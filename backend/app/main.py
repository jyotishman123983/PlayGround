"""ViralYantra AI reference backend (FastAPI).

Run it with:
    uvicorn app.main:app --host 0.0.0.0 --port 8000

Design rules:
* No secret keys. Models are loaded from local disk or public model hubs.
* Nothing is faked. If no engine is ready, /api/health says so and
  /api/generations returns 503.
* Progress is only what the engine reports.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import __version__
from .config import settings
from .engines import get_engine
from .jobs import Job, JobManager
from .schemas import GenerationCreated, GenerationRequestBody, GenerationStatus, HealthResponse

app = FastAPI(
    title="ViralYantra AI backend",
    version=__version__,
    description="Honest, modular bridge between the ViralYantra web app and open-source video models.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

manager = JobManager(settings.output_dir)


def _health() -> HealthResponse:
    engine = get_engine()
    available = engine.is_available()
    return HealthResponse(
        status="ok" if available else "unavailable",
        engine=engine.name if available else None,
        model=engine.model,
        demo=engine.is_demo,
        message=engine.describe(),
        capabilities={
            "image_to_video": engine.supports_image,
            "max_duration": engine.max_duration,
            "aspect_ratios": ["9:16", "16:9", "1:1"],
        },
    )


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return _health()


@app.get("/api/models")
def models() -> dict:
    engine = get_engine()
    return {
        "active": engine.name,
        "model": engine.model,
        "available": engine.is_available(),
        "custom_engines": ["diffusers-text-to-video", "sample-clips", "unavailable"],
        "select_with": "VY_ENGINE environment variable (see backend/README.md)",
    }


@app.post("/api/generations", response_model=GenerationCreated, status_code=202)
def create_generation(body: GenerationRequestBody) -> GenerationCreated:
    engine = get_engine()
    if not engine.is_available():
        raise HTTPException(status_code=503, detail=engine.describe())
    if body.input_mode == "text" and not body.prompt:
        raise HTTPException(status_code=422, detail="A prompt is required for text-to-video.")
    if body.input_mode == "image" and not body.image:
        raise HTTPException(status_code=422, detail="An image is required for image-to-video.")

    job = manager.submit(body)
    return GenerationCreated(id=job.id)


def _serialize(job: Job) -> GenerationStatus:
    return GenerationStatus(
        id=job.id,
        status=job.status,  # type: ignore[arg-type]
        progress=job.progress,
        message=job.error or job.message,
        video_url=f"/api/generations/{job.id}/video" if job.status == "completed" else None,
        thumbnail_url=f"/api/generations/{job.id}/thumbnail" if job.thumbnail_path else None,
        engine=job.engine,
        model=job.model,
        is_demo=job.is_demo,
    )


@app.get("/api/generations/{job_id}", response_model=GenerationStatus)
def get_generation(job_id: str) -> GenerationStatus:
    job = manager.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown generation id.")
    return _serialize(job)


@app.get("/api/generations/{job_id}/video")
def get_video(job_id: str) -> FileResponse:
    job = manager.get(job_id)
    if job is None or job.status != "completed" or not job.video_path or not job.video_path.exists():
        raise HTTPException(status_code=404, detail="Video is not ready.")
    return FileResponse(job.video_path, media_type="video/mp4", filename=f"{job.id}.mp4")


@app.get("/api/generations/{job_id}/thumbnail")
def get_thumbnail(job_id: str) -> FileResponse:
    job = manager.get(job_id)
    if job is None or not job.thumbnail_path or not job.thumbnail_path.exists():
        raise HTTPException(status_code=404, detail="No thumbnail available.")
    return FileResponse(job.thumbnail_path)


@app.delete("/api/generations/{job_id}")
def delete_generation(job_id: str) -> dict:
    job = manager.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown generation id.")
    for path in (job.video_path, job.thumbnail_path):
        if path and path.exists():
            path.unlink(missing_ok=True)
    manager.forget(job_id)
    return {"deleted": job_id}
