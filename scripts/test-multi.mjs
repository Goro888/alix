#!/usr/bin/env node
/**
 * Backend test suite for Legend Boy's multi-provider engine.
 * Starts fake versions of the Gemini / OpenAI / Anthropic APIs on localhost,
 * then calls the real Worker (src/worker.js) and checks real responses:
 *   key detection · verify · chat (3 styles) · failover · vision gating ·
 *   research (grounded + free fallback) · transcribe · tts · imagine ·
 *   PDF built-in reader · health · models endpoint
 *
 * Run:  node scripts/test-multi.mjs
 */
import http from "node:http";
import { deflateSync, gzipSync } from "node:zlib";
import { detectProvider, buildEntries, shortModel } from "../src/providers.js";
import worker from "../src/worker.js";

/* ------------------------------------------------------------- */
/* Tiny helpers                                                   */
/* ------------------------------------------------------------- */
let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}
function section(t) { console.log(`\n${t}`); }

const KEYS = {
  gemini: "AIzaSyTestGeminiKey1234567890abcd",
  gemini2: "AQ.Ab8TestGeminiKey1234567890xyz",
  openai: "sk-testopenaikey1234567890abcdef",
  openaiBad: "sk-badopenaikey1234567890abcdef",
  claude: "sk-ant-testclaudekey1234567890",
  groq: "gsk_testgroqkey1234567890abcd",
  cerebras: "csk-testcerebraskey1234567890",
  pplx: "pplx-testpplxkey1234567890abcd",
  hf: "hf_testhfkey1234567890abcdef",
  fireworks: "fw_testfwkey1234567890abcdefg",
  xai: "xai-testxaikey1234567890abcd",
  openrouter: "sk-or-testorkey1234567890abcde",
};

const PORTS = { gemini: 0, openai: 0, anthropic: 0 };

function sseLines(chunks) {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
}
const enc = new TextEncoder();
const PCM = new Uint8Array(4800); // tiny fake PCM (silence)

/* ------------------------------------------------------------- */
/* Fake Gemini (generativelanguage style)                          */
/* ------------------------------------------------------------- */
const geminiServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const key = req.headers["x-goog-api-key"];
  const bad = key !== KEYS.gemini && key !== KEYS.gemini2;
  const body = await readBody(req);

  if (url.pathname === "/v1beta/models") {
    if (bad) return send(res, 403, { error: { message: "API key not valid" } });
    return send(res, 200, {
      models: [
        { name: "models/gemini-flash-latest", supportedGenerationMethods: ["generateContent"] },
        { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] },
        { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
      ],
    });
  }
  const m = url.pathname.match(/^\/v1beta\/models\/([^:]+):(generateContent|streamGenerateContent)$/);
  if (m) {
    if (bad) return send(res, 403, { error: { message: "API key not valid. Please pass a valid API key." } });
    const j = JSON.parse(body || "{}");
    const parts = j.contents?.flatMap((c) => c.parts || []) || [];
    const inline = parts.find((p) => p.inlineData);
    const mods = j.generationConfig?.responseModalities || [];

    if (m[2] === "streamGenerateContent") {
      const grounded = Array.isArray(j.tools) && j.tools.some((t) => t.google_search);
      const chunks = [
        { candidates: [{ content: { parts: [{ text: "Grounded report " }] } }] },
        {
          candidates: [{
            content: { parts: [{ text: "about **widgets** with facts." }] },
            ...(grounded ? {
              groundingMetadata: {
                webSearchQueries: ["widgets 2026"],
                groundingChunks: [{ web: { uri: "https://example.com/widgets", title: "Widget News" } }],
                groundingSupports: [{ segment: { text: "about **widgets** with facts.", endIndex: 28 }, groundingChunkIndices: [0] }],
              },
            } : {}),
          }],
        },
      ];
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sseLines(chunks).replace("data: [DONE]\n\n", ""));
      return;
    }

    // generateContent (non-stream)
    if (mods.includes("AUDIO")) {
      return send(res, 200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/L16;rate=24000", data: Buffer.from(PCM).toString("base64") } }] } }] });
    }
    if (mods.includes("IMAGE")) {
      return send(res, 200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: Buffer.from("PNGPIXELS").toString("base64") } }] } }] });
    }
    if (inline?.inlineData?.mimeType === "application/pdf") {
      return send(res, 200, { candidates: [{ content: { parts: [{ text: "# PDF via Gemini\nFull document text." }] } }] });
    }
    if (inline?.inlineData?.mimeType?.startsWith("audio/")) {
      return send(res, 200, { candidates: [{ content: { parts: [{ text: "hello world from voice" }] } }] });
    }
    return send(res, 200, { candidates: [{ content: { parts: [{ text: "Hello from Gemini" }] } }] });
  }
  send(res, 404, { error: { message: "not found: " + url.pathname } });
});

/* ------------------------------------------------------------- */
/* Fake OpenAI-style API (also covers Groq etc. shape)             */
/* ------------------------------------------------------------- */
let lastOpenAIChatBody = null;
const openaiServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const key = (req.headers.authorization || "").replace(/^Bearer /, "");
  const body = await readBody(req);

  if (url.pathname === "/v1/models") {
    if (key !== KEYS.openai) return send(res, 401, { error: { message: "Incorrect API key provided" } });
    return send(res, 200, { data: [{ id: "mock-gpt" }, { id: "mock-gpt-mini" }, { id: "gpt-5.6" }] });
  }
  if (url.pathname === "/v1/chat/completions") {
    if (key !== KEYS.openai) return send(res, 401, { error: { message: "Incorrect API key provided" } });
    const j = JSON.parse(body || "{}");
    lastOpenAIChatBody = j;
    if (j.model === "echo-fail") return send(res, 429, { error: { message: "Rate limit reached" } });
    const hasImage = j.messages?.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image_url"));
    const hasSystem = j.messages?.[0]?.role === "system";
    const text = hasImage ? "I see an image" : hasSystem ? "Hello from OpenAI" : "no-system";
    if (j.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sseLines([
        { choices: [{ delta: { role: "assistant" } }] },
        { choices: [{ delta: { content: text + " " } }] },
        { choices: [{ delta: { content: "streamed." } }] },
      ]));
      return;
    }
    return send(res, 200, { choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }], citations: undefined });
  }
  if (url.pathname === "/v1/audio/speech") {
    if (key !== KEYS.openai) return send(res, 401, { error: { message: "bad key" } });
    res.writeHead(200, { "content-type": "audio/mpeg" });
    res.end(Buffer.from("ID3FAKEMP3"));
    return;
  }
  if (url.pathname === "/v1/audio/transcriptions") {
    if (key !== KEYS.openai) return send(res, 401, { error: { message: "bad key" } });
    if (!(req.headers["content-type"] || "").includes("multipart/form-data")) return send(res, 400, { error: { message: "multipart required" } });
    return send(res, 200, { text: "transcribed by whisper" });
  }
  if (url.pathname === "/v1/images/generations") {
    if (key !== KEYS.openai) return send(res, 401, { error: { message: "bad key" } });
    const j = JSON.parse(body || "{}");
    if (!/^gpt-image|^dall-e/.test(j.model || "")) return send(res, 404, { error: { message: "model not found" } });
    return send(res, 200, { data: [{ b64_json: Buffer.from("OPENAIIMG").toString("base64") }] });
  }
  send(res, 404, { error: { message: "not found: " + url.pathname } });
});

/* ------------------------------------------------------------- */
/* Fake Anthropic API                                              */
/* ------------------------------------------------------------- */
let lastAnthropicBody = null;
const anthropicServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const key = req.headers["x-api-key"];
  const body = await readBody(req);
  if ((req.headers["anthropic-version"] || "") !== "2023-06-01") return send(res, 400, { error: { type: "invalid_request_error", message: "anthropic-version header required" } });

  if (url.pathname === "/v1/models") {
    if (key !== KEYS.claude) return send(res, 401, { error: { type: "authentication_error", message: "invalid x-api-key" } });
    return send(res, 200, { data: [{ id: "claude-sonnet-5" }, { id: "claude-haiku-4-5" }] });
  }
  if (url.pathname === "/v1/messages") {
    if (key !== KEYS.claude) return send(res, 401, { error: { type: "authentication_error", message: "invalid x-api-key" } });
    const j = JSON.parse(body || "{}");
    lastAnthropicBody = j;
    if (j.stream) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(sseLines([
        { type: "message_start", message: { id: "msg_1" } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello from Claude" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "!" } },
        { type: "message_stop" },
      ]).replace("data: [DONE]\n\n", ""));
      return;
    }
    return send(res, 200, { content: [{ type: "text", text: "Hello once from Claude" }], stop_reason: "end_turn" });
  }
  send(res, 404, { error: { message: "not found" } });
});

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(chunks.length ? Buffer.concat(chunks).toString("latin1") : ""));
  });
}
function send(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}
function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

/* ------------------------------------------------------------- */
/* Worker call helpers                                             */
/* ------------------------------------------------------------- */
function makeEnv(extra = {}) {
  return {
    ASSETS: { fetch: () => new Response("asset") },
    GEMINI_BASE_URL: `http://127.0.0.1:${PORTS.gemini}/v1beta`,
    OPENAI_BASE_URL: `http://127.0.0.1:${PORTS.openai}/v1`,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORTS.anthropic}`,
    GROQ_BASE_URL: `http://127.0.0.1:${PORTS.openai}/v1`,
    ...extra,
  };
}
async function callApi(path, { env = {}, headers = {}, body, formData, method = "POST" } = {}) {
  const h = { ...headers };
  let payload;
  if (formData) payload = formData;
  else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
  const req = new Request(`http://test${path}`, { method, headers: h, body: payload });
  return worker.fetch(req, makeEnv(env));
}
async function readSSE(res) {
  const text = await res.text();
  const events = [];
  for (const block of text.split("\n\n")) {
    for (const line of block.split("\n")) {
      if (line.startsWith("data:")) { try { events.push(JSON.parse(line.slice(5).trim())); } catch {} }
    }
  }
  return events;
}
const tokenText = (events) => events.filter((e) => e.type === "token").map((e) => e.text).join("");
const keysHeader = (keys) => JSON.stringify({ keys: keys.map((k) => ({ provider: k.p, key: k.k, model: k.m || "", base: k.b || "" })) });

/* ------------------------------------------------------------- */
/* Main                                                           */
/* ------------------------------------------------------------- */
PORTS.gemini = await listen(geminiServer);
PORTS.openai = await listen(openaiServer);
PORTS.anthropic = await listen(anthropicServer);
console.log(`Fake APIs running: gemini=${PORTS.gemini} openai=${PORTS.openai} anthropic=${PORTS.anthropic}`);

/* ---- Web interception for the free-research fallback (DDG / Wikipedia / pages) ---- */
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.url);
  if (u.hostname.includes("duckduckgo.com")) {
    const html = `<html><body>
      <a class="result__a" href="https://example.com/article">Widget Trends 2026</a>
      <div class="result__snippet">Widgets are trending up this year.</div>
      <a class="result__a" href="https://example.org/guide">Widget Guide</a>
      <div class="result__snippet">A guide to widgets.</div>
      </body></html>`;
    return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
  }
  if (u.hostname.includes("wikipedia.org")) {
    return new Response(JSON.stringify({
      query: { pages: { 1: { index: 1, title: "Widget", fullurl: "https://en.wikipedia.org/wiki/Widget", extract: "A widget is a placeholder gadget." } } },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (u.hostname === "example.com" || u.hostname === "example.org") {
    return new Response("<html><body><p>Long form article about widgets and their uses in industry.</p></body></html>", { status: 200, headers: { "content-type": "text/html" } });
  }
  return realFetch(input, init);
};

try {
  section("1 · Key detection");
  ok(detectProvider(KEYS.gemini) === "gemini", "detects Google key (AIza…)");
  ok(detectProvider(KEYS.gemini2) === "gemini", "detects Google key (AQ.…)");
  ok(detectProvider(KEYS.claude) === "claude", "detects Claude key");
  ok(detectProvider(KEYS.groq) === "groq", "detects Groq key");
  ok(detectProvider(KEYS.openrouter) === "openrouter", "detects OpenRouter key");
  ok(detectProvider(KEYS.xai) === "grok", "detects Grok key");
  ok(detectProvider(KEYS.hf) === "huggingface", "detects Hugging Face key");
  ok(detectProvider(KEYS.pplx) === "perplexity", "detects Perplexity key");
  ok(detectProvider(KEYS.cerebras) === "cerebras", "detects Cerebras key");
  ok(detectProvider(KEYS.fireworks) === "fireworks", "detects Fireworks key");
  ok(detectProvider(KEYS.openai) === "openai", "detects OpenAI key");
  ok(detectProvider("random-text-123") === null, "unknown key → null");

  section("2 · Chain building");
  {
    const env = makeEnv({ GEMINI_API_KEY: KEYS.gemini, SOME_RANDOM_BOX: KEYS.groq });
    const entries = buildEntries(env, [
      { provider: "openai", key: KEYS.openai },
      { provider: "gemini", key: KEYS.gemini }, // dup of server key → skipped
      { provider: "claude", key: KEYS.claude },
    ]);
    ok(entries[0]?.provider === "gemini" && entries[0].server, "server key goes first");
    ok(entries[1]?.provider === "groq" && entries[1].server, "key pasted in a wrong-named env var is found by shape");
    ok(entries.filter((e) => e.key === KEYS.gemini).length === 1, "duplicate keys removed");
    ok(entries.slice(-2).map((e) => e.provider).join() === "openai,claude", "app keys keep user order");
    ok(shortModel("accounts/fireworks/models/llama4-maverick") === "llama4-maverick", "shortModel strips paths");
  }

  section("3 · Verify endpoint");
  {
    const r = await callApi("/api/verify", { body: { key: KEYS.gemini } });
    const j = await r.json();
    ok(j.ok && j.provider === "gemini", "good Gemini key verifies", JSON.stringify(j));
    ok(j.models.includes("gemini-2.5-flash"), "verify returns live model list");
    const r2 = await callApi("/api/verify", { body: { key: "sk-bad-nope-nothing", provider: "openai" } });
    const j2 = await r2.json();
    ok(!j2.ok && j2.code === "BAD_KEY", "bad OpenAI key rejected", JSON.stringify(j2));
    const r3 = await callApi("/api/verify", { body: { key: "x" } });
    ok((await r3.json()).code === "UNKNOWN_KEY", "tiny key → UNKNOWN_KEY hint");
  }

  section("4 · Chat across providers");
  {
    const res = await callApi("/api/chat", { headers: { "x-ai-keys": keysHeader([{ p: "openai", k: KEYS.openai }]) }, body: { messages: [{ role: "user", content: "hi" }] } });
    const ev = await readSSE(res);
    ok(tokenText(ev).includes("Hello from OpenAI"), "OpenAI-style chat streams tokens");
    ok(ev.some((e) => e.type === "using" && e.provider === "openai"), "client told which provider answered");
    ok(lastOpenAIChatBody.messages[0].role === "system", "system prompt sent to OpenAI-style API");

    const res2 = await callApi("/api/chat", { headers: { "x-ai-keys": keysHeader([{ p: "claude", k: KEYS.claude }]) }, body: { messages: [{ role: "user", content: "hi" }] } });
    const ev2 = await readSSE(res2);
    ok(tokenText(ev2).includes("Hello from Claude!"), "Anthropic-style chat streams text deltas");
    ok(typeof lastAnthropicBody.system === "string" && lastAnthropicBody.system.includes("Legend Boy"), "Claude got the system prompt as top-level field");

    const res3 = await callApi("/api/chat", { env: { GEMINI_API_KEY: KEYS.gemini }, body: { messages: [{ role: "user", content: "hi" }] } });
    // gemini non-stream path isn't used for chat; chat always streams — the fake stream returns "Grounded report…"
    const ev3 = await readSSE(res3);
    ok(tokenText(ev3).length > 0, "Gemini env (Cloudflare) key can chat without app keys");
  }

  section("5 · Failover");
  {
    const res = await callApi("/api/chat", {
      headers: { "x-ai-keys": keysHeader([{ p: "openai", k: KEYS.openaiBad }, { p: "gemini", k: KEYS.gemini }, { p: "claude", k: KEYS.claude }]) },
      body: { messages: [{ role: "user", content: "hi" }] },
    });
    const ev = await readSSE(res);
    ok(ev.filter((e) => e.type === "using").length >= 2, "failover tried more than one key");
    ok(!ev.some((e) => e.type === "error"), "no error surfaced when a later key works");
    ok(tokenText(ev).length > 0, "answer streamed from the fallback key");

    const res2 = await callApi("/api/chat", { headers: { "x-ai-keys": keysHeader([{ p: "openai", k: KEYS.openaiBad }]) }, body: { messages: [{ role: "user", content: "hi" }] } });
    const ev2 = await readSSE(res2);
    const errEv = ev2.find((e) => e.type === "error");
    ok(Boolean(errEv) && /Every saved key failed/.test(errEv.error), "all keys failing → aggregated error", errEv?.error);
  }

  section("6 · Vision gating");
  {
    const img = { images: ["data:image/png;base64," + Buffer.from("IMG").toString("base64")] };
    const res = await callApi("/api/chat", {
      headers: { "x-ai-keys": keysHeader([{ p: "openai", k: KEYS.openai }]) },
      body: { messages: [{ role: "user", content: "what is this?", ...img }] },
    });
    const ev = await readSSE(res);
    ok(tokenText(ev).includes("I see an image"), "image reached an OpenAI-style vision model");
    ok(JSON.stringify(lastOpenAIChatBody).includes("image_url"), "image sent as image_url part");

    const res2 = await callApi("/api/chat", {
      headers: { "x-ai-keys": keysHeader([{ p: "cerebras", k: KEYS.cerebras }]) },
      body: { messages: [{ role: "user", content: "what is this?", ...img }] },
    });
    const ev2 = await readSSE(res2);
    const errEv = ev2.find((e) => e.type === "error");
    ok(Boolean(errEv) && /can see/.test(errEv.error), "text-only key + photo → clear NO_CAP message", errEv?.error?.slice(0, 80));
  }

  section("7 · Research");
  {
    const res = await callApi("/api/research", { env: { GEMINI_API_KEY: KEYS.gemini }, body: { query: "widgets news" } });
    const ev = await readSSE(res);
    ok(tokenText(ev).includes("Grounded report"), "grounded research streams the report");
    ok(ev.some((e) => e.type === "sources" && e.sources[0]?.url === "https://example.com/widgets"), "Google grounding sources forwarded");
    ok(ev.some((e) => e.type === "queries"), "search queries forwarded");
    ok(ev.some((e) => e.type === "replace" && e.text.includes("[1]")), "citation markers added");

    const res2 = await callApi("/api/research", { headers: { "x-ai-keys": keysHeader([{ p: "openai", k: KEYS.openai }]) }, body: { query: "widgets news" } });
    const ev2 = await readSSE(res2);
    ok(ev2.some((e) => e.type === "sources" && e.sources.length > 0), "free-search fallback finds sources without a Gemini key");
    ok(tokenText(ev2).length > 0, "fallback report streams via the OpenAI key");
  }

  section("8 · Voice in");
  {
    const fd = new FormData();
    fd.append("audio", new Blob([new Uint8Array(2000)], { type: "audio/wav" }), "speech.wav");
    const r = await callApi("/api/transcribe", { env: { GEMINI_API_KEY: KEYS.gemini }, formData: fd });
    const j = await r.json();
    ok(j.text === "hello world from voice", "Gemini inline-audio transcription works", JSON.stringify(j));

    const fd2 = new FormData();
    fd2.append("audio", new Blob([new Uint8Array(2000)], { type: "audio/wav" }), "speech.wav");
    const r2 = await callApi("/api/transcribe", { headers: { "x-ai-keys": keysHeader([{ p: "openai", k: KEYS.openai }]) }, formData: fd2 });
    const j2 = await r2.json();
    ok(j2.text === "transcribed by whisper", "Whisper-style transcription works", JSON.stringify(j2));

    const fd3 = new FormData();
    fd3.append("audio", new Blob([new Uint8Array(2000)], { type: "audio/wav" }), "speech.wav");
    const r3 = await callApi("/api/transcribe", { headers: { "x-ai-keys": keysHeader([{ p: "claude", k: KEYS.claude }]) }, formData: fd3 });
    const j3 = await r3.json();
    ok(r3.status === 422 && j3.code === "NO_CAP", "no-STT key → clear message", `${r3.status} ${j3.code}`);
  }

  section("9 · Voice out");
  {
    const r = await callApi("/api/tts", { env: { GEMINI_API_KEY: KEYS.gemini }, body: { text: "Hello there", speaker: "Puck" } });
    const buf = new Uint8Array(await r.arrayBuffer());
    ok(r.headers.get("content-type") === "audio/wav" && buf[0] === 0x52 && buf[1] === 0x49, "Gemini PCM converted to a WAV file");

    const r2 = await callApi("/api/tts", { headers: { "x-ai-keys": keysHeader([{ p: "openai", k: KEYS.openai }]) }, body: { text: "Hello", speaker: "alloy" } });
    const buf2 = new Uint8Array(await r2.arrayBuffer());
    ok(r2.headers.get("content-type") === "audio/mpeg" && buf2.length > 5, "OpenAI TTS passes MP3 audio back");

    const r3 = await callApi("/api/tts", { headers: { "x-ai-keys": keysHeader([{ p: "claude", k: KEYS.claude }]) }, body: { text: "Hello" } });
    ok(r3.status === 204, "no-TTS key → 204 so the phone's own voice speaks");
  }

  section("10 · Create image");
  {
    const r = await callApi("/api/imagine", { env: { GEMINI_API_KEY: KEYS.gemini }, body: { prompt: "a cat" } });
    const j = await r.json();
    ok(/^data:image\/png;base64,/.test(j.image || ""), "Gemini image generation returns a data URL");

    const r2 = await callApi("/api/imagine", { headers: { "x-ai-keys": keysHeader([{ p: "openai", k: KEYS.openai }]) }, body: { prompt: "a cat" } });
    const j2 = await r2.json();
    ok(/^data:image\/png;base64,/.test(j2.image || ""), "OpenAI images API returns a data URL", JSON.stringify(j2).slice(0, 90));

    const r3 = await callApi("/api/imagine", { headers: { "x-ai-keys": keysHeader([{ p: "claude", k: KEYS.claude }]) }, body: { prompt: "a cat" } });
    const j3 = await r3.json();
    ok(r3.status === 422 && j3.code === "NO_CAP" && /Gemini, OpenAI/.test(j3.error), "no-image key → names which companies can draw");
  }

  section("11 · Files & the built-in PDF reader");
  {
    const fd = new FormData();
    fd.append("file", new Blob(["just some plain text"], { type: "text/plain" }), "notes.txt");
    const r = await callApi("/api/extract", { formData: fd });
    ok((await r.json()).text === "just some plain text", "plain text file read without any key");

    // Craft a minimal PDF with one Flate-compressed content stream (zlib, like real PDFs)
    const content = "BT /F1 12 Tf 72 720 Td (Hello PDF world) Tj T* (Second line works) Tj ET";
    const compressed = deflateSync(Buffer.from(content, "latin1"));
    const pdf =
      "%PDF-1.4\n1 0 obj<<>>endobj\n2 0 obj<< /Length " + compressed.length + " >>\nstream\n" +
      compressed.toString("latin1") + "\nendstream\nendobj\ntrailer<<>>\n%%EOF";
    const fd2 = new FormData();
    fd2.append("file", new Blob([Buffer.from(pdf, "latin1")], { type: "application/pdf" }), "doc.pdf");
    const r2 = await callApi("/api/extract", { formData: fd2 });
    const j2 = await r2.json();
    ok(/Hello PDF world/.test(j2.text || "") && /Second line works/.test(j2.text || ""), "built-in PDF reader extracts text (no AI key)", (j2.text || "").slice(0, 60));

    const fd3 = new FormData();
    fd3.append("file", new Blob([Buffer.from(pdf, "latin1")], { type: "application/pdf" }), "doc.pdf");
    const r3 = await callApi("/api/extract", { env: { GEMINI_API_KEY: KEYS.gemini }, formData: fd3 });
    const j3 = await r3.json();
    ok(/PDF via Gemini/.test(j3.text || ""), "with a Gemini key the PDF goes through Gemini instead");
  }

  section("12 · Health & models endpoints");
  {
    const r = await worker.fetch(new Request("http://test/api/health", { method: "GET" }), makeEnv({ GEMINI_API_KEY: KEYS.gemini, OPENAI_API_KEY: KEYS.openai }));
    const j = await r.json();
    ok(j.providers.length === 14, `health lists all 14 companies (got ${j.providers.length})`);
    ok(j.serverEntries.length === 2 && j.keyConfigured, "health shows Cloudflare-saved keys");
    ok(j.tts === true && j.speakers.includes("Puck"), "health offers Gemini voices when a Gemini key exists");

    const r2 = await worker.fetch(new Request("http://test/api/health", { method: "GET" }), makeEnv({ ANTHROPIC_API_KEY: KEYS.claude }));
    const j2 = await r2.json();
    ok(j2.tts === false && j2.speakers.length === 0, "health reports no HD voice with a Claude-only key");

    const r3 = await callApi("/api/models", { body: { provider: "openrouter" } });
    const j3 = await r3.json();
    ok(j3.models.length >= 5 && j3.models[0].id.includes("/"), "models endpoint returns curated OpenRouter list without a key");

    const r4 = await callApi("/api/models", { body: { provider: "openai", key: KEYS.openai } });
    const j4 = await r4.json();
    ok(j4.live && j4.models.some((m) => m.id === "mock-gpt"), "models endpoint merges the live list when a key is given");
  }

  section("13 · Demo mode & access code");
  {
    const res = await callApi("/api/chat", { env: { MOCK_AI: "1" }, body: { messages: [{ role: "user", content: "hi" }] } });
    const ev = await readSSE(res);
    ok(tokenText(ev).includes("Demo mode"), "demo mode streams without any key");

    const r2 = await callApi("/api/chat", { env: { ACCESS_CODE: "s3cret" }, body: { messages: [] } });
    ok(r2.status === 401, "access code enforced");
    const r3 = await callApi("/api/chat", { env: { ACCESS_CODE: "s3cret" }, headers: { "x-access-code": "s3cret" }, body: { messages: [{ role: "user", content: "hi" }] } });
    ok(r3.status !== 401, "correct access code passes");
  }

  section("14 · No keys at all");
  {
    const r = await callApi("/api/chat", { body: { messages: [{ role: "user", content: "hi" }] } });
    const j = await r.json();
    ok(r.status === 500 && j.code === "NO_KEY" && /any AI company|AI keys & models/.test(j.error), "clear multi-provider no-key message");
  }
} finally {
  globalThis.fetch = realFetch;
}

console.log(`\n──────────────\n${passed} passed, ${failed} failed`);
if (failed) { console.log("Failed:", failures.join(" · ")); process.exit(1); }
geminiServer.close(); openaiServer.close(); anthropicServer.close();
process.exit(0);
