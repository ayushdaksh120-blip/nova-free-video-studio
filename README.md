# Nova · Free Video Studio

Mobile-first dark website with a real video generation flow.

## Files
- `index.html` — markup
- `styles.css` — mobile-first dark theme
- `script.js` — provider verification, Pollinations video gen, local canvas recorder, history
- `README.md` — this file

## Provider status (verified from this environment)
- Endpoint tested: `https://gen.pollinations.ai/video/models` → HTTP 200, returns 20 video models.
- CORS: preflight returns 204 with `access-control-allow-origin: *`.
- Anonymous generation: `https://gen.pollinations.ai/video/...` → HTTP 401 (key required). No fake videos are shown; the UI surfaces this error.
- Keys are never hardcoded. Enter your free key in the Provider section (stored in browser localStorage).

## Run on Android (Termux)
1. Install Termux (F-Droid recommended).
2. Update and install Python:
   ```
   pkg update -y
   pkg install -y python
   ```
3. Put this project in a folder (e.g. `/sdcard/Download/nova` or `~/nova`).
4. Start server:
   ```
   cd ~/nova
   python -m http.server 8000
   ```
5. Open `http://localhost:8000` or `http://127.0.0.1:8000` in Chrome/Firefox.
   On same Wi-Fi, use your phone IP: `http://<phone-ip>:8000`.

Alternative servers:
```
cd ~/nova && npx serve .
cd ~/nova && php -S localhost:8000
```

## Get a free Pollinations key
1. Open https://enter.pollinations.ai/keys
2. Sign in with GitHub (free) and create a key.
3. Paste it into the site's Provider section and click "Test my key".
   Keys stay in your browser only.

## Test stages
- Stage 1 (provider): open `#provider`, click "Re-check provider" — expect catalog count.
- Stage 2 (key): save key, click "Test my key" — expect "Key valid".
- Stage 3 (remote gen): fill prompt, click "Generate video" — expect real MP4 or a real error.
- Stage 4 (offline): use `#local` to record a canvas video without network.
- Stage 5 (history): verify entries list; clear with "Clear history".

## Budget notes
- ₹0: uses free tiers/quest pollen only. Paid-only models may fail; errors are shown honestly.
- No local GPU needed. Remote generation runs on provider; local recorder runs on device CPU.
- keep prompts short to reduce cost.

## Safety
- Never commit API keys. The site reads from localStorage only.
- `VERIFY FREE PROVIDERS BEFORE INTEGRATING`: this repo documents tested endpoints above; do not add unverified endpoints.
