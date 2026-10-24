# ViralYantra AI — Generation Backend

An honest, modular FastAPI bridge between the ViralYantra web app and any
open-source text-to-video model. It is free to run and needs **no API keys**.

> **Honesty rules enforced by this server**
> - With no engine configured, `/api/health` reports `status: "unavailable"` and
>   `/api/generations` returns HTTP `503`. Nothing is faked.
> - Progress values come only from the engine. If a pipeline cannot report
>   progress, the job stays `running` (indeterminate) instead of inventing one.
> - Anything that is not a real model run is returned with `is_demo: true`, and
>   the web app labels it as a demo clip, never as AI output.

---

## 1. Quick start (no model yet)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open <http://localhost:8000/docs> for interactive API docs. By default you get
the `unavailable` engine, which is the correct, honest starting point.

### Try the sample engine (full pipeline, still no model)

The sample engine serves the bundled procedural clips but marks them
`is_demo: true`, so the app will always show them as demo content.

```bash
VY_ENGINE=sample uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## 2. Connect an open-source model

The reference adapter lives in [`app/engines/diffusers_t2v.py`](app/engines/diffusers_t2v.py).
It uses Hugging Face **Diffusers**, the standard library for open-source
diffusion models.

### Step 1 — install model dependencies

```bash
pip install -r requirements-model.txt
```

This installs `torch`, `diffusers`, `transformers`, `accelerate`, `imageio`,
`imageio-ffmpeg`, and `Pillow`. All are free and open-source. A GPU is strongly
recommended; CPU works but is very slow.

### Step 2 — pick a pretrained checkpoint

Any Diffusers text-to-video checkpoint works. Starting points (all open weights):

| Model | ID | Notes |
| --- | --- | --- |
| ModelScope T2V | `damo-vilab/text-to-video-ms-1.7b` | Smallest/easiest, ~16 frames, good first test |
| Wan 2.1 | `Wan-AI/Wan2.1-T2V-1.3B-Diffusers` | Newer, better quality, heavier |
| LTX-Video | `Lightricks/LTX-Video` | Fast, strong motion, 24 GB+ class GPU |
| CogVideoX | `THUDM/CogVideoX-2b` | Strong quality, needs more VRAM |

### Step 3 — run it

```bash
VY_ENGINE=diffusers \
VY_MODEL_ID=damo-vilab/text-to-video-ms-1.7b \
VY_DEVICE=auto \
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`/api/health` now returns `status: "ok"` with `demo: false`, and generated clips
are marked as AI output in the app. The first request downloads weights
(usually a few GB) — subsequent runs reuse the Hugging Face cache.

### Step 4 — point the app at the server

In **Settings → Real engine**, enter your server URL:

- Same machine: `http://localhost:8000`
- Phone on the same Wi-Fi: `http://<your-computer-LAN-IP>:8000` (e.g.
  `http://192.168.1.20:8000`). Find it with `ipconfig` / `ifconfig` / `ip addr`.

Tap **Test**. The header badge switches to **AI connected**.

### Using a different model architecture

1. Create `app/engines/my_model.py` implementing the `VideoEngine` protocol in
   [`app/engines/base.py`](app/engines/base.py).
2. Register it in [`app/engines/registry.py`](app/engines/registry.py).
3. Select it with `VY_ENGINE=my_model`.

The HTTP layer never changes — that is the whole point of the interface.

---

## 3. API contract

The frontend is written against exactly this contract (see
`src/lib/api.ts`). Keep it stable if you rewrite the backend.

### `GET /api/health`

```json
{
  "status": "ok",
  "engine": "diffusers-text-to-video",
  "model": "damo-vilab/text-to-video-ms-1.7b",
  "demo": false,
  "message": "Ready to load … on cuda",
  "capabilities": {
    "image_to_video": false,
    "max_duration": 8,
    "aspect_ratios": ["9:16", "16:9", "1:1"]
  }
}
```

`status` is `"unavailable"` when no engine can run.

### `POST /api/generations` → `202`

```json
{
  "prompt": "A neon-lit Mumbai street after rain, cinematic slow motion",
  "input_mode": "text",
  "image": "data:image/png;base64,…",
  "aspect_ratio": "9:16",
  "duration": 4,
  "style": "cinematic",
  "quality": "standard"
}
```

`image` is only used when `input_mode` is `"image"`. Returns
`{ "id": "<job-id>", "status": "queued" }`. If no engine is ready the server
returns `503` with a `detail` message for the UI.

### `GET /api/generations/{id}`

```json
{
  "id": "…",
  "status": "running",
  "progress": 0.42,
  "message": "Denoising step 13/30",
  "video_url": "/api/generations/<id>/video",
  "thumbnail_url": null,
  "engine": "diffusers-text-to-video",
  "model": "damo-vilab/text-to-video-ms-1.7b",
  "is_demo": false
}
```

`status` is one of `queued | running | completed | failed`. `progress` is
optional — omit it when the engine cannot report real progress.

### `GET /api/generations/{id}/video` and `/thumbnail`

Stream the finished media. The frontend resolves these relative URLs against the
configured base URL.

---

## 4. Image-to-video

When `input_mode` is `"image"`, the base64 image is written to a temporary file
and passed to the engine as `request.image_path`. The reference Diffusers adapter
declares `supports_image = False`, so requests are rejected with a clear message
until you implement it. To support it, use an image-conditioned pipeline
(for example an image-to-video Diffusers pipeline) in your engine and set
`supports_image = True`.

---

## 5. Tests

```bash
cd backend
pip install -r requirements.txt pytest httpx
pytest -q
```

The tests run the sample engine through the real HTTP API and assert both the
job lifecycle and the `is_demo` flag, so a regression cannot smuggle demo output
in as "AI".

---

## 6. Security & cost

- No API keys are used or required by this server.
- Models are loaded from local disk or a public model hub.
- CORS defaults to `*` for easy phone testing. For anything public, set
  `VY_CORS_ORIGINS=https://your-app.example` and put the server behind a reverse
  proxy.
- Jobs are stored in memory. Restarting the server clears history; only outputs
  on disk remain.
