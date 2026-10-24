"""Engine registry — the single place that decides what can run.

Add new engines here and select them with the ``VY_ENGINE`` environment variable.
"""

from __future__ import annotations

from ..config import settings
from .base import VideoEngine
from .diffusers_t2v import DiffusersTextToVideoEngine
from .sample import SampleEngine
from .unavailable import UnavailableEngine

_engine: VideoEngine | None = None


def build_engine() -> VideoEngine:
    choice = settings.engine

    if choice == "sample":
        return SampleEngine(
            sample_dir=settings.sample_dir,
            output_dir=settings.output_dir,
            max_duration=settings.max_duration,
        )

    if choice == "diffusers":
        return DiffusersTextToVideoEngine(
            model_id=settings.model_id,
            output_dir=settings.output_dir,
            device=settings.device,
            torch_dtype=settings.torch_dtype,
            num_inference_steps=settings.num_inference_steps,
            fps=settings.frames_per_second,
            max_duration=settings.max_duration,
            allow_cpu=settings.allow_cpu,
        )

    return UnavailableEngine(
        max_duration=settings.max_duration,
        reason=(
            f"VY_ENGINE={choice!r} is not a known engine. "
            "Set VY_ENGINE=diffusers (real model) or VY_ENGINE=sample (bundled demo clips)."
        ),
    )


def get_engine() -> VideoEngine:
    global _engine
    if _engine is None:
        _engine = build_engine()
    return _engine
