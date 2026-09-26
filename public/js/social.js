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
const digits = (p = "") => String(p).replace(/[^\d]/g, "");
// للاتصال نسمح بـ + في البداية
const dialable = (p = "") => String(p).trim().replace(/(?!^\+)[^\d]/g, "");
// أسماء المستخدمين بدون @ أو مسافات
const handle = (u = "") => String(u).trim().replace(/^@+/, "").replace(/\s+/g, "");

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
    window.location.href = `tel:${dialable(phone)}`;
  },

  sms: (phone, text = "") => {
    window.location.href = `sms:${dialable(phone)}${text ? `&body=${enc(text)}` : ""}`;
  },

  whatsapp: (phone, text = "") => {
    // يفتح واتساب ويضع الرقم ورسالتك الجاهزة في خانة الكتابة تلقائياً
    const q = text ? `?text=${enc(text)}` : "";
    window.location.href = `https://wa.me/${digits(phone)}${q}`;
  },

  telegram: (usernameOrPhone, text = "") => {
    // يفتح تليجرام مع رسالة جاهزة (إن توفرت) أو يفتح المحادثة مباشرة
    const to = handle(usernameOrPhone);
    const isPhone = /^\+?\d[\d\s-]{5,}$/.test(String(usernameOrPhone).trim());
    if (isPhone) {
      const p = digits(usernameOrPhone);
      launch(`tg://resolve?phone=${p}${text ? `&text=${enc(text)}` : ""}`, `https://t.me/+${p}`);
    } else if (text) {
      launch(`tg://resolve?domain=${to}&text=${enc(text)}`, `https://t.me/${to}?text=${enc(text)}`);
    } else {
      launch(`tg://resolve?domain=${to}`, `https://t.me/${to}`);
    }
  },

  signal: (phone) => {
    // سيجنال لا يدعم تعبئة نص الرسالة من الرابط
    window.location.href = `https://signal.me/#p/+${digits(phone)}`;
  },

  viber: (phone, text = "") => {
    const p = digits(phone);
    const url = text ? `viber://forward?text=${enc(text)}` : `viber://chat?number=%2B${p}`;
    launch(url, "https://www.viber.com/download/");
  },

  messenger: (username) => {
    const u = handle(username);
    launch(`fb-messenger://user-thread/${u}`, `https://m.me/${u}`);
  },

  // ---------- منصات الفيديوهات والمحتوى ----------
  instagram: (username) => {
    const u = handle(username);
    launch(`instagram://user?username=${u}`, `https://www.instagram.com/${u}/`);
  },

  tiktok: (username) => {
    // رابط تيك توك العام يفتح التطبيق تلقائياً على الآيفون (Universal Link)
    window.location.href = `https://www.tiktok.com/@${handle(username)}`;
  },

  youtube: (searchQuery) => {
    // إذا أعطيته نصاً، سيبحث عنه داخل تطبيق يوتيوب مباشرة
    const q = enc(searchQuery);
    launch(`youtube://results?search_query=${q}`, `https://www.youtube.com/results?search_query=${q}`);
  },

  snapchat: (username) => {
    const u = handle(username);
    launch(`snapchat://add/${u}`, `https://www.snapchat.com/add/${u}`);
  },

  facebook: (profileId) => {
    const id = handle(profileId);
    const scheme = /^\d+$/.test(id) ? `fb://profile/${id}` : `fb://profile?id=${id}`;
    launch(scheme, `https://www.facebook.com/${id}`);
  },

  twitter: (username) => {
    const u = handle(username);
    launch(`twitter://user?screen_name=${u}`, `https://x.com/${u}`);
  },

  x: (username) => SocialApps.twitter(username),

  reddit: (username) => {
    const u = handle(username).replace(/^u\//i, "");
    launch(`reddit:///user/${u}`, `https://www.reddit.com/user/${u}`);
  },

  pinterest: (username) => {
    const u = handle(username);
    launch(`pinterest://user/${u}/`, `https://www.pinterest.com/${u}/`);
  },

  linkedin: (profileId) => {
    const id = handle(profileId);
    launch(`linkedin://in/${id}`, `https://www.linkedin.com/in/${id}`);
  },

  // ---------- متصفح وبحث احتياطي في جوجل ----------
  search: (query) => {
    window.location.href = `https://www.google.com/search?q=${enc(query)}`;
  },
};

// أسماء بديلة (عربي / اختصارات)
const ALIASES = {
  phone: "call", tel: "call", اتصال: "call", اتصل: "call",
  wa: "whatsapp", واتساب: "whatsapp", واتس: "whatsapp",
  tg: "telegram", تليجرام: "telegram", تلغرام: "telegram", تيليجرام: "telegram",
  سيجنال: "signal", فايبر: "viber", ماسنجر: "messenger", messages: "sms", رسالة: "sms",
  ig: "instagram", insta: "instagram", انستغرام: "instagram", انستا: "instagram", انستقرام: "instagram",
  تيك: "tiktok", تيكتوك: "tiktok", yt: "youtube", يوتيوب: "youtube",
  snap: "snapchat", سناب: "snapchat", سنابشات: "snapchat",
  fb: "facebook", فيسبوك: "facebook", فيس: "facebook", تويتر: "twitter",
  ريديت: "reddit", بنترست: "pinterest", لينكدان: "linkedin", لينكد: "linkedin",
  google: "search", جوجل: "search", قوقل: "search", بحث: "search",
};

export function resolveApp(name = "") {
  const app = String(name).toLowerCase().trim();
  if (Object.hasOwn(SocialApps, app)) return app;
  return ALIASES[app] || "";
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
 * Parse a chat command like:
 *   /open whatsapp +9647701234567 hello there
 *   /افتح واتساب 07701234567 مرحبا
 *   /open youtube funny cats
 * Returns true if handled.
 */
export function runOpenCommand(text = "") {
  const m = String(text).trim().match(/^\/(?:open|افتح)\s+(\S+)\s*([\s\S]*)$/i);
  if (!m) return false;
  const [, name, rest] = m;
  const app = resolveApp(name);
  // تطبيقات يكون فيها كامل النص هو الهدف (بحث)
  if (app === "youtube" || app === "search") {
    openAppCommand(app, rest.trim());
    return true;
  }
  if (!app) {
    openAnyApp(name);
    return true;
  }
  // الهدف: رقم هاتف (قد يحتوي مسافات) أو اسم مستخدم، والباقي هو الرسالة
  const phone = rest.match(/^\+?\d[\d\s-]{5,}\d/);
  const target = phone ? phone[0] : (rest.match(/^\S+/) || [""])[0];
  const msg = rest.slice(target.length).trim();
  openAppCommand(app, target.trim(), msg);
  return true;
}

// متاح أيضاً من الكونسول أو أي سكربت آخر
if (typeof window !== "undefined") {
  Object.assign(window, { SocialApps, openAppCommand, openAnyApp });
}
