"""Engine interface for connecting an open-source text-to-video model.

Anything that implements :class:`VideoEngine` can be plugged into ViralYantra.
The rest of the server only knows about this interface, so swapping models never
touches the HTTP layer.

Contract
--------
* ``is_available()`` must return ``True`` only when the engine can actually run
  right now. If it returns ``False`` the API answers ``503`` and the web app
  keeps showing "engine unavailable" — it never fakes output.
* ``generate()`` runs the model and returns a real file path. Report progress
  through ``on_progress`` with values in ``[0, 1]`` **only when the model
  actually reports progress**. Never invent percentages.
* ``is_demo`` must be ``True`` for anything that is not a real model generation
  (for example a bundled sample file). The web app relies on this flag to avoid
  labelling a sample as AI output.

To add a new model:
1. Create ``app/engines/my_engine.py`` implementing this protocol.
2. Register it in ``app/engines/registry.py``.
3. Set ``VY_ENGINE=my_engine`` in the environment.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Protocol, runtime_checkable

ProgressCallback = Callable[[float, Optional[str]], None]


class EngineUnavailable(RuntimeError):
    """Raised when an engine cannot run (missing deps, no weights, no GPU…)."""


@dataclass
class GenerationRequest:
    prompt: str
    aspect_ratio: str = "9:16"
    duration: int = 4
    style: str = "cinematic"
    quality: str = "standard"
    negative_prompt: str = ""
    image_path: Optional[Path] = None  # set for image-to-video runs


@dataclass
class GenerationResult:
    video_path: Path
    is_demo: bool
    model: Optional[str] = None
    thumbnail_path: Optional[Path] = None
    metadata: Optional[dict] = None


@runtime_checkable
class VideoEngine(Protocol):
    name: str
    model: Optional[str]
    supports_image: bool
    max_duration: int
    is_demo: bool

    def is_available(self) -> bool:
        """True only if generate() can succeed right now."""

    def describe(self) -> str:
        """Short human-readable status shown by /api/health."""

    def generate(self, request: GenerationRequest, on_progress: ProgressCallback) -> GenerationResult:
        """Run the model. Must be safe to call from a worker thread."""
