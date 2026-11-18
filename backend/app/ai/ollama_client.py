"""ModelClient adapter for the local Ollama runtime (NFR-5: photos never leave the machine).
Every call tries the vision model first and falls back to the smaller model."""
import base64
import io
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Protocol

import httpx
from PIL import Image

log = logging.getLogger("smartfix.ai")

PROBLEM_TYPES = ["pothole", "streetlight", "water_leak", "sidewalk_crack", "other"]
MODEL_IMAGE_SIDE = 896


class ModelUnavailable(RuntimeError):
    pass


@dataclass
class ModelResult:
    model_name: str
    latency_ms: int
    raw: dict = field(default_factory=dict)


@dataclass
class Classification(ModelResult):
    problem_type: str = "other"
    severity: int = 3
    confidence: float = 0.0
    is_infrastructure: bool = True
    summary: str = ""


@dataclass
class DuplicateVerdict(ModelResult):
    is_match: bool = False
    confidence: float = 0.0


@dataclass
class RepairVerdictResult(ModelResult):
    verdict: str = "unclear"          # repaired | not_repaired | unclear
    confidence: float = 0.0


class ModelClient(Protocol):
    async def classify(self, photo: bytes, text: str, chosen_type: str) -> Classification: ...
    async def compare_reports(self, a: bytes, b: bytes, distance_m: float, problem_type: str) -> DuplicateVerdict: ...
    async def verify_repair(self, before: bytes, after: bytes, problem_type: str) -> RepairVerdictResult: ...
    async def write_message(self, prompt: str) -> str: ...


def _encode(photo: bytes) -> str:
    img = Image.open(io.BytesIO(photo)).convert("RGB")
    img.thumbnail((MODEL_IMAGE_SIDE, MODEL_IMAGE_SIDE))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=85)
    return base64.b64encode(out.getvalue()).decode()


def _clamp(value, lo: float, hi: float, default: float) -> float:
    try:
        return max(lo, min(hi, float(value)))
    except (TypeError, ValueError):
        return default


CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "is_infrastructure": {"type": "boolean"},
        "problem_type": {"type": "string", "enum": PROBLEM_TYPES},
        "severity": {"type": "integer", "minimum": 1, "maximum": 5},
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "summary": {"type": "string"},
    },
    "required": ["is_infrastructure", "problem_type", "severity", "confidence", "summary"],
}

CLASSIFY_PROMPT = """You inspect photos sent to a city's public-infrastructure repair service.

Decide whether the photo shows public infrastructure (roads, sidewalks, street lights,
water mains, hydrants, drains, signs, railings, public property). Selfies, pets, food,
indoor rooms, screenshots or unrelated objects are NOT infrastructure.

Pick the problem type:
- pothole: hole or broken surface in a road or parking lane
- streetlight: street light that is out, broken, leaning or exposed wiring
- water_leak: leaking or burst pipe, hydrant, water main, or water pooling from one
- sidewalk_crack: cracked, lifted or broken sidewalk, curb or path
- other: any other damaged public infrastructure

Rate severity 1-5:
1 cosmetic, no risk | 2 minor, low risk | 3 moderate, should be fixed soon |
4 serious hazard to vehicles or pedestrians | 5 immediate danger to life or major service failure

confidence is how sure you are of the problem type and severity, from 0 to 1.
Use the photo as the main evidence. summary is one short sentence describing what you see.

The resident chose the category "{chosen}" and wrote: "{text}"
Reply with JSON only."""

COMPARE_PROMPT = """Two residents reported a {ptype} problem {distance:.0f} metres apart.
Image 1 is from the existing report, image 2 is the new report.
Do both photos show the SAME physical problem (the same pothole, the same light, the same leak)?
Consider the surroundings, shape and size. Different angles or lighting of the same thing count as a match.
Reply with JSON: is_match (boolean) and confidence (0 to 1)."""

VERIFY_PROMPT = """A repair crew says they fixed a {ptype}.
Image 1 was taken before the repair, image 2 after.
Does image 2 show the problem from image 1 repaired?
verdict: "repaired" if clearly fixed, "not_repaired" if the damage is still there,
"unclear" if the photos cannot be compared (different place, blurry, too dark).
Reply with JSON: verdict and confidence (0 to 1)."""


class OllamaClient:
    def __init__(self, base_url: str, model: str, fallback_model: str, timeout_s: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.fallback_model = fallback_model
        self.client = httpx.AsyncClient(timeout=timeout_s)

    async def close(self) -> None:
        await self.client.aclose()

    async def warm_up(self) -> None:
        """Load the vision model into memory so the first report meets the 15 s target."""
        try:
            await self.client.post(f"{self.base_url}/api/generate",
                                   json={"model": self.model, "keep_alive": "30m"})
            log.info("Ollama model %s loaded", self.model)
        except Exception as exc:
            log.warning("Ollama warm-up failed: %s", exc)

    async def health(self) -> dict:
        try:
            r = await self.client.get(f"{self.base_url}/api/tags", timeout=3)
            names = [m["name"] for m in r.json().get("models", [])]
            return {"reachable": True, "vision_model": self.model in names,
                    "fallback_model": self.fallback_model in names}
        except Exception:
            return {"reachable": False, "vision_model": False, "fallback_model": False}

    async def _chat(self, prompt: str, images: list[str] | None = None,
                    schema: dict | None = None) -> tuple[str, str, int]:
        errors = []
        for model in (self.model, self.fallback_model):
            body = {"model": model, "stream": False, "keep_alive": "30m",
                    "options": {"temperature": 0},
                    "messages": [{"role": "user", "content": prompt, **({"images": images} if images else {})}]}
            if schema:
                body["format"] = schema
            started = time.perf_counter()
            try:
                r = await self.client.post(f"{self.base_url}/api/chat", json=body)
                r.raise_for_status()
                content = r.json()["message"]["content"].strip()
                if not content:
                    raise ValueError("empty response")
                return content, model, int((time.perf_counter() - started) * 1000)
            except Exception as exc:
                log.warning("model %s failed: %s", model, exc)
                errors.append(f"{model}: {exc}")
        raise ModelUnavailable("; ".join(errors))

    async def _json(self, prompt: str, images: list[str], schema: dict) -> tuple[dict, str, int]:
        content, model, ms = await self._chat(prompt, images, schema)
        try:
            return json.loads(content), model, ms
        except json.JSONDecodeError:
            start, end = content.find("{"), content.rfind("}")
            if start >= 0 and end > start:
                return json.loads(content[start:end + 1]), model, ms
            raise ModelUnavailable(f"unparseable model output: {content[:200]}")

    async def classify(self, photo: bytes, text: str, chosen_type: str) -> Classification:
        prompt = CLASSIFY_PROMPT.format(chosen=chosen_type, text=(text or "(no description)")[:500])
        data, model, ms = await self._json(prompt, [_encode(photo)], CLASSIFY_SCHEMA)
        ptype = data.get("problem_type")
        return Classification(
            model_name=model, latency_ms=ms, raw=data,
            problem_type=ptype if ptype in PROBLEM_TYPES else "other",
            severity=int(_clamp(data.get("severity"), 1, 5, 3)),
            confidence=_clamp(data.get("confidence"), 0, 1, 0),
            is_infrastructure=bool(data.get("is_infrastructure", True)),
            summary=str(data.get("summary", ""))[:300])

    async def compare_reports(self, a: bytes, b: bytes, distance_m: float, problem_type: str) -> DuplicateVerdict:
        schema = {"type": "object", "properties": {"is_match": {"type": "boolean"},
                                                    "confidence": {"type": "number"}},
                  "required": ["is_match", "confidence"]}
        prompt = COMPARE_PROMPT.format(ptype=problem_type.replace("_", " "), distance=distance_m)
        data, model, ms = await self._json(prompt, [_encode(a), _encode(b)], schema)
        return DuplicateVerdict(model_name=model, latency_ms=ms, raw=data,
                                is_match=bool(data.get("is_match")),
                                confidence=_clamp(data.get("confidence"), 0, 1, 0))

    async def verify_repair(self, before: bytes, after: bytes, problem_type: str) -> RepairVerdictResult:
        schema = {"type": "object", "properties": {
            "verdict": {"type": "string", "enum": ["repaired", "not_repaired", "unclear"]},
            "confidence": {"type": "number"}}, "required": ["verdict", "confidence"]}
        prompt = VERIFY_PROMPT.format(ptype=problem_type.replace("_", " "))
        data, model, ms = await self._json(prompt, [_encode(before), _encode(after)], schema)
        verdict = data.get("verdict")
        return RepairVerdictResult(model_name=model, latency_ms=ms, raw=data,
                                   verdict=verdict if verdict in ("repaired", "not_repaired", "unclear") else "unclear",
                                   confidence=_clamp(data.get("confidence"), 0, 1, 0))

    async def write_message(self, prompt: str) -> str:
        content, _, _ = await self._chat(prompt)
        return content.strip().strip('"')
