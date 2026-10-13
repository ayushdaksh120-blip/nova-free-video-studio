// ===== Nova Generator: independent, own-built video engine =====
// No external AI APIs. All rendering and recording happen in this browser.

const DB_NAME = "novaGenDB";
const DB_STORE = "videos";
const LS_QUEUE = "nova.queue.meta";

const $ = (sel, ctx = document) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx = document) => Array.from((ctx || document).querySelectorAll(sel));

let db = null;
let objectUrlCache = new Map();
let queue = [];
let lastGenerated = null;
let renderCanvas = null;
let renderCtx = null;

// ---------- Tabs ----------
function activateTab(tab) {
  $$(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${tab}`));
  $("#nav-links")?.classList.remove("open");
  $("#nav-toggle")?.setAttribute("aria-expanded", "false");
  if (location.hash !== `#${tab}`) location.hash = tab;
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

// ---------- Utilities ----------
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function escapeAttr(s) { return escapeHtml(s); }
function formatBytes(n) { return Math.round(n / 1024) + " KB"; }

// ---------- Prompt intelligence ----------
const ENGINE_KEYWORDS = {
  city: ["city", "neon", "urban", "street", "cyber", "building", "rain", "night"],
  ocean: ["ocean", "sea", "water", "wave", "beach", "storm", "sail"],
  space: ["space", "galaxy", "star", "planet", "cosmos", "nebula", "moon"],
  nature: ["nature", "forest", "mountain", "tree", "flower", "meadow", "sunrise", "sunset", "garden"],
  abstract: ["abstract", "dream", "surreal", "particles", "flow", "liquid", "color", "psychedelic"],
  aurora: ["aurora", "northern lights", "sky", "snow", "ice", "winter", "calm"]
};
function detectEngine(prompt, requested) {
  if (requested && requested !== "auto") return requested;
  const p = (prompt || "").toLowerCase();
  let best = "aurora", score = -1;
  for (const [name, words] of Object.entries(ENGINE_KEYWORDS)) {
    const s = words.reduce((a, w) => a + (p.includes(w) ? 1 : 0), 0);
    if (s > score) { score = s; best = name; }
  }
  return best;
}
const PALETTES = {
  warm: ["#ff9a5a", "#ff6f61", "#ffd166", "#f4a261", "#e76f51"],
  cool: ["#4ea8de", "#5dade2", "#8fc4ff", "#a7d9ff", "#6ce5e8"],
  neon: ["#ff4ecd", "#7c5cff", "#5ef2ff", "#b967ff", "#39ff14"],
  emerald: ["#2dd4bf", "#34d399", "#86efac", "#a7f3d0", "#14b8a6"],
  cosmic: ["#9370db", "#c084fc", "#818cf8", "#fb7185", "#38bdf8"],
 mono: ["#94a3b8", "#cbd5e1", "#e2e8f0", "#64748b", "#f1f5f9"]
};
function detectPalette(prompt) {
  const p = (prompt || "").toLowerCase();
  if (p.includes("sunset") || p.includes("fire") || p.includes("warm")) return "warm";
  if (p.includes("ocean") || p.includes("ice") || p.includes("winter")) return "cool";
  if (p.includes("neon") || p.includes("cyber")) return "neon";
  if (p.includes("forest") || p.includes("nature")) return "emerald";
  if (p.includes("space") || p.includes("galaxy")) return "cosmic";
  return "cool";
}
function enhancePrompt(prompt) {
  const p = (prompt || "").trim();
  if (!p) return "";
  const lower = p.toLowerCase();
  const additions = [];
  if (!lower.includes("cinematic")) additions.push("cinematic lighting");
  if (!lower.includes("smooth") && !lower.includes("motion")) additions.push("smooth motion");
  if (!lower.includes("atmosphere")) additions.push("atmospheric depth");
  if (!lower.includes("detail")) additions.push("high detail");
  const engine = detectEngine(p, "auto");
  return `${p}. ${additions.join(", ")}. Mood: ${engine} motion, rich color, clean composition.`;
}

// ---------- IndexedDB ----------
function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(DB_STORE)) {
        const store = d.createObjectStore(DB_STORE, { keyPath: "id" });
        store.createIndex("when", "when", { unique: false });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
function idbRequest(mode, fn) {
  return openDB().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, mode);
    const store = tx.objectStore(DB_STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
function addVideoRecord(record) { return idbRequest("readwrite", (store) => store.put(record)); }
function getAllVideoRecords() { return idbRequest("readonly", (store) => store.getAll()); }
function clearVideoRecords() { return idbRequest("readwrite", (store) => store.clear()); }

// ---------- Scene builders ----------
function makeScene(engine, w, h, palette, rng) {
  const colors = PALETTES[palette] || PALETTES.cool;
  const ctx = null;
  switch (engine) {
    case "city": return makeCity(w, h, colors, rng);
    case "ocean": return makeOcean(w, h, colors, rng);
    case "space": return makeSpace(w, h, colors, rng);
    case "abstract": return makeAbstract(w, h, colors, rng);
    case "nature": return makeNature(w, h, colors, rng);
    default: return makeAurora(w, h, colors, rng);
  }
}

function makeAurora(w, h, colors, rng) {
  const layers = [];
  for (let i = 0; i < 5; i++) {
    layers.push({
      phase: rng() * Math.PI * 2,
      amp: 30 + rng() * 60,
      y: h * (0.25 + rng() * 0.2),
      color: colors[i % colors.length],
      speed: 0.25 + rng() * 0.7
    });
  }
  const stars = Array.from({ length: 120 }, () => ({ x: rng() * w, y: rng() * h * 0.55, r: rng() * 1.6 + 0.2, tw: rng() * Math.PI * 2 }));
  const mountains = [
    { y: h * 0.62, color: "rgba(9,16,30,0.9)", amp: 24 },
    { y: h * 0.68, color: "rgba(15,24,42,0.95)", amp: 18 }
  ];
  return (c, t) => {
    // sky
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#061024");
    sky.addColorStop(0.45, "#0b1f4a");
    sky.addColorStop(1, "#030712");
    c.fillStyle = sky; c.fillRect(0, 0, w, h);
    // stars
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * 1.8 + s.tw);
      c.globalAlpha = tw;
      c.fillStyle = "#ffffff";
      c.beginPath(); c.arc(s.x, s.y, s.r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    // aurora
    for (const l of layers) {
      c.save();
      c.globalAlpha = 0.32;
      c.fillStyle = l.color;
      c.beginPath();
      c.moveTo(0, l.y);
      for (let x = 0; x <= w; x += 8) {
        const y = l.y + Math.sin(x * 0.01 + t * l.speed + l.phase) * l.amp;
        c.lineTo(x, y);
      }
      c.lineTo(w, h); c.lineTo(0, h); c.closePath();
      c.fill();
      c.restore();
    }
    // mountains
    for (const m of mountains) {
      c.fillStyle = m.color;
      c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 10) {
        const y = m.y + Math.sin(x * 0.008 + t * 0.1) * m.amp;
        c.lineTo(x, y);
      }
      c.lineTo(w, h); c.closePath(); c.fill();
    }
    // reflection
    c.save();
    c.globalAlpha = 0.18;
    const ref = c.createLinearGradient(0, h * 0.7, 0, h);
    ref.addColorStop(0, colors[0]);
    ref.addColorStop(1, "transparent");
    c.fillStyle = ref;
    c.fillRect(0, h * 0.7, w, h * 0.3);
    c.restore();
  };
}

function makeCity(w, h, colors, rng) {
  const buildings = [];
  let x = 0;
  while (x < w) {
    const bw = 20 + rng() * 60;
    const bh = h * (0.25 + rng() * 0.45);
    buildings.push({ x, w: bw, h: bh, windows: Math.floor(4 + rng() * 8), phase: rng() * 10 });
    x += bw + 2 + rng() * 6;
  }
  const rain = Array.from({ length: 140 }, () => ({ x: rng() * w, y: rng() * h, s: 6 + rng() * 8 }));
  return (c, t) => {
    const sky = c.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#050816"); sky.addColorStop(0.5, "#101735"); sky.addColorStop(1, "#02040a");
    c.fillStyle = sky; c.fillRect(0, 0, w, h);
    // distant glow
    c.save(); c.globalAlpha = 0.25;
    for (let i = 0; i < 3; i++) {
      const gx = w * (0.2 + i * 0.3) + Math.sin(t * 0.2 + i) * 40;
      const g = c.createRadialGradient(gx, h * 0.55, 0, gx, h * 0.55, 180);
      g.addColorStop(0, colors[i % colors.length]); g.addColorStop(1, "transparent");
      c.fillStyle = g; c.fillRect(0, 0, w, h);
    }
    c.restore();
    // buildings
    for (const b of buildings) {
      c.fillStyle = "rgba(8,12,26,0.95)";
      c.fillRect(b.x, h - b.h, b.w, b.h);
      c.strokeStyle = "rgba(255,255,255,0.05)";
      c.strokeRect(b.x, h - b.h, b.w, b.h);
      for (let i = 0; i < b.windows; i++) {
        if (Math.sin(t * 1.2 + b.phase + i) > 0.15) {
          c.fillStyle = colors[i % colors.length];
          c.globalAlpha = 0.85;
          const wx = b.x + 4 + (i % 3) * 5;
          const wy = h - b.h + 6 + Math.floor(i / 3) * 7;
          c.fillRect(wx, wy, 3, 4);
        }
      }
      c.globalAlpha = 1;
    }
    // rain
    c.strokeStyle = "rgba(180,220,255,0.18)";
    c.lineWidth = 1;
    c.beginPath();
    for (const r of rain) {
      const y = (r.y + t * (200 + r.s * 10)) % h;
      c.moveTo(r.x, y); c.lineTo(r.x, y + r.s);
    }
    c.stroke();
    // ground glow
    const gg = c.createLinearGradient(0, h - 40, 0, h);
    gg.addColorStop(0, "transparent"); gg.addColorStop(1, colors[2] + "55");
    c.fillStyle = gg; c.fillRect(0, h - 40, w, 40);
  };
}

function makeOcean(w, h, colors, rng) {
  const clouds = Array.from({ length: 8 }, () => ({ x: rng() * w, y: 20 + rng() * 80, s: 40 + rng() * 60, v: 6 + rng() * 12 }));
  return (c, t) => {
    const sky = c.createLinearGradient(0, 0, 0, h * 0.5);
    sky.addColorStop(0, "#071a3a"); sky.addColorStop(1, "#1b3a6f");
    c.fillStyle = sky; c.fillRect(0, 0, w, h * 0.52);
    const sea = c.createLinearGradient(0, h * 0.52, 0, h);
    sea.addColorStop(0, "#0a2a55"); sea.addColorStop(1, "#020b1a");
    c.fillStyle = sea; c.fillRect(0, h * 0.52, w, h * 0.48);
    // sun
    const sx = w * 0.72, sy = h * 0.24;
    const sun = c.createRadialGradient(sx, sy, 0, sx, sy, 90);
    sun.addColorStop(0, "#fff7d6"); sun.addColorStop(0.4, "#ffd166"); sun.addColorStop(1, "transparent");
    c.fillStyle = sun; c.beginPath(); c.arc(sx, sy, 90, 0, Math.PI * 2); c.fill();
    // clouds
    c.save(); c.globalAlpha = 0.5;
    for (const cl of clouds) {
      const x = (cl.x + t * cl.v) % (w + 120) - 60;
      c.fillStyle = "rgba(255,255,255,0.6)";
      c.beginPath();
      c.ellipse(x, cl.y, cl.s, cl.s * 0.35, 0, 0, Math.PI * 2);
      c.ellipse(x + 25, cl.y - 5, cl.s * 0.7, cl.s * 0.3, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    // waves
    for (let k = 0; k < 6; k++) {
      c.save(); c.globalAlpha = 0.28 + k * 0.06;
      c.strokeStyle = colors[k % colors.length];
      c.lineWidth = 2;
      c.beginPath();
      const base = h * 0.52 + k * 16;
      for (let x = 0; x <= w; x += 6) {
        const y = base + Math.sin(x * 0.012 + t * 0.9 + k * 0.7) * (6 + k * 2);
        if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      c.restore();
    }
    // shimmer
    c.save(); c.globalAlpha = 0.15;
    const sh = c.createLinearGradient(0, h * 0.5, w, h);
    sh.addColorStop(0, "transparent"); sh.addColorStop(0.5, colors[1]); sh.addColorStop(1, "transparent");
    c.fillStyle = sh; c.fillRect(0, h * 0.5, w, h * 0.5);
    c.restore();
  };
}

function makeSpace(w, h, colors, rng) {
  const stars = Array.from({ length: 260 }, () => ({ x: rng() * w, y: rng() * h, r: rng() * 1.8 + 0.15, tw: rng() * Math.PI * 2, layer: rng() }));
  const nebulae = Array.from({ length: 4 }, () => ({ x: rng() * w, y: rng() * h, r: 120 + rng() * 200, c: colors[Math.floor(rng() * colors.length)] }));
  const orbiters = Array.from({ length: 3 }, (_, i) => ({ radius: 90 + i * 70, speed: 0.15 + i * 0.1, phase: rng() * Math.PI * 2, size: 4 + i * 3 }));
  return (c, t) => {
    c.fillStyle = "#02030a"; c.fillRect(0, 0, w, h);
    // nebulae
    c.save();
    for (const n of nebulae) {
      const x = n.x + Math.sin(t * 0.12 + n.r) * 30;
      const y = n.y + Math.cos(t * 0.1 + n.r) * 20;
      const g = c.createRadialGradient(x, y, 0, x, y, n.r);
      g.addColorStop(0, n.c + "55"); g.addColorStop(1, "transparent");
      c.globalAlpha = 0.7;
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, n.r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    // stars with parallax
    for (const s of stars) {
      const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.5 + s.tw));
      const px = (s.x - t * (8 + s.layer * 16)) % w;
      const x = px < 0 ? px + w : px;
      c.globalAlpha = tw * (0.5 + s.layer * 0.5);
      c.fillStyle = "#ffffff";
      c.beginPath(); c.arc(x, s.y + Math.sin(t * 0.4 + s.tw) * 1.5, s.r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    // planet
    const px = w * 0.78, py = h * 0.28, pr = Math.min(w, h) * 0.12;
    const pl = c.createRadialGradient(px - pr * 0.3, py - pr * 0.3, pr * 0.1, px, py, pr);
    pl.addColorStop(0, colors[0]); pl.addColorStop(0.6, colors[2]); pl.addColorStop(1, "#05060f");
    c.fillStyle = pl; c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.fill();
    c.save(); c.globalAlpha = 0.35;
    const ring = c.createLinearGradient(px - pr * 1.6, py, px + pr * 1.6, py);
    ring.addColorStop(0, "transparent"); ring.addColorStop(0.5, colors[1]); ring.addColorStop(1, "transparent");
    c.strokeStyle = ring; c.lineWidth = 2;
    c.beginPath(); c.ellipse(px, py, pr * 1.9, pr * 0.45, 0.35, 0, Math.PI * 2); c.stroke();
    c.restore();
    // orbiters
    c.save();
    for (const o of orbiters) {
      const a = t * o.speed + o.phase;
      const x = px + Math.cos(a) * o.radius;
      const y = py + Math.sin(a) * o.radius * 0.35;
      const g = c.createRadialGradient(x, y, 0, x, y, o.size * 3);
      g.addColorStop(0, colors[3]); g.addColorStop(1, "transparent");
      c.fillStyle = g; c.beginPath(); c.arc(x, y, o.size * 3, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  };
}

function makeAbstract(w, h, colors, rng) {
  const particles = Array.from({ length: 90 }, () => ({
    x: rng() * w, y: rng() * h, r: 2 + rng() * 6, vx: -0.6 + rng() * 1.2, vy: -0.6 + rng() * 1.2, ci: Math.floor(rng() * colors.length), p: rng() * Math.PI * 2
  }));
  const blobs = Array.from({ length: 4 }, () => ({ x: rng() * w, y: rng() * h, r: 80 + rng() * 120, v: 0.2 + rng() * 0.6, phase: rng() * Math.PI * 2, ci: Math.floor(rng() * colors.length) }));
  return (c, t) => {
    c.fillStyle = "#04060f"; c.fillRect(0, 0, w, h);
    // blobs
    c.save();
    for (const b of blobs) {
      const x = b.x + Math.sin(t * b.v + b.phase) * 60;
      const y = b.y + Math.cos(t * b.v * 0.8 + b.phase) * 50;
      const g = c.createRadialGradient(x, y, 0, x, y, b.r);
      g.addColorStop(0, colors[b.ci] + "66"); g.addColorStop(1, "transparent");
      c.fillStyle = g; c.beginPath(); c.arc(x, y, b.r, 0, Math.PI * 2); c.fill();
    }
    c.restore();
    // swirling particles
    for (const p of particles) {
      const x = p.x + Math.sin(t * 0.8 + p.p) * 80;
      const y = p.y + Math.cos(t * 0.7 + p.p) * 80;
      c.save(); c.globalAlpha = 0.7;
      c.fillStyle = colors[p.ci];
      c.beginPath(); c.arc(x, y, p.r, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    // trails
    c.save(); c.globalAlpha = 0.12; c.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      c.strokeStyle = colors[i % colors.length];
      c.beginPath();
      for (let x = 0; x <= w; x += 12) {
        const y = h / 2 + Math.sin(x * 0.008 + t * 0.9 + i * 1.3) * (60 + i * 20);
        if (x === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    c.restore();
    // center vortex
    const vx = w / 2, vy = h / 2;
    c.save();
    for (let i = 0; i < 12; i++) {
      const a = t * 0.6 + i * Math.PI / 6;
      const r = 30 + i * 12 + Math.sin(t + i) * 10;
      c.strokeStyle = colors[i % colors.length];
      c.globalAlpha = 0.45;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(vx, vy, r, a, a + 1.1);
      c.stroke();
    }
    c.restore();
  };
}

function makeNature(w, h, colors, rng) {
  const hills = [
    { y: h * 0.6, c: "#12331a", amp: 28 },
    { y: h * 0.68, c: "#1b4a24", amp: 22 },
    { y: h * 0.76, c: "#245a30", amp: 18 }
  ];
  const trees = Array.from({ length: 14 }, () => ({ x: rng() * w, h: 50 + rng() * 90, w: 3 + rng() * 2, sway: rng() * Math.PI * 2 }));
  const clouds = Array.from({ length: 7 }, () => ({ x: rng() * w, y: 30 + rng() * 70, s: 30 + rng() * 45, v: 4 + rng() * 8 }));
  return (c, t) => {
    // sky
    const sky = c.createLinearGradient(0, 0, 0, h * 0.6);
    sky.addColorStop(0, "#86c5ff"); sky.addColorStop(1, "#eaf6ff");
    c.fillStyle = sky; c.fillRect(0, 0, w, h * 0.62);
    // ground
    c.fillStyle = "#2f7a3a"; c.fillRect(0, h * 0.62, w, h * 0.38);
    // sun rays
    c.save(); c.globalAlpha = 0.25;
    const sx = w * 0.18, sy = h * 0.16;
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6 + t * 0.08;
      c.fillStyle = "#fff6b0";
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(sx + Math.cos(a) * w, sy + Math.sin(a) * w);
      c.lineTo(sx + Math.cos(a + 0.08) * w, sy + Math.sin(a + 0.08) * w);
      c.closePath(); c.fill();
    }
    c.restore();
    // sun
    c.fillStyle = "#ffd166"; c.beginPath(); c.arc(sx, sy, 34, 0, Math.PI * 2); c.fill();
    // clouds
    c.save(); c.globalAlpha = 0.85;
    for (const cl of clouds) {
      const x = (cl.x + t * cl.v) % (w + 100) - 50;
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.beginPath();
      c.ellipse(x, cl.y, cl.s, cl.s * 0.4, 0, 0, Math.PI * 2);
      c.ellipse(x + 20, cl.y - 4, cl.s * 0.7, cl.s * 0.35, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    // hills
    for (const hill of hills) {
      c.fillStyle = hill.c;
      c.beginPath(); c.moveTo(0, h);
      for (let x = 0; x <= w; x += 8) {
        const y = hill.y + Math.sin(x * 0.006 + t * 0.15) * hill.amp;
        c.lineTo(x, y);
      }
      c.lineTo(w, h); c.closePath(); c.fill();
    }
    // trees
    for (const tr of trees) {
      const sway = Math.sin(t * 1.2 + tr.sway) * 6;
      c.strokeStyle = "#3b2f2f"; c.lineWidth = tr.w;
      c.beginPath(); c.moveTo(tr.x, h * 0.72 + 20); c.lineTo(tr.x + sway * 0.2, h * 0.72 + 20 - tr.h); c.stroke();
      c.fillStyle = "#1f6b32"; c.globalAlpha = 0.9;
      c.beginPath(); c.ellipse(tr.x + sway * 0.2, h * 0.72 + 20 - tr.h, 18, 26, 0, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 1;
    }
  };
}

// ---------- Queue ----------
function renderQueue() {
  const el = $("#queue-list"); if (!el) return;
  $("#queue-count").textContent = `${queue.length} item${queue.length === 1 ? "" : "s"}`;
  if (!queue.length) { el.innerHTML = "<p class='q-empty'>No jobs yet. Generate your first video above.</p>"; return; }
  el.innerHTML = [...queue].reverse().map((q) => `
    <div class="queue-item">
      <div class="qi-title">${escapeHtml(q.prompt.slice(0, 60))}</div>
      <div class="qi-meta">${escapeHtml(q.engine)} · ${q.duration}s · ${q.resolution} · ${q.status} · ${new Date(q.when).toLocaleTimeString()}</div>
    </div>
  `).join("");
}

// ---------- Gallery (IndexedDB) ----------
async function refreshGallery() {
  const grid = $("#gallery-grid"); if (!grid) return;
  let records = [];
  try { records = await getAllVideoRecords(); } catch (e) { records = []; }
  records.sort((a, b) => b.when - a.when);
  if (!records.length) { grid.innerHTML = "<p class='muted'>No saved videos yet.</p>"; return; }
  grid.innerHTML = "";
  for (const rec of records) {
    if (!objectUrlCache.has(rec.id)) objectUrlCache.set(rec.id, URL.createObjectURL(rec.blob));
    const url = objectUrlCache.get(rec.id);
    const art = document.createElement("article");
    art.className = "media-card";
    art.innerHTML = `
      <video src="${escapeAttr(url)}" preload="none" controls playsinline></video>
      <div class="mc-body">
        <div class="mc-title">${escapeHtml((rec.prompt || "").slice(0, 70))}</div>
        <div class="mc-meta">${escapeHtml(rec.engine)} · ${rec.duration}s · ${rec.resolution} · ${new Date(rec.when).toLocaleString()}</div>
        <div class="actions">
          <a class="btn btn-ghost btn-sm" href="${escapeAttr(url)}" download="nova-${rec.id}.webm">Download</a>
          <button class="btn btn-ghost btn-sm" data-delete="${escapeAttr(rec.id)}" type="button">Delete</button>
        </div>
      </div>
    `;
    grid.appendChild(art);
  }
  $$("[data-delete]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.delete;
    if (objectUrlCache.has(id)) { URL.revokeObjectURL(objectUrlCache.get(id)); objectUrlCache.delete(id); }
    // remove record by re-opening IDB deletion
    await openDB();
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    await new Promise((res) => { tx.oncomplete = res; });
    refreshGallery();
  }));
}
async function saveToGallery(item, blob) {
  const rec = {
    id: `vid-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
    prompt: item.prompt,
    engine: item.engine,
    duration: item.duration,
    fps: item.fps,
    resolution: item.resolution,
    blob,
    when: Date.now()
  };
  await addVideoRecord(rec);
  await refreshGallery();
  return rec.id;
}

// ---------- Generator ----------
function makeAudioPlan(audio, duration, ctx) {
  // returns {stream, stop}
  if (audio === "off" || !window.AudioContext) return { stream: null, stop: () => {} };
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const dest = ac.createMediaStreamDestination();
  const gain = ac.createGain();
  gain.gain.value = 0.06;
  gain.connect(dest);
  if (audio === "hum") {
    const o1 = ac.createOscillator(); o1.type = "sine"; o1.frequency.value = 58; o1.connect(gain); o1.start();
    const o2 = ac.createOscillator(); o2.type = "sine"; o2.frequency.value = 116; o2.connect(gain); o2.start();
    const stop = () => { o1.stop(); o2.stop(); ac.close(); };
    return { stream: dest.stream, stop, delay: 0 };
  }
  if (audio === "sparkle") {
    const o = ac.createOscillator(); o.type = "triangle"; o.frequency.value = 440; o.connect(gain); o.start();
    const stop = () => { o.stop(); ac.close(); };
    return { stream: dest.stream, stop };
  }
  return { stream: null, stop: () => ac.close() };
}

async function runGeneration(params) {
  const canvas = $("#render-canvas");
  if (!canvas) throw new Error("Canvas not available.");
  const [rw, rh] = params.resolution.split("x").map(Number);
  canvas.width = rw; canvas.height = rh;
  const ctx = canvas.getContext("2d");
  const rng = mulberry32(params.seed);
  const engine = detectEngine(params.prompt, params.style);
  params.engine = engine;
  params.palette = detectPalette(params.prompt);
  const scene = makeScene(engine, rw, rh, params.palette, rng);

  const audioPlan = makeAudioPlan(params.audio, params.duration, ctx);
  const canvasStream = canvas.captureStream(params.fps);
  let mixedStream = canvasStream;
  if (audioPlan.stream) {
    mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioPlan.stream.getAudioTracks()]);
  }
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
  const recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: Math.max(1_200_000, rw * rh * 1.5) });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start(250);

  const start = performance.now();
  const totalMs = params.duration * 1000;
  await new Promise((resolve, reject) => {
    const loop = () => {
      const elapsed = performance.now() - start;
      const t = Math.min(elapsed / 1000, params.duration);
      try { scene(ctx, t); } catch (err) { reject(err); return; }
      if (elapsed >= totalMs) resolve();
      else requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  // final frame ensure
  scene(ctx, params.duration);
  recorder.stop();
  audioPlan.stop();
  await stopped;

  const blob = new Blob(chunks, { type: mimeType });
  if (blob.size < 1024) throw new Error("Recorded video is empty. Try lower resolution or shorter duration.");
  return { blob, engine, mimeType };
}

// ---------- UI ----------
const queueListEl = () => $("#queue-list");

$("#gen-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const statusEl = $("#gen-status");
  const btn = $("#btn-generate");
  const prompt = ($("#prompt")?.value || "").trim();
  if (!prompt) { setStatus(statusEl, "Prompt is required.", "error"); return; }

  const params = {
    prompt,
    style: $("#style").value,
    duration: parseFloat($("#duration").value),
    resolution: $("#resolution").value,
    fps: parseFloat($("#fps").value),
    seedInput: ($("#seed").value || "").trim(),
    audio: $("#audio").value,
  };
  params.seed = params.seedInput ? parseInt(params.seedInput, 10) : hashString(prompt);
  const engine = detectEngine(prompt, params.style);

  const job = { id: `job-${Date.now()}`, prompt, engine: engine === "auto" ? detectEngine(prompt, "auto") : engine, duration: params.duration, resolution: params.resolution, status: "generating", when: Date.now() };
  // correct engine value
  job.engine = params.style === "auto" ? detectEngine(prompt, "auto") : params.style;
  params.engine = job.engine;
  queue.push(job);
  renderQueue();

  btn.disabled = true; btn.textContent = "Generating…";
  setStatus(statusEl, "Generating frames… this runs on your device.");
  let generated = null;
  try {
    const { blob, engine: eng, mimeType } = await runGeneration(params);
    params.engine = eng;
    const item = {
      prompt, engine: eng, duration: params.duration, resolution: params.resolution,
      fps: params.fps, seed: params.seed, mimeType, size: blob.size, when: Date.now(), blob
    };
    const objUrl = URL.createObjectURL(blob);
    generated = { item, objUrl, blob };
    lastGenerated = generated;

    const empty = $("#preview-empty"), media = $("#preview-media"), meta = $("#preview-meta");
    const video = $("#preview-video"), info = $("#preview-info"), dl = $("#preview-download"), saveBtn = $("#preview-save");
    if (video) { video.src = objUrl; video.load(); }
    if (dl) { dl.href = objUrl; dl.download = `nova-${eng}-${params.duration}s.webm`; }
    if (info) info.textContent = `${eng} engine · ${params.duration}s · ${params.resolution} · ${params.fps}fps · ${formatBytes(blob.size)}`;
    empty?.classList.add("hidden");
    media?.classList.remove("hidden");
    meta?.classList.remove("hidden");
    if (saveBtn) { saveBtn.textContent = "Save to gallery"; saveBtn.disabled = false; }
    job.status = "done";
    renderQueue();
    setStatus(statusEl, "Done — real video generated on-device.");
  } catch (err) {
    job.status = "failed";
    renderQueue();
    setStatus(statusEl, `Generation failed: ${err.message}`, "error");
  } finally {
    btn.disabled = false; btn.textContent = "Generate video";
  }
});

$("#btn-enhance")?.addEventListener("click", () => {
  const ta = $("#prompt"); if (!ta) return;
  const current = ta.value.trim();
  if (!current) { setStatus($("#gen-status"), "Enter a prompt first.", "error"); return; }
  ta.value = enhancePrompt(current);
  setStatus($("#gen-status"), "Prompt enhanced locally.");
});

$("#preview-save")?.addEventListener("click", async () => {
  if (!lastGenerated) return;
  try {
    await saveToGallery(lastGenerated.item, lastGenerated.blob);
    const btn = $("#preview-save"); if (btn) { btn.textContent = "Saved"; btn.disabled = true; }
    await refreshGallery();
    setStatus($("#gen-status"), "Saved to gallery.");
  } catch (e) {
    setStatus($("#gen-status"), `Save failed: ${e.message}`, "error");
  }
});

// ---------- Gallery ----------
$("#btn-clear-gallery")?.addEventListener("click", async () => {
  if (!confirm("Delete all saved videos from this browser?")) return;
  await clearVideoRecords();
  objectUrlCache.forEach((u) => URL.revokeObjectURL(u));
  objectUrlCache.clear();
  refreshGallery();
});

// ---------- Engine tab highlight (none extra) ----------

// ---------- Init ----------
(async function init() {
  renderQueue();
  await openDB();
  await refreshGallery();
  // ensure canvas exists
  renderCanvas = $("#render-canvas");
  renderCtx = renderCanvas?.getContext("2d");
})();