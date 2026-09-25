/**
 * Legend Boy — AI assistant backend (Cloudflare Worker, works with almost any AI company)
 *
 * Cloudflare only HOSTS the app. All AI runs on the provider APIs with your own keys.
 * Keys can come from two places (both are tried in order, with automatic failover):
 *   1. Cloudflare secrets — e.g. GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, GROQ_API_KEY,
 *      DEEPSEEK_API_KEY, XAI_API_KEY, MISTRAL_API_KEY, PERPLEXITY_API_KEY, OPENROUTER_API_KEY,
 *      TOGETHER_API_KEY, CEREBRAS_API_KEY, HUGGINGFACE_API_KEY, FIREWORKS_API_KEY
 *      (Worker → Settings → Variables and Secrets). Any key pasted under a wrong-looking
 *      name is still detected by its shape.
 *   2. Keys pasted in the app (saved only on the phone) — sent in the x-ai-keys header.
 *
 * Routes
 *   GET  /api/health       status, providers, voices, feature flags
 *   POST /api/chat         streamed chat (text + photos + files)             → SSE
 *   POST /api/research     web research with citations                       → SSE
 *   POST /api/transcribe   voice → text (multipart "audio")                  → JSON
 *   POST /api/tts          text → voice (JSON {text, speaker})               → audio/*
 *   POST /api/extract      document → text (multipart "file")                → JSON
 *   POST /api/imagine      text → image (JSON {prompt})                      → JSON
 *   POST /api/verify       check one API key (JSON {key, provider?, base?})  → JSON
 *   POST /api/models       model list for the picker (JSON {provider, key?}) → JSON
 */

import {
  PROVIDERS, PROVIDER_BY_ID, GEMINI_VOICES, OPENAI_VOICES,
  cleanKey, detectProvider, shortModel, chatModelOf, selectChain, buildEntries,
  listModels, streamChat, generateOnce, transcribeAudio, ttsAudio, generateImage,
  toBase64, ProviderError,
} from "./providers.js";

const MAX_HISTORY = 30;
const MAX_FILE_CHARS = 60000;
const MAX_MSG_CHARS = 20000;

const ENV_IMAGE_MODEL = { gemini: "GEMINI_IMAGE_MODEL", openai: "OPENAI_IMAGE_MODEL", grok: "XAI_IMAGE_MODEL", together: "TOGETHER_IMAGE_MODEL" };
const ENV_TTS_MODEL = { gemini: "GEMINI_TTS_MODEL", openai: "OPENAI_TTS_MODEL" };

/* ==================================================================== */
/* Routing                                                               */
/* ==================================================================== */

export default {
  async fetch(request, rawEnv) {
    const url = new URL(request.url);
    const env = { ...rawEnv };
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });

    try {
      if (url.pathname === "/api/health") return health(env, request);
      if (!checkAccess(request, env)) return json({ error: "Access code required", code: "ACCESS_CODE" }, 401);
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

      // Build the key chain for this request (Cloudflare secrets → app keys).
      env.__legacyKey = request.headers.get("x-gemini-key") || "";
      const entries = buildEntries(env, parseKeysHeader(request));

      switch (url.pathname) {
        case "/api/chat": return await handleChat(request, env, entries);
        case "/api/research": return await handleResearch(request, env, entries);
        case "/api/transcribe": return await handleTranscribe(request, env, entries);
        case "/api/tts": return await handleTTS(request, env, entries);
        case "/api/extract": return await handleExtract(request, env, entries);
        case "/api/imagine": return await handleImagine(request, env, entries);
        case "/api/verify": return await handleVerify(request, env, entries);
        case "/api/models": return await handleModels(request, env, entries);
        default: return json({ error: "Not found" }, 404);
      }
    } catch (err) {
      console.error(err);
      return json({ error: friendlyError(err), code: errorCode(err), failures: err?.failures }, err?.status && err.status < 600 && err.status >= 400 ? err.status : 500);
    }
  },
};

function parseKeysHeader(request) {
  const raw = request.headers.get("x-ai-keys");
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    const list = Array.isArray(j) ? j : j.keys;
    return (Array.isArray(list) ? list : []).slice(0, 30).map((k) => ({
      provider: String(k?.provider || "").slice(0, 30),
      key: String(k?.key || "").slice(0, 300),
      model: String(k?.model || "").slice(0, 120),
      base: String(k?.base || "").slice(0, 300),
    }));
  } catch {
    return [];
  }
}

/* ==================================================================== */
/* Helpers                                                              */
/* ==================================================================== */

function isMock(env) {
  return env.MOCK_AI === "1" || env.MOCK_AI === "true";
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-access-code,x-ai-keys,x-gemini-key",
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

const NO_KEY_ERROR =
  "Legend Boy needs an API key from an AI company to answer. Tap Settings ⚙️ → AI keys & models and paste one (Gemini has a free tier), or add a Secret like GEMINI_API_KEY in Cloudflare.";

function noKeyResponse() {
  return json({ error: NO_KEY_ERROR, code: "NO_KEY" }, 500);
}

function needsEntries(env, entries) {
  return isMock(env) || entries.length > 0;
}

function friendlyError(err) {
  const msg = String(err?.message || err || "Unknown error");
  const s = err?.status;
  const who = err?.provider ? `${PROVIDER_BY_ID[err.provider]?.short || err.provider}: ` : "";
  if (err?.failures?.length) return err.message;
  if (s === 429 || /RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(msg)) return `${who}limit reached (out of credit or too many requests). Tried every key. (${msg.slice(0, 180)})`;
  if (s === 401 || s === 403 || /API key|invalid.*key|PERMISSION_DENIED|UNAUTHENTICATED|Unauthorized/i.test(msg)) return `${who}rejected the API key — check it in Settings ⚙️. (${msg.slice(0, 180)})`;
  if (s === 404 || /model.*not (found|available)|does not exist/i.test(msg)) return `${who}model not available: ${msg.slice(0, 220)}`;
  return who + msg;
}

function errorCode(err) {
  const msg = String(err?.message || "");
  if (err?.failures) return err.failures.some((f) => /429|limit|quota/i.test(f.error)) ? "RATE_LIMIT" : "ALL_FAILED";
  if (/API key|API_KEY_INVALID|UNAUTHENTICATED|PERMISSION_DENIED|Unauthorized/i.test(msg) || err?.status === 401 || err?.status === 403) return "BAD_KEY";
  if (err?.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) return "RATE_LIMIT";
  if (err?.code === "NO_CAP") return "NO_CAP";
  return undefined;
}

/** Aggregate error after every key in the chain failed. */
function allFailed(failures) {
  const list = failures.slice(0, 6).map((f) => `• ${f.where}: ${f.error}`).join("\n");
  const err = new Error(
    `Every saved key failed:\n${list}${failures.length > 6 ? `\n• …and ${failures.length - 6} more` : ""}`
  );
  err.failures = failures;
  return err;
}

/** Error when a feature needs a capability no key has. */
function capError(cap) {
  const messages = {
    vision: "To look at photos, add a key from a company whose AI can see: Google Gemini, OpenAI, Claude, Groq, OpenRouter, Grok, Mistral, Together or Fireworks (Settings ⚙️).",
    stt: "Voice typing works with a key from: Google Gemini, OpenAI, Groq, Mistral or Fireworks. Add one in Settings ⚙️ — or just type your message.",
    images: "Creating images works with a key from: Google Gemini, OpenAI, Grok (xAI) or Together. Add one in Settings ⚙️.",
  };
  const err = new Error(messages[cap] || "No saved key can do this.");
  err.code = "NO_CAP";
  err.status = 422;
  return err;
}

function entryLabel(entry) {
  const p = PROVIDER_BY_ID[entry.provider];
  return `${p?.short || entry.provider} · ${shortModel(chatModelOf(entry) || "default")}`;
}

/* ==================================================================== */
/* Key verification + model lists                                       */
/* ==================================================================== */

function curatedList(providerId) {
  const p = PROVIDER_BY_ID[providerId];
  return (p?.models || []).map((s) => {
    const [id, ...rest] = s.split(" — ");
    return { id: id.trim(), label: rest.join(" — ").trim() };
  });
}

async function verifyEntry(entry) {
  const models = await listModels(entry);
  return models;
}

/** POST /api/verify {key, provider?, base?} — check one key (used by "Add key" in the app). */
async function handleVerify(request, env) {
  if (isMock(env)) return json({ ok: true, mock: true, provider: "gemini", name: "Google Gemini", models: ["gemini-flash-latest"] });
  const body = await request.json().catch(() => ({}));
  const key = cleanKey(body.key) || String(body.key || "").trim();
  const base = String(body.base || "").trim().replace(/\/+$/, "");
  let providerId = PROVIDER_BY_ID[body.provider] ? body.provider : "";
  if (!providerId) providerId = detectProvider(key) || (base ? "custom" : "");
  if (!providerId) {
    return json({
      ok: false,
      error: "That key isn't recognised. Pick the company yourself in the Company list, then save again.",
      code: "UNKNOWN_KEY",
    }, 400);
  }
  if (providerId === "custom" && !/^https?:\/\//.test(base)) {
    return json({ ok: false, error: "For a custom server, paste its address too (https://…/v1).", code: "NO_BASE" }, 400);
  }
  if (providerId !== "custom" && key.length < 10) {
    return json({ ok: false, error: "That key looks too short — paste the whole key.", code: "BAD_KEY" }, 400);
  }
  const p = PROVIDER_BY_ID[providerId];
  const entry = { id: `${providerId}#verify`, provider: providerId, key, model: "", base: base || String(env[p.baseEnv] || "").trim() || p.base, server: false };
  try {
    const live = await verifyEntry(entry);
    const curated = curatedList(providerId).map((c) => c.id);
    const models = [...new Set([...curated, ...live])].slice(0, 400);
    return json({
      ok: true,
      provider: providerId,
      name: p.name,
      detected: !PROVIDER_BY_ID[body.provider],
      caps: p.caps,
      defaultModel: p.defaults.chat || models[0] || "",
      models,
    });
  } catch (e) {
    console.warn("verify failed", e);
    return json({ ok: false, provider: providerId, name: p.name, error: friendlyError(new ProviderError(e.message, e.status, providerId)), code: errorCode(e) || "BAD_KEY" }, 400);
  }
}

/** POST /api/models {provider, key?, base?} — feed the model picker. */
async function handleModels(request, env) {
  const body = await request.json().catch(() => ({}));
  const providerId = PROVIDER_BY_ID[body.provider] ? body.provider : "";
  if (!providerId) return json({ models: [], error: "Unknown provider" }, 400);
  const p = PROVIDER_BY_ID[providerId];
  const curated = curatedList(providerId);
  const key = String(body.key || "").trim();
  const base = String(body.base || "").trim().replace(/\/+$/, "");
  let live = [];
  if (key || (providerId === "custom" && base)) {
    try {
      live = await listModels({ id: `${providerId}#list`, provider: providerId, key, model: "", base: base || String(env[p.baseEnv] || "").trim() || p.base, server: false });
    } catch (e) {
      console.warn("model list failed", e.message);
    }
  }
  const seen = new Set();
  const models = [];
  for (const c of curated) { if (!seen.has(c.id)) { seen.add(c.id); models.push(c); } }
  for (const id of live) { if (!seen.has(id)) { seen.add(id); models.push({ id, label: "" }); } }
  if (isMock(env) && !models.length) models.push({ id: "demo-model", label: "Demo" });
  return json({ ok: true, models: models.slice(0, 500), live: live.length > 0 });
}

/* ==================================================================== */
/* Health                                                               */
/* ==================================================================== */

function health(env, request) {
  const mock = isMock(env);
  env.__legacyKey = request.headers.get("x-gemini-key") || "";
  const entries = buildEntries(env, parseKeysHeader(request));
  const serverEntries = entries.filter((e) => e.server);

  const ttsEntry = selectChain(entries, { tts: true })[0];
  let speakers = [];
  let voiceGenders = {};
  let defaultSpeaker = "";
  if (ttsEntry?.provider === "gemini") {
    voiceGenders = GEMINI_VOICES;
    speakers = Object.keys(GEMINI_VOICES);
    defaultSpeaker = GEMINI_VOICES[env.TTS_SPEAKER] ? env.TTS_SPEAKER : PROVIDER_BY_ID.gemini.defaults.voice;
  } else if (ttsEntry?.provider === "openai") {
    voiceGenders = OPENAI_VOICES;
    speakers = Object.keys(OPENAI_VOICES);
    defaultSpeaker = OPENAI_VOICES[env.TTS_SPEAKER] ? env.TTS_SPEAKER : PROVIDER_BY_ID.openai.defaults.voice;
  }

  return json({
    ok: true,
    name: "Legend Boy",
    version: 2,
    mock,
    keyConfigured: serverEntries.length > 0,
    appKeyAccepted: entries.some((e) => !e.server),
    accessCodeRequired: Boolean((env.ACCESS_CODE || "").trim()),
    serverEntries: serverEntries.map((e) => ({ provider: e.provider, name: PROVIDER_BY_ID[e.provider].short, model: chatModelOf(e), modelShort: shortModel(chatModelOf(e)) })),
    providers: PROVIDERS.map((p) => ({
      id: p.id, name: p.name, short: p.short, letter: p.letter, color: p.color,
      link: p.link, keyHint: p.keyHint, custom: Boolean(p.custom),
      caps: p.caps, defaultModel: p.defaults.chat || "",
      models: p.models.slice(0, 8),
    })),
    speakers,
    voiceGenders,
    defaultSpeaker,
    tts: Boolean(ttsEntry),
    searchMode: selectChain(entries, { researchSearch: true })[0]
      ? (PROVIDER_BY_ID[selectChain(entries, { researchSearch: true })[0].provider].caps.search === "grounded" ? "google" : "perplexity")
      : "free",
  });
}

/* ==================================================================== */
/* Prompts + conversation building                                      */
/* ==================================================================== */

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

/** Convert the client conversation into normalized messages (role, text, images[]). */
function normalizeMessages(clientMessages) {
  const msgs = Array.isArray(clientMessages) ? clientMessages.slice(-MAX_HISTORY) : [];

  let lastImageIdx = -1;
  msgs.forEach((m, i) => { if (m?.role === "user" && Array.isArray(m.images) && m.images.length) lastImageIdx = i; });

  const out = [];
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
    if (m.role === "user" && i === lastImageIdx && images.length) {
      out.push({ role: "user", text: text || "What do you see in this image?", images: images.slice(0, 6) });
    } else {
      if (m.role === "user" && images.length) text = `[shared ${images.length} photo(s) earlier] ` + text;
      out.push({ role: m.role, text: text.trim() ? text : m.role === "user" ? "(empty)" : "…", images: [] });
    }
  });
  return out;
}

/* ==================================================================== */
/* SSE + failover engine                                                */
/* ==================================================================== */

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
      await send({ type: "error", error: friendlyError(err), code: errorCode(err), failures: err?.failures?.slice(0, 6) });
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
  return { text };
}

/**
 * Stream a chat answer from the whole key chain with automatic failover.
 * Emits `using` events so the app can show "⚡ Claude · claude-sonnet-5".
 */
async function runChain(entries, args, send, { needs = {}, onEntry } = {}) {
  const chain = selectChain(entries, needs);
  const capName = Object.keys(needs).find((k) => needs[k]);
  if (!chain.length) throw capError(capName || "chat");
  const failures = [];
  for (const entry of chain) {
    await send({ type: "using", provider: entry.provider, name: PROVIDER_BY_ID[entry.provider]?.short || entry.provider, model: chatModelOf(entry), modelShort: shortModel(chatModelOf(entry)) });
    if (onEntry) onEntry(entry);
    let streamed = false;
    try {
      const r = await streamChat(entry, args, async (t) => {
        streamed = true;
        await send({ type: "token", text: t });
      });
      if (!r.text && !streamed) throw new ProviderError("Empty answer", 0, entry.provider);
      r.via = { provider: entry.provider, model: chatModelOf(entry) };
      r.failures = failures;
      return r;
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      console.warn(`entry failed: ${entryLabel(entry)}`, e?.message);
      failures.push({ where: entryLabel(entry), error: String(e?.message || e).slice(0, 200) });
      if (streamed) await send({ type: "reset" });
    }
  }
  throw allFailed(failures);
}

/* ==================================================================== */
/* Chat                                                                 */
/* ==================================================================== */

async function handleChat(request, env, entries) {
  const body = await request.json().catch(() => ({}));
  const voice = Boolean(body.voice);
  const messages = normalizeMessages(body.messages);
  const hasImages = messages.some((m) => m.images?.length);

  if (isMock(env)) {
    return sseStream(async (send) => {
      const last = messages[messages.length - 1];
      await send({ type: "using", provider: "demo", name: "Demo", model: "demo", modelShort: "demo" });
      await mockStream(send,
        `**Demo mode** is on (no AI key used). \n\n` +
        (hasImages ? `I received your photo 📸 — once a key is added I'll describe it for real.\n\n` : "") +
        `You said: _"${String(last?.text || "").slice(0, 160).replace(/\n/g, " ")}"_\n\nAdd any AI key in **Settings ⚙️ → AI keys & models** and I'll answer for real. 🚀`);
    });
  }
  if (!entries.length) return noKeyResponse();

  return sseStream((send) =>
    runChain(entries, {
      system: systemPrompt(body.userName) + (voice ? VOICE_ADDON : ""),
      messages,
      maxTokens: 8192,
      fast: voice,
    }, send, { needs: hasImages ? { vision: true } : {} })
  );
}

/* ==================================================================== */
/* Research                                                             */
/* ==================================================================== */

async function handleResearch(request, env, entries) {
  const body = await request.json().catch(() => ({}));
  const query = String(body.query || "").trim().slice(0, 800);
  const deep = body.depth === "deep";
  if (!query) return json({ error: "Please enter a research topic." }, 400);
  if (isMock(env)) {
    return sseStream(async (send) => {
      await send({ type: "status", step: "search", text: "Searching the web…" });
      await send({ type: "queries", queries: [query] });
      await send({ type: "sources", sources: [{ n: 1, title: "Demo source", url: "https://example.com", snippet: "" }] });
      await mockStream(send, `**TL;DR** — this is a demo report about _${query}_.\n\n## Details\nAdd an AI key to run real research with live sources. 🚀\n\n## Key takeaways\n- Demo mode is on`);
    });
  }
  if (!entries.length) return noKeyResponse();

  return sseStream(async (send) => {
    const failures = [];

    // 1) Gemini key → Google Search grounding with citations
    const grounded = entries.filter((e) => PROVIDER_BY_ID[e.provider]?.caps.search === "grounded");
    for (const entry of grounded) {
      await send({ type: "status", step: "search", text: "Searching Google…" });
      await send({ type: "using", provider: entry.provider, name: PROVIDER_BY_ID.gemini.short, model: chatModelOf(entry), modelShort: shortModel(chatModelOf(entry)) });
      let streamed = false;
      try {
        let started = false;
        const result = await streamChat(entry, {
          system: researchSystem(deep, true),
          messages: [{ role: "user", text: `Research question: ${query}`, images: [] }],
          maxTokens: 8192,
          tools: [{ google_search: {} }],
        }, async (t) => {
          streamed = true;
          if (!started) { started = true; await send({ type: "status", step: "write", text: "Writing your report…" }); }
          await send({ type: "token", text: t });
        });
        if (!result.text && !streamed) throw new ProviderError("Empty report", 0, entry.provider);
        const g = result.grounding;
        if (g?.webSearchQueries?.length) await send({ type: "queries", queries: g.webSearchQueries });
        const chunks = (g?.groundingChunks || []).filter((c) => c.web?.uri);
        const sources = chunks.map((c, i) => ({ n: i + 1, title: c.web.title || c.web.domain || "Source", url: c.web.uri, snippet: "" }));
        if (sources.length) {
          await send({ type: "sources", sources });
          const cited = addCitations(result.text, g.groundingSupports || [], chunks.length);
          if (cited !== result.text) await send({ type: "replace", text: cited });
        }
        return;
      } catch (e) {
        console.warn("grounded research failed", e?.message);
        failures.push({ where: entryLabel(entry), error: String(e?.message || e).slice(0, 200) });
        if (streamed) await send({ type: "reset" });
      }
    }

    // 2) Perplexity key → its own live web search
    const native = entries.filter((e) => PROVIDER_BY_ID[e.provider]?.caps.search === "native");
    for (const entry of native) {
      await send({ type: "status", step: "search", text: "Searching the web with Perplexity…" });
      await send({ type: "using", provider: entry.provider, name: PROVIDER_BY_ID.perplexity.short, model: chatModelOf(entry), modelShort: shortModel(chatModelOf(entry)) });
      try {
        const model = chatModelOf(entry);
        const researchModel = deep && model === "sonar" ? "sonar-pro" : model;
        const res = await fetch(`${entry.base}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${entry.key}` },
          body: JSON.stringify({
            model: researchModel,
            messages: [
              { role: "system", content: researchSystem(deep, true) },
              { role: "user", content: `Research question: ${query}` },
            ],
            stream: false,
          }),
        });
        if (!res.ok) throw new ProviderError((await res.text()).slice(0, 200), res.status, entry.provider);
        const j = await res.json().catch(() => ({}));
        const text = j?.choices?.[0]?.message?.content || "";
        if (!text) throw new ProviderError("Empty report", 0, entry.provider);
        const citations = (j.citations || j.search_results?.map((r) => r.url) || []).slice(0, 12);
        if (citations.length) {
          await send({ type: "sources", sources: citations.map((url, i) => ({ n: i + 1, title: hostOf(url), url, snippet: "" })) });
        }
        await send({ type: "token", text });
        return;
      } catch (e) {
        console.warn("perplexity research failed", e?.message);
        failures.push({ where: entryLabel(entry), error: String(e?.message || e).slice(0, 200) });
      }
    }

    // 3) Any key → free web search + report
    await send({ type: "status", step: "fallback", text: grounded.length || native.length ? "Built-in search — using backup web search…" : "Searching the web…" });
    await fallbackResearch(entries, send, query, deep);
  });
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Source"; }
}

function researchSystem(deep, grounded) {
  return (
    `You are Legend Boy, an expert research assistant. Today is ${todayString()}.\n` +
    (grounded
      ? `Research the question using live web search${deep ? " (run at least 5 searches covering different angles)" : ""} and write a ${deep ? "thorough, detailed" : "clear, concise"} report in Markdown.\n`
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

async function fallbackResearch(entries, send, query, deep) {
  await send({ type: "queries", queries: [query] });
  const results = await freeSearch(query).catch(() => []);
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
  await runChain(entries, {
    system: researchSystem(deep, false),
    messages: [{ role: "user", text: `Research question: ${query}\n\nSources:\n\n${context}`, images: [] }],
    maxTokens: 8192,
  }, send);
}

const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36 LegendBoy/2.0";

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

/* ==================================================================== */
/* Voice in (transcribe)                                                */
/* ==================================================================== */

async function handleTranscribe(request, env, entries) {
  const form = await request.formData();
  const audio = form.get("audio");
  const language = (form.get("language") || "").toString().trim();
  if (!audio || typeof audio === "string") return json({ error: "No audio received" }, 400);
  if (audio.size > 18 * 1024 * 1024) return json({ error: "Recording is too long" }, 413);
  if (isMock(env)) return json({ text: "Hey Legend Boy, what can you do? (demo transcription)" });
  if (!entries.length) return noKeyResponse();

  let mimeType = (audio.type || "").split(";")[0] || "audio/wav";
  if (mimeType === "audio/x-m4a" || mimeType === "audio/m4a") mimeType = "audio/mp4";
  const bytes = new Uint8Array(await audio.arrayBuffer());

  const chain = selectChain(entries, { stt: true });
  if (!chain.length) return json({ error: capError("stt").message, code: "NO_CAP" }, 422);

  const failures = [];
  for (const entry of chain) {
    try {
      const text = await transcribeAudio(entry, { bytes, mimeType }, language);
      return json({ text, provider: entry.provider });
    } catch (e) {
      console.warn("transcribe failed", entryLabel(entry), e?.message);
      failures.push({ where: entryLabel(entry), error: String(e?.message || e).slice(0, 200) });
    }
  }
  const err = allFailed(failures);
  return json({ error: friendlyError(err), code: errorCode(err) || "TRANSCRIBE_FAILED", failures }, 502);
}

/* ==================================================================== */
/* Voice out (TTS)                                                      */
/* ==================================================================== */

async function handleTTS(request, env, entries) {
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || "").trim().slice(0, 1500);
  if (!text) return json({ error: "No text" }, 400);
  if (isMock(env)) return new Response(null, { status: 204 }); // client falls back to the phone's voice

  const chain = selectChain(entries, { tts: true });
  if (!chain.length) return new Response(null, { status: 204 }); // phone's own voice takes over

  for (const entry0 of chain) {
    try {
      let entry = entry0;
      let voice = "";
      if (entry.provider === "gemini") {
        voice = GEMINI_VOICES[body.speaker] ? body.speaker : GEMINI_VOICES[env.TTS_SPEAKER] ? env.TTS_SPEAKER : PROVIDER_BY_ID.gemini.defaults.voice;
        entry = { ...entry, ttsModel: env[ENV_TTS_MODEL.gemini] || "" };
      } else if (entry.provider === "openai") {
        voice = OPENAI_VOICES[body.speaker] ? body.speaker : OPENAI_VOICES[env.TTS_SPEAKER] ? env.TTS_SPEAKER : PROVIDER_BY_ID.openai.defaults.voice;
        entry = { ...entry, ttsModel: env[ENV_TTS_MODEL.openai] || "" };
      }
      const r = await ttsAudio(entry, text, voice);
      if (r?.bytes?.length) {
        return new Response(r.bytes, { headers: { "content-type": r.type, "cache-control": "no-store" } });
      }
    } catch (e) {
      console.warn("tts failed", entryLabel(entry), e?.message);
    }
  }
  return new Response(null, { status: 204 });
}

/* ==================================================================== */
/* Files                                                                */
/* ==================================================================== */

async function handleExtract(request, env, entries) {
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
    if (isMock(env)) return json({ name, text: `(Demo mode) Pretend content of ${name}. Deploy with a key to read real PDFs.` });
    // Best: a Gemini key can read the whole PDF (even scanned pages).
    const geminiEntries = entries.filter((e) => e.provider === "gemini");
    for (const entry of geminiEntries) {
      try {
        text = await generateOnce(entry, {
          messages: [{
            role: "user",
            text: "Extract ALL the text of this document as clean Markdown, keeping headings, lists and tables. Describe charts or images briefly in [brackets]. Output only the document content.",
            images: [{ mimeType: "application/pdf", data: toBase64(buf) }],
          }],
          maxTokens: 8192,
          fast: true,
        });
        if (text.trim()) break;
      } catch (e) {
        console.warn("pdf via gemini failed", e?.message);
      }
    }
    // No Gemini key (or it failed): use the built-in reader for text-based PDFs.
    if (!text.trim()) {
      text = await extractPdfText(buf).catch(() => "");
      if (text.trim() && geminiEntries.length === 0) {
        text += "\n\n---\n*(Read by the built-in PDF reader — add a Google Gemini key for scanned PDFs and perfect layout.)*";
      }
    }
    if (!text.trim()) {
      return json({
        error: geminiEntries.length
          ? "Couldn't read this PDF with Gemini or the built-in reader."
          : "This PDF has no readable text (probably scanned). Add a Google Gemini key in Settings ⚙️ to read it.",
        code: "NO_CAP",
      }, 422);
    }
  } else if (["doc", "xls", "ppt"].includes(ext)) {
    return json({ error: `Old .${ext} files aren't supported — please save it as .${ext}x (or PDF) and try again.` }, 422);
  } else {
    text = new TextDecoder().decode(buf);
    if (/\uFFFD/.test(text.slice(0, 2000))) return json({ error: "Can't read this file type." }, 422);
  }

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return json({ error: "No readable text found in this file." }, 422);
  return json({ name, text: text.slice(0, 300000) });
}

/* ---- Built-in PDF reader (no AI needed): inflate streams, pull text operators ---- */

function findBytes(u8, needle, from) {
  outer: for (let i = from; i + needle.length <= u8.length; i++) {
    for (let j = 0; j < needle.length; j++) if (u8[i + j] !== needle.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

async function tryInflate(data) {
  const dec = new TextDecoder("latin1");
  // PDFs use zlib ("deflate"), but be tolerant: some writers produce raw deflate or gzip.
  for (const fmt of ["deflate", "deflate-raw", "gzip"]) {
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream(fmt));
      return dec.decode(await new Response(stream).arrayBuffer());
    } catch {}
  }
  return null;
}

/** Extract readable text from a simple (text-based) PDF. */
async function extractPdfText(buf) {
  const u8 = new Uint8Array(buf);
  const chunks = [];
  let pos = 0;
  for (let guard = 0; guard < 4000; guard++) {
    const s = findBytes(u8, "stream", pos);
    if (s < 0) break;
    let start = s + 6;
    // The stream data starts after EOL — tolerate extra whitespace before it.
    while (start < u8.length && (u8[start] === 13 || u8[start] === 10 || u8[start] === 32)) start++;
    const e = findBytes(u8, "endstream", start);
    if (e < 0) break;
    pos = e + 9;
    let end = e;
    while (end > start && (u8[end - 1] === 13 || u8[end - 1] === 10 || u8[end - 1] === 32)) end--;
    const data = u8.subarray(start, end);
    let text = null;
    if (data.length >= 4 && (data[0] === 0x78 || data[0] === 0x1f || (data[0] & 0x0f) === 0x08)) text = await tryInflate(data);
    if (!text && data.length >= 4) {
      // Some extractors hit stray bytes before the real header — retry from the first plausible start.
      for (let k = 1; k < Math.min(16, data.length - 4) && !text; k++) {
        if (data[k] === 0x78 || data[k] === 0x1f) text = await tryInflate(data.subarray(k));
      }
    }
    if (!text && /BT|Tj|TJ/.test(new TextDecoder("latin1").decode(data.subarray(0, 200)))) {
      text = new TextDecoder("latin1").decode(data);
    }
    if (text && /\bBT\b|Tj|TJ/.test(text)) chunks.push(text);
  }
  const all = chunks.join("\n");
  if (!all) return "";
  return pdfContentToText(all);
}

/** Pull strings out of PDF content streams (Tj / TJ operators). */
function pdfContentToText(content) {
  const out = [];
  let i = 0;
  const n = content.length;
  let line = [];
  const flushLine = () => { if (line.length) { out.push(line.join("")); line = []; } };

  const readLiteralString = () => {
    // content[i] === "("
    let depth = 1;
    let s = "";
    i++;
    while (i < n && depth > 0) {
      const c = content[i];
      if (c === "\\") {
        const nc = content[i + 1];
        if (nc === "n") s += "\n";
        else if (nc === "r" || nc === "t") s += " ";
        else if (nc === "(" ) s += "(";
        else if (nc === ")") s += ")";
        else if (nc === "\\") s += "\\";
        else if (/[0-7]/.test(nc || "")) {
          const oct = content.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)[0];
          s += String.fromCharCode(parseInt(oct, 8));
          i += oct.length - 1;
        } else s += nc || "";
        i += 2;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) { i++; break; }
      }
      if (depth > 0) s += c;
      i++;
    }
    return s;
  };

  const decodeText = (s) => {
    if (!s) return "";
    if (s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff) {
      let r = "";
      for (let k = 2; k + 1 < s.length; k += 2) r += String.fromCharCode((s.charCodeAt(k) << 8) | s.charCodeAt(k + 1));
      return r;
    }
    return s;
  };

  const maybeHexString = () => {
    // content[i] === "<" but not "<<"
    let j = i + 1;
    let hex = "";
    while (j < n && content[j] !== ">") { if (/[0-9a-fA-F]/.test(content[j])) hex += content[j]; j++; }
    if (content[j] !== ">" || !hex) return null;
    i = j + 1;
    let s = "";
    for (let k = 0; k + 1 < hex.length; k += 2) s += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
    return s;
  };

  let lastTok = "";
  while (i < n) {
    const c = content[i];
    if (c === "(") {
      lastTok = decodeText(readLiteralString());
      continue;
    }
    if (c === "<" && content[i + 1] !== "<") {
      const h = maybeHexString();
      if (h !== null) { lastTok = decodeText(h); continue; }
    }
    // word/operator token
    if (/[A-Za-z*"']/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z*"']/.test(content[j])) j++;
      const op = content.slice(i, j);
      i = j;
      if (op === "Tj" || op === "'" || op === '"') { line.push(lastTok); }
      else if (op === "TJ") { line.push(lastTok); }
      else if (op === "Td" || op === "TD" || op === "T*") flushLine();
      continue;
    }
    // inside TJ arrays: numbers < -200 mean a space
    if (c === "-" ) {
      let j = i;
      while (j < n && /[-0-9.]/.test(content[j])) j++;
      const num = Number(content.slice(i, j));
      if (num <= -120 && !line.join("").endsWith(" ")) line.push(" ");
      i = j || i + 1;
      continue;
    }
    i++;
  }
  flushLine();
  return out
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

/* ==================================================================== */
/* Imagine                                                              */
/* ==================================================================== */

async function handleImagine(request, env, entries) {
  const body = await request.json().catch(() => ({}));
  const prompt = String(body.prompt || "").trim().slice(0, 2000);
  if (!prompt) return json({ error: "Describe the image you want." }, 400);

  if (isMock(env)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="768"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="#fff" font-size="36" font-family="sans-serif" text-anchor="middle">Demo image</text></svg>`;
    return json({ image: "data:image/svg+xml;base64," + btoa(svg), prompt });
  }
  if (!entries.length) return noKeyResponse();

  const chain = selectChain(entries, { images: true });
  if (!chain.length) return json({ error: capError("images").message, code: "NO_CAP" }, 422);

  const failures = [];
  for (const entry of chain) {
    try {
      const envVar = ENV_IMAGE_MODEL[entry.provider];
      const e2 = envVar && env[envVar] ? { ...entry, imageModel: env[envVar] } : entry;
      const image = await generateImage(e2, prompt);
      if (image) return json({ image, prompt, provider: entry.provider });
    } catch (e) {
      console.warn("imagine failed", entryLabel(entry), e?.message);
      failures.push({ where: entryLabel(entry), error: String(e?.message || e).slice(0, 200) });
    }
  }
  const err = allFailed(failures);
  return json({ error: friendlyError(err), failures }, 502);
}
