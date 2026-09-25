// Tiny API client for the Legend Boy Worker (multi-provider).
import { settings, orderedAiKeys } from "./store.js";

export class ApiError extends Error {
  constructor(message, status, code, failures) {
    super(message);
    this.status = status;
    this.code = code;
    this.failures = failures;
  }
}

function headers(extra = {}) {
  const h = { ...extra };
  if (settings.code) h["x-access-code"] = settings.code;
  const keys = orderedAiKeys();
  if (keys.length) {
    h["x-ai-keys"] = JSON.stringify({
      keys: keys.map((k) => ({ provider: k.provider, key: k.key, model: k.model || "", base: k.base || "" })),
    });
  }
  return h;
}

async function asError(res) {
  let msg = `Request failed (${res.status})`;
  let code, failures;
  try {
    const j = await res.json();
    msg = j.error || msg;
    code = j.code;
    failures = j.failures;
  } catch {}
  return new ApiError(msg, res.status, code, failures);
}

export async function health() {
  const res = await fetch("/api/health", { cache: "no-store", headers: headers() });
  if (!res.ok) throw await asError(res);
  return res.json();
}

/**
 * POST JSON and consume the server-sent-event stream.
 * onEvent receives parsed objects: {type:"token"|"using"|"status"|"sources"|"queries"|"reset"|"error"|"done", ...}
 */
export async function stream(path, body, onEvent, signal) {
  const res = await fetch(path, {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await asError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()));
        } catch {}
      }
    }
  }
}

/** Check an API key before saving it. Returns {ok, provider, name, models, defaultModel, error, code}. */
export async function verifyKey({ key, provider = "", base = "" }) {
  const res = await fetch("/api/verify", {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ key, provider, base }),
  });
  return res.json().catch(() => ({ ok: false, error: `Check failed (${res.status})` }));
}

/** Models for the picker. With a key, returns the live list merged with curated ones. */
export async function listModels({ provider, key = "", base = "" }) {
  const res = await fetch("/api/models", {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ provider, key, base }),
  });
  return res.json().catch(() => ({ ok: false, models: [] }));
}

export async function transcribe(blob, filename = "speech.wav") {
  const fd = new FormData();
  fd.append("audio", blob, filename);
  if (settings.lang && settings.lang !== "auto") fd.append("language", settings.lang);
  const res = await fetch("/api/transcribe", { method: "POST", headers: headers(), body: fd });
  if (!res.ok) throw await asError(res);
  return res.json();
}

export async function tts(text, signal) {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ text, speaker: settings.speaker }),
    signal,
  });
  if (res.status === 204) return null; // → the phone's own voice speaks
  if (!res.ok) throw await asError(res);
  const blob = await res.blob();
  return blob.size > 0 ? blob : null;
}

export async function extract(file) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const res = await fetch("/api/extract", { method: "POST", headers: headers(), body: fd });
  if (!res.ok) throw await asError(res);
  return res.json();
}

export async function imagine(prompt) {
  const res = await fetch("/api/imagine", {
    method: "POST",
    headers: headers({ "content-type": "application/json" }),
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw await asError(res);
  return res.json();
}
