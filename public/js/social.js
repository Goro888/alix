// ==========
// مكتبة الروابط الشاملة لتطبيقات السوشيال ميديا على الآيفون (مع دعم الرسائل والنصوص)
// Deep links for social / messaging apps on iPhone (with pre-filled messages).
//
// Each app is opened with its native URL scheme. If the app isn't installed
// (the page is still visible after a short wait), we fall back to the web /
// universal link so the user still lands somewhere useful.
// ==========

const enc = (s = "") => encodeURIComponent(String(s));
// أرقام فقط (واتساب وغيره يرفضون + والمسافات والشرطات)
const digits = (p = "") => toAsciiDigits(p).replace(/[^\d]/g, "");
// للاتصال نسمح بـ + في البداية
const dialable = (p = "") => toAsciiDigits(p).trim().replace(/(?!^\+)[^\d]/g, "");
// أسماء المستخدمين بدون @ أو مسافات
const handle = (u = "") => String(u).trim().replace(/^@+/, "").replace(/\s+/g, "");

/* ---------- تطبيع الأرقام والحروف (عربي / كردي) ---------- */
// ٠١٢٣٤٥٦٧٨٩ و ۰۱۲۳۴۵۶۷۸۹ ← 0123456789 (كثير من لوحات المفاتيح العربية تكتبها)
const ARABIC_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g;
function toAsciiDigits(s = "") {
  return String(s).replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) & 0xf));
}

// حروف فارسية/كردية ← العربية المكافئة، وحذف التشكيل والتطويل
// (يستعمل للمقارنة فقط، وليس للنص المُرسل)
function norm(s = "") {
  return toAsciiDigits(s)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640\u200c\u200d]/g, "") // تشكيل، تطويل، ZWNJ/ZWJ
    .replace(/[يیى]/g, "ي")
    .replace(/[كک]/g, "ك")
    .replace(/[گ]/g, "غ")
    .replace(/[أإآٱا]/g, "ا")
    .replace(/[ةۀەهھ]/g, "ه")
    .replace(/[ۆو]/g, "و")
    .replace(/[ڕر]/g, "ر")
    .replace(/[ڵل]/g, "ل")
    .replace(/[ڤف]/g, "ف")
    .replace(/[ؤئء]/g, "")
    .replace(/(.)\1+/g, "$1") // "فیسبووک"/"یووتیوب" → يسبوك / يوتيوب
    .trim();
}

// "الواتساب" · "والواتساب" → واتساب
const stripArticle = (k = "") => String(k).replace(/^و(?=ال)/, "").replace(/^ال/, "");

// رمز الدولة الافتراضي للعراق — يُضاف تلقائياً للأرقام المحلية 07…
export const DEFAULT_COUNTRY_CODE = "964";
const DEFAULT_CC = DEFAULT_COUNTRY_CODE;

/**
 * 07701234567 · ٠٧٧٠١٢٣٤٥٦٧ · 7701234567 · +964 770 123 4567 · 00964…
 * ← 9647701234567 (رقم دولي بلا + ، كما يطلبه واتساب)
 * الأرقام التي تبدأ بـ + أو برمز دولة آخر تبقى كما هي.
 */
export function intlNumber(phone = "", cc = DEFAULT_CC) {
  let p = digits(phone);
  if (!p) return "";
  if (/^00/.test(p)) p = p.slice(2);           // 00964… → 964…
  if (p.startsWith(cc)) return p;              // دولي أصلاً
  if (p.startsWith("0")) return cc + p.slice(1); // محلي: 0770… → 964770…
  if (p.length === 10 && p.startsWith("7")) return cc + p; // 770… (بلا صفر)
  return p;
}

/**
 * Open a URL scheme; if the app doesn't take over within `wait` ms,
 * go to `fallback` (web link / App Store) instead.
 */
export function launch(url, fallback = "", wait = 1500) {
  if (!fallback) {
    window.location.href = url;
    return;
  }
  let left = false;
  const onHide = () => {
    if (document.hidden) left = true;
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);
  const t = setTimeout(() => {
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onHide);
    // إذا بقيت الصفحة ظاهرة، فالتطبيق غير مثبت ← نفتح البديل
    if (!left && !document.hidden) window.location.href = fallback;
  }, wait);
  window.addEventListener("blur", () => clearTimeout(t), { once: true });
  window.location.href = url;
}

export const SocialApps = {
  // ---------- الاتصالات والمراسلة الفورية ----------
  call: (phone) => {
    // بدون رقم: يفتح تطبيق الاتصال. مع رقم محلي 0770… يضيف رمز الدولة تلقائياً
    const p = phone ? dialable(intlNumber(phone)) : "";
    window.location.href = p ? `tel:+${p}` : "tel:";
  },

  sms: (phone, text = "") => {
    const p = phone ? "+" + intlNumber(phone) : "";
    window.location.href = `sms:${p}${text ? `&body=${enc(text)}` : ""}`;
  },

  whatsapp: (phone, text = "") => {
    // بدون رقم: يفتح واتساب مباشرة. مع رقم: يضيف رمز الدولة للأرقام المحلية 0770…
    if (!phone) return window.location.href = "https://wa.me/";
    // يفتح واتساب ويضع الرقم ورسالتك الجاهزة في خانة الكتابة تلقائياً
    const q = text ? `?text=${enc(text)}` : "";
    window.location.href = `https://wa.me/${intlNumber(phone)}${q}`;
  },

  telegram: (usernameOrPhone, text = "") => {
    // بدون هدف: يفتح تليجرام. مع رقم: رقم دولي مع رسالة جاهزة (إن توفرت)
    const raw = String(usernameOrPhone ?? "").trim();
    if (!raw) return window.location.href = "https://t.me/";
    const to = handle(raw);
    const isPhone = /^\+?\d[\d\s-]{5,}$/.test(toAsciiDigits(raw));
    if (isPhone) {
      const p = intlNumber(raw);
      launch(`tg://resolve?phone=${p}${text ? `&text=${enc(text)}` : ""}`, `https://t.me/+${p}`);
    } else if (text) {
      launch(`tg://resolve?domain=${to}&text=${enc(text)}`, `https://t.me/${to}?text=${enc(text)}`);
    } else {
      launch(`tg://resolve?domain=${to}`, `https://t.me/${to}`);
    }
  },

  signal: (phone) => {
    // سيجنال لا يدعم تعبئة نص الرسالة من الرابط
    window.location.href = phone ? `https://signal.me/#p/+${intlNumber(phone)}` : "https://signal.org/download/";
  },

  viber: (phone, text = "") => {
    const p = intlNumber(phone);
    const url = text ? `viber://forward?text=${enc(text)}` : `viber://chat?number=%2B${p}`;
    launch(url, "https://www.viber.com/download/");
  },

  messenger: (username) => {
    const u = handle(username);
    if (!u) return window.location.href = "https://www.messenger.com/";
    launch(`fb-messenger://user-thread/${u}`, `https://m.me/${u}`);
  },

  // ---------- منصات الفيديوهات والمحتوى ----------
  instagram: (username) => {
    const u = handle(username);
    if (!u) return window.location.href = "https://www.instagram.com/";
    launch(`instagram://user?username=${u}`, `https://www.instagram.com/${u}/`);
  },

  tiktok: (username) => {
    const u = handle(username);
    // رابط تيك توك العام يفتح التطبيق تلقائياً على الآيفون (Universal Link)
    window.location.href = u ? `https://www.tiktok.com/@${u}` : "https://www.tiktok.com/";
  },

  youtube: (searchQuery) => {
    // بدون نص: يفتح يوتيوب. مع نص: يبحث عنه داخل تطبيق يوتيوب مباشرة
    const q = enc(searchQuery);
    if (!String(searchQuery ?? "").trim()) return window.location.href = "https://www.youtube.com/";
    launch(`youtube://results?search_query=${q}`, `https://www.youtube.com/results?search_query=${q}`);
  },

  snapchat: (username) => {
    const u = handle(username);
    if (!u) return window.location.href = "https://www.snapchat.com/";
    launch(`snapchat://add/${u}`, `https://www.snapchat.com/add/${u}`);
  },

  facebook: (profileId) => {
    const id = handle(profileId);
    if (!id) return window.location.href = "https://www.facebook.com/";
    const scheme = /^\d+$/.test(id) ? `fb://profile/${id}` : `fb://profile?id=${id}`;
    launch(scheme, `https://www.facebook.com/${id}`);
  },

  twitter: (username) => {
    const u = handle(username);
    if (!u) return window.location.href = "https://x.com/";
    launch(`twitter://user?screen_name=${u}`, `https://x.com/${u}`);
  },

  x: (username) => SocialApps.twitter(username),

  reddit: (username) => {
    const u = handle(username).replace(/^u\//i, "");
    if (!u) return window.location.href = "https://www.reddit.com/";
    launch(`reddit:///user/${u}`, `https://www.reddit.com/user/${u}`);
  },

  pinterest: (username) => {
    const u = handle(username);
    if (!u) return window.location.href = "https://www.pinterest.com/";
    launch(`pinterest://user/${u}/`, `https://www.pinterest.com/${u}/`);
  },

  linkedin: (profileId) => {
    const id = handle(profileId);
    if (!id) return window.location.href = "https://www.linkedin.com/";
    launch(`linkedin://in/${id}`, `https://www.linkedin.com/in/${id}`);
  },

  // ---------- متصفح وبحث احتياطي في جوجل ----------
  search: (query) => {
    const q = String(query ?? "").trim();
    window.location.href = q ? `https://www.google.com/search?q=${enc(q)}` : "https://www.google.com/";
  },
};

// أسماء بديلة (عربي / كردي / اختصارات) — تُطبَّع بـ norm() عند البحث
const ALIASES = {
  phone: "call", tel: "call", call: "call", اتصال: "call", اتصل: "call", هاتف: "call", تلفون: "call", تلفن: "call", مكالمه: "call",
  wa: "whatsapp", whatsap: "whatsapp", whats: "whatsapp", واتساب: "whatsapp", واتس: "whatsapp", وتساب: "whatsapp", واتساپ: "whatsapp", واتزاب: "whatsapp",
  واتسئاپ: "whatsapp", واتساپه: "whatsapp", واٹساپ: "whatsapp",
  tg: "telegram", تليجرام: "telegram", تلغرام: "telegram", تيليجرام: "telegram", تلجرام: "telegram", تليكرام: "telegram", تليغرام: "telegram", تلغرامه: "telegram",
  تەلەگرام: "telegram", تەلگرام: "telegram", تيليگرام: "telegram",
  سيجنال: "signal", signal: "signal", فايبر: "viber", viber: "viber",
  ماسنجر: "messenger", messenger: "messenger", فيسمسنجر: "messenger",
  messages: "sms", رسالة: "sms", رسايل: "sms", مسجات: "sms", sms: "sms",
  ig: "instagram", insta: "instagram", instgram: "instagram", انستغرام: "instagram", انستا: "instagram", انستقرام: "instagram", انستگرام: "instagram", انستاگرام: "instagram", انستەگرام: "instagram", ئینستاگرام: "instagram", ئینستەگرام: "instagram", انستە: "instagram",
  تيك: "tiktok", تيكتوك: "tiktok", تكتوك: "tiktok", tik: "tiktok", tiktok: "tiktok",
  yt: "youtube", يوتيوب: "youtube", يوتوب: "youtube", youtube: "youtube", یوتیوب: "youtube",
  snap: "snapchat", سناب: "snapchat", سنابشات: "snapchat", snapchat: "snapchat",
  fb: "facebook", فيسبوك: "facebook", فيس: "facebook", facebook: "facebook", فیسبوک: "facebook", فەیسبوک: "facebook", فەیسبووک: "facebook",
  تويتر: "twitter", twitter: "twitter", منصةاكس: "twitter",
  ريديت: "reddit", reddit: "reddit", بنترست: "pinterest", pinterest: "pinterest",
  لينكدان: "linkedin", لينكد: "linkedin", linkedin: "linkedin", لينكداين: "linkedin",
  google: "search", جوجل: "search", قوقل: "search", غوغل: "search", بحث: "search", search: "search",
};

// بعض الأسماء تُطبَّع إلى كلمة أخرى (فيسبوك، يوتيوب…)
const ALIAS_KEYS = Object.fromEntries(Object.keys(ALIASES).map((k) => [norm(k), k]));

// ---------- أفعال الفتح: إنجليزي · عربي · كردي ----------
// كردي (الفعل في النهاية عادةً): ڤەکە · بکەرەوە · بکەوە · بکەنەوە · کرەوە · کردنەوە · بکه
const KURDISH_VERBS = [
  "ڤەکە", "فهکه", "فه‌که", "بکه", "بکه‌", "بکە",
  "بکەرەوە", "بکەره‌وه", "بکه‌ره‌وه", "بکەوە", "بکه‌وه",
  "بکەنەوە", "بکه‌نه‌وه", "بکهنهوه",
  "کرەوە", "کردنەوە", "کردنه‌وه",
];
const KURDISH_SET = new Set(KURDISH_VERBS.map(norm));
// التطبيع يحذف التشكيل والزخارف، فالكتابة قد تختلف قليلاً — نقبل أيضاً الكلمة المنتهية بالفعل
const isKurdishVerb = (n = "") => KURDISH_SET.has(n) || [...KURDISH_SET].some((v) => v.length >= 3 && n.endsWith(v));

// عربي/إنجليزي: الفعل في البداية — open · افتح · شغل · فتح
const OPEN_VERBS = new Set(
  ["open", "launch", "start", "run",
   "افتح", "افتحلي", "افتحلى", "فتح", "شغل", "شغلي", "شغلى", "ابدا", "ابدأ", "هيا",
   "فكه", "فك", "دخل", "ادخل", "سير", "روح"].map(norm)
);

// أفعال هي نفسها تطبيق: "اتصل 0770…" · "بحث اغاني كردية"
const SEARCH_VERBS = ["بحث", "ابحث", "بحثلي", "ابحثلي", "search", "google", "جوجل", "قوقل", "غوغل", "گهڕان"];
const CALL_VERBS = ["اتصل", "اتصلي", "اتصال", "رن", "كلم", "كلمي", "call", "هاتف", "تلفون", "تلفن", "پهیوەندی"];
const VERB_APPS = {};
for (const v of SEARCH_VERBS) VERB_APPS[norm(v)] = "search";
for (const v of CALL_VERBS) VERB_APPS[norm(v)] = "call";
for (const v of SEARCH_VERBS.concat(CALL_VERBS)) OPEN_VERBS.add(norm(v));

/** هل هذه الكلمة فعل فتح؟ (الفعل الكردي في النهاية أو البداية) */
const isOpenVerb = (w = "") => {
  const n = norm(w);
  return OPEN_VERBS.has(n) || isKurdishVerb(n);
};

/**
 * هل النص أمر "افتح تطبيق"؟
 * يقبل:
 *   /open whatsapp   ·   open whatsapp   ·   افتح واتساب
 *   واتساب بکەرەوە   ·   یوتیوب ڤەکە
 * ولا يقبل جملة عادية مثل "open the file" أو "افتح لي الملف".
 */
export function parseOpenCommand(text = "") {
  // إزالة علامات الاتجاه غير المرئية داخل النص (يضيفها النسخ واللصق وSTT)
  let raw = String(text ?? "").replace(/[\u200e\u200f\u061c]/g, " ").replace(/^\s+/, "");
  const explicit = raw.match(/^\/(?:open|افتح|ڤەکە)\s+([\s\S]+)$/i); // الأمر القديم بالسلاش
  if (explicit) {
    // "/open whatsapp 0770… مرحبا" — الاسم بعد السلاش مباشرة
    const words = explicit[1].trim().split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    return { app: resolveApp(words[0]), target: words.slice(1).join(" ").trim(), name: clearPrefix(words[0]) };
  }
  raw = raw.trim();
  if (!raw) return null;

  const words = raw.split(/\s+/);

  // كردي: الفعل في النهاية — "واتساب بکەرەوە" / "یوتیوب ڤەکە" أو مع رقم/رسالة بعده
  for (let i = words.length - 1; i >= 1; i--) {
    if (!isOpenVerb(words[i])) continue;
    const app = resolveApp(words[i - 1]);
    if (!app) continue;
    return { app, target: words.slice(i + 1).join(" ").trim(), name: words[i - 1] };
  }

  // عربي/إنجليزي (وكردي مقلوب): الفعل في البداية
  if (!isOpenVerb(words[0])) return null;

  // الفعل نفسه تطبيق: "اتصل 07701234567" · "بحث اغاني كردية"
  const verbApp = VERB_APPS[norm(words[0])];
  if (verbApp && !resolveApp(words[1] || "")) {
    return { app: verbApp, target: words.slice(1).join(" ").trim(), name: words[0] };
  }

  // ابحث عن أول كلمة معروفة كتطبيق (تتخطى "لي / فتح / على / the")
  const skip = new Set(["لي", "لى", "ال", "على", "علا", "the", "my", "app", "تطبيق"].map(norm));
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    const app = resolveApp(w);
    if (app) return { app, target: words.slice(i + 1).join(" ").trim(), name: clearPrefix(w) };
    // جملة عادية: "open the file" / "افتح لي الملف" → ليست أمر تطبيق
    if (skip.has(norm(w))) continue;
    return null;
  }
  return null;
}

/** إزالة "ال" التعريف من أول الكلمة لعرضها في التوست (الواتساب → واتساب) */
function clearPrefix(w = "") {
  const s = String(w).trim();
  const out = s.replace(/^(?:و?(?=ال))/, "").replace(/^ال/, "");
  return out.length > 1 ? out : s;
}

/** اسم تطبيق مكتوب بأي شكل (عربي/كردي/إنجليزي، مع "ال") ← اسم داخلي، أو "" */
export function resolveApp(name = "") {
  const key = norm(name);
  if (!key) return "";
  if (Object.hasOwn(SocialApps, key)) return key;
  const direct = ALIASES[key] || ALIASES[ALIAS_KEYS[key]];
  if (direct) return direct;
  // "الواتساب" / "واليوتيوب"
  const stripped = stripArticle(key);
  if (stripped !== key) {
    if (Object.hasOwn(SocialApps, stripped)) return stripped;
    return ALIASES[stripped] || ALIASES[ALIAS_KEYS[stripped]] || "";
  }
  return "";
}

// ==========
// دالة التشغيل الذكية الموحدة (كاملة)
// ==========
export function openAppCommand(appName, target = "", extraText = "") {
  const app = resolveApp(appName);
  if (app) {
    // تمرير الهدف (رقم أو اسم مستخدم) مع النص الإضافي (إن وجد)
    SocialApps[app](target, extraText);
    return true;
  }
  const name = String(appName ?? "").trim();
  console.log(`التطبيق "${name}" غير مدعوم، جاري البحث في الويب...`);
  SocialApps.search(`${name} ${target}`.trim());
  return false;
}

// ==========
// دالة لفتح أي تطبيق عام على الآيفون
// ==========
export function openAnyApp(appName, customScheme = "", storeSearchQuery = "") {
  const app = String(appName ?? "").toLowerCase().trim();

  // إذا كان له مخطط معروف، نفتحه فوراً
  if (customScheme) {
    window.location.href = customScheme;
    return;
  }

  // محاولة فتح التطبيق عبر تخمين الـ URL Scheme الخاص به (مثل appname://)
  const guessedScheme = `${app.replace(/[^a-z0-9.+-]/g, "")}://`;
  // إذا لم يفتح التطبيق (غير مثبت أو المخطط مختلف) نبحث عنه في متجر التطبيقات
  const term = enc(storeSearchQuery || appName);
  console.log(`جارٍ التحقق من فتح تطبيق: ${app}`);
  launch(guessedScheme, `https://apps.apple.com/search?term=${term}`, 1200);
}

/**
 * ينفّذ أمر فتح تطبيق من نص حر (كتابة أو كلام).
 * يقبل: open whatsapp · افتح واتساب · واتساب بکەرەوە · /open whatsapp 07701234567 مرحبا
 * يرجع true إذا فتح تطبيقاً (فتُعالج الرسالة محلياً ولا تُرسل للذكاء الاصطناعي).
 */
export function runOpenCommand(text = "") {
  const cmd = parseOpenCommand(text);
  if (!cmd) return false;
  const { app, target, name } = cmd;

  // بدون تطبيق معروف: نفتح أي تطبيق (مخطط مخمّن) أو نبحث في الويب
  if (!app) {
    openAnyApp(name);
    return true;
  }

  // يوتيوب وجوجل: كل النص الباقي هو كلمة البحث
  if (app === "youtube" || app === "search") {
    openAppCommand(app, target);
    return true;
  }

  // الهدف: رقم هاتف (قد يحتوي مسافات أو أرقاماً عربية) أو اسم مستخدم، والباقي هو الرسالة
  const ascii = toAsciiDigits(target);
  const phone = ascii.match(/^\+?\d[\d\s-]{5,}\d/);
  const first = phone ? phone[0] : (target.match(/^\S+/) || [""])[0];
  const msg = target.slice(first.length).trim();
  openAppCommand(app, first.trim(), msg);
  return true;
}

/** اسم التطبيق بالعربي للعرض في التوست */
const DISPLAY = {
  call: "Phone", sms: "Messages", whatsapp: "WhatsApp", telegram: "Telegram", signal: "Signal",
  viber: "Viber", messenger: "Messenger", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube",
  snapchat: "Snapchat", facebook: "Facebook", twitter: "X", reddit: "Reddit", pinterest: "Pinterest",
  linkedin: "LinkedIn", search: "Google",
};
export const appLabel = (app = "") => DISPLAY[app] || app || "App";

// متاح أيضاً من الكونسول أو أي سكربت آخر
if (typeof window !== "undefined") {
  Object.assign(window, { SocialApps, openAppCommand, openAnyApp, runOpenCommand, resolveApp, parseOpenCommand });
}
