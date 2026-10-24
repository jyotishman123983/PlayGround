"""API tests. They use the bundled sample engine and verify the honesty flags."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.engines.base import EngineUnavailable, GenerationRequest
from app.engines.unavailable import UnavailableEngine
from app.main import app

client = TestClient(app)


def test_health_reports_sample_engine_and_demo_flag():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["engine"] == "sample-clips"
    assert data["demo"] is True
    assert data["capabilities"]["aspect_ratios"] == ["9:16", "16:9", "1:1"]


def test_text_generation_flow_returns_demo_output():
    created = client.post(
        "/api/generations",
        json={"prompt": "A test clip", "input_mode": "text", "aspect_ratio": "16:9", "duration": 4},
    )
    assert created.status_code == 202
    job_id = created.json()["id"]

    final = None
    for _ in range(50):
        status = client.get(f"/api/generations/{job_id}")
        assert status.status_code == 200
        final = status.json()
        if final["status"] in {"completed", "failed"}:
            break
        time.sleep(0.05)

    assert final is not None
    assert final["status"] == "completed", final
    assert final["is_demo"] is True
    assert final["video_url"] == f"/api/generations/{job_id}/video"

    video = client.get(final["video_url"])
    assert video.status_code == 200
    assert video.headers["content-type"].startswith("video/")


def test_missing_prompt_is_rejected():
    response = client.post("/api/generations", json={"prompt": "", "input_mode": "text"})
    assert response.status_code == 422


def test_unknown_job_returns_404():
    assert client.get("/api/generations/does-not-exist").status_code == 404


def test_unavailable_engine_refuses_to_fake_output():
    engine = UnavailableEngine()
    assert engine.is_available() is False
    try:
        engine.generate(GenerationRequest(prompt="x"), lambda *_args: None)
    except EngineUnavailable:
        pass
    else:  # pragma: no cover
        raise AssertionError("UnavailableEngine must not produce output")
