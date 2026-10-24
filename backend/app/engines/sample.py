"""Bundled-sample engine (explicitly ``is_demo=True``).

This engine exists so you can exercise the full HTTP pipeline — uploads, jobs,
polling, streaming — without downloading a multi-gigabyte model. It serves the
same procedural sample clips that ship with the web app and always reports
``is_demo=True``. The frontend therefore labels its output as a demo clip, never
as AI, so it is safe to leave enabled.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from .base import EngineUnavailable, GenerationRequest, GenerationResult, ProgressCallback

ASPECT_FILES = {
    "9:16": "demo-portrait.mp4",
    "16:9": "demo-landscape.mp4",
    "1:1": "demo-square.mp4",
}


class SampleEngine:
    name = "sample-clips"
    model = "bundled-procedural-sample"
    supports_image = True
    is_demo = True

    def __init__(self, sample_dir: Path, output_dir: Path, max_duration: int = 8) -> None:
        self._sample_dir = sample_dir
        self._output_dir = output_dir
        self.max_duration = max_duration

    def _source_for(self, aspect_ratio: str) -> Path:
        return self._sample_dir / ASPECT_FILES.get(aspect_ratio, ASPECT_FILES["9:16"])

    def is_available(self) -> bool:
        return all((self._sample_dir / name).exists() for name in ASPECT_FILES.values())

    def describe(self) -> str:
        if self.is_available():
            return "Serving bundled procedural sample clips. Output is flagged as a demo, not AI."
        return f"Sample clips not found in {self._sample_dir}. Copy the files from public/demo."

    def generate(self, request: GenerationRequest, on_progress: ProgressCallback) -> GenerationResult:
        if not self.is_available():
            raise EngineUnavailable(self.describe())
        source = self._source_for(request.aspect_ratio)
        on_progress(0.0, "Copying bundled sample clip (demo, not AI)")
        target = self._output_dir / f"sample-{request.aspect_ratio.replace(':', '-')}.mp4"
        shutil.copyfile(source, target)
        on_progress(1.0, "Sample clip ready (demo)")
        return GenerationResult(video_path=target, is_demo=True, model=self.model)
