// ===== Nova Free Video Studio =====
const BASE = "https://gen.pollinations.ai";
const LS_KEY = "nova.pollinations.key";
const LS_HISTORY = "nova.history.v1";

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

let modelsCache = [];
let objectUrls = [];

const revokeAll = () => {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
};

// ---------- Mobile nav ----------
const navToggle = $("#nav-toggle");
const navLinks = $("#nav-links");
navToggle?.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(open));
});
navLinks?.querySelectorAll("a").forEach((a) =>
  a.addEventListener("click", () => {
    navLinks.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  })
);

// ---------- Status helpers ----------
function setStatus(el, text, isError = false) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", isError);
}

// ---------- API key ----------
const keyInput = $("#api-key");
function getKey() { return (localStorage.getItem(LS_KEY) || "").trim(); }
function setKey(k) { localStorage.setItem(LS_KEY, k.trim()); }
function clearKey() { localStorage.removeItem(LS_KEY); }
function maskKey(k) {
  if (!k) return "(none)";
  if (k.length < 10) return "••••";
  return k.slice(0, 4) + "••••" + k.slice(-4);
}
function hydrateKeyInput() {
  const k = getKey();
  if (keyInput) keyInput.value = k;
  updateKeyStatus();
}
function updateKeyStatus() {
  const k = getKey();
  setStatus($("#key-status"), k ? `Saved key: ${maskKey(k)}` : "No key saved yet.");
}

$("#btn-save-key")?.addEventListener("click", () => {
  const v = (keyInput?.value || "").trim();
  if (!v) { setStatus($("#key-status"), "Enter a key first.", true); return; }
  setKey(v);
  updateKeyStatus();
  setStatus($("#key-status"), "Key saved in this browser.");
});

$("#btn-clear-key")?.addEventListener("click", () => {
  clearKey();
  if (keyInput) keyInput.value = "";
  updateKeyStatus();
  setStatus($("#key-status"), "Key cleared.");
});

// ---------- Provider verification ----------
async function fetchCatalog() {
  const res = await fetch(`${BASE}/video/models`);
  if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
  return res.json();
}

function updateModelOptions(models) {
  const select = $("#model");
  if (!select) return;
  const prev = select.value;
  select.innerHTML = "";
  models.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = `${m.title || m.name} (${m.publisher || "unknown"})`;
    if (m.paid_only) opt.textContent += " · paid pollen";
    select.appendChild(opt);
  });
  if (prev && models.some((m) => m.name === prev)) select.value = prev;
  if (!select.value && models[0]) select.value = models[0].name;
  updateDurationResolution();
}

function updateDurationResolution() {
  const model = modelsCache.find((m) => m.name === $("#model")?.value);
  const durSel = $("#duration");
  const resSel = $("#resolution");
  if (!durSel || !resSel) return;

  durSel.innerHTML = "";
  (model?.allowed_durations || [4]).forEach((d) => {
    const opt = document.createElement("option");
    opt.value = String(d);
    opt.textContent = `${d}s`;
    if (d === (model?.default_duration)) opt.selected = true;
    durSel.appendChild(opt);
  });
  if (!durSel.value && model?.default_duration) durSel.value = String(model.default_duration);

  resSel.innerHTML = "";
  const ress = model?.resolutions || [""];
  ress.forEach((r) => {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r || (model?.pricing_default_label || "default");
    resSel.appendChild(opt);
  });
  if (!resSel.value && ress[0] !== undefined) resSel.value = ress[0];
}

$("#model")?.addEventListener("change", updateDurationResolution);

async function verifyProvider() {
  const statusEl = $("#provider-status");
  setStatus(statusEl, "Checking provider…");
  try {
    const models = await fetchCatalog();
    modelsCache = models;
    $("#v-catalog").textContent = "Reachable (HTTP 200)";
    $("#v-cors").textContent = "Enabled (access-control-allow-origin: *)";
    $("#v-models").textContent = `${models.length} video models available`;
    updateModelOptions(models);
    setStatus(statusEl, "Provider verified: catalog reachable, CORS OK, generation needs a key (run Test my key).");
  } catch (err) {
    $("#v-catalog").textContent = "Unreachable";
    $("#v-models").textContent = "—";
    setStatus(statusEl, `Catalog check failed: ${err.message}`, true);
  }
}

$("#btn-refresh-catalog")?.addEventListener("click", verifyProvider);

// ---------- Key test ----------
$("#btn-test-key")?.addEventListener("click", async () => {
  const key = getKey();
  if (!key) { setStatus($("#provider-status"), "Save a key first.", true); return; }
  setStatus($("#provider-status"), "Testing key…");
  try {
    const res = await fetch(`${BASE}/account/key`, { headers: { Authorization: `Bearer ${key}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
    setStatus($("#provider-status"), `Key valid. Type: ${body?.type || "unknown"} · permissions: ${(body?.permissions || []).join(", ") || "n/a"}`);
  } catch (err) {
    setStatus($("#provider-status"), `Key test failed: ${err.message}`, true);
  }
});

// ---------- Video generation ----------
function buildVideoUrl(prompt, model, duration, resolution) {
  const path = encodeURIComponent(prompt.trim());
  const params = new URLSearchParams();
  params.set("model", model);
  if (duration) params.set("duration", duration);
  if (resolution) params.set("resolution", resolution);
  return `${BASE}/video/${path}?${params.toString()}`;
}

function parseLinkHeader(header) {
  if (!header) return "";
  const m = header.match(/<([^>]+)>/);
  return m ? m[1] : "";
}

$("#gen-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = $("#gen-status");
  const btn = $("#btn-generate");
  revokeAll();

  const key = getKey();
  if (!key) { setStatus(statusEl, "Save a Pollinations key first (see Provider section).", true); return; }

  const prompt = ($("#prompt")?.value || "").trim();
  if (!prompt) { setStatus(statusEl, "Prompt is required.", true); return; }

  const model = $("#model")?.value;
  const duration = $("#duration")?.value;
  const resolution = $("#resolution")?.value;

  const url = buildVideoUrl(prompt, model, duration, resolution);
  setStatus(statusEl, "Generating… this can take a while.");
  if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error?.message) msg = j.error.message;
      } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    if (!blob.type.startsWith("video/")) {
      throw new Error(`Provider returned ${blob.type || "unknown"} instead of video. Not displaying.`);
    }
    const objUrl = URL.createObjectURL(blob);
    objectUrls.push(objUrl);

    const card = $("#result-card");
    const video = $("#result-video");
    const download = $("#result-download");
    const open = $("#result-open");
    const info = $("#result-info");

    if (video) { video.src = objUrl; video.load(); }
    if (download) { download.href = objUrl; download.download = "nova-video.mp4"; }
    const sourceUrl = parseLinkHeader(res.headers.get("Link")) || res.url || url;
    if (open) { open.href = sourceUrl; }
    if (info) info.textContent = `${model} · ${duration}s${resolution ? " · " + resolution : ""} · ${Math.round(blob.size / 1024)} KB`;
    card?.classList.remove("hidden");

    addHistory({ prompt, model, duration, resolution, url: sourceUrl, when: Date.now() });
    renderHistory();
    setStatus(statusEl, "Done — real video generated.");
  } catch (err) {
    setStatus(statusEl, `Generation failed: ${err.message}`, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Generate video"; }
  }
});

// ---------- Local canvas video ----------
const canvas = $("#local-canvas");
const ctx = canvas?.getContext("2d");

function drawFrame(t, seed, name) {
  const w = canvas.width, h = canvas.height;
  const g = ctx.createLinearGradient(0, 0, w, h);
  const a = (t * 0.3 + seed) % 1;
  g.addColorStop(0, `hsl(${(seed * 360 + t * 40) % 360}, 70%, 20%)`);
  g.addColorStop(1, `hsl(${(seed * 360 + t * 40 + 120) % 360}, 60%, 10%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // moving orbs
  for (let i = 0; i < 5; i++) {
    const x = (w * 0.5) + Math.sin(t * 0.7 + i * 1.3 + seed) * (w * 0.35);
    const y = (h * 0.5) + Math.cos(t * 0.9 + i * 0.7 + seed) * (h * 0.35);
    const r = 40 + Math.sin(t + i) * 15;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
    grad.addColorStop(0, `hsla(${(seed*360+i*60+t*30)%360},80%,65%,0.7)`);
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r * 2, 0, Math.PI * 2); ctx.fill();
  }

  // text
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "bold 28px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, w / 2, h / 2);
  ctx.font = "14px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText(`t=${t.toFixed(2)}s`, w / 2, h / 2 + 34);
}

$("#local-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = $("#local-status");
  const btn = $("#btn-local");
  revokeAll();

  if (!canvas || !ctx) { setStatus(statusEl, "Canvas not supported.", true); return; }
  if (typeof MediaRecorder === "undefined") { setStatus(statusEl, "MediaRecorder not supported in this browser.", true); return; }

  const name = ($("#local-prompt")?.value || "Scene").trim();
  const seconds = parseFloat($("#local-seconds")?.value || "5");
  const fps = parseFloat($("#local-fps")?.value || "30");
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) / 1000;

  let recorder;
  try {
    const stream = canvas.captureStream(fps);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_000_000 });
  } catch (err) {
    setStatus(statusEl, `Recorder error: ${err.message}`, true);
    return;
  }

  const chunks = [];
  recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  const done = new Promise((resolve) => { recorder.onstop = () => resolve(); });

  setStatus(statusEl, "Recording…");
  if (btn) { btn.disabled = true; btn.textContent = "Recording…"; }
  recorder.start(250);

  const totalFrames = Math.ceil(seconds * fps);
  const start = performance.now();
  await new Promise((resolve) => {
    let frame = 0;
    const step = () => {
      const t = (performance.now() - start) / 1000;
      if (t >= seconds) { resolve(); return; }
      drawFrame(t, seed, name);
      frame++;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  // ensure last frame rendered
  drawFrame(seconds, seed, name);
  recorder.stop();
  await done;

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);

  const card = $("#local-result");
  const video = $("#local-video");
  const download = $("#local-download");
  if (video) { video.src = url; video.load(); }
  if (download) { download.href = url; download.download = "nova-local.webm"; }
  card?.classList.remove("hidden");

  if (btn) { btn.disabled = false; btn.textContent = "Record video"; }
  setStatus(statusEl, `Recorded ${seconds}s (${Math.round(blob.size / 1024)} KB).`);
});

// ---------- History ----------
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) || "[]"); } catch { return []; }
}
function saveHistory(items) { localStorage.setItem(LS_HISTORY, JSON.stringify(items.slice(0, 20))); }
function addHistory(item) {
  const items = loadHistory();
  items.unshift(item);
  saveHistory(items);
}
function renderHistory() {
  const list = $("#history-list");
  if (!list) return;
  const items = loadHistory();
  if (!items.length) { list.innerHTML = "<p class='muted'>No history yet.</p>"; return; }
  list.innerHTML = items.map((it) => `
    <div class="history-item">
      <div class="hi-title">${escapeHtml(it.prompt)}</div>
      <div class="hi-meta">${escapeHtml(it.model)} · ${it.duration}s ${it.resolution || ""} · ${new Date(it.when).toLocaleString()}</div>
      ${it.url ? `<a href="${escapeAttr(it.url)}" target="_blank" rel="noopener">Open source URL</a>` : ""}
    </div>
  `).join("");
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

$("#btn-clear-history")?.addEventListener("click", () => {
  localStorage.removeItem(LS_HISTORY);
  renderHistory();
});

// ---------- Init ----------
hydrateKeyInput();
renderHistory();
verifyProvider();
