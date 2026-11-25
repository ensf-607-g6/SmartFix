"""Photo storage with pluggable backends: local disk or Supabase Storage.

Choose with env var STORAGE_BACKEND = "local" (default) | "supabase".
"""
import hashlib
import io
import os
from abc import ABC, abstractmethod
from pathlib import Path
from uuid import uuid4
from .config import Settings, get_settings

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_SIDE = 1600
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


class InvalidImage(ValueError):
    pass


class PhotoStorage(ABC):
    """Shared validation/normalisation; subclasses only implement raw byte I/O."""

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
        self._write(path, jpeg)
        return path, hashlib.sha256(jpeg).hexdigest(), "image/jpeg"

    @abstractmethod
    def _write(self, storage_path: str, jpeg: bytes) -> None: ...

    @abstractmethod
    def load(self, storage_path: str) -> bytes: ...

    @abstractmethod
    def delete(self, storage_path: str) -> None: ...

    def signed_url(self, storage_path: str, expires_in: int = 3600) -> str | None:
        """A browser-loadable URL, or None if the backend can't provide one
        (callers should then serve the bytes from load())."""
        return None


class LocalPhotoStorage(PhotoStorage):
    def __init__(self, root: Path | str = "uploads"):
        self.root = Path(root)
        for kind in ("report", "after"):
            (self.root / kind).mkdir(parents=True, exist_ok=True)

    def _resolve(self, storage_path: str) -> Path:
        full = (self.root / storage_path).resolve()
        if self.root.resolve() not in full.parents:
            raise FileNotFoundError(storage_path)
        return full

    def _write(self, storage_path: str, jpeg: bytes) -> None:
        self._resolve(storage_path).write_bytes(jpeg)

    def load(self, storage_path: str) -> bytes:
        return self._resolve(storage_path).read_bytes()

    def delete(self, storage_path: str) -> None:
        self._resolve(storage_path).unlink(missing_ok=True)


class SupabasePhotoStorage(PhotoStorage):
    def __init__(self, url: str, key: str, bucket: str = "photos"):
        from supabase import create_client  # lazy: not needed for local mode

        self.bucket = create_client(url, key).storage.from_(bucket)

    def _write(self, storage_path: str, jpeg: bytes) -> None:
        self.bucket.upload(
            storage_path, jpeg,
            file_options={"content-type": "image/jpeg", "upsert": "false"},
        )

    def load(self, storage_path: str) -> bytes:
        return self.bucket.download(storage_path)

    def delete(self, storage_path: str) -> None:
        self.bucket.remove([storage_path])

    def signed_url(self, storage_path: str, expires_in: int = 3600) -> str | None:
        return self.bucket.create_signed_url(storage_path, expires_in)["signedURL"]


def create_storage() -> PhotoStorage:
    backend = os.getenv("STORAGE_BACKEND", "local").strip().lower()
    if backend == "local":
        settings = get_settings()
        return LocalPhotoStorage(settings.storage_dir)
    if backend == "supabase":
        try:
            return SupabasePhotoStorage(
                os.environ["SUPABASE_URL"],
                os.environ["SUPABASE_SERVICE_ROLE_KEY"],
                os.getenv("SUPABASE_BUCKET", "photos"),
            )
        except KeyError as exc:
            raise RuntimeError(f"Missing env var for Supabase storage: {exc}") from exc
    raise RuntimeError(f"Unknown STORAGE_BACKEND '{backend}' (use 'local' or 'supabase')")