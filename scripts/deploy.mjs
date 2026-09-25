#!/usr/bin/env node
/**
 * Legend Boy deploy — used by `npm run deploy` (and Cloudflare Workers Builds).
 *
 * Runs `wrangler deploy`. If your Gemini key is available as a BUILD variable
 * (Cloudflare → Worker → Settings → Build → Variables and secrets → GEMINI_API_KEY),
 * it is uploaded automatically as the runtime Secret GEMINI_API_KEY.
 * The key is never printed and never written into the repo.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const looksLikeKey = (v) => /^(AQ\.|AIza)[\w.-]{20,}$/.test(String(v || "").trim());

// Accept the key under its proper name, or if it was pasted into another box by mistake.
const candidates = ["GEMINI_API_KEY", "GEMINI_KEY", "GOOGLE_API_KEY", "GEMINI_MODEL", "GEMINI_TTS_MODEL", "GEMINI_IMAGE_MODEL", "TTS_SPEAKER"];
let key = "";
for (const name of candidates) {
  const v = (process.env[name] || "").trim();
  if (looksLikeKey(v)) {
    key = v;
    if (name !== "GEMINI_API_KEY") console.log(`ℹ️  Found your Gemini key in the build variable "${name}", using it as GEMINI_API_KEY.`);
    break;
  }
}

const args = ["wrangler", "deploy", ...process.argv.slice(2)];
let dir = "";
if (key) {
  dir = mkdtempSync(join(tmpdir(), "lb-"));
  const file = join(dir, "secrets.json");
  writeFileSync(file, JSON.stringify({ GEMINI_API_KEY: key }), { mode: 0o600 });
  args.push("--secrets-file", file);
  console.log("🔑 GEMINI_API_KEY will be saved as an encrypted Secret on your Worker.");
} else {
  console.log("ℹ️  No GEMINI_API_KEY build variable found. Deploying without it (a Secret you already set is kept, or the app will ask for the key).");
}

const r = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
if (dir) rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);
