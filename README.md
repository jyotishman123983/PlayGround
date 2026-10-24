# ViralYantra AI 🎬

A **mobile-first AI video generator web app** built as an honest, working
prototype you can run for ₹0. It has a polished dark UI (black + purple +
orange), a real on-device **demo renderer**, local clip history, and a
documented path to plug in a real **open-source text-to-video model** later.

> **What is real today vs. later**
> - ✅ **Real now:** the entire app, navigation, settings, local storage, the
>   procedural demo renderer, video preview/download/share, and the reference
>   FastAPI backend.
> - ⏳ **Later:** actual AI video generation. It only runs once you connect and
>   start an open-source model on your own machine/server.
> - 🚫 **Never faked:** demo clips are watermarked, stored as `is_demo`, and
>   labelled *“Demo · not AI”*. The app refuses to generate in “Real engine” mode
>   when no backend is reachable, and it never invents progress.

---

## ✨ Features

- **Text-to-Video** with a large prompt box that supports **हिंदी and English**.
- **Image-to-Video** — pick a photo from your device (demo mode animates it
  with a Ken-Burns move and colour grade).
- **Aspect ratios:** Portrait `9:16`, Landscape `16:9`, Square `1:1`.
- **Durations:** 4s / 6s / 8s (demo records a genuine clip in real time).
- **Quality:** Draft / Standard / High, with real output dimensions.
- **Style presets:** Realistic, Cinematic, 3D Cartoon, Anime, Fantasy.
- **Generate** button with a live render stage, real progress, cancel, and clear
  error messages.
- **Preview** with play, download, and share (Web Share API when available).
- **My Videos** history saved locally in IndexedDB, with search, filters, and
  per-item download/share/delete.
- **Settings** for engine selection, defaults, storage protection, and app info.
- **Installable PWA** (manifest + icons) ready to wrap as an **Android app**.

## 🧠 How it stays honest

| Mode | What runs | Labelled as |
| --- | --- | --- |
| **Demo mode** | Canvas + `MediaRecorder` procedural render on your device | `Demo · not AI`, watermarked |
| **Real engine** | Your FastAPI backend + open-source model | `AI generated` |

- No paid APIs and **no API keys** anywhere.
- “Real engine” generation is blocked until `/api/health` confirms a loaded
  engine. Progress bars only move on real backend progress.
- If a backend reports itself as a sample provider (`is_demo: true`), the clip
  stays labelled as demo.

---

## 🛠 Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| UI | React 18 + TypeScript | Small, familiar, easy to maintain |
| Build | Vite 5 | Instant dev server, tiny output, PWA-friendly |
| Demo engine | Canvas 2D + MediaRecorder | Real local video, no model, no server |
| Storage | IndexedDB (+ localStorage fallback) | Keeps clips on-device |
| Backend | Python FastAPI + Diffusers adapter | Free, open-source model path |

No component library, no paid services. Icons are inline SVG, fonts are bundled
local **Outfit** and **Noto Sans Devanagari** (both OFL-licensed).

---

## 🚀 Frontend setup

Requirements: **Node.js 18+**.

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build and preview:

```bash
npm run build        # outputs static files to dist/
npm run preview
npm run typecheck    # TypeScript, no emit
```

The built `dist/` folder is fully static — drop it on any free static host, or
open it through the packaged Android app.

---

## 🤖 Connect a real AI video model

This is a two-part task, fully documented in
[`backend/README.md`](backend/README.md):

1. **Run the reference backend**

   ```bash
   cd backend
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

   With nothing configured it honestly reports `unavailable`.

2. **Enable an open-source model** (for example ModelScope T2V, Wan 2.1,
   LTX-Video, or CogVideoX):

   ```bash
   pip install -r requirements-model.txt
   VY_ENGINE=diffusers VY_MODEL_ID=damo-vilab/text-to-video-ms-1.7b \
     uvicorn app.main:app --host 0.0.0.0 --port 8000
   ```

3. In the app: **Settings → Real engine →** paste your URL (use your computer's
   LAN IP for a phone, e.g. `http://192.168.1.20:8000`) **→ Test**.

The engine interface (`backend/app/engines/base.py`) is the single integration
point. Add a new file implementing `VideoEngine`, register it in `registry.py`,
and select it with `VY_ENGINE`. The HTTP API and the frontend stay unchanged.

---

## 📱 Package for Android

You have three free options, easiest first.

### Option A — Install as a PWA (zero tooling)

The app ships a web manifest and icons. Host `dist/` over **HTTPS**, open it in
Chrome on Android, then use **⋮ → Add to Home screen / Install app**. It runs
standalone, full-screen, with its own icon.

### Option B — Capacitor (a real APK/AAB)

```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "ViralYantra AI" app.viralyantra.ai --web-dir=dist
npm run build
npx cap add android
npx cap sync
npx cap open android        # opens Android Studio to build/sign the APK
```

Because the app is client-side, the demo mode works offline inside the APK. If
you want real AI generation, point Settings at a reachable backend.

### Option C — Bubblewrap (Trusted Web Activity)

If you host the PWA on HTTPS and have the signing key, `bubblewrap init --manifest https://your-url/manifest.webmanifest`
wraps it in a Play-Store-ready APK/AAB without Android Studio.

---

## 📁 Project structure

```
.
├── index.html                 # app shell + PWA meta
├── public/
│   ├── demo/                  # bundled demo sample MP4s + posters
│   ├── fonts/                 # Outfit + Noto Sans Devanagari (OFL)
│   ├── icons/                 # PWA / Android icons
│   ├── logo.svg
│   └── manifest.webmanifest
├── src/
│   ├── components/            # App, Home, MyVideos, Settings, preview, nav…
│   ├── hooks/useLocalStorage.ts
│   ├── lib/
│   │   ├── api.ts             # FastAPI contract + polling (documented)
│   │   ├── db.ts              # IndexedDB history
│   │   ├── demoRenderer.ts    # canvas demo engine
│   │   ├── presets.ts         # aspects, styles, qualities
│   │   └── share.ts
│   ├── styles.css
│   └── main.tsx
└── backend/                   # optional FastAPI + model integration
    ├── app/engines/           # VideoEngine interface + adapters
    ├── tests/
    └── README.md              # full backend + model guide
```

## 🧪 Verification

```bash
npm run typecheck && npm run build   # frontend types + production build
cd backend && pytest -q              # backend API + honesty-flag tests
```

## 📄 Notes on cost and licensing

Everything here is free and open-source. The bundled sample videos were rendered
locally with FFmpeg from generated gradients (no third-party footage). Bundled
fonts are under the SIL Open Font License (see `public/fonts/OFL-*.txt`). No
API keys, accounts, or paid services are used or required.

---

<!-- omgithub:readme:start -->
## 🚀 Build, play, and remix with OMGithub

**Created using [OMGithub.com](https://omgithub.com).**

[![OMGithub](https://img.shields.io/badge/OMGithub-Open%20project-orange?style=for-the-badge)](https://omgithub.com/jyotishman123983/PlayGround)
[![GitHub](https://img.shields.io/badge/GitHub-Source-181717?logo=github&style=for-the-badge)](https://github.com/jyotishman123983/PlayGround)

- 🎮 [Open the project](https://omgithub.com/jyotishman123983/PlayGround).
- ✨ [Remix this project](https://omgithub.com/?remix=jyotishman123983%2FPlayGround).
- 💻 [Explore the source](https://github.com/jyotishman123983/PlayGround).
- 🛠️ [Check build runs](https://github.com/jyotishman123983/PlayGround/actions).
- 🐛 [Report an issue](https://github.com/jyotishman123983/PlayGround/issues).
- 👤 [Explore the creator's projects](https://omgithub.com/jyotishman123983).
- 🌍 [Create with OMGithub](https://omgithub.com).
<!-- omgithub:readme:end -->
