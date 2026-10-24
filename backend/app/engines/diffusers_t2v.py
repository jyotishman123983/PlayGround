"""Example adapter for a real open-source text-to-video model (Diffusers).

This file is the reference implementation of the model integration described in
``backend/README.md``. It is *not* installed by default. To use it:

    pip install -r requirements.txt -r requirements-model.txt
    VY_ENGINE=diffusers VY_MODEL_ID=damo-vilab/text-to-video-ms-1.7b \\
        uvicorn app.main:app --host 0.0.0.0 --port 8000

Any Hugging Face Diffusers text-to-video checkpoint works, for example:
* ``damo-vilab/text-to-video-ms-1.7b`` (ModelScope, light and easy to start)
* ``Wan-AI/Wan2.1-T2V-1.3B-Diffusers`` (newer, higher quality, heavier)
* ``Lightricks/LTX-Video`` (fast, strong motion)
* ``THUDM/CogVideoX-2b``

Progress is only forwarded when the pipeline reports it through
``callback_on_step_end``. If a pipeline does not support that hook, the job stays
"running" with an indeterminate status instead of inventing a percentage.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .base import EngineUnavailable, GenerationRequest, GenerationResult, ProgressCallback

# ModelScope MS 1.7B is trained for ~16 frames; keep it honest about that.
DEFAULT_FRAMES = 16


class DiffusersTextToVideoEngine:
    name = "diffusers-text-to-video"
    supports_image = False

    def __init__(
        self,
        model_id: str,
        output_dir: Path,
        device: str = "auto",
        torch_dtype: str = "auto",
        num_inference_steps: int = 30,
        fps: int = 8,
        max_duration: int = 8,
        allow_cpu: bool = True,
    ) -> None:
        self.model = model_id
        self.is_demo = False
        self.max_duration = max_duration
        self._output_dir = output_dir
        self._device_pref = device
        self._dtype_pref = torch_dtype
        self._steps = num_inference_steps
        self._fps = fps
        self._allow_cpu = allow_cpu
        self._pipe: Any | None = None
        self._device = "cpu"

    # -- availability -------------------------------------------------------
    def _imports(self):
        try:
            import torch  # noqa: F401
            from diffusers import DiffusionPipeline  # noqa: F401
        except Exception as exc:  # pragma: no cover - depends on optional deps
            raise EngineUnavailable(
                f"Diffusers/torch are not installed ({exc}). Run: pip install -r requirements-model.txt"
            ) from exc

    def _resolve_device(self) -> str:
        import torch

        if self._device_pref != "auto":
            return self._device_pref
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        if not self._allow_cpu:
            raise EngineUnavailable("No GPU detected and VY_ALLOW_CPU=false.")
        return "cpu"

    def is_available(self) -> bool:
        try:
            self._imports()
            self._resolve_device()
        except EngineUnavailable:
            return False
        return True

    def describe(self) -> str:
        if not self.is_available():
            return "Model engine not ready. Install requirements-model.txt and enable a GPU, or set VY_ALLOW_CPU=true."
        return f"Ready to load {self.model} on {self._resolve_device()}."

    # -- loading ------------------------------------------------------------
    def _load(self):
        if self._pipe is not None:
            return self._pipe
        self._imports()
        import torch
        from diffusers import DiffusionPipeline

        device = self._resolve_device()
        dtype = torch.float16 if device in {"cuda", "mps"} else torch.float32
        if self._dtype_pref != "auto":
            dtype = getattr(torch, self._dtype_pref, dtype)
        pipe = DiffusionPipeline.from_pretrained(self.model, torch_dtype=dtype)
        # CPU offload keeps memory low on small GPUs but is not supported on CPU.
        if device == "cuda" and hasattr(pipe, "enable_model_cpu_offload"):
            pipe.enable_model_cpu_offload()
        else:
            pipe = pipe.to(device)
        self._pipe = pipe
        self._device = device
        return pipe

    # -- generation ---------------------------------------------------------
    def _frame_count(self, duration: int) -> int:
        """Map requested seconds to the frames the checkpoint can actually make."""
        return max(8, min(int(duration) * self._fps, DEFAULT_FRAMES * 2))

    def _save_frames(self, frames, path: Path) -> None:
        import imageio.v2 as imageio
        import numpy as np

        normalized = []
        for frame in frames:
            array = np.asarray(frame)
            if array.dtype != np.uint8:
                array = (array.clip(0, 1) * 255).astype("uint8")
            normalized.append(array)
        imageio.mimsave(str(path), normalized, fps=self._fps, codec="libx264", quality=7)

    def generate(self, request: GenerationRequest, on_progress: ProgressCallback) -> GenerationResult:
        if request.image_path is not None and not self.supports_image:
            raise EngineUnavailable("This text-to-video engine does not support image-to-video input yet.")

        pipe = self._load()
        frames = self._frame_count(request.duration)
        steps = self._steps

        def _callback(_pipe, step: int, _timestep, _kwargs):
            # Real progress from the sampler only.
            on_progress(min(0.98, (step + 1) / steps), f"Denoising step {step + 1}/{steps}")

        on_progress(0.0, f"Generating {frames} frames on {self._device}")
        kwargs: dict[str, Any] = {
            "prompt": request.prompt,
            "num_inference_steps": steps,
            "num_frames": frames,
        }
        if request.negative_prompt:
            kwargs["negative_prompt"] = request.negative_prompt
        try:
            result = pipe(callback_on_step_end=_callback, **kwargs)
        except TypeError:
            # Pipeline does not support the step callback — run it straight.
            result = pipe(**kwargs)

        frame_list = result.frames[0]
        slug = request.prompt[:24].strip().replace(" ", "-") or "clip"
        safe = "".join(ch for ch in slug if ch.isalnum() or ch in "-_") or "clip"
        target = self._output_dir / f"{safe}-{os.getpid()}.mp4"
        self._save_frames(frame_list, target)
        on_progress(1.0, "Encoding finished")
        return GenerationResult(video_path=target, is_demo=False, model=self.model)
