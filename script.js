// ===== Nova Studio: Kling-style AI video web =====
const BASE = "https://gen.pollinations.ai";
const LS_KEY = "nova.pollinations.key";
const LS_HISTORY = "nova.history.v2";

const $ = (sel, ctx = document) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx = document) => Array.from((ctx || document).querySelectorAll(sel));

let modelsCache = [];
let objectUrls = [];
let queue = [];
let lastGenerated = null;

const revokeAll = () => { objectUrls.forEach((u) => URL.revokeObjectURL(u)); objectUrls = []; };

// ---------- Tabs ----------
function activateTab(tab) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${tab}`));
  const nl = $("#nav-links"); nl?.classList.remove("open");
  $("#nav-toggle")?.setAttribute("aria-expanded", "false");
  location.hash = tab;
}
$$(".tab-btn").forEach((b) => b.addEventListener("click", () => activateTab(b.dataset.tab)));
if (location.hash) {
  const t = location.hash.replace("#", "");
  if ($(`#view-${t}`)) activateTab(t);
}

// ---------- Nav ----------
$("#nav-toggle")?.addEventListener("click", () => {
  const nl = $("#nav-links");
  const open = nl.classList.toggle("open");
  $("#nav-toggle").setAttribute("aria-expanded", String(open));
});

// ---------- Status ----------
function setStatus(el, text, mode = "") {
  if (!el) return;
  el.textContent = text;
  el.classList.remove("error", "warn");
  if (mode) el.classList.add(mode);
}

// ---------- Keys
const keyInput = $("#api-key");
function getKey() { return (localStorage.getItem(LS_KEY) || "").trim(); }
function setKey(v) { localStorage.setItem(LS_KEY, v.trim()); }
function clearKey() { localStorage.removeItem(LS_KEY); }
function maskKey(v) { return !v ? "(none)" : v.length < 10 ? "••••" : v.slice(0, 4) + "••••" + v.slice(-4); }
function hydrateKey() {
  if (keyInput) keyInput.value = getKey();
  updateKeyStatus();
}
function updateKeyStatus() {
  const k = getKey();
  setStatus($("#key-status"), k ? `Saved key: ${maskKey(k)}` : "No key saved yet.");
}
$("#btn-save-key")?.addEventListener("click", () => {
  const v = (keyInput?.value || "").trim();
  if (!v) { setStatus($("#key-status"), "Enter a key first.", "error"); return; }
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

// ---------- Catalog ----------
async function fetchCatalog() {
  const res = await fetch(`${BASE}/video/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
function sortModels(m) { return [...m].sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name)); }
function updateModelOptions(models) {
  const sel = $("#model"); if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = "";
  sortModels(models).forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = `${m.title || m.name} (${m.publisher || "unknown"})${m.paid_only ? " · paid pollen" : ""}`;
    sel.appendChild(opt);
  });
  if (prev && models.some((m) => m.name === prev)) sel.value = prev;
  else if (models[0]) sel.value = models[0].name;
  updateDurationResolution();
}
function updateDurationResolution() {
  const model = modelsCache.find((m) => m.name === $("#model")?.value);
  const dur = $("#duration"), res = $("#resolution");
  if (!dur || !res) return;
  dur.innerHTML = "";
  (model?.allowed_durations || [4]).forEach((d) => {
    const o = document.createElement("option"); o.value = String(d); o.textContent = `${d}s`;
    if (d === model?.default_duration) o.selected = true;
    dur.appendChild(o);
  });
  if (!dur.value && model?.default_duration) dur.value = String(model.default_duration);
  res.innerHTML = "";
  (model?.resolutions || [""]).forEach((r) => {
    const o = document.createElement("option"); o.value = r;
    o.textContent = r || (model?.pricing_default_label || "default");
    res.appendChild(o);
  });
  if (!res.value && (model?.resolutions || [])[0] !== undefined) res.value = (model.resolutions || [])[0];
}
$("#model")?.addEventListener("change", updateDurationResolution);

async function verifyProvider() {
  const statusEl = $("#provider-status");
  setStatus(statusEl, "Checking provider…");
  try {
    const models = await fetchCatalog();
    modelsCache = models;
    $("#p-catalog").textContent = "Reachable (HTTP 200)";
    $("#p-cors").textContent = "Enabled";
    $("#p-models").textContent = String(models.length);
    $("#provider-pill").textContent = "Verified";
    $("#provider-pill").className = "status-pill ok";
    updateModelOptions(models);
    setStatus(statusEl, "Provider verified: catalog, CORS and key test available.");
  } catch (err) {
    $("#p-catalog").textContent = "Unreachable";
    $("#p-models").textContent = "—";
    $("#provider-pill").textContent = "Offline";
    $("#provider-pill").className = "status-pill warn";
    setStatus(statusEl, `Provider check failed: ${err.message}`, "error");
  }
}
$("#btn-refresh-provider")?.addEventListener("click", verifyProvider);

async function testKey() {
  const key = getKey();
  if (!key) { setStatus($("#provider-status"), "Save a key first.", "error"); return; }
  setStatus($("#provider-status"), "Testing key…");
  try {
    const res = await fetch(`${BASE}/account/key`, { headers: { Authorization: `Bearer ${key}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`);
    setStatus($("#provider-status"), `Key valid · type: ${body?.type || "unknown"} · permissions: ${(body?.permissions || []).join(", ") || "n/a"}`);
    $("#provider-pill").textContent = "Key OK";
    $("#provider-pill").className = "status-pill ok";
  } catch (err) {
    setStatus($("#provider-status"), `Key test failed: ${err.message}`, "error");
  }
}
$("#btn-test-key")?.addEventListener("click", testKey);

// ---------- Queue ----------
function renderQueue() {
  const el = $("#queue-list"); if (!el) return;
  $("#queue-count").textContent = `${queue.length} item${queue.length === 1 ? "" : "s"}`;
  if (!queue.length) { el.innerHTML = "<p class='q-empty'>No jobs yet. Create a video above.</p>"; return; }
  el.innerHTML = [...queue].reverse().map((q) => `
    <div class="queue-item">
      <div class="qi-title">${escapeHtml(q.prompt)}</div>
      <div class="qi-meta">${escapeHtml(q.model)} · ${q.duration}s · ${q.resolution || "default"} · ${q.status} · ${new Date(q.when).toLocaleTimeString()}</div>
    </div>
  `).join("");
}

// ---------- History ----------
function loadHistory() { try { return JSON.parse(localStorage.getItem(LS_HISTORY) || "[]"); } catch { return []; } }
function saveHistory(items) { localStorage.setItem(LS_HISTORY, JSON.stringify(items.slice(0, 40))); }
function addHistory(item) { const items = loadHistory(); items.unshift(item); saveHistory(items); renderGallery(); }
function clearHistory() { localStorage.removeItem(LS_HISTORY); renderGallery(); }

function parseLinkHeader(h) { if (!h) return ""; const m = h.match(/<([^>]+)>/); return m ? m[1] : ""; }

function finalPrompt() {
  const base = ($("#prompt")?.value || "").trim();
  const neg = ($("#negative")?.value || "").trim();
  const aspect = $("#aspect")?.value;
  let p = base;
  if (neg) p += ` Avoid: ${neg}.`;
  if (aspect && aspect !== "") p += ` Composition: ${aspect} cinematic framing.`;
  return p;
}

function buildUrl(prompt, model, duration, resolution, seed, imageUrl) {
  const params = new URLSearchParams();
  params.set("model", model);
  if (duration) params.set("duration", duration);
  if (resolution) params.set("resolution", resolution);
  if (seed) params.set("seed", seed);
  if (imageUrl) params.set("image", imageUrl);
  return `${BASE}/video/${encodeURIComponent(prompt)}?${params.toString()}`;
}

// ---------- Generate ----------
$("#gen-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = $("#gen-status");
  const btn = $("#btn-generate");
  const key = getKey();
  if (!key) { setStatus(statusEl, "Save a Pollinations key first (Providers tab).", "error"); activateTab("providers"); return; }

  const p = finalPrompt();
  if (!p) { setStatus(statusEl, "Prompt is required.", "error"); return; }

  const model = $("#model").value;
  const duration = $("#duration").value;
  const resolution = $("#resolution").value;
  const seed = ($("#seed").value || "").trim();
  const imageUrl = ($("#image-url").value || "").trim();

  const url = buildUrl(p, model, duration, resolution, seed, imageUrl);
  const jobId = `job-${Date.now()}`;
  queue.push({ id: jobId, prompt: p, model, duration, resolution, status: "generating", when: Date.now() });
  renderQueue();

  setStatus(statusEl, "Generating… this can take a while.");
  if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }
  revokeAll();

  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.error?.message) msg = j.error.message; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    if (!blob.type.startsWith("video/")) throw new Error(`Provider returned ${blob.type || "unknown"}, not a video.`);

    const objUrl = URL.createObjectURL(blob);
    objectUrls.push(objUrl);
    const sourceUrl = parseLinkHeader(res.headers.get("Link")) || res.url || url;

    const item = {
      prompt: p, model, duration, resolution, seed, imageUrl,
      url: sourceUrl, size: blob.size, when: Date.now(),
    };
    lastGenerated = item;
    addHistory(item);

    const cardEmpty = $("#preview-empty");
    const cardMedia = $("#preview-media");
    const cardMeta = $("#preview-meta");
    const video = $("#preview-video");
    const info = $("#preview-info");
    const dl = $("#preview-download");
    const open = $("#preview-open");
    const saveBtn = $("#preview-to-gallery");

    if (video) { video.src = objUrl; video.load(); }
    if (dl) { dl.href = objUrl; dl.download = "nova-video.mp4"; }
    if (open) open.href = sourceUrl;
    if (info) info.textContent = `${model} · ${duration}s${resolution ? " · " + resolution : ""}${seed ? " · seed " + seed : ""} · ${Math.round(blob.size / 1024)} KB`;
    cardEmpty?.classList.add("hidden");
    cardMedia?.classList.remove("hidden");
    cardMeta?.classList.remove("hidden");
    if (saveBtn) { saveBtn.textContent = "Saved"; saveBtn.disabled = true; }

    const q = queue.find((x) => x.id === jobId);
    if (q) q.status = "done";
    renderQueue();
    setStatus(statusEl, "Done — real video generated.");
  } catch (err) {
    const q = queue.find((x) => x.id === jobId);
    if (q) q.status = "failed";
    renderQueue();
    setStatus(statusEl, `Generation failed: ${err.message}`, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Generate video"; }
  }
});

$("#btn-enhance")?.addEventListener("click", async () => {
  const statusEl = $("#gen-status");
  const key = getKey();
  if (!key) { setStatus(statusEl, "Save a key first to enhance prompts.", "error"); return; }
  const current = ($("#prompt")?.value || "").trim();
  if (!current) { setStatus(statusEl, "Enter a prompt first.", "error"); return; }
  setStatus(statusEl, "Enhancing prompt…");
  try {
    const q = encodeURIComponent(`Rewrite this video prompt to be more cinematic and detailed, keep it concise (max 80 words): ${current}`);
    const res = await fetch(`${BASE}/text/${q}?model=openai/gpt-4o-mini`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).trim();
    if (text) {
      if (keyInput) {}
      const ta = $("#prompt"); if (ta) ta.value = text;
      setStatus(statusEl, "Prompt enhanced.");
    } else throw new Error("Empty response");
  } catch (err) {
    setStatus(statusEl, `Enhance failed: ${err.message}`, "error");
  }
});

$("#preview-to-gallery")?.addEventListener("click", () => {
  if (lastGenerated) {
    addHistory(lastGenerated);
    const btn = $("#preview-to-gallery");
    if (btn) { btn.textContent = "Saved"; btn.disabled = true; }
  }
});

// ---------- Gallery ----------
function renderGallery() {
  const grid = $("#gallery-grid"); if (!grid) return;
  const items = loadHistory();
  if (!items.length) {
    grid.innerHTML = "<p class='muted'>No generated media yet. Create something in Studio.</p>";
    return;
  }
  grid.innerHTML = items.map((it, idx) => `
    <article class="media-card">
      <video src="${escapeAttr(it.url || "")}" preload="none" controls playsinline></video>
      <div class="mc-body">
        <div class="mc-title">${escapeHtml((it.prompt || "").slice(0, 80))}</div>
        <div class="mc-meta">${escapeHtml(it.model || "")} · ${it.duration || "?"}s${it.resolution ? " · " + it.resolution : ""} · ${new Date(it.when).toLocaleString()}</div>
        <div class="actions">
          ${it.url ? `<a class="btn btn-ghost btn-sm" href="${escapeAttr(it.url)}" target="_blank" rel="noopener">Source</a>` : ""}
          <button class="btn btn-ghost btn-sm" data-replay="${idx}" type="button">Replay</button>
        </div>
      </div>
    </article>
  `).join("");
  $$("[data-replay]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.replay);
    const it = loadHistory()[i];
    if (!it) return;
    $("#preview-video").src = it.url || "";
    $("#preview-video").load();
    $("#preview-empty")?.classList.add("hidden");
    $("#preview-media")?.classList.remove("hidden");
    $("#preview-meta")?.classList.remove("hidden");
    $("#preview-info").textContent = `${it.model} · ${it.duration}s`;
    activateTab("studio");
  }));
}
$("#btn-clear-history")?.addEventListener("click", clearHistory);

// ---------- Local recorder ----------
const canvas = $("#local-canvas");
const ctx = canvas?.getContext("2d");
function drawFrame(t, seed, name) {
  if (!canvas || !ctx) return;
  const w = canvas.width, h = canvas.height;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${(seed * 360 + t * 50) % 360}, 70%, 18%)`);
  g.addColorStop(1, `hsl(${(seed * 360 + t * 50 + 120) % 360}, 60%, 8%)`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const x = w * 0.5 + Math.sin(t * 0.6 + i * 1.2 + seed) * (w * 0.38);
    const y = h * 0.5 + Math.cos(t * 0.9 + i * 0.8 + seed) * (h * 0.35);
    const r = 36 + Math.sin(t + i) * 12;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
    grad.addColorStop(0, `hsla(${(seed * 360 + i * 55 + t * 28) % 360},85%,68%,0.75)`);
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "bold 34px Inter, system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(name.slice(0, 28), w / 2, h / 2);
  ctx.font = "13px Inter, system-ui, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.fillText(`local render · t=${t.toFixed(2)}s`, w / 2, h / 2 + 38);
}
$("#local-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = $("#local-status");
  const btn = $("#btn-local");
  if (!canvas || !ctx) { setStatus(statusEl, "Canvas not supported.", "error"); return; }
  if (typeof MediaRecorder === "undefined") { setStatus(statusEl, "MediaRecorder not supported.", "error"); return; }

  const name = ($("#local-prompt")?.value || "Scene").trim();
  const seconds = parseFloat($("#local-seconds")?.value || "5");
  const fps = parseFloat($("#local-fps")?.value || "30");
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const seed = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) / 1000;

  let recorder;
  try {
    const stream = canvas.captureStream(fps);
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  } catch (err) { setStatus(statusEl, `Recorder error: ${err.message}`, "error"); return; }

  const chunks = [];
  recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  const done = new Promise((resolve) => { recorder.onstop = resolve; });
  setStatus(statusEl, "Recording…");
  if (btn) { btn.disabled = true; btn.textContent = "Recording…"; }
  recorder.start(250);

  const start = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const t = (performance.now() - start) / 1000;
      if (t >= seconds) { resolve(); return; }
      drawFrame(t, seed, name);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  drawFrame(seconds, seed, name);
  recorder.stop();
  await done;

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);

  const empty = $("#local-empty"), media = $("#local-media"), meta = $("#local-meta");
  const vid = $("#local-video"), dl = $("#local-download");
  if (vid) { vid.src = url; vid.load(); }
  if (dl) { dl.href = url; dl.download = "nova-local.webm"; }
  empty?.classList.add("hidden");
  media?.classList.remove("hidden");
  meta?.classList.remove("hidden");
  if (btn) { btn.disabled = false; btn.textContent = "Record video"; }
  setStatus(statusEl, `Recorded ${seconds}s · ${Math.round(blob.size / 1024)} KB.`);
});

// ---------- Helpers ----------
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

// ---------- Init ----------
hydrateKey();
renderQueue();
renderGallery();
verifyProvider();
renderGallery();
$("#btn-clear-history").onclick = () => { localStorage.removeItem(LS_HISTORY); renderGallery(); };
