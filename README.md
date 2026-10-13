# Nova Generator · Independent Video Studio

A self-contained, owner-built AI-style video generator. No external APIs, no API keys, no paid providers, no fake videos.

- Live site: https://ayushdaksh120-blip.github.io/nova-free-video-studio/
- Repository: https://github.com/ayushdaksh120-blip/nova-free-video-studio

## What it does
- Prompt-driven scene generation (aurora, city, ocean, space, abstract, nature)
- Deterministic seeds for repeatable results
- Real-time canvas rendering with particles, gradients, lighting, and camera motion
- Genuine WebM output recorded from rendered frames via MediaRecorder
- Optional ambient audio synthesized in-browser
- Gallery persisted in IndexedDB (on-device only)
- Mobile-first responsive UI

## Architecture
- `index.html` — tabbed app UI
- `styles.css` — mobile-first dark theme
- `script.js` — prompt intelligence, scene engines, recording, storage
- `manifest.webmanifest` — installable PWA metadata

## Run locally
```bash
python -m http.server 9000
# open http://localhost:9000
```

Android / Termux:
```bash
pkg update -y && pkg install -y python git
git clone https://github.com/ayushdaksh120-blip/nova-free-video-studio.git
cd nova-free-video-studio
python -m http.server 9000
```

## Security / privacy
- No secrets are committed or required.
- All generation and storage happen in the browser.
- No requests to Pollinations, Kling, Runway, Replicate, or Hugging Face.
