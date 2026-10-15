/* EmlakSoft PWA: privacy-bounded offline shell and push notifications. */
const VERSION = "v7";
// v6 is a one-time privacy migration. It must take control immediately so any
// legacy v4 worker/cache stops serving previously cached authenticated HTML.
// Future versions can return to the normal waiting lifecycle by leaving this
// migration marker at v6.
const FORCE_ACTIVATE_VERSION = "v6";
const MANAGED_CACHE_PREFIX = "emlaksoft-";
const STATIC_CACHE = `emlaksoft-static-${VERSION}`;
const PAGE_CACHE = `emlaksoft-pages-${VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, PAGE_CACHE];

const OFFLINE_URL = "/offline.html";
const NOTIFICATION_ICON = "/brand/icon-192.png";
// Android durum çubuğu rozeti: tek renk (beyaz + saydam) PNG; SVG rozet desteklenmez.
const NOTIFICATION_BADGE = "/brand/badge-96.png";
const PRECACHE_STATIC = [OFFLINE_URL, "/manifest.webmanifest", "/icon.svg", NOTIFICATION_ICON, NOTIFICATION_BADGE];

/*
 * Web Share Target (manifest share_target → POST /app/paylas-al). Paylaşılan dosyalar sunucuya GİTMEZ: yalnız bu
 * cihazın Cache Storage'ında, paylaşım başına rastgele anahtarla geçici tutulur; /app/paylas-al sayfası okuyup işler
 * ve siler. Yönetilen sayfa önbelleklerinden ayrı ad (sürüm geçişinde silinmez), 24 saatte kendiliğinden temizlenir;
 * oturum (kullanıcı/ofis) değişince sayfa tarafı da temizler.
 */
const SHARE_CACHE = "es-share-inbox";
const SHARE_PATH = "/app/paylas-al";
const SHARE_TTL_MS = 24 * 3600 * 1000;
const SHARE_MAX_FILES = 10;
const SHARE_MAX_BYTES = 15 * 1024 * 1024;

/*
 * Page caching is fail-closed. New routes remain network-only until explicitly
 * reviewed here, so a future token/portal route cannot leak private HTML on a
 * shared device merely because somebody forgot to extend a deny-list.
 */
const CACHEABLE_PUBLIC_PAGES = new Set([
  "/",
  "/cerez-politikasi",
  "/gizlilik",
  "/iptal-iade",
  "/kullanim-sartlari",
  "/kvkk-aydinlatma",
  "/mesafeli-satis",
  "/on-bilgilendirme",
]);

const CACHEABLE_PUBLIC_ASSETS = new Set([
  OFFLINE_URL,
  NOTIFICATION_ICON,
  NOTIFICATION_BADGE,
  "/brand/shortcut-hizli.png",
  "/brand/shortcut-bugun.png",
  "/brand/shortcut-randevu.png",
  "/brand/shortcut-gorev.png",
  "/file.svg",
  "/globe.svg",
  "/icon.svg",
  "/listing-bosphorus-villa.webp",
  "/manifest.webmanifest",
  "/next.svg",
  "/vercel.svg",
  "/window.svg",
]);

function isCacheablePublicPage(pathname) {
  return CACHEABLE_PUBLIC_PAGES.has(pathname);
}

function isStaticAsset(pathname) {
  return pathname.startsWith("/_next/static/") || CACHEABLE_PUBLIC_ASSETS.has(pathname);
}

function responseMayBeCached(response, expectedKind) {
  if (!response.ok || response.type === "opaque") return false;
  const policy = (response.headers.get("Cache-Control") || "").toLowerCase();
  if (policy.includes("no-store") || policy.includes("private")) return false;
  const finalUrl = new URL(response.url || self.location.origin, self.location.origin);
  if (finalUrl.origin !== self.location.origin) return false;
  return expectedKind === "page"
    ? isCacheablePublicPage(finalUrl.pathname) && !finalUrl.search
    : isStaticAsset(finalUrl.pathname);
}

function safeNotificationHref(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/app";
  }
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) return "/app";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/app";
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .open(STATIC_CACHE)
        .then((cache) => Promise.allSettled(PRECACHE_STATIC.map((url) => cache.add(url)))),
      caches.open(PAGE_CACHE),
    ]).then(() => {
      if (VERSION === FORCE_ACTIVATE_VERSION) return self.skipWaiting();
      return undefined;
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith(MANAGED_CACHE_PREFIX) && !CURRENT_CACHES.includes(key),
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const PUSH_ACTIONS = new Set(["open", "call", "done", "snooze"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Yalnız rakam ve baştaki + (7–16 hane); aksi null. Sunucu tarafı aynı kuralı uygular (notification-topics.ts). */
function safeTel(value) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/[\s()-]/g, "");
  return /^\+?\d{7,16}$/.test(compact) ? compact : null;
}

function safeEntity(value) {
  if (!value || typeof value !== "object") return null;
  if (value.type !== "task" || typeof value.id !== "string" || !UUID_RE.test(value.id)) return null;
  return { type: "task", id: value.id };
}

function safeActions(value, entity, tel) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const a of value) {
    if (!a || typeof a !== "object" || !PUSH_ACTIONS.has(a.action)) continue;
    if ((a.action === "done" || a.action === "snooze") && !entity) continue;
    if (a.action === "call" && !tel) continue;
    out.push({ action: a.action, title: String(a.title || "").slice(0, 24) || "Aç" });
    if (out.length === 2) break;
  }
  return out;
}

self.addEventListener("push", (event) => {
  let payload = { title: "EmlakSoft", body: "Yeni bildirim", href: "/app" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    /* Invalid/non-JSON payload: use the safe defaults. */
  }
  const title = String(payload.title || "EmlakSoft").slice(0, 100);
  const body = String(payload.body || "Yeni bildirim").slice(0, 300);
  const href = safeNotificationHref(payload.href);
  const entity = safeEntity(payload.entity);
  const tel = safeTel(payload.tel);
  const tag = typeof payload.tag === "string" && payload.tag ? payload.tag.slice(0, 120) : undefined;
  const options = {
    body,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    lang: "tr",
    timestamp: Date.now(),
    data: { href, entity, tel },
    actions: safeActions(payload.actions, entity, tel),
    requireInteraction: payload.kind === "danger",
  };
  // Aynı kayda ait yeni bildirim öncekinin yerine geçer; yalnız açıkça istenirse yeniden titreştirir.
  if (tag) {
    options.tag = tag;
    options.renotify = payload.renotify === true;
  }
  const badge =
    self.navigator && "setAppBadge" in self.navigator
      ? self.navigator.setAppBadge().catch(() => undefined)
      : Promise.resolve();
  event.waitUntil(Promise.all([self.registration.showNotification(title, options), badge]));
});

function focusOrOpen(href) {
  const targetUrl = new URL(href, self.location.origin).href;
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const client of clients) {
      if (client.url === targetUrl && "focus" in client) return client.focus();
    }
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && "focus" in client && "navigate" in client) {
        return client.focus().then((c) => (c || client).navigate(targetUrl));
      }
    }
    return self.clients.openWindow(href);
  });
}

function clearBadgeIfEmpty() {
  if (!self.navigator || !("clearAppBadge" in self.navigator)) return Promise.resolve();
  return self.registration
    .getNotifications()
    .then((list) => (list.length === 0 ? self.navigator.clearAppBadge() : undefined))
    .catch(() => undefined);
}

/** "Tamamla" / "Yarına ertele": oturum çereziyle aynı kökenden POST; olmazsa kayıt tarayıcıda açılır. */
function runRecordAction(action, data, notification) {
  return fetch("/api/app/push-eylem", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-emlaksoft-push": "1" },
    body: JSON.stringify({ action, entity: data.entity }),
  })
    .then((res) => res.json().then((json) => ({ ok: res.ok && json && json.ok, json })))
    .then(({ ok, json }) => {
      if (!ok) return focusOrOpen(data.href);
      const message = typeof json.message === "string" ? json.message.slice(0, 120) : "İşlem tamamlandı";
      return self.registration.showNotification(message, {
        body: String(notification.body || "").slice(0, 300),
        icon: NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE,
        lang: "tr",
        tag: notification.tag || undefined,
        silent: true,
        data: { href: data.href },
      });
    })
    .catch(() => focusOrOpen(data.href));
}

self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  notification.close();
  const raw = notification.data || {};
  const data = { href: safeNotificationHref(raw.href), entity: safeEntity(raw.entity), tel: safeTel(raw.tel) };
  let work;
  if ((event.action === "done" || event.action === "snooze") && data.entity) {
    work = runRecordAction(event.action, data, notification);
  } else if (event.action === "call" && data.tel) {
    // tel: açılamazsa (bazı tarayıcılar openWindow'da yalnız http(s) kabul eder) kaydın kendisi açılır.
    work = self.clients.openWindow(`tel:${data.tel}`).catch(() => focusOrOpen(data.href));
  } else {
    work = focusOrOpen(data.href);
  }
  event.waitUntil(Promise.resolve(work).then(clearBadgeIfEmpty));
});

function purgeOldShares(cache) {
  return cache.keys().then((requests) =>
    Promise.all(
      requests.map((req) => {
        const m = /\/__share\/(\d+)-/.exec(new URL(req.url).pathname);
        if (m && Date.now() - Number(m[1]) > SHARE_TTL_MS) return cache.delete(req);
        return undefined;
      }),
    ),
  );
}

function handleShareTarget(request) {
  return request
    .formData()
    .then((form) => {
      const key = `${Date.now()}-${self.crypto.randomUUID()}`;
      const meta = {
        title: String(form.get("title") || "").slice(0, 300),
        text: String(form.get("text") || "").slice(0, 4000),
        url: String(form.get("url") || "").slice(0, 1000),
        files: [],
        at: Date.now(),
      };
      return caches.open(SHARE_CACHE).then((cache) => {
        const puts = [];
        const files = form.getAll("media").filter((f) => f && typeof f === "object" && "size" in f);
        for (const file of files.slice(0, SHARE_MAX_FILES)) {
          if (file.size > SHARE_MAX_BYTES) continue;
          const path = `/__share/${key}/${meta.files.length}`;
          meta.files.push({ path, name: String(file.name || "dosya").slice(0, 120), type: String(file.type || ""), size: file.size });
          puts.push(cache.put(path, new Response(file, { headers: { "content-type": file.type || "application/octet-stream" } })));
        }
        puts.push(cache.put(`/__share/${key}/meta`, new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } })));
        return Promise.all(puts)
          .then(() => purgeOldShares(cache))
          .then(() => Response.redirect(`${SHARE_PATH}?k=${encodeURIComponent(key)}`, 303));
      });
    })
    .catch(() => Response.redirect(`${SHARE_PATH}?hata=1`, 303));
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "PURGE_SHARES") event.waitUntil(caches.delete(SHARE_CACHE));
});

function cacheFirst(request) {
  return caches.match(request).then(
    (cached) =>
      cached ||
      fetch(request).then((response) => {
        if (responseMayBeCached(response, "asset")) {
          const clone = response.clone();
          void caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      }),
  );
}

function pageNetworkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (responseMayBeCached(response, "page")) {
        const clone = response.clone();
        void caches.open(PAGE_CACHE).then((cache) => cache.put(request, clone));
      }
      return response;
    })
    .catch(() =>
      caches
        .match(request)
        .then((cached) => cached || caches.match(OFFLINE_URL))
        .then((fallback) => fallback || Response.error()),
    );
}

function networkWithOfflineFallback(request) {
  return fetch(request).catch(() =>
    caches.match(OFFLINE_URL).then((fallback) => fallback || Response.error()),
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === SHARE_PATH) {
    event.respondWith(handleShareTarget(request));
    return;
  }
  if (request.method !== "GET") return;

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/giris")) return;

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    if (!isCacheablePublicPage(url.pathname) || url.search) {
      event.respondWith(networkWithOfflineFallback(request));
      return;
    }
    event.respondWith(pageNetworkFirst(request));
  }
  // RSC payloads and every other GET stay on the network and are never cached.
});
