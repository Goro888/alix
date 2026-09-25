/**
 * Legend Boy — AI assistant backend (Cloudflare Worker, powered by Google Gemini)
 *
 * Cloudflare only HOSTS the app. All AI runs on the Gemini API with your own key:
 *   GEMINI_API_KEY  (secret, required)  → set in Cloudflare: Worker → Settings → Variables and Secrets
 *   GEMINI_MODEL    (var, optional)     → chat / vision / research / transcription model
 *
 * Routes
 *   GET  /api/health       status + feature flags
 *   POST /api/chat         streamed chat (text + photos + files)             → SSE
 *   POST /api/research     Google-Search-grounded research with citations    → SSE
 *   POST /api/transcribe   voice → text (multipart "audio")                  → JSON
 *   POST /api/tts          text → voice (JSON {text, speaker})               → audio/wav
 *   POST /api/extract      document → text (multipart "file")                → JSON
 *   POST /api/imagine      text → image (JSON {prompt})                      → JSON
 */

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const DEFAULTS = {
  chat: "gemini-flash-latest", // always points to Google's newest Flash model
  tts: "gemini-3.8-flash-lite-tts",
  image: "gemini-3.1-flash-lite-image",
  voice: "Puck",
};

// Gemini prebuilt voices (m = masculine, f = feminine)
const VOICES = {
  Puck: "m", Charon: "m", Fenrir: "m", Orus: "m", Enceladus: "m", Iapetus: "m", Umbriel: "m",
  Algieba: "m", Algenib: "m", Rasalgethi: "m", Alnilam: "m", Schedar: "m", Achird: "m",
  Zubenelgenubi: "m", Sadachbia: "m", Sadaltager: "m",
  Zephyr: "f", Kore: "f", Leda: "f", Aoede: "f", Callirrhoe: "f", Autonoe: "f", Despina: "f",
  Erinome: "f", Laomedeia: "f", Achernar: "f", Gacrux: "f", Pulcherrima: "f", Vindemiatrix: "f", Sulafat: "f",
};

const MAX_HISTORY = 30;
const MAX_FILE_CHARS = 60000;
const MAX_MSG_CHARS = 20000;

export default {
  async fetch(request, rawEnv) {
    const url = new URL(request.url);
    // Key priority: Cloudflare secret GEMINI_API_KEY → key saved in the app on the user's phone.
    const env = withKey(rawEnv, request);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    try {
      if (url.pathname === "/api/health") return health(env);
      if (!checkAccess(request, env)) return json({ error: "Access code required", code: "ACCESS_CODE" }, 401);
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      if (!isMock(env) && !env.GEMINI_API_KEY) {
        return json({
          error: "Legend Boy needs your Gemini API key. Paste it in Settings ⚙️ (it's saved only on this phone), or add a Secret named GEMINI_API_KEY in Cloudflare.",
          code: "NO_KEY",
        }, 500);
      }

      switch (url.pathname) {
        case "/api/chat": return await handleChat(request, env);
        case "/api/research": return await handleResearch(request, env);
        case "/api/transcribe": return await handleTranscribe(request, env);
        case "/api/tts": return await handleTTS(request, env);
        case "/api/extract": return await handleExtract(request, env);
        case "/api/imagine": return await handleImagine(request, env);
        case "/api/verify": return await handleVerify(env);
        default: return json({ error: "Not found" }, 404);
      }
    } catch (err) {
      console.error(err);
      return json({ error: friendlyError(err), code: errorCode(err) }, err?.status && err.status < 600 ? err.status : 500);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function cleanKey(k) {
  const v = String(k || "").trim();
  // ignore empty values and placeholders like "your_key_here"
  if (v.length < 20 || /your|xxx|placeholder|example/i.test(v)) return "";
  return v;
}

const looksLikeKey = (v) => /^(AQ\.|AIza)[\w.-]{20,}$/.test(String(v || "").trim());
const MODEL_VARS = ["GEMINI_MODEL", "GEMINI_TTS_MODEL", "GEMINI_IMAGE_MODEL", "TTS_SPEAKER"];

function withKey(env, request) {
  env = { ...env };
  // If the key was pasted into a model/voice variable by mistake, use it as the key
  // and fall back to the default model for that variable.
  let strayKey = "";
  for (const n of MODEL_VARS) {
    if (looksLikeKey(env[n])) { strayKey = strayKey || String(env[n]).trim(); delete env[n]; }
  }
  const serverKey = cleanKey(env.GEMINI_API_KEY) || strayKey;
  const appKey = cleanKey(request.headers.get("x-gemini-key"));
  return { ...env, GEMINI_API_KEY: serverKey || appKey, SERVER_KEY: Boolean(serverKey) };
}

function models(env) {
  return {
    chat: env.GEMINI_MODEL || DEFAULTS.chat,
    tts: env.GEMINI_TTS_MODEL || DEFAULTS.tts,
    image: env.GEMINI_IMAGE_MODEL || DEFAULTS.image,
  };
}

function isMock(env) {
  return env.MOCK_AI === "1" || env.MOCK_AI === "true";
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-access-code",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function checkAccess(request, env) {
  const required = (env.ACCESS_CODE || "").trim();
  if (!required) return true;
  const given = (request.headers.get("x-access-code") || "").trim();
  if (given.length !== required.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ required.charCodeAt(i);
  return diff === 0;
}

class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function friendlyError(err) {
  const msg = String(err?.message || err || "Unknown error");
  const s = err?.status;
  if (s === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return "Gemini limit reached for now (free tier). Wait a minute and try again. (" + msg.slice(0, 200) + ")";
  if (s === 401 || s === 403 || /API key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) return "Gemini rejected the API key — check it in Settings ⚙️ (or the GEMINI_API_KEY secret on Cloudflare). (" + msg.slice(0, 200) + ")";
  if (s === 404 || /not found|is not supported/i.test(msg)) return "Gemini model not available: " + msg.slice(0, 240);
  return msg;
}

function errorCode(err) {
  const msg = String(err?.message || "");
  if (/API key|API_KEY_INVALID|UNAUTHENTICATED|PERMISSION_DENIED/i.test(msg) || err?.status === 401 || err?.status === 403) return "BAD_KEY";
  if (err?.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return "RATE_LIMIT";
  return undefined;
}

/** Check that the Gemini key works (used by the app's "Connect Gemini" screen). */
async function handleVerify(env) {
  if (isMock(env)) return json({ ok: true, mock: true });
  const res = await fetch(`${GEMINI_BASE}/models?pageSize=50`, { headers: { "x-goog-api-key": env.GEMINI_API_KEY } });
  if (!res.ok) {
    const err = new GeminiError(extractGeminiError(await res.text()), res.status);
    return json({ ok: false, error: friendlyError(err), code: errorCode(err) || "BAD_KEY" }, 400);
  }
  const data = await res.json().catch(() => ({}));
  const names = (data.models || []).map((m) => String(m.name || "").replace("models/", ""));
  return json({ ok: true, server: Boolean(env.SERVER_KEY), models: names.slice(0, 50) });
}

function health(env) {
  return json({
    ok: true,
    name: "Legend Boy",
    provider: "gemini",
    mock: isMock(env),
    keyConfigured: Boolean(env.SERVER_KEY), // key saved on Cloudflare
    appKeyAccepted: Boolean(env.GEMINI_API_KEY && !env.SERVER_KEY),
    accessCodeRequired: Boolean((env.ACCESS_CODE || "").trim()),
    webSearch: "google",
    models: models(env),
    speakers: Object.keys(VOICES),
    voiceGenders: VOICES,
    defaultSpeaker: env.TTS_SPEAKER && VOICES[env.TTS_SPEAKER] ? env.TTS_SPEAKER : DEFAULTS.voice,
  });
}

function todayString() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

function systemPrompt(userName) {
  const name = (userName || "").toString().slice(0, 40).trim();
  return [
    `You are Legend Boy — a friendly, confident, and genuinely helpful personal AI assistant living in the user's phone.`,
    `Personality: warm, upbeat, a little playful, never cringe. You speak like a smart friend. Keep answers clear and well organised.`,
    `Today is ${todayString()}.`,
    name ? `The user's name is ${name}. Use it naturally now and then, not in every message.` : ``,
    `Abilities inside this app: chatting, seeing photos from the camera or gallery, reading files (PDF, Word, Excel, PowerPoint, text, code), deep web research with sources, creating images, and voice conversation.`,
    `When the user shares an image, look closely and describe or analyse exactly what is asked. When the user shares a file, its content is included between <<<FILE>>> markers — use it to answer.`,
    `Format with Markdown (short paragraphs, bullet lists, **bold** for key points, code blocks for code). For casual chat keep it short.`,
    `If something may have changed recently, say so and suggest using the Research tab.`,
    `Reply in the same language the user writes in.`,
  ].filter(Boolean).join("\n");
}

const VOICE_ADDON = `\nThe user is TALKING to you by voice and will HEAR your reply. Answer conversationally in 1–4 short sentences, no Markdown, no lists, no emojis, no URLs. Ask a quick follow-up question when natural.`;

function parseDataUrl(url) {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(url || "");
  return m ? { mimeType: m[1], data: m[2] } : null;
}

/** Convert the client conversation into Gemini `contents`. */
function buildContents(clientMessages) {
  const msgs = Array.isArray(clientMessages) ? clientMessages.slice(-MAX_HISTORY) : [];

  // Only the most recent message that carries images keeps them (fast + small requests).
  let lastImageIdx = -1;
  msgs.forEach((m, i) => { if (m?.role === "user" && Array.isArray(m.images) && m.images.length) lastImageIdx = i; });

  const contents = [];
  msgs.forEach((m, i) => {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return;
    let text = String(m.content || "").slice(0, MAX_MSG_CHARS);
    if (Array.isArray(m.files) && m.files.length) {
      text += m.files
        .filter((f) => f && f.text)
        .map((f) => `\n\n<<<FILE: ${String(f.name || "file").slice(0, 120)}>>>\n${String(f.text).slice(0, MAX_FILE_CHARS)}\n<<<END FILE>>>`)
        .join("");
    }
    const images = Array.isArray(m.images) ? m.images.map(parseDataUrl).filter(Boolean) : [];
    const parts = [];
    if (m.role === "user" && i === lastImageIdx && images.length) {
      images.slice(0, 6).forEach((img) => parts.push({ inlineData: img }));
      parts.push({ text: text || "What do you see in this image?" });
    } else {
      if (m.role === "user" && images.length) text = `[shared ${images.length} photo(s) earlier] ` + text;
      parts.push({ text: text.trim() ? text : m.role === "user" ? "(empty)" : "…" });
    }
    const role = m.role === "assistant" ? "model" : "user";
    // Gemini prefers alternating roles — merge consecutive same-role turns.
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts);
    else contents.push({ role, parts });
  });

  if (!contents.length || contents[contents.length - 1].role !== "user") contents.push({ role: "user", parts: [{ text: "Continue." }] });
  if (contents[0].role !== "user") contents.unshift({ role: "user", parts: [{ text: "Hi" }] });
  return contents;
}

/* ------------------------------------------------------------------ */
/* Gemini API                                                          */
/* ------------------------------------------------------------------ */

async function geminiFetch(env, model, method, body, { stream = false, signal } = {}) {
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:${method}${stream ? "?alt=sse" : ""}`;
  const send = (b) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(b),
      signal,
    });

  let res = await send(body);
  // Older models don't know `thinkingConfig.thinkingLevel` — retry once without it.
  if (res.status === 400 && body.generationConfig?.thinkingConfig) {
    const text = await res.text();
    if (/thinking/i.test(text)) {
      const b2 = { ...body, generationConfig: { ...body.generationConfig } };
      delete b2.generationConfig.thinkingConfig;
      res = await send(b2);
    } else {
      throw new GeminiError(extractGeminiError(text), 400);
    }
  }
  if (!res.ok) throw new GeminiError(extractGeminiError(await res.text()), res.status);
  return res;
}

function extractGeminiError(text) {
  try {
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    return e?.message || text.slice(0, 300);
  } catch {
    return text.slice(0, 300);
  }
}

/** Iterate over parsed JSON chunks of a Gemini SSE stream. */
async function* geminiEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try { yield JSON.parse(payload); } catch {}
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith("data:")) { try { yield JSON.parse(rest.slice(5).trim()); } catch {} }
}

function chunkText(ev) {
  const parts = ev?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
}

function responseText(j) {
  return (j?.candidates?.[0]?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");
}

function blockedReason(ev) {
  const fb = ev?.promptFeedback?.blockReason;
  const fr = ev?.candidates?.[0]?.finishReason;
  if (fb) return `Request blocked by Gemini safety filters (${fb}).`;
  if (fr && /SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(fr)) return `Answer stopped by Gemini safety filters (${fr}).`;
  return null;
}

/** Create an SSE response and give the caller a `send(obj)` function. */
function sseStream(run) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let closed = false;
  const send = async (obj) => {
    if (closed) return;
    try { await writer.write(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { closed = true; }
  };
  (async () => {
    try {
      await run(send);
    } catch (err) {
      console.error(err);
      await send({ type: "error", error: friendlyError(err), code: errorCode(err) });
    } finally {
      await send({ type: "done" });
      closed = true;
      try { await writer.close(); } catch {}
    }
  })();
  return new Response(readable, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}

async function mockStream(send, text) {
  for (const word of text.split(/(\s+)/)) {
    await send({ type: "token", text: word });
    await new Promise((r) => setTimeout(r, 10));
  }
  return { text, grounding: null };
}

/**
 * Stream a Gemini answer, forwarding tokens. Returns {text, grounding}.
 */
async function streamGemini(env, send, { system, contents, tools, fast = false }) {
  if (isMock(env)) {
    const last = contents[contents.length - 1];
    const lastText = last.parts.filter((p) => p.text).map((p) => p.text).join(" ");
    const hasImage = last.parts.some((p) => p.inlineData);
    return mockStream(send,
      `**Demo mode** is on (no Gemini key used in local dev).\n\n` +
      (hasImage ? `I received your photo 📸 — once deployed I'll describe it for real.\n\n` : "") +
      `You said: _"${lastText.slice(0, 160).replace(/\n/g, " ")}"_\n\nAdd your **GEMINI_API_KEY** secret on Cloudflare and I'll answer for real. 🚀`);
  }

  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: 8192 },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };
  if (fast) body.generationConfig.thinkingConfig = { thinkingLevel: "low" };
  if (tools) body.tools = tools;

  const res = await geminiFetch(env, models(env).chat, "streamGenerateContent", body, { stream: true });
  let full = "";
  let grounding = null;
  let blocked = null;
  for await (const ev of geminiEvents(res)) {
    const t = chunkText(ev);
    if (t) {
      full += t;
      await send({ type: "token", text: t });
    }
    const gm = ev?.candidates?.[0]?.groundingMetadata;
    if (gm) grounding = mergeGrounding(grounding, gm);
    blocked = blockedReason(ev) || blocked;
  }
  if (!full && blocked) throw new Error(blocked);
  return { text: full, grounding };
}

function mergeGrounding(a, b) {
  if (!a) return { ...b };
  return {
    webSearchQueries: [...new Set([...(a.webSearchQueries || []), ...(b.webSearchQueries || [])])],
    groundingChunks: b.groundingChunks?.length ? b.groundingChunks : a.groundingChunks,
    groundingSupports: [...(a.groundingSupports || []), ...(b.groundingSupports || [])],
  };
}

async function generateOnce(env, { system, parts, fast = true, config = {} }, model) {
  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: { ...config },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (fast) body.generationConfig.thinkingConfig = { thinkingLevel: "low" };
  const res = await geminiFetch(env, model || models(env).chat, "generateContent", body);
  return res.json();
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

async function handleChat(request, env) {
  const body = await request.json().catch(() => ({}));
  const voice = Boolean(body.voice);
  const contents = buildContents(body.messages);
  return sseStream(async (send) => {
    await streamGemini(env, send, {
      system: systemPrompt(body.userName) + (voice ? VOICE_ADDON : ""),
      contents,
      fast: voice,
    });
  });
}

/* ------------------------------------------------------------------ */
/* Research (Google Search grounding, with free-search fallback)       */
/* ------------------------------------------------------------------ */

async function handleResearch(request, env) {
  const body = await request.json().catch(() => ({}));
  const query = String(body.query || "").trim().slice(0, 800);
  const deep = body.depth === "deep";
  if (!query) return json({ error: "Please enter a research topic." }, 400);

  const system = researchSystem(deep, true);

  return sseStream(async (send) => {
    await send({ type: "status", step: "search", text: "Searching Google…" });

    let result;
    try {
      // Stream the report live, then add citations once grounding info arrives.
      let started = false;
      result = await streamGemini(env, async (ev) => {
        if (ev.type === "token" && !started) {
          started = true;
          await send({ type: "status", step: "write", text: "Writing your report…" });
        }
        await send(ev);
      }, {
        system,
        contents: [{ role: "user", parts: [{ text: `Research question: ${query}` }] }],
        tools: [{ google_search: {} }],
      });
    } catch (e) {
      console.warn("grounded research failed, falling back", e);
      await send({ type: "status", step: "fallback", text: "Google Search unavailable — using backup search…" });
      await send({ type: "reset" });
      return fallbackResearch(env, send, query, deep);
    }

    const g = result.grounding;
    if (g?.webSearchQueries?.length) await send({ type: "queries", queries: g.webSearchQueries });
    const chunks = (g?.groundingChunks || []).filter((c) => c.web?.uri);
    const sources = chunks.map((c, i) => ({ n: i + 1, title: c.web.title || c.web.domain || "Source", url: c.web.uri, snippet: "" }));
    if (sources.length) {
      await send({ type: "sources", sources });
      const cited = addCitations(result.text, g.groundingSupports || [], chunks.length);
      if (cited !== result.text) await send({ type: "replace", text: cited });
    }
  });
}

function researchSystem(deep, grounded) {
  return (
    `You are Legend Boy, an expert research assistant. Today is ${todayString()}.\n` +
    (grounded
      ? `Research the question using Google Search (run several different searches${deep ? ", at least 5, covering different angles" : ""}) and write a ${deep ? "thorough, detailed" : "clear, concise"} report in Markdown.\n`
      : `Write a ${deep ? "thorough, detailed" : "clear, concise"} research report in Markdown using the numbered sources provided. Cite facts inline like [1] or [2][3].\n`) +
    `Rules:\n- Start with a short **TL;DR**.\n- Use ## headings and bullet points.\n- Include concrete facts, numbers, dates and names.\n` +
    `- If sources disagree or info may be outdated, say so.\n- End with "## Key takeaways".\n- Do NOT write a sources list or raw URLs (the app shows sources).\n- Reply in the same language as the question.`
  );
}

/** Insert [n] markers after grounded text segments. */
function addCitations(text, supports, nChunks) {
  const inserts = [];
  let searchFrom = 0;
  const sorted = [...supports].sort((a, b) => (a.segment?.endIndex || 0) - (b.segment?.endIndex || 0));
  for (const s of sorted) {
    const seg = s.segment?.text;
    const idxs = (s.groundingChunkIndices || []).filter((i) => i < nChunks);
    if (!seg || !idxs.length) continue;
    let pos = text.indexOf(seg, Math.max(0, searchFrom - seg.length));
    if (pos < 0) pos = text.indexOf(seg);
    if (pos < 0) continue;
    const end = pos + seg.length;
    searchFrom = end;
    inserts.push({ at: end, marks: [...new Set(idxs)].slice(0, 3).map((i) => `[${i + 1}]`).join("") });
  }
  inserts.sort((a, b) => b.at - a.at);
  let out = text;
  let lastAt = Infinity;
  for (const ins of inserts) {
    if (ins.at === lastAt) continue;
    lastAt = ins.at;
    out = out.slice(0, ins.at) + ins.marks + out.slice(ins.at);
  }
  return out;
}

async function fallbackResearch(env, send, query, deep) {
  const queries = [query];
  await send({ type: "queries", queries });
  const results = (await Promise.all(queries.map((q) => freeSearch(q).catch(() => [])))).flat();
  const seen = new Set();
  const sources = [];
  for (const r of results) {
    if (!r?.url || seen.has(r.url)) continue;
    seen.add(r.url);
    sources.push(r);
  }
  const top = sources.slice(0, deep ? 8 : 6);
  await Promise.all(top.filter((s) => !s.content || s.content.length < 400).slice(0, 4).map(async (s) => {
    const t = await fetchPageText(s.url).catch(() => "");
    if (t) s.content = (s.content || "") + "\n" + t.slice(0, 4000);
  }));
  await send({ type: "sources", sources: top.map((s, i) => ({ n: i + 1, title: s.title, url: s.url, snippet: (s.snippet || "").slice(0, 200) })) });
  await send({ type: "status", step: "write", text: "Writing your report…" });
  const context = top.length
    ? top.map((s, i) => `[${i + 1}] ${s.title}\nURL: ${s.url}\n${(s.content || s.snippet || "").slice(0, 4000)}`).join("\n\n---\n\n")
    : "(No web results found. Answer from your own knowledge and clearly say live sources were unavailable.)";
  await streamGemini(env, send, {
    system: researchSystem(deep, false),
    contents: [{ role: "user", parts: [{ text: `Research question: ${query}\n\nSources:\n\n${context}` }] }],
  });
}

const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36 LegendBoy/1.0";

async function freeSearch(q) {
  const [ddg, wiki] = await Promise.all([searchDuckDuckGo(q).catch(() => []), searchWikipedia(q).catch(() => [])]);
  return [...ddg.slice(0, 5), ...wiki.slice(0, 3)];
}

async function searchDuckDuckGo(q) {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body: `q=${encodeURIComponent(q)}`,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  return parseDuckDuckGo(await res.text());
}

function parseDuckDuckGo(html) {
  const out = [];
  const anchors = [];
  const re = /<a\b[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const href = (m[0].match(/href="([^"]+)"/) || [])[1];
    if (href) anchors.push({ href, title: m[1], start: m.index, end: re.lastIndex });
  }
  anchors.forEach((a, i) => {
    if (out.length >= 8) return;
    let href = decodeEntities(a.href);
    const uddg = href.match(/[?&]uddg=([^&]+)/);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:\/\//.test(href) || /duckduckgo\.com\/(y\.js|l\/)/.test(href)) return;
    const block = html.slice(a.end, anchors[i + 1]?.start ?? a.end + 4000);
    const sn = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(a|div|td)>/);
    out.push({ title: stripTags(a.title), url: href, snippet: stripTags(sn?.[1] || "") });
  });
  return out;
}

async function searchWikipedia(q) {
  const api =
    "https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=3&prop=extracts|info" +
    "&inprop=url&exintro=1&explaintext=1&exlimit=max&origin=*&gsrsearch=" + encodeURIComponent(q);
  const res = await fetch(api, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const data = await res.json();
  return Object.values(data.query?.pages || {})
    .sort((a, b) => (a.index || 0) - (b.index || 0))
    .map((p) => ({ title: `${p.title} — Wikipedia`, url: p.fullurl, snippet: (p.extract || "").slice(0, 300), content: p.extract || "" }));
}

async function fetchPageText(url) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,text/plain" }, redirect: "follow", signal: AbortSignal.timeout(7000) });
  if (!res.ok) return "";
  const type = res.headers.get("content-type") || "";
  if (!/text\/html|text\/plain/.test(type)) return "";
  const html = (await res.text()).slice(0, 600000);
  if (type.includes("text/plain")) return html.slice(0, 8000);
  return htmlToText(html).slice(0, 8000);
}

function htmlToText(html) {
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|aside|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n");
  return decodeEntities(body.replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function stripTags(s) {
  return decodeEntities(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/* ------------------------------------------------------------------ */
/* Voice                                                               */
/* ------------------------------------------------------------------ */

const LANG_NAMES = { en: "English", ar: "Arabic", ku: "Kurdish", hi: "Hindi", ur: "Urdu", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", tr: "Turkish", ru: "Russian", zh: "Chinese", ja: "Japanese", ko: "Korean", id: "Indonesian", bn: "Bengali", fa: "Persian" };

async function handleTranscribe(request, env) {
  const form = await request.formData();
  const audio = form.get("audio");
  const language = (form.get("language") || "").toString().trim();
  if (!audio || typeof audio === "string") return json({ error: "No audio received" }, 400);
  if (audio.size > 18 * 1024 * 1024) return json({ error: "Recording is too long" }, 413);
  if (isMock(env)) return json({ text: "Hey Legend Boy, what can you do? (demo transcription)" });

  let mimeType = (audio.type || "").split(";")[0] || "audio/wav";
  if (mimeType === "audio/x-m4a" || mimeType === "audio/m4a") mimeType = "audio/mp4";
  const langHint = LANG_NAMES[language] ? ` The speech is in ${LANG_NAMES[language]}.` : "";
  const j = await generateOnce(env, {
    parts: [
      { inlineData: { mimeType, data: toBase64(await audio.arrayBuffer()) } },
      { text: `Transcribe this voice message exactly as spoken, in the original language and script.${langHint} Output ONLY the transcript text — no quotes, labels, timestamps or explanations. If there is no clear speech, output nothing.` },
    ],
  });
  let text = responseText(j).trim().replace(/^["“]|["”]$/g, "");
  if (/^\(?(no (clear )?speech|silence|inaudible)/i.test(text)) text = "";
  return json({ text });
}

async function handleTTS(request, env) {
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim().slice(0, 1500);
  if (!text) return json({ error: "No text" }, 400);
  if (isMock(env)) return new Response(null, { status: 204 }); // client falls back to the phone's voice

  const voice = VOICES[body.speaker] ? body.speaker : VOICES[env.TTS_SPEAKER] ? env.TTS_SPEAKER : DEFAULTS.voice;
  const ttsBody = (voiceConfig) => ({
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig } },
  });
  let res;
  try {
    res = await geminiFetch(env, models(env).tts, "generateContent", ttsBody({ prebuiltVoiceConfig: { voiceName: voice } }));
  } catch (e) {
    if (e.status !== 400) throw e;
    res = await geminiFetch(env, models(env).tts, "generateContent", ttsBody({ voice })); // newer TTS models
  }
  const j = await res.json();
  const part = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data);
  if (!part) return json({ error: "TTS returned no audio" }, 502);
  const mime = part.inlineData.mimeType || "";
  let bytes = fromBase64(part.inlineData.data);
  let type = mime.split(";")[0] || "audio/wav";
  if (/L16|pcm/i.test(mime) || (!/wav|mpeg|mp3|ogg|opus|aac|mp4/i.test(mime))) {
    const rate = Number((mime.match(/rate=(\d+)/) || [])[1]) || 24000;
    bytes = pcmToWav(bytes, rate);
    type = "audio/wav";
  }
  return new Response(bytes, { headers: { "content-type": type, "cache-control": "no-store" } });
}

function pcmToWav(pcm, rate, channels = 1) {
  const buf = new ArrayBuffer(44 + pcm.length);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

async function handleExtract(request, env) {
  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file === "string") return json({ error: "No file received" }, 400);
  if (file.size > 18 * 1024 * 1024) return json({ error: "File is too large (max 18 MB)" }, 413);

  const name = file.name || "document";
  const ext = name.split(".").pop().toLowerCase();
  const buf = await file.arrayBuffer();
  let text = "";

  if (["docx", "xlsx", "pptx", "odt", "ods", "odp"].includes(ext)) {
    text = await extractOffice(buf, ext);
  } else if (["html", "htm"].includes(ext)) {
    text = htmlToText(new TextDecoder().decode(buf));
  } else if (["csv", "xml", "txt", "md", "json", "tsv"].includes(ext)) {
    text = new TextDecoder().decode(buf);
  } else if (ext === "pdf" || file.type === "application/pdf") {
    if (isMock(env)) return json({ name, text: `(Demo mode) Pretend content of ${name}. Deploy with your Gemini key to read real PDFs.` });
    const j = await generateOnce(env, {
      parts: [
        { inlineData: { mimeType: "application/pdf", data: toBase64(buf) } },
        { text: "Extract ALL the text of this document as clean Markdown, keeping headings, lists and tables. Describe charts or images briefly in [brackets]. Output only the document content." },
      ],
    });
    text = responseText(j);
  } else if (["doc", "xls", "ppt"].includes(ext)) {
    return json({ error: `Old .${ext} files aren't supported — please save it as .${ext}x (or PDF) and try again.` }, 422);
  } else {
    // Unknown type: try as UTF-8 text
    text = new TextDecoder().decode(buf);
    if (/\uFFFD/.test(text.slice(0, 2000))) return json({ error: "Can't read this file type." }, 422);
  }

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return json({ error: "No readable text found in this file." }, 422);
  return json({ name, text: text.slice(0, 300000) });
}

/* Minimal ZIP reader (for .docx .xlsx .pptx .odt .ods .odp) */
async function unzip(buf, wanted) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("This file looks damaged (not a valid Office file).");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= u8.length; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const fname = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(fname)) continue;
    const lNameLen = dv.getUint16(local + 26, true);
    const lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = u8.subarray(start, start + csize);
    if (method === 0) files[fname] = dec.decode(data);
    else if (method === 8) {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      files[fname] = await new Response(stream).text();
    }
  }
  return files;
}

function xmlText(xml) {
  return decodeEntities(xml.replace(/<[^>]+>/g, ""));
}

async function extractOffice(buf, ext) {
  if (ext === "docx") {
    const f = await unzip(buf, (n) => n === "word/document.xml" || /^word\/(header|footer|footnotes)\d*\.xml$/.test(n));
    const doc = f["word/document.xml"] || "";
    return xmlText(
      doc.replace(/<w:tab\/>/g, "\t").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n").replace(/<\/w:tc>/g, " | ").replace(/<\/w:tr>/g, "\n")
    );
  }
  if (ext === "pptx") {
    const f = await unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    return Object.keys(f)
      .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
      .map((k, i) => `## Slide ${i + 1}\n` + xmlText(f[k].replace(/<\/a:p>/g, "\n")).trim())
      .join("\n\n");
  }
  if (ext === "xlsx") {
    const f = await unzip(buf, (n) => n === "xl/sharedStrings.xml" || n === "xl/workbook.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const shared = [...(f["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1]));
    const sheetNames = [...(f["xl/workbook.xml"] || "").matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => decodeEntities(m[1]));
    const keys = Object.keys(f).filter((k) => k.includes("worksheets")).sort((a, b) => Number(a.match(/(\d+)\.xml/)[1]) - Number(b.match(/(\d+)\.xml/)[1]));
    return keys.map((k, i) => {
      const rows = [...f[k].matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].slice(0, 2000).map((r) =>
        [...r[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
          const attrs = c[1];
          const inner = c[2] || "";
          const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
          if (/t="s"/.test(attrs)) return shared[Number(v)] ?? "";
          if (/t="inlineStr"/.test(attrs)) return xmlText(inner);
          return v != null ? decodeEntities(v) : "";
        }).join(" | ")
      );
      return `## Sheet: ${sheetNames[i] || i + 1}\n` + rows.join("\n");
    }).join("\n\n");
  }
  // OpenDocument
  const f = await unzip(buf, (n) => n === "content.xml");
  return xmlText((f["content.xml"] || "").replace(/<\/text:(p|h)>/g, "\n").replace(/<\/table:table-cell>/g, " | ").replace(/<\/table:table-row>/g, "\n"));
}

/* ------------------------------------------------------------------ */
/* Imagine                                                             */
/* ------------------------------------------------------------------ */

async function handleImagine(request, env) {
  const body = await request.json().catch(() => ({}));
  const prompt = String(body.prompt || "").trim().slice(0, 2000);
  if (!prompt) return json({ error: "Describe the image you want." }, 400);

  if (isMock(env)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="#fff" font-size="36" font-family="sans-serif" text-anchor="middle">Demo image</text></svg>`;
    return json({ image: "data:image/svg+xml;base64," + btoa(svg), prompt });
  }

  const res = await geminiFetch(env, models(env).image, "generateContent", {
    contents: [{ role: "user", parts: [{ text: `Create an image: ${prompt}` }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  });
  const j = await res.json();
  const part = (j?.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data && /^image\//.test(p.inlineData.mimeType || "image/"));
  if (!part) {
    const why = blockedReason(j) || responseText(j) || "No image returned.";
    return json({ error: "Image generation failed: " + why.slice(0, 300) }, 502);
  }
  return json({ image: `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`, prompt });
}
