#!/usr/bin/env node
/**
 * Test suite for "open an app" commands (text, voice transcript, Arabic, Kurdish).
 *
 * Covers the three bugs reported from the phone:
 *   1. "open whatsapp" without a slash must not go to the AI
 *   2. spoken words ("open youtube", "واتساب بکەرەوە") must open the app
 *   3. local Iraqi numbers (0770…) must get the 964 country code for WhatsApp
 *
 * Run:  node scripts/test-open.mjs
 */

/* ------------------------------------------------------------- */
/* Tiny harness                                                   */
/* ------------------------------------------------------------- */
let passed = 0, failed = 0;
const failures = [];
function ok(cond, name, extra = "") {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}
function eq(actual, expected, name) {
  ok(actual === expected, name, `→ got ${JSON.stringify(actual)}, wanted ${JSON.stringify(expected)}`);
}
function section(t) { console.log(`\n${t}`); }

/* ------------------------------------------------------------- */
/* Fake browser (the module touches window/document when opening)  */
/* ------------------------------------------------------------- */
const opened = [];
globalThis.window = {
  location: {
    set href(url) { opened.push(String(url)); },
    get href() { return opened[opened.length - 1] ?? ""; },
  },
  addEventListener() {},
};
globalThis.document = { hidden: true, addEventListener() {} };

const { parseOpenCommand, resolveApp, runOpenCommand, intlNumber, appLabel, DEFAULT_COUNTRY_CODE } =
  await import("../public/js/social.js");

/* ------------------------------------------------------------- */
/* 1) What counts as an "open app" command                        */
/* ------------------------------------------------------------- */
section("1) Recognising the command (text, no slash needed)");
{
  const cases = [
    // [input, expected app, expected target]
    ["open whatsapp", "whatsapp", ""],
    ["Open WhatsApp", "whatsapp", ""],
    ["open whatsapp 07701234567 hi", "whatsapp", "07701234567 hi"],
    ["open whatsapp +9647701234567 hello there", "whatsapp", "+9647701234567 hello there"],
    ["/open whatsapp +9647701234567 hello", "whatsapp", "+9647701234567 hello"],
    ["open youtube", "youtube", ""],
    ["open youtube funny cats", "youtube", "funny cats"],
    ["open instagram legend.boy", "instagram", "legend.boy"],
    ["open ig legend.boy", "instagram", "legend.boy"],
    ["open call 07701234567", "call", "07701234567"],
    ["open telegram @legendboy hi", "telegram", "@legendboy hi"],
    // Arabic
    ["افتح واتساب", "whatsapp", ""],
    ["افتح واتساب ٠٧٧٠١٢٣٤٥٦٧ مرحبا", "whatsapp", "٠٧٧٠١٢٣٤٥٦٧ مرحبا"],
    ["افتح لي الواتساب 07701234567 مرحبا", "whatsapp", "07701234567 مرحبا"],
    ["افتح اليوتيوب اغاني كردية", "youtube", "اغاني كردية"],
    ["شغل يوتيوب", "youtube", ""],
    ["فتح انستقرام", "instagram", ""],
    ["افتح رسالة 07701234567 مرحبا", "sms", "07701234567 مرحبا"],
    ["/افتح يوتيوب اغاني", "youtube", "اغاني"],
    ["افتح فيسبوك", "facebook", ""],
    ["اتصل 07701234567", "call", "07701234567"],
    // Kurdish (verb after the app name)
    ["واتساب بکەرەوە", "whatsapp", ""],
    ["واتساب بکەرەوە 07701234567 سلام", "whatsapp", "07701234567 سلام"],
    ["یوتیوب ڤەکە", "youtube", ""],
    ["یوتیوب ڤەکە گۆرانی کوردی", "youtube", "گۆرانی کوردی"],
    ["انستاگرام بکەوە", "instagram", ""],
    ["تەلەگرام بکەرەوە", "telegram", ""],
    ["فیسبووک بکە", "facebook", ""],
    ["واتساپ ڤەکە", "whatsapp", ""],
  ];
  for (const [text, app, target] of cases) {
    const cmd = parseOpenCommand(text);
    ok(!!cmd && cmd.app === app && cmd.target === target, `"${text}" → ${app}`, cmd ? `→ got ${cmd.app} / ${JSON.stringify(cmd.target)}` : "→ not recognised");
  }
}

section("2) Normal sentences keep going to the AI");
{
  const notCommands = [
    "open the file",
    "افتح لي الملف",
    "افتح الملف المرفق",
    "whatsapp",
    "i want to open youtube on my phone",
    "hello how are you",
    "كيف حالك",
    "یوتیوب چییە",
    "لا تفتح الباب",
    "send a message to my friend",
  ];
  for (const text of notCommands) {
    const cmd = parseOpenCommand(text);
    ok(cmd === null, `"${text}" → goes to the AI`, cmd ? `→ wrongly recognised as ${cmd.app}` : "");
  }
}

section("3) App names in every spelling");
{
  eq(resolveApp("الواتساب"), "whatsapp", "الواتساب → whatsapp");
  eq(resolveApp("یوتیوب"), "youtube", "یوتیوب (Kurdish yeh) → youtube");
  eq(resolveApp("يوتوب"), "youtube", "يوتوب → youtube");
  eq(resolveApp("واتساپ"), "whatsapp", "واتساپ → whatsapp");
  eq(resolveApp("تليكرام"), "telegram", "تليكرام → telegram");
  eq(resolveApp("انستەگرام"), "instagram", "انستەگرام → instagram");
  eq(resolveApp("تكتوك"), "tiktok", "تكتوك → tiktok");
  eq(resolveApp("فيسبوك"), "facebook", "فيسبوك → facebook");
  eq(resolveApp("قوقل"), "search", "قوقل → search");
  eq(resolveApp("YouTube"), "youtube", "YouTube (mixed case) → youtube");
  eq(resolveApp("نص عادي"), "", "unknown word → \"\"");
}

/* ------------------------------------------------------------- */
/* 4) Country code for local numbers                              */
/* ------------------------------------------------------------- */
section("4) Local numbers get the country code (WhatsApp)");
{
  eq(DEFAULT_COUNTRY_CODE, "964", "default country code is 964 (Iraq)");
  eq(intlNumber("07701234567"), "9647701234567", "07701234567 → 9647701234567");
  eq(intlNumber("٠٧٧٠١٢٣٤٥٦٧"), "9647701234567", "Arabic digits → 9647701234567");
  eq(intlNumber("7701234567"), "9647701234567", "7701234567 → 9647701234567");
  eq(intlNumber("+964 770 123 4567"), "9647701234567", "+964 770 123 4567 → 9647701234567");
  eq(intlNumber("009647701234567"), "9647701234567", "00964… → 964…");
  eq(intlNumber("9647701234567"), "9647701234567", "already international → unchanged");
  eq(intlNumber("07801234567"), "9647801234567", "0780… → 9647801234567");
}

/* ------------------------------------------------------------- */
/* 5) The links actually produced                                 */
/* ------------------------------------------------------------- */
section("5) Tap → the right link opens");
{
  const open = (text) => { opened.length = 0; const handled = runOpenCommand(text); return { handled, url: opened[0] || "" }; };

  let r = open("open whatsapp 07701234567 hi");
  ok(r.handled, "open whatsapp 07701234567 hi → handled locally (never reaches the AI)");
  eq(r.url, "https://wa.me/9647701234567?text=hi", "…opens WhatsApp with 964 + your message");

  r = open("واتساب بکەرەوە");
  ok(r.handled, "واتساب بکەرەوە → handled locally");
  eq(r.url, "https://wa.me/", "…opens WhatsApp with no number");

  r = open("open youtube funny cats");
  eq(r.url, "youtube://results?search_query=funny%20cats", "open youtube funny cats → YouTube app search");

  r = open("افتح اليوتيوب اغاني كردية");
  eq(r.url, "youtube://results?search_query=%D8%A7%D8%BA%D8%A7%D9%86%D9%8A%20%D9%83%D8%B1%D8%AF%D9%8A%D8%A9", "افتح اليوتيوب اغاني كردية → YouTube search");

  r = open("open instagram legend.boy");
  eq(r.url, "instagram://user?username=legend.boy", "open instagram legend.boy → Instagram profile");

  r = open("open whatsapp");
  eq(r.url, "https://wa.me/", "open whatsapp → WhatsApp app");

  r = open("open call 07701234567");
  eq(r.url, "tel:+9647701234567", "open call 07701234567 → dials +9647701234567");

  r = open("open telegram @legendboy hi");
  eq(r.url, "tg://resolve?domain=legendboy&text=hi", "open telegram @legendboy hi → Telegram chat");

  r = open("افتح الفيسبوك");
  eq(r.url, "https://www.facebook.com/", "افتح الفيسبوك → Facebook");

  r = open("open the file");
  ok(!r.handled && !r.url, "open the file → not handled (goes to the AI)");

  eq(appLabel("whatsapp"), "WhatsApp", "appLabel gives a pretty name");
}

section("6) Odd input never crashes (empty, invisible marks, lone word)");
{
  for (const text of ["", "   ", "\n", null, undefined, "/open", "/open ", "افتح", "بکەرەوە", "واتساب", "ال"]) {
    let out;
    try { out = parseOpenCommand(text); } catch (e) { out = "THREW " + e.message; }
    ok(out === null, `parseOpenCommand(${JSON.stringify(text)}) → null`);
  }
  const rlm = parseOpenCommand("open \u200f whatsapp"); // علامة اتجاه غير مرئية من النسخ/STT
  ok(!!rlm && rlm.app === "whatsapp", "invisible direction mark inside the text is ignored");

  opened.length = 0;
  runOpenCommand("بحث");
  eq(opened[0], "https://www.google.com/", "lone \"بحث\" with nothing to search opens Google, not a blank query");
}

/* ------------------------------------------------------------- */
console.log(`\n${failed === 0 ? "🎉" : "⚠️ "} ${passed} passed, ${failed} failed`);
if (failures.length) console.log("Failed:\n" + failures.map((f) => "  · " + f).join("\n"));
process.exit(failed ? 1 : 0);
