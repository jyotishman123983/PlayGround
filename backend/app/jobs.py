"""In-memory job manager.

Jobs live in memory for the lifetime of the process. That is deliberate for a
prototype: no database, no hidden state. Swap this module for a queue (Redis,
Celery, RQ…) when you deploy for real. The HTTP contract stays identical.
"""

from __future__ import annotations

import base64
import binascii
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .engines import EngineUnavailable, GenerationRequest, get_engine
from .engines.base import GenerationResult
from .schemas import GenerationRequestBody


@dataclass
class Job:
    id: str
    status: str = "queued"  # queued | running | completed | failed
    progress: Optional[float] = None
    message: str = ""
    prompt: str = ""
    aspect_ratio: str = "9:16"
    duration: int = 4
    style: str = "cinematic"
    engine: Optional[str] = None
    model: Optional[str] = None
    is_demo: bool = False
    video_path: Optional[Path] = None
    thumbnail_path: Optional[Path] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)


class JobManager:
    def __init__(self, output_dir: Path) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._output_dir = output_dir

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def forget(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)

    def _update(self, job: Job, **changes) -> None:
        with self._lock:
            for key, value in changes.items():
                setattr(job, key, value)
            job.updated_at = time.time()

    def submit(self, body: GenerationRequestBody) -> Job:
        job = Job(
            id=uuid.uuid4().hex,
            prompt=body.prompt,
            aspect_ratio=body.aspect_ratio,
            duration=body.duration,
            style=body.style,
        )
        with self._lock:
            self._jobs[job.id] = job

        thread = threading.Thread(target=self._run, args=(job.id, body), daemon=True)
        thread.start()
        return job

    # -- internals ----------------------------------------------------------
    def _write_image(self, job_id: str, data_url: str) -> Optional[Path]:
        if not data_url:
            return None
        if not data_url.startswith("data:"):
            raise ValueError("Image must be a data URL, e.g. data:image/png;base64,...")
        try:
            header, encoded = data_url.split(",", 1)
        except ValueError as exc:
            raise ValueError("Malformed image data URL.") from exc
        if "base64" not in header:
            raise ValueError("Image data URL must be base64 encoded.")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Image data could not be decoded.") from exc
        if len(raw) > 10 * 1024 * 1024:
            raise ValueError("Image is larger than the 10 MB limit.")
        target = self._output_dir / f"input-{job_id}.img"
        target.write_bytes(raw)
        return target

    def _run(self, job_id: str, body: GenerationRequestBody) -> None:
        job = self.get(job_id)
        if job is None:
            return
        engine = get_engine()
        self._update(job, status="running", engine=engine.name, model=engine.model, is_demo=engine.is_demo)

        if not engine.is_available():
            self._update(job, status="failed", error=engine.describe(), message=engine.describe())
            return

        def on_progress(value: float, message: Optional[str] = None) -> None:
            # Only called with real values from the engine.
            self._update(job, progress=max(0.0, min(1.0, value)), message=message or job.message)

        image_path = None
        try:
            if body.input_mode == "image":
                if not engine.supports_image:
                    raise EngineUnavailable("The configured engine does not support image-to-video yet.")
                if not body.image:
                    raise ValueError("input_mode is 'image' but no image was provided.")
                image_path = self._write_image(job_id, body.image)

            request = GenerationRequest(
                prompt=body.prompt,
                aspect_ratio=body.aspect_ratio,
                duration=min(body.duration, engine.max_duration),
                style=body.style,
                quality=body.quality,
                negative_prompt=body.negative_prompt,
                image_path=image_path,
            )
            result: GenerationResult = engine.generate(request, on_progress)
            self._update(
                job,
                status="completed",
                progress=1.0,
                message="Completed",
                video_path=result.video_path,
                thumbnail_path=result.thumbnail_path,
                model=result.model or engine.model,
                is_demo=result.is_demo,
            )
        except EngineUnavailable as exc:
            self._update(job, status="failed", error=str(exc), message=str(exc))
        except Exception as exc:  # noqa: BLE001 - surface any model error to the client
            self._update(job, status="failed", error=f"{type(exc).__name__}: {exc}", message="Generation failed")
        finally:
            if image_path and image_path.exists():
                image_path.unlink(missing_ok=True)
