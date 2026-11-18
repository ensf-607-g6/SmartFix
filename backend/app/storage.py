"""Photo storage on local disk (swap for Supabase Storage by reimplementing save/load)."""
import hashlib
import io
from pathlib import Path
from uuid import uuid4

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_SIDE = 1600
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


class InvalidImage(ValueError):
    pass


class PhotoStorage:
    def __init__(self, root: Path):
        self.root = Path(root)
        for kind in ("report", "after"):
            (self.root / kind).mkdir(parents=True, exist_ok=True)

    def save(self, data: bytes, kind: str) -> tuple[str, str, str]:
        """Normalise to an upright JPEG; returns (storage_path, sha256, mime_type)."""
        if len(data) > MAX_UPLOAD_BYTES:
            raise InvalidImage("Photo is larger than 15 MB")
        try:
            img = Image.open(io.BytesIO(data))
            img = ImageOps.exif_transpose(img).convert("RGB")
        except (UnidentifiedImageError, OSError) as exc:
            raise InvalidImage("File is not a readable image") from exc
        img.thumbnail((MAX_SIDE, MAX_SIDE))
        out = io.BytesIO()
        img.save(out, "JPEG", quality=85)
        jpeg = out.getvalue()
        path = f"{kind}/{uuid4()}.jpg"
        (self.root / path).write_bytes(jpeg)
        return path, hashlib.sha256(jpeg).hexdigest(), "image/jpeg"

    def load(self, storage_path: str) -> bytes:
        return self.path(storage_path).read_bytes()

    def path(self, storage_path: str) -> Path:
        full = (self.root / storage_path).resolve()
        if self.root.resolve() not in full.parents:
            raise FileNotFoundError(storage_path)
        return full
