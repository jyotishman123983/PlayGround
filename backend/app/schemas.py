from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

AspectRatio = Literal["9:16", "16:9", "1:1"]
InputMode = Literal["text", "image"]


class GenerationRequestBody(BaseModel):
    prompt: str = Field(default="", max_length=1200)
    negative_prompt: str = ""
    input_mode: InputMode = "text"
    # Data URL (data:image/png;base64,...). Kept short-lived in memory only.
    image: Optional[str] = None
    aspect_ratio: AspectRatio = "9:16"
    duration: int = Field(default=4, ge=1, le=30)
    style: str = "cinematic"
    quality: str = "standard"

    @field_validator("prompt")
    @classmethod
    def require_prompt_or_image(cls, value: str) -> str:
        return value.strip()


class GenerationCreated(BaseModel):
    id: str
    status: Literal["queued"] = "queued"


class GenerationStatus(BaseModel):
    id: str
    status: Literal["queued", "running", "completed", "failed"]
    progress: Optional[float] = None
    message: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    engine: Optional[str] = None
    model: Optional[str] = None
    is_demo: bool = False


class HealthResponse(BaseModel):
    status: Literal["ok", "unavailable"]
    engine: Optional[str] = None
    model: Optional[str] = None
    demo: bool = False
    message: str = ""
    capabilities: dict = {}
