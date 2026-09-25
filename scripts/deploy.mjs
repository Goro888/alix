#!/usr/bin/env node
/**
 * Legend Boy deploy — used by `npm run deploy` (and Cloudflare Workers Builds).
 *
 * Runs `wrangler deploy`. Any AI-company key available as a BUILD variable
 * (Cloudflare → Worker → Settings → Build → Variables and secrets) is uploaded
 * automatically as a runtime Secret — GEMINI_API_KEY, OPENAI_API_KEY,
 * ANTHROPIC_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY, XAI_API_KEY, MISTRAL_API_KEY,
 * PERPLEXITY_API_KEY, OPENROUTER_API_KEY, TOGETHER_API_KEY, CEREBRAS_API_KEY,
 * HUGGINGFACE_API_KEY, FIREWORKS_API_KEY…
 * A key pasted into ANY other build variable is detected by its shape (e.g.
 * `sk-ant-…` → ANTHROPIC_API_KEY) and saved under the right name.
 * Keys are never printed and never written into the repo.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PROVIDERS, detectProvider, cleanKey } from "../src/providers.js";

const SECRET_NAMES = new Map(); // env name -> provider id
for (const p of PROVIDERS) for (const n of p.envNames) if (!SECRET_NAMES.has(n)) SECRET_NAMES.set(n, p.id);

const secrets = {};

// 1) Properly named build variables (any provider)
for (const [name, providerId] of SECRET_NAMES) {
  const v = cleanKey(process.env[name]);
  if (v && !secrets[name]) secrets[name] = v;
}

// 2) Extra aliases + stray keys pasted into any other build variable
const SKIP = /^(PATH|HOME|PWD|SHELL|CI_|CF_|WORKERS_|NODE_|NPM_|WRANGLER_|BUILD_|SYSTEM_|_)/i;
for (const [name, raw] of Object.entries(process.env)) {
  const v = String(raw || "").trim();
  if (!v || SKIP.test(name)) continue;
  const providerId = detectProvider(v);
  if (!providerId) continue;
  const p = PROVIDERS.find((x) => x.id === providerId);
  const proper = p.envNames[0];
  if (secrets[proper]) continue;
  secrets[proper] = v;
  if (name !== proper) console.log(`ℹ️  Found a ${p.name} key in the build variable "${name}" — saving it as ${proper}.`);
}

const args = ["wrangler", "deploy", ...process.argv.slice(2)];
let dir = "";
const names = Object.keys(secrets);
if (names.length) {
  dir = mkdtempSync(join(tmpdir(), "lb-"));
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
  args.push("--secrets-file", file);
  console.log(`🔑 ${names.length} API key(s) will be saved as encrypted Secrets on your Worker: ${names.join(", ")}`);
} else {
  console.log("ℹ️  No API-key build variables found. Deploying without them (Secrets you already set are kept, and the app can also ask for a key).");
}

const r = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
if (dir) rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);
