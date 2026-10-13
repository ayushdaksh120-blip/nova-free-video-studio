# Nova Studio · AI Video Generation

Kling-style, mobile-first web app for generating real AI videos.

- Live site (GitHub Pages): https://ayushdaksh120-blip.github.io/nova-free-video-studio/
- Repository: https://github.com/ayushdaksh120-blip/nova-free-video-studio

## Files
- `index.html` — multi-tab app UI
- `styles.css` — mobile-first dark theme
- `script.js` — provider verification, Pollinations generation, local canvas recorder, gallery
- `manifest.webmanifest` — installable PWA metadata
- `README.md` — setup notes

## Verified provider status
- Catalog: `GET https://gen.pollinations.ai/video/models` → HTTP 200 (20 models)
- CORS: preflight `OPTIONS` → 204 with `access-control-allow-origin: *`
- Generation: anonymous `GET /video/...` → HTTP 401 (key required)
- Key validation: `GET /account/key` with Bearer token
- Only the verified Pollinations endpoint is integrated. Other providers are listed as not integrated.

## Local run
```bash
python -m http.server 9000
# open http://localhost:9000
```

Android/Termux:
```bash
pkg update -y
pkg install -y python git
git clone https://github.com/ayushdaksh120-blip/nova-free-video-studio.git
cd nova-free-video-studio
python -m http.server 9000
```

## Security
- No API keys are committed.
- Keys are stored only in browser localStorage.
-Rotate shared tokens after use.
