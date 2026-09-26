/**
 * Legend Boy — multi-provider engine.
 *
 * One conversation format feeds every AI company. A "chain" of keys is built
 * per request (Cloudflare secrets first, then the keys saved in the app, in
 * the user's order). Every feature tries the chain top to bottom: if a key is
 * wrong, out of credit or rate-limited, the next one answers automatically.
 *
 * Provider styles:
 *   gemini    Google Gemini generateContent API (key header: x-goog-api-key)
 *   openai    OpenAI chat/completions API (Bearer) — also used by OpenRouter,
 *             Groq, DeepSeek, Grok, Mistral, Perplexity, Together, Cerebras,
 *             Hugging Face, Fireworks and any OpenAI-compatible server
 *   anthropic Anthropic /v1/messages API (x-api-key)
 */

export const GEMINI_VOICES = {
  Puck: "m", Charon: "m", Fenrir: "m", Orus: "m", Enceladus: "m", Iapetus: "m", Umbriel: "m",
  Algieba: "m", Algenib: "m", Rasalgethi: "m", Alnilam: "m", Schedar: "m", Achird: "m",
  Zubenelgenubi: "m", Sadachbia: "m", Sadaltager: "m",
  Zephyr: "f", Kore: "f", Leda: "f", Aoede: "f", Callirrhoe: "f", Autonoe: "f", Despina: "f",
  Erinome: "f", Laomedeia: "f", Achernar: "f", Gacrux: "f", Pulcherrima: "f", Vindemiatrix: "f", Sulafat: "f",
};

export const OPENAI_VOICES = {
  alloy: "f", ash: "m", ballad: "m", coral: "f", echo: "m", fable: "m",
  nova: "f", onyx: "m", sage: "f", shimmer: "f", verse: "m",
};

/** Caps: chat(=always), vision, stt (voice in), tts (voice out), images, search ("grounded"=Google, "native"=built-in web). */
export const PROVIDERS = [
  {
    id: "gemini",
    name: "Google Gemini",
    short: "Gemini",
    letter: "G",
    color: "#4285f4",
    link: "https://aistudio.google.com/apikey",
    keyHint: "AIza… or AQ.…",
    style: "gemini",
    base: "https://generativelanguage.googleapis.com/v1beta",
    baseEnv: "GEMINI_BASE_URL",
    envNames: ["GEMINI_API_KEY", "GEMINI_KEY", "GOOGLE_API_KEY"],
    modelEnv: "GEMINI_MODEL",
    detect: /^(AQ\.|AIza)[\w.-]{16,}$/,
    caps: { vision: true, stt: "gemini", tts: "gemini", images: "gemini", search: "grounded" },
    defaults: { chat: "gemini-flash-latest", tts: "gemini-3.8-flash-lite-tts", image: "gemini-3.1-flash-lite-image", voice: "Puck" },
    models: [
      "gemini-flash-latest — newest Flash, always up to date",
      "gemini-3.8-flash — fast flagship Flash",
      "gemini-3.1-flash-lite — cheapest & fastest",
      "gemini-3.1-pro-preview — best reasoning",
      "gemini-2.5-flash — previous generation",
    ],
  },
  {
    id: "openai",
    name: "OpenAI (ChatGPT)",
    short: "OpenAI",
    letter: "O",
    color: "#10a37f",
    link: "https://platform.openai.com/api-keys",
    keyHint: "sk-… or sk-proj-…",
    style: "openai",
    base: "https://api.openai.com/v1",
    baseEnv: "OPENAI_BASE_URL",
    envNames: ["OPENAI_API_KEY"],
    modelEnv: "OPENAI_MODEL",
    detect: /^sk-(proj-|svcacct-)?[\w-]{20,}$/,
    caps: { vision: true, stt: "whisper", tts: "openai", images: "openai", search: null },
    defaults: { chat: "gpt-5.6", sttModels: ["gpt-4o-mini-transcribe", "whisper-1"], ttsModel: "gpt-4o-mini-tts", voice: "alloy", imageModel: "gpt-image-1" },
    models: [
      "gpt-5.6 — flagship (points to newest GPT-5.6)",
      "gpt-5.6-sol — best reasoning & coding",
      "gpt-5.6-terra — balanced speed and price",
      "gpt-5.6-luna — cheapest, high volume",
      "gpt-6-astra — newest frontier model",
      "gpt-4o — previous generation",
      "gpt-4o-mini — cheap & fast",
    ],
  },
  {
    id: "claude",
    name: "Claude (Anthropic)",
    short: "Claude",
    letter: "C",
    color: "#d97757",
    link: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-…",
    style: "anthropic",
    base: "https://api.anthropic.com",
    baseEnv: "ANTHROPIC_BASE_URL",
    envNames: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    modelEnv: "ANTHROPIC_MODEL",
    detect: /^sk-ant-[\w-]{16,}$/,
    caps: { vision: true, stt: null, tts: null, images: null, search: null },
    defaults: { chat: "claude-sonnet-5" },
    models: [
      "claude-sonnet-5 — best speed + intelligence mix",
      "claude-opus-5-5 — strongest Opus, agentic coding",
      "claude-fable-5-1 — frontier flagship",
      "claude-haiku-4-5 — fast & cheap",
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter (400+ models)",
    short: "OpenRouter",
    letter: "R",
    color: "#6566f1",
    link: "https://openrouter.ai/keys",
    keyHint: "sk-or-…",
    style: "openai",
    base: "https://openrouter.ai/api/v1",
    baseEnv: "OPENROUTER_BASE_URL",
    envNames: ["OPENROUTER_API_KEY"],
    modelEnv: "OPENROUTER_MODEL",
    detect: /^sk-or-[\w-]{16,}$/,
    caps: { vision: true, stt: null, tts: null, images: null, search: null },
    defaults: { chat: "google/gemini-3.8-flash" },
    headers: { "x-title": "Legend Boy" },
    models: [
      "google/gemini-3.8-flash — Google via OpenRouter",
      "openai/gpt-5.6 — GPT-5.6 via OpenRouter",
      "anthropic/claude-sonnet-5 — Claude via OpenRouter",
      "x-ai/grok-4.5 — Grok via OpenRouter",
      "deepseek/deepseek-chat-v4 — DeepSeek via OpenRouter",
      "meta-llama/llama-4-maverick — open Llama",
    ],
  },
  {
    id: "groq",
    name: "Groq (ultra fast)",
    short: "Groq",
    letter: "Q",
    color: "#f55036",
    link: "https://console.groq.com/keys",
    keyHint: "gsk_…",
    style: "openai",
    base: "https://api.groq.com/openai/v1",
    baseEnv: "GROQ_BASE_URL",
    envNames: ["GROQ_API_KEY"],
    modelEnv: "GROQ_MODEL",
    detect: /^gsk_[\w-]{16,}$/,
    caps: { vision: true, stt: "whisper", tts: null, images: null, search: null },
    visionOnly: /llama-4|maverick|scout|vision/i,
    defaults: { chat: "llama-3.3-70b-versatile", sttModels: ["whisper-large-v3-turbo", "whisper-large-v3"] },
    models: [
      "llama-3.3-70b-versatile — great all-rounder",
      "openai/gpt-oss-120b — big open model, reasoning",
      "openai/gpt-oss-20b — small & instant",
      "meta-llama/llama-4-maverick-17b-128e-instruct — sees photos",
      "meta-llama/llama-4-scout-17b-16e-instruct — sees photos",
      "qwen/qwen3-32b — Qwen reasoning",
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    short: "DeepSeek",
    letter: "D",
    color: "#4d6bfe",
    link: "https://platform.deepseek.com/api_keys",
    keyHint: "sk-…",
    style: "openai",
    base: "https://api.deepseek.com/v1",
    baseEnv: "DEEPSEEK_BASE_URL",
    envNames: ["DEEPSEEK_API_KEY"],
    modelEnv: "DEEPSEEK_MODEL",
    detect: null, // keys look like OpenAI's — picked manually in the app
    caps: { vision: false, stt: null, tts: null, images: null, search: null },
    defaults: { chat: "deepseek-chat" },
    models: [
      "deepseek-chat — V4 chat, great & cheap",
      "deepseek-reasoner — V4 Pro with deep reasoning",
    ],
  },
  {
    id: "grok",
    name: "Grok (xAI)",
    short: "Grok",
    letter: "X",
    color: "#e7e9ea",
    link: "https://console.x.ai/",
    keyHint: "xai-…",
    style: "openai",
    base: "https://api.x.ai/v1",
    baseEnv: "XAI_BASE_URL",
    envNames: ["XAI_API_KEY", "GROK_API_KEY"],
    modelEnv: "XAI_MODEL",
    detect: /^xai-[\w-]{16,}$/,
    caps: { vision: true, stt: null, tts: null, images: "openai", search: null },
    defaults: { chat: "grok-4.5", imageModel: "grok-2-image" },
    models: [
      "grok-4.7 — newest Grok",
      "grok-4.5 — fast flagship",
      "grok-4 — stable",
      "grok-4-fast — cheapest, very fast",
      "grok-3-mini — small reasoning",
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    short: "Mistral",
    letter: "M",
    color: "#ff7000",
    link: "https://console.mistral.ai/api-keys",
    keyHint: "any key, no prefix",
    style: "openai",
    base: "https://api.mistral.ai/v1",
    baseEnv: "MISTRAL_BASE_URL",
    envNames: ["MISTRAL_API_KEY"],
    modelEnv: "MISTRAL_MODEL",
    detect: null,
    caps: { vision: true, stt: "whisper", tts: null, images: null, search: null },
    defaults: { chat: "mistral-large-latest", sttModels: ["voxtral-mini-latest"] },
    models: [
      "mistral-large-latest — Mistral Large 3, flagship",
      "mistral-medium-latest — balanced",
      "magistral-medium-latest — reasoning",
      "ministral-8b-latest — tiny & fast",
      "pixtral-large-latest — best with photos",
    ],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    short: "Perplexity",
    letter: "P",
    color: "#20b8cd",
    link: "https://www.perplexity.ai/settings/api",
    keyHint: "pplx-…",
    style: "openai",
    base: "https://api.perplexity.ai",
    baseEnv: "PERPLEXITY_BASE_URL",
    envNames: ["PERPLEXITY_API_KEY", "PPLX_API_KEY"],
    modelEnv: "PERPLEXITY_MODEL",
    detect: /^pplx-[\w-]{16,}$/,
    caps: { vision: false, stt: null, tts: null, images: null, search: "native" },
    defaults: { chat: "sonar", researchModel: "sonar-pro" },
    models: [
      "sonar — fast answers with live web",
      "sonar-pro — deeper web research",
      "sonar-reasoning-pro — thinks + browses",
    ],
  },
  {
    id: "together",
    name: "Together AI",
    short: "Together",
    letter: "T",
    color: "#0f6fff",
    link: "https://api.together.ai/settings/api-keys",
    keyHint: "64 letters/numbers",
    style: "openai",
    base: "https://api.together.xyz/v1",
    baseEnv: "TOGETHER_BASE_URL",
    envNames: ["TOGETHER_API_KEY"],
    modelEnv: "TOGETHER_MODEL",
    detect: null,
    caps: { vision: true, stt: null, tts: null, images: "openai", search: null },
    defaults: { chat: "meta-llama/Llama-3.3-70B-Instruct-Turbo", imageModel: "black-forest-labs/FLUX.1-schnell-Free" },
    models: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo — fast Llama",
      "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8 — sees photos",
      "deepseek-ai/DeepSeek-V4 — DeepSeek hosted",
      "Qwen/Qwen3-235B-A22B-Instruct — big Qwen",
      "moonshotai/Kimi-K2-Instruct — Kimi",
    ],
  },
  {
    id: "cerebras",
    name: "Cerebras (fastest)",
    short: "Cerebras",
    letter: "Cb",
    color: "#f36f21",
    link: "https://cloud.cerebras.ai/",
    keyHint: "csk-…",
    style: "openai",
    base: "https://api.cerebras.ai/v1",
    baseEnv: "CEREBRAS_BASE_URL",
    envNames: ["CEREBRAS_API_KEY"],
    modelEnv: "CEREBRAS_MODEL",
    detect: /^csk-[\w-]{16,}$/,
    caps: { vision: false, stt: null, tts: null, images: null, search: null },
    defaults: { chat: "gpt-oss-120b" },
    models: [
      "gpt-oss-120b — big open model, insane speed",
      "llama-4-scout-17b-16e-instruct — Llama 4",
      "llama3.3-70b — steady Llama",
      "qwen-3-235b-a22b-instruct-2507 — big Qwen",
    ],
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    short: "HF",
    letter: "🤗",
    color: "#ff9d00",
    link: "https://huggingface.co/settings/tokens",
    keyHint: "hf_…",
    style: "openai",
    base: "https://router.huggingface.co/v1",
    baseEnv: "HUGGINGFACE_BASE_URL",
    envNames: ["HUGGINGFACE_API_KEY", "HF_TOKEN"],
    modelEnv: "HUGGINGFACE_MODEL",
    detect: /^hf_[\w]{16,}$/,
    caps: { vision: false, stt: null, tts: null, images: null, search: null },
    defaults: { chat: "meta-llama/Llama-3.3-70B-Instruct" },
    models: [
      "meta-llama/Llama-3.3-70B-Instruct — popular Llama",
      "Qwen/Qwen3-235B-A22B — big Qwen",
      "deepseek-ai/DeepSeek-V4 — DeepSeek hosted",
      "moonshotai/Kimi-K2-Instruct — Kimi",
    ],
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    short: "Fireworks",
    letter: "F",
    color: "#ff4424",
    link: "https://fireworks.ai/account/api-keys",
    keyHint: "fw_…",
    style: "openai",
    base: "https://api.fireworks.ai/inference/v1",
    baseEnv: "FIREWORKS_BASE_URL",
    envNames: ["FIREWORKS_API_KEY"],
    modelEnv: "FIREWORKS_MODEL",
    detect: /^fw_[\w]{16,}$/,
    caps: { vision: true, stt: "whisper", tts: null, images: null, search: null },
    defaults: { chat: "accounts/fireworks/models/llama4-maverick-instruct-basic", sttModels: ["accounts/fireworks/models/whisper-v3"] },
    models: [
      "accounts/fireworks/models/llama4-maverick-instruct-basic — sees photos",
      "accounts/fireworks/models/gpt-oss-120b — big open model",
      "accounts/fireworks/models/deepseek-v4 — DeepSeek hosted",
      "accounts/fireworks/models/qwen3-235b-a22b — big Qwen",
    ],
  },
  {
    id: "custom",
    name: "Other (OpenAI-compatible)",
    short: "Custom",
    letter: "⚙",
    color: "#64748b",
    link: "",
    keyHint: "any key + server address",
    style: "openai",
    base: "",
    baseEnv: "CUSTOM_BASE_URL",
    envNames: ["CUSTOM_API_KEY"],
    modelEnv: "CUSTOM_MODEL",
    detect: null,
    custom: true,
    caps: { vision: true, stt: null, tts: null, images: null, search: null },
    defaults: { chat: "" },
    models: [],
  },
];

export const PROVIDER_BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

/* ------------------------------------------------------------------ */
/* Keys & chain                                                        */
/* ------------------------------------------------------------------ */

export function cleanKey(k) {
  const v = String(k || "").trim();
  if (v.length < 10 || /your|xxx|placeholder|example/i.test(v)) return "";
  return v;
}

/** Guess which company a key belongs to (null = unknown). Distinctive prefixes are
 *  checked first so e.g. sk-ant-… (Claude) isn't swallowed by the generic sk-… rule. */
const DETECT_ORDER = [
  "gemini", "claude", "openrouter", "groq", "grok", "huggingface",
  "perplexity", "cerebras", "fireworks", "openai", "deepseek", "mistral", "together",
];
export function detectProvider(key) {
  const k = String(key || "").trim();
  if (k.length < 10) return null;
  for (const id of DETECT_ORDER) {
    const p = PROVIDER_BY_ID[id];
    if (p?.detect && p.detect.test(k)) return id;
  }
  return null;
}

/** Model id for display: keep last path segment, drop long date suffixes. v2.1: handles more edge cases */
export function shortModel(model) {
  if (!model) return "";
  const raw = String(model).trim();
  if (!raw) return "";
  const m = raw.split("/").pop() || "";
  if (!m) return "";
  // Remove date suffixes like -20240101 or -2024-01-01
  let short = m.replace(/-(\d{4})(\d{2})(\d{2})$/, "").replace(/-(\d{8})$/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "");
  // Remove trailing version numbers that are just numbers
  short = short.replace(/-v?\d+(\.\d+)*$/i, (match) => match.length > 8 ? "" : match);
  return short.length > 30 ? short.slice(0, 29) + "…" : short;
}

/** v2.1: normalize base URL — trim trailing slashes, handle empty */
export function normalizeBaseUrl(url) {
  if (!url) return "";
  let u = String(url).trim().replace(/\/+$/, "");
  u = u.replace(/([^:]\/)\/+/g, "$1");
  return u;
}

/** Sensible model per entry: user choice → env override → provider default. */
export function chatModelOf(entry) {
  return entry.model || PROVIDER_BY_ID[entry.provider]?.defaults.chat || "";
}

/** Can this chain entry handle the given capability? v2.1: improved visionOnly handling */
export function entryCan(entry, cap) {
  const p = PROVIDER_BY_ID[entry.provider];
  if (!p) return false;
  if (cap === "chat") return true;
  if (cap === "vision") {
    if (!p.caps.vision) return false;
    if (p.visionOnly) {
      const model = chatModelOf(entry);
      // If visionOnly regex exists, model must match; if no model, assume false for safety unless provider is vision-capable without filter
      if (!model) return false;
      if (!p.visionOnly.test(model)) return false;
    }
    return true;
  }
  return Boolean(p.caps[cap === "researchSearch" ? "search" : cap]);
}

/** Filter the chain by capability, keeping priority order. */
export function selectChain(entries, needs = {}) {
  if (!needs || !Object.keys(needs).length) return entries;
  return entries.filter((e) => Object.entries(needs).every(([cap, on]) => !on || entryCan(e, cap)));
}

const NON_KEY_ENV = new Set([
  "MOCK_AI", "ACCESS_CODE", "TTS_SPEAKER", "GEMINI_TTS_MODEL", "GEMINI_IMAGE_MODEL",
  "GEMINI_MODEL", "OPENAI_MODEL", "ANTHROPIC_MODEL", "CLAUDE_MODEL", "OPENROUTER_MODEL", "GROQ_MODEL",
  "DEEPSEEK_MODEL", "XAI_MODEL", "MISTRAL_MODEL", "PERPLEXITY_MODEL", "TOGETHER_MODEL",
  "CEREBRAS_MODEL", "HUGGINGFACE_MODEL", "FIREWORKS_MODEL", "CUSTOM_MODEL",
  "DISABLE_RATE_LIMIT", "RATE_LIMIT_MAX", "RATE_LIMIT_WINDOW",
]);

function looksLikeAnyKey(v) {
  return /^[\w.:-]{16,}$/.test(String(v || "").trim()) && detectProvider(v);
}

/**
 * Build the ordered key chain for a request.
 *   1) Cloudflare secrets found under their provider's env names (owner keys first)
 *   2) any other env value that clearly looks like a provider key (pasted into a wrong box)
 *   3) keys sent by the app in the x-ai-keys header, in the user's priority order
 * Duplicates (same key value) are removed.
 */
export function buildEntries(env, appKeys = []) {
  const entries = [];
  const seen = new Set();
  const push = (providerId, key, { model = "", base = "", server = false } = {}) => {
    const p = PROVIDER_BY_ID[providerId];
    key = server ? cleanKey(key) : String(key || "").trim();
    if (!p || (!key && !p.custom)) return;
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    if (p.custom && !base) return;
    const envModel = server ? String(env[p.modelEnv] || "").trim() : "";
    // v2.1: normalize base URLs to remove trailing slashes
    const normalizedBase = normalizeBaseUrl(base) || normalizeBaseUrl(String(env[p.baseEnv] || "").trim()) || p.base;
    entries.push({
      id: `${p.id}#${entries.length}`,
      provider: p.id,
      key,
      model: model || envModel,
      base: normalizedBase,
      server,
    });
  };

  // 1) properly named secrets
  for (const p of PROVIDERS) {
    for (const name of p.envNames) {
      const v = cleanKey(env[name]);
      if (v) { push(p.id, v, { server: true }); break; }
    }
  }
  // 2) stray secrets pasted under other names (config mistakes auto-fixed)
  for (const [name, v] of Object.entries(env)) {
    if (NON_KEY_ENV.has(name) || !/^[A-Z][A-Z0-9_]{2,50}$/.test(name)) continue;
    if (looksLikeAnyKey(v)) push(detectProvider(v), v, { server: true });
  }
  // legacy single-key header from older app versions
  const legacy = cleanKey(env.__legacyKey);
  if (legacy) push(detectProvider(legacy) || "openai", legacy, { server: false });
  // 3) app keys, user-ordered (active key first)
  for (const k of Array.isArray(appKeys) ? appKeys : []) {
    if (!k || typeof k !== "object") continue;
    const provider = PROVIDER_BY_ID[k.provider] ? k.provider : detectProvider(k.key);
    if (!provider) continue;
    push(provider, k.key, { model: k.model, base: k.base, server: false });
  }
  return entries;
}

/** The model list endpoint for an entry. */
export async function listModels(entry) {
  const p = PROVIDER_BY_ID[entry.provider];
  if (!p) return [];
  try {
    if (p.style === "gemini") {
      const res = await fetch(`${entry.base}/models?pageSize=300`, {
        headers: { "x-goog-api-key": entry.key },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw await toError(res, entry);
      const j = await res.json().catch(() => ({}));
      return (j.models || [])
        .filter((m) => /generateContent/i.test((m.supportedGenerationMethods || []).join(" ")))
        .map((m) => String(m.name || "").replace(/^models\//, ""))
        .filter((id) => /gemini|gemma/i.test(id));
    }
    if (p.style === "anthropic") {
      const res = await fetch(`${entry.base}/v1/models?limit=100`, {
        headers: anthropicHeaders(entry),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw await toError(res, entry);
      const j = await res.json().catch(() => ({}));
      return (j.data || []).map((m) => m.id).filter(Boolean);
    }
    // openai style
    const res = await fetch(`${entry.base}/models`, {
      headers: openaiHeaders(entry),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw await toError(res, entry);
    const j = await res.json().catch(() => ({}));
    return (j.data || []).map((m) => m.id || m.name).filter(Boolean);
  } catch (e) {
    e._listed = true;
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class ProviderError extends Error {
  constructor(message, status, provider) {
    super(message);
    this.status = status || 0;
    this.provider = provider;
  }
}

export function extractApiError(text) {
  try {
    const j = JSON.parse(text);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    if (typeof e === "string") return e.slice(0, 300);
    return (e?.message || j.message || text.slice(0, 300) || "Unknown error").slice(0, 300);
  } catch {
    return String(text || "Unknown error").slice(0, 300);
  }
}

export async function toError(res, entry) {
  const msg = extractApiError(await res.text().catch(() => ""));
  return new ProviderError(msg, res.status, entry?.provider);
}

/* ------------------------------------------------------------------ */
/* Shared HTTP helpers                                                 */
/* ------------------------------------------------------------------ */

function openaiHeaders(entry, extra = {}) {
  const p = PROVIDER_BY_ID[entry.provider];
  return {
    "content-type": "application/json",
    authorization: `Bearer ${entry.key || "none"}`,
    ...(p?.headers || {}),
    ...extra,
  };
}

function anthropicHeaders(entry, extra = {}) {
  return {
    "content-type": "application/json",
    "x-api-key": entry.key,
    "anthropic-version": "2023-06-01",
    ...extra,
  };
}

/** Iterate `data:` payloads of any SSE stream, yielding parsed JSON. */
export async function* sseEvents(res) {
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
  if (rest.startsWith("data:")) { try { const p = rest.slice(5).trim(); if (p !== "[DONE]") yield JSON.parse(p); } catch {} }
}

/* ------------------------------------------------------------------ */
/* Conversation conversion (normalized msgs → per-provider bodies)      */
/* Input norm: [{ role:"user"|"assistant", text, images:[{mimeType,data}] }] */
/* ------------------------------------------------------------------ */

export function toGeminiBody(entry, { system, messages, maxTokens = 8192, fast = false, tools = null, temperature }) {
  const contents = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts = [];
    if (m.role === "user") for (const img of m.images || []) parts.push({ inlineData: img });
    parts.push({ text: m.text || "…" });
    const prev = contents[contents.length - 1];
    if (prev && prev.role === role) prev.parts.push(...parts);
    else contents.push({ role, parts });
  }
  if (!contents.length || contents[contents.length - 1].role !== "user") contents.push({ role: "user", parts: [{ text: "Continue." }] });
  if (contents[0].role !== "user") contents.unshift({ role: "user", parts: [{ text: "Hi" }] });

  const generationConfig = { maxOutputTokens: maxTokens };
  if (temperature != null) generationConfig.temperature = temperature;
  if (fast) generationConfig.thinkingConfig = { thinkingLevel: "low" };
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig,
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
    ...(tools ? { tools } : {}),
  };
}

export function toOpenAIBody(entry, { system, messages, maxTokens = 8192, stream = true, temperature }) {
  const out = system ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const images = m.role === "user" ? m.images || [] : [];
    let content;
    if (images.length) {
      content = [];
      for (const img of images) content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
      content.push({ type: "text", text: m.text || "What do you see in this image?" });
    } else {
      content = m.text || (role === "user" ? "(empty)" : "…");
    }
    out.push({ role, content });
  }
  if (!out.length || out[out.length - 1].role !== "user") out.push({ role: "user", content: "Continue." });
  const body = { model: chatModelOf(entry), messages: out, stream };
  if (temperature != null) body.temperature = temperature;
  if (stream) body.stream_options = { include_usage: false };
  body.max_completion_tokens = maxTokens;
  return body;
}

export function toAnthropicBody(entry, { system, messages, maxTokens = 8192, stream = true, temperature }) {
  const out = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const blocks = [];
    if (m.role === "user") for (const img of m.images || []) blocks.push({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.data } });
    blocks.push({ type: "text", text: m.text || (role === "user" ? "(empty)" : "…") });
    const prev = out[out.length - 1];
    if (prev && prev.role === role) prev.content.push(...blocks);
    else out.push({ role, content: blocks });
  }
  if (!out.length || out[out.length - 1].role !== "user") out.push({ role: "user", content: [{ type: "text", text: "Continue." }] });
  if (out[0].role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "Hi" }] });
  const body = { model: chatModelOf(entry), max_tokens: maxTokens, system, messages: out, stream };
  if (temperature != null) body.temperature = temperature;
  return body;
}

/* ------------------------------------------------------------------ */
/* Style-specific fetchers                                             */
/* ------------------------------------------------------------------ */

async function geminiFetch(entry, model, method, body, { stream = false } = {}) {
  const url = `${entry.base}/models/${encodeURIComponent(model)}:${method}${stream ? "?alt=sse" : ""}`;
  const send = (b) => fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": entry.key },
    body: JSON.stringify(b),
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
      throw new ProviderError(extractApiError(text), 400, entry.provider);
    }
  }
  if (!res.ok) throw await toError(res, entry);
  return res;
}

async function openaiChatFetch(entry, body) {
  const url = `${entry.base}/chat/completions`;
  const send = (b) => fetch(url, { method: "POST", headers: openaiHeaders(entry), body: JSON.stringify(b) });
  let res = await send(body);
  if (res.status === 400) {
    const text = await res.text();
    // Reasoning models reject `max_completion_tokens`? Older ones reject nothing — be tolerant both ways.
    if (body.max_completion_tokens != null && /max_completion_tokens|max tokens/i.test(text)) {
      const b2 = { ...body };
      b2.max_tokens = body.max_completion_tokens;
      delete b2.max_completion_tokens;
      res = await send(b2);
    } else if (body.messages?.[0]?.role === "system" && /system|developer/i.test(text)) {
      const b2 = { ...body, messages: [{ role: "developer", content: body.messages[0].content }, ...body.messages.slice(1)] };
      res = await send(b2);
    } else if (body.temperature != null && /temperature/i.test(text)) {
      const b2 = { ...body };
      delete b2.temperature;
      res = await send(b2);
    } else {
      throw new ProviderError(extractApiError(text), 400, entry.provider);
    }
  }
  if (res.status === 400 && body.max_completion_tokens != null) {
    // second-chance: maybe the model only takes default token settings
    const text = await res.clone().text();
    if (/max_completion_tokens/i.test(text)) {
      const b3 = { ...body };
      delete b3.max_completion_tokens;
      res = await send(b3);
    }
  }
  if (!res.ok) throw await toError(res, entry);
  return res;
}

function anthropicChatFetch(entry, body) {
  return fetch(`${entry.base}/v1/messages`, { method: "POST", headers: anthropicHeaders(entry), body: JSON.stringify(body) })
    .then(async (res) => {
      if (!res.ok) throw await toError(res, entry);
      return res;
    });
}

/* ------------------------------------------------------------------ */
/* Chat: streaming and one-shot                                        */
/* ------------------------------------------------------------------ */

function geminiTokenText(ev) {
  const parts = ev?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("");
}

function openaiTokenText(ev) {
  const d = ev?.choices?.[0]?.delta;
  return d?.content || "";
}

function anthropicTokenText(ev) {
  if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") return ev.delta.text || "";
  return "";
}

function mergeGrounding(a, b) {
  if (!a) return { ...b };
  return {
    webSearchQueries: [...new Set([...(a.webSearchQueries || []), ...(b.webSearchQueries || [])])],
    groundingChunks: b.groundingChunks?.length ? b.groundingChunks : a.groundingChunks,
    groundingSupports: [...(a.groundingSupports || []), ...(b.groundingSupports || [])],
  };
}

function blockedReasonGemini(ev) {
  const fb = ev?.promptFeedback?.blockReason;
  const fr = ev?.candidates?.[0]?.finishReason;
  if (fb) return `Blocked by Gemini safety filters (${fb})`;
  if (fr && /SAFETY|PROHIBITED|BLOCKLIST|SPII/.test(fr)) return `Answer stopped by safety filters (${fr})`;
  return null;
}

/**
 * Stream a chat answer from ONE chain entry.
 * onToken(text) is called for every piece. Returns { text, grounding }.
 */
export async function streamChat(entry, args, onToken) {
  const p = PROVIDER_BY_ID[entry.provider];
  let full = "";
  if (p.style === "gemini") {
    const body = toGeminiBody(entry, args);
    const res = await geminiFetch(entry, chatModelOf(entry), "streamGenerateContent", body, { stream: true });
    let grounding = null;
    let blocked = null;
    for await (const ev of sseEvents(res)) {
      const t = geminiTokenText(ev);
      if (t) { full += t; await onToken(t); }
      const gm = ev?.candidates?.[0]?.groundingMetadata;
      if (gm) grounding = mergeGrounding(grounding, gm);
      blocked = blockedReasonGemini(ev) || blocked;
    }
    if (!full && blocked) throw new ProviderError(blocked, 400, entry.provider);
    return { text: full, grounding };
  }
  if (p.style === "anthropic") {
    const body = toAnthropicBody(entry, args);
    const res = await anthropicChatFetch(entry, body);
    for await (const ev of sseEvents(res)) {
      const t = anthropicTokenText(ev);
      if (t) { full += t; await onToken(t); }
    }
    return { text: full, grounding: null };
  }
  const body = toOpenAIBody(entry, args);
  const res = await openaiChatFetch(entry, body);
  for await (const ev of sseEvents(res)) {
    const t = ev?.choices?.[0]?.delta?.content;
    if (Array.isArray(t)) {
      for (const part of t) if (part?.type === "text" && part.text) { full += part.text; await onToken(part.text); }
    } else if (t) {
      full += t;
      await onToken(t);
    }
  }
  return { text: full, grounding: null };
}

/** Non-streamed one-shot generation (transcription, PDF, JSON replies…). Returns raw text. */
export async function generateOnce(entry, args) {
  const p = PROVIDER_BY_ID[entry.provider];
  if (p.style === "gemini") {
    const body = toGeminiBody(entry, args);
    const res = await geminiFetch(entry, args.model || chatModelOf(entry), "generateContent", body);
    return geminiTokenText(await res.json());
  }
  if (p.style === "anthropic") {
    const body = toAnthropicBody(entry, { ...args, maxTokens: args.maxTokens || 4096, stream: false });
    const res = await anthropicChatFetch(entry, body);
    const j = await res.json();
    return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  }
  const body = toOpenAIBody(entry, { ...args, stream: false });
  const res = await openaiChatFetch(entry, body);
  const j = await res.json();
  const c = j?.choices?.[0]?.message?.content;
  if (Array.isArray(c)) return c.filter((x) => x?.type === "text").map((x) => x.text).join("");
  return c || "";
}

/* ------------------------------------------------------------------ */
/* Media capabilities                                                  */
/* ------------------------------------------------------------------ */

/** Speech → text. Needs an entry with caps.stt. `bytes` is a Uint8Array. */
export async function transcribeAudio(entry, { bytes, mimeType }, language) {
  const p = PROVIDER_BY_ID[entry.provider];
  const models = p.defaults.sttModels || [];
  if (p.caps.stt === "gemini") {
    const langHint = language && LANG_NAMES[language] ? ` The speech is in ${LANG_NAMES[language]}.` : "";
    const body = {
      contents: [{
        role: "user",
        parts: [
          { inlineData: { mimeType, data: toBase64(bytes) } },
          { text: `Transcribe this voice message exactly as spoken, in the original language and script.${langHint} Output ONLY the transcript text — no quotes, labels, timestamps or explanations. If there is no clear speech, output nothing.` },
        ],
      }],
      generationConfig: { thinkingConfig: { thinkingLevel: "low" } },
    };
    const res = await geminiFetch(entry, chatModelOf(entry), "generateContent", body);
    let text = geminiTokenText(await res.json()).trim().replace(/^["“]|["”]$/g, "");
    if (/^\(?(no (clear )?speech|silence|inaudible)/i.test(text)) text = "";
    return text;
  }
  // whisper-style /audio/transcriptions
  let lastErr = null;
  for (const model of models.length ? models : ["whisper-1"]) {
    try {
      const fd = new FormData();
      const ext = /mp4|m4a/.test(mimeType) ? "m4a" : /ogg/.test(mimeType) ? "ogg" : /webm/.test(mimeType) ? "webm" : "wav";
      fd.append("file", new Blob([bytes], { type: mimeType }), `speech.${ext}`);
      fd.append("model", model);
      if (language && language !== "auto") fd.append("language", language);
      const res = await fetch(`${entry.base}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${entry.key}` },
        body: fd,
      });
      if (!res.ok) throw await toError(res, entry);
      const j = await res.json().catch(() => ({}));
      return String(j.text || "").trim();
    } catch (e) {
      lastErr = e;
      if (e.status && e.status !== 400 && e.status !== 404) throw e;
    }
  }
  throw lastErr || new ProviderError("Transcription failed", 0, entry.provider);
}

const LANG_NAMES = { en: "English", ar: "Arabic", ku: "Kurdish", hi: "Hindi", ur: "Urdu", es: "Spanish", fr: "French", de: "German", pt: "Portuguese", tr: "Turkish", ru: "Russian", zh: "Chinese", ja: "Japanese", ko: "Korean", id: "Indonesian", bn: "Bengali", fa: "Persian" };

/** Text → speech for one entry. Returns {bytes, type} or null when not possible. */
export async function ttsAudio(entry, text, voice) {
  const p = PROVIDER_BY_ID[entry.provider];
  if (p.caps.tts === "gemini") {
    const model = p.defaults.tts; // env override handled by caller via entry.ttsModel
    const ttsBody = (voiceConfig) => ({
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig } },
    });
    let res;
    try {
      res = await geminiFetch({ ...entry, model: "" }, entry.ttsModel || model, "generateContent", ttsBody({ prebuiltVoiceConfig: { voiceName: voice } }));
    } catch (e) {
      if (e.status !== 400) throw e;
      res = await geminiFetch(entry, entry.ttsModel || model, "generateContent", ttsBody({ voice }));
    }
    const j = await res.json();
    const part = (j?.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData?.data);
    if (!part) return null;
    const mime = part.inlineData.mimeType || "";
    let bytes = fromBase64(part.inlineData.data);
    let type = mime.split(";")[0] || "audio/wav";
    if (/L16|pcm/i.test(mime) || !/wav|mpeg|mp3|ogg|opus|aac|mp4/i.test(mime)) {
      const rate = Number((mime.match(/rate=(\d+)/) || [])[1]) || 24000;
      bytes = pcmToWav(bytes, rate);
      type = "audio/wav";
    }
    return { bytes, type };
  }
  if (p.caps.tts === "openai") {
    const v = OPENAI_VOICES[voice] ? voice : p.defaults.voice;
    const res = await fetch(`${entry.base}/audio/speech`, {
      method: "POST",
      headers: openaiHeaders(entry),
      body: JSON.stringify({ model: entry.ttsModel || p.defaults.ttsModel, input: text, voice: v, response_format: "mp3" }),
    });
    if (res.status === 400 && /model/i.test(await res.clone().text().catch(() => ""))) {
      // fallback to an older OpenAI TTS model
      const res2 = await fetch(`${entry.base}/audio/speech`, {
        method: "POST",
        headers: openaiHeaders(entry),
        body: JSON.stringify({ model: "tts-1", input: text, voice: v, response_format: "mp3" }),
      });
      if (!res2.ok) throw await toError(res2, entry);
      return { bytes: new Uint8Array(await res2.arrayBuffer()), type: "audio/mpeg" };
    }
    if (!res.ok) throw await toError(res, entry);
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: "audio/mpeg" };
  }
  return null;
}

/** Text → image data URL for one entry (null when the provider can't). */
export async function generateImage(entry, prompt) {
  const p = PROVIDER_BY_ID[entry.provider];
  if (p.caps.images === "gemini") {
    const res = await geminiFetch(entry, entry.imageModel || p.defaults.image, "generateContent", {
      contents: [{ role: "user", parts: [{ text: `Create an image: ${prompt}` }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    });
    const j = await res.json();
    const part = (j?.candidates?.[0]?.content?.parts || []).find((x) => x.inlineData?.data && /^image\//.test(x.inlineData.mimeType || "image/"));
    if (!part) {
      const why = blockedReasonGemini(j) || geminiTokenText(j) || "No image returned.";
      throw new ProviderError("Image generation failed: " + why.slice(0, 300), 502, entry.provider);
    }
    return `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}`;
  }
  if (p.caps.images === "openai") {
    const res = await fetch(`${entry.base}/images/generations`, {
      method: "POST",
      headers: openaiHeaders(entry),
      body: JSON.stringify({ model: entry.imageModel || p.defaults.imageModel, prompt, n: 1, size: "1024x1024" }),
    });
    if (!res.ok) throw await toError(res, entry);
    const j = await res.json().catch(() => ({}));
    const d = (j.data || [])[0] || {};
    if (d.b64_json) return `data:image/png;base64,${d.b64_json}`;
    if (d.url) {
      const img = await fetch(d.url);
      if (img.ok) return `data:image/png;base64,${toBase64(await img.arrayBuffer())}`;
    }
    throw new ProviderError("Image generation failed: no image returned.", 502, entry.provider);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Base64 / wav helpers                                                */
/* ------------------------------------------------------------------ */

export function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function pcmToWav(pcm, rate, channels = 1) {
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
