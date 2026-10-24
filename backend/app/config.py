"""Configuration is read from environment variables.

No secret API keys belong here — open-source models are loaded from local disk
or from a public model hub by name. The frontend never receives any credential.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_ROOT.parent


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    # "unavailable" | "sample" | "diffusers"
    engine: str = field(default_factory=lambda: os.environ.get("VY_ENGINE", "unavailable").strip().lower())
    model_id: str = field(default_factory=lambda: os.environ.get("VY_MODEL_ID", "damo-vilab/text-to-video-ms-1.7b"))
    output_dir: Path = field(default_factory=lambda: Path(os.environ.get("VY_OUTPUT_DIR", str(BACKEND_ROOT / "outputs"))))
    sample_dir: Path = field(default_factory=lambda: Path(os.environ.get("VY_SAMPLE_DIR", str(REPO_ROOT / "public" / "demo"))))
    device: str = field(default_factory=lambda: os.environ.get("VY_DEVICE", "auto"))
    torch_dtype: str = field(default_factory=lambda: os.environ.get("VY_TORCH_DTYPE", "auto"))
    cors_origins: str = field(default_factory=lambda: os.environ.get("VY_CORS_ORIGINS", "*"))
    max_duration: int = field(default_factory=lambda: int(os.environ.get("VY_MAX_DURATION", "8")))
    num_inference_steps: int = field(default_factory=lambda: int(os.environ.get("VY_STEPS", "30")))
    frames_per_second: int = field(default_factory=lambda: int(os.environ.get("VY_FPS", "8")))
    allow_cpu: bool = field(default_factory=lambda: _env_bool("VY_ALLOW_CPU", True))

    @property
    def cors_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
settings.output_dir.mkdir(parents=True, exist_ok=True)
