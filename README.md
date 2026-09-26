# Legend Boy: your AI assistant for your phone — any AI company, any model

Legend Boy is a mobile AI assistant. **Cloudflare only hosts it** (free). **All the AI runs on your own API key(s)** — and you're not locked to one company.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Goro888/alix)

## Works with almost any AI company

Paste a key and Legend Boy detects who it's from. **You only need one key** (Gemini has a free tier) — add more and they're used one after another automatically.

| Company | Key looks like | Chat | Photos | Voice in | HD voice out | Images | Research |
|---|---|---|---|---|---|---|---|
| **Google Gemini** | `AIza…` / `AQ.…` | ✅ | ✅ | ✅ | ✅ (30 voices) | ✅ | ✅ Google Search with citations |
| **OpenAI (ChatGPT)** | `sk-…` / `sk-proj-…` | ✅ | ✅ | ✅ (Whisper) | ✅ | ✅ | ✅ (web search) |
| **Claude (Anthropic)** | `sk-ant-…` | ✅ | ✅ | — | — | — | ✅ (web search) |
| **OpenRouter** (400+ models) | `sk-or-…` | ✅ | ✅* | — | — | — | ✅ (web search) |
| **Groq** (ultra fast) | `gsk_…` | ✅ | ✅* | ✅ | — | — | ✅ (web search) |
| **DeepSeek** | `sk-…` | ✅ | — | — | — | — | ✅ (web search) |
| **Grok (xAI)** | `xai-…` | ✅ | ✅ | — | — | ✅ | ✅ (web search) |
| **Mistral** | any | ✅ | ✅ | ✅ | — | — | ✅ (web search) |
| **Perplexity** | `pplx-…` | ✅ | — | — | — | — | ✅ **live web search built in** |
| **Together AI** | any | ✅ | ✅* | — | — | ✅ (FLUX) | ✅ (web search) |
| **Cerebras** (fastest) | `csk-…` | ✅ | — | — | — | — | ✅ (web search) |
| **Hugging Face** | `hf_…` | ✅ | — | — | — | — | ✅ (web search) |
| **Fireworks AI** | `fw_…` | ✅ | ✅* | ✅ | — | — | ✅ (web search) |
| **Any OpenAI-compatible server** | any | ✅ | ✅* | — | — | — | ✅ (web search) |

\* depends on the model you pick. "Web search" = a free built-in search (DuckDuckGo + Wikipedia) — no Google needed.

### Many keys at once = automatic failover
Keys are tried **top to bottom**. If one is wrong, out of credit or rate-limited, the next answers automatically. Each reply shows a small line like **⚡ Claude · claude-sonnet-5** so you can see who answered.

### Any model
Tap **Change ▾** under any key to search that company's **live model list**, or type any model name yourself. Tap the **name at the top of the chat** to switch which AI answers instantly.

### Graceful fallbacks
- **HD voice out** needs a Gemini or OpenAI key — otherwise the phone's own voice speaks automatically.
- **Voice typing** works with Gemini, OpenAI, Groq, Mistral or Fireworks keys (clear message otherwise).
- **PDFs**: a Gemini key reads anything (even scanned); without one, the built-in PDF reader handles text-based PDFs.
- Old Gemini-only setups: your key is moved into the new key list automatically.

## Features

| Section | What it does |
|---|---|
| **Splash** | Opens with Legend Boy's photo and a glowing animation. Tap it and he **greets you out loud** |
| **Talk** | Hands-free voice chat. You talk, he listens, stops by himself when you go quiet, answers **with his voice**, then listens again. Tap his face to interrupt him |
| **Chat** | Streaming AI chat with Markdown and code blocks. Each reply can be copied, read aloud, shared or retried. Chats are saved on the device, voice typing included |
| **Camera** | Live camera with front/back flip. Take a photo, then ask about it: *Describe, Read text, Solve, Translate, Identify, Tips* (needs a vision-capable model) |
| **Files & Photos** | Reads **PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), CSV, text, code** and photos. Summarise, explain, pull out key facts, or get a quiz |
| **Research** | Gemini → **Google Search grounding** with numbered citations. Perplexity → its own live web search. Any other key → free web search. *Quick* and *Deep* modes |
| **Create image** | Makes an image from words (Gemini "Nano Banana", OpenAI gpt-image, Grok, Together FLUX…) |
| **Settings** | Keys & models, Legend Boy's photo, your name, voices, speech language (incl. Kurdish and Arabic), auto-read, greeting |
| **Open apps** | Just say it or type it — no slash needed: **open whatsapp** · **افتح واتساب** · **واتساب بکەرەوە** · **یوتیوب ڤەکە** (also `/open`, `/افتح`). Works from chat, the mic and Talk mode. Add a target: *open whatsapp 07701234567 hi* (Iraqi numbers starting with 07 get **964** added automatically), *open instagram legend.boy*, *افتح اليوتيوب اغاني كردية*, *open call 0770…*. Supports WhatsApp, Telegram, Signal, Viber, Messenger, SMS, Instagram, TikTok, YouTube, Snapchat, Facebook, X, Reddit, Pinterest, LinkedIn, Google. If the app isn't installed it opens the website or App Store instead — and on iPhone, if Safari blocks the jump, a **tap-to-open button** appears |
| **Install as app** | It's a PWA: "Add to Home Screen" gives it an icon and opens it full screen |

---

## 🚀 Deploy to Cloudflare

### ✨ What happens automatically
| Setting | Type | Set up how |
|---|---|---|
| `GEMINI_MODEL` = `gemini-flash-latest` | Text | ✅ Automatic, from `wrangler.jsonc` |
| `GEMINI_TTS_MODEL`, `TTS_SPEAKER`, `GEMINI_IMAGE_MODEL` | Text | ✅ Automatic, from `wrangler.jsonc` |
| `GEMINI_API_KEY` (or **any** provider key) | **Secret** | ✅ The Deploy button asks for it, **or** `npm run deploy` promotes it from your Build variables, **or** the app asks for it on first open |

### 1) Deploy the app (pick one)

**A. One-tap button (easiest):** tap **Deploy to Cloudflare** above. Paste a key from **any** company and tap **Deploy**. Cloudflare saves it as an encrypted **Secret**.

**B. Connect this repo (works on a phone):**
1. **dash.cloudflare.com → Workers & Pages → Create → Import a repository**
2. Choose **Goro888/alix**, branch **main**. Leave **Build command** empty. **Deploy command:** `npm run deploy`
3. Under **Build → Variables and secrets**, add your key(s) as **Secret** (e.g. `GEMINI_API_KEY`, `OPENAI_API_KEY`…)
4. Tap **Deploy** — the deploy script saves every recognised key as a runtime **Secret**, even if you pasted it into a differently-named box.

**C. From a computer:** `npm install && npx wrangler login && npm run deploy`

### 2) Add keys (any mix of these, all optional)
- **In the app (easiest):** open it → **Settings ⚙️ → AI keys & models → ＋ Add an API key**. The company is detected from the key; tap **Change ▾** to pick a model. Keys are saved **only on that phone**.
- **On Cloudflare (shared across devices):** Worker → **Settings → Variables and Secrets → + Add** → Type **Secret**, name e.g. `GEMINI_API_KEY` → **Deploy** (computer: `npx wrangler secret put GEMINI_API_KEY`).
- **Priority:** Cloudflare secrets first, then the phone's keys top to bottom.

> ⚠️ Never paste keys into `wrangler.jsonc` or any file in this repo — it's public and bots steal keys within minutes.
> A key saved in the app stays on that phone. A key saved on Cloudflare is shared — add an `ACCESS_CODE` secret to lock the app.

### 3) Put it on your phone
Open `https://legend-boy.<your-name>.workers.dev`
- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ → **Install app**

### Optional secrets / vars
| Name | Why |
|---|---|
| `ACCESS_CODE` | Password-locks the app so strangers can't use your quota |
| `GEMINI_MODEL` | Default Gemini model (`gemini-flash-latest` = always the newest Flash) |
| `GEMINI_TTS_MODEL`, `TTS_SPEAKER` | HD voice model + default voice |
| `GEMINI_IMAGE_MODEL` | Image model for Create image |
| `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GROQ_MODEL`, `OPENROUTER_MODEL`, `DEEPSEEK_MODEL`, `XAI_MODEL`, `MISTRAL_MODEL`, `PERPLEXITY_MODEL`, `TOGETHER_MODEL`, `CEREBRAS_MODEL`, `HUGGINGFACE_MODEL`, `FIREWORKS_MODEL` | Default model for each provider (overridable per key in the app) |

**Cost:** Cloudflare Workers hosting is free (100k requests/day). Most providers have free or cheap tiers — Gemini's is generous. If you hit a limit, the next key answers automatically.

---

## 🖼️ Use your own photo for Legend Boy
1. **In the app:** Settings ⚙️ → *Legend Boy's photo* → **Change photo** (stored on your phone).
2. **For everyone:** replace `public/img/legend-boy.jpg` with your photo (square, ~640×640); optionally replace the `icon-*.png` files next to it.

---

## 🧪 Local development
```bash
npm install
npm run dev:demo   # demo mode: fake AI answers, no key needed
# real AI locally: copy .dev.vars.example to .dev.vars, paste any provider key (git-ignored), then:
npm run dev
# backend tests (fake provider APIs, no key needed): 77 checks
node scripts/test-multi.mjs
# "open an app" commands, text + voice + Kurdish + phone numbers: 71 checks
node scripts/test-open.mjs
```

## Project structure
```
wrangler.jsonc          Cloudflare config (assets + model default vars)
wrangler.demo.jsonc     Local demo config (fake AI)
src/providers.js        Multi-provider engine: 14 companies, key detection, failover chain, 3 API styles
src/worker.js           API routes: /api/chat, /api/research, /api/transcribe, /api/tts,
                        /api/extract (incl. built-in PDF reader), /api/imagine, /api/verify, /api/models, /api/health
scripts/deploy.mjs      `npm run deploy` — promotes any provider key from Build variables to Secrets
scripts/test-multi.mjs  Backend test suite (fake Gemini/OpenAI/Anthropic APIs)
scripts/test-open.mjs   App-open tests (English/Arabic/Kurdish, voice, 964 numbers)
public/                 The phone app (no build step)
  index.html            Screens: splash, chat, talk, camera, files, research, settings + key/model/switcher sheets
  css/app.css           Mobile-first dark UI with safe-area support
  js/app.js             App logic (keys, models, quick switcher, streaming chat…)
  js/api.js, store.js   API client (x-ai-keys header) + local storage
  js/voice.js           Mic recording + auto-stop on silence + voice playback queue
  js/social.js          App deep links + "open <app>" parser (text, voice, Arabic, Kurdish)
  js/camera.js, markdown.js, media.js
  sw.js, manifest.webmanifest   Installable PWA
  img/                  Legend Boy photo + app icons
```
