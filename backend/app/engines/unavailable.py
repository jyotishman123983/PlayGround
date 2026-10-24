"""Default engine: honestly reports that nothing is configured.

With the default ``VY_ENGINE=unavailable`` the server still boots, exposes
``/api/health`` and returns an explicit error from ``/api/generations``.
That is deliberate: the web app must never mistake "no engine" for "ready".
"""

from __future__ import annotations

from .base import EngineUnavailable, GenerationRequest, GenerationResult, ProgressCallback


class UnavailableEngine:
    name = "unavailable"
    model = None
    supports_image = False
    is_demo = False

    def __init__(self, max_duration: int = 8, reason: str = "") -> None:
        self.max_duration = max_duration
        self._reason = reason or "No open-source model is configured on this server."

    def is_available(self) -> bool:
        return False

    def describe(self) -> str:
        return self._reason

    def generate(self, request: GenerationRequest, on_progress: ProgressCallback) -> GenerationResult:
        raise EngineUnavailable(self._reason)
