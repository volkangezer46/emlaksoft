/* EmlakSoft PWA — sürümlü cache, offline fallback, push bildirimleri */
const VERSION = "v3";
const STATIC_CACHE = `emlaksoft-static-${VERSION}`;
const PAGE_CACHE = `emlaksoft-pages-${VERSION}`;
const CURRENT_CACHES = [STATIC_CACHE, PAGE_CACHE];

const OFFLINE_URL = "/offline.html";
const PRECACHE_STATIC = [OFFLINE_URL, "/manifest.webmanifest", "/window.svg"];
const PRECACHE_PAGES = ["/"];

/**
 * Oturum gerektiren sayfalar ASLA cache'lenmez: /app veya /admin bir kez
 * PAGE_CACHE'e yazılırsa çıkış yapmış (veya başka) kullanıcı offline'da
 * paneli cache'ten görebilir. Bu path'ler network-first yerine yalnız
 * ağ + offline.html fallback alır.
 */
function isPrivatePage(pathname) {
  return pathname === "/app" || pathname.startsWith("/app/") || pathname === "/admin" || pathname.startsWith("/admin/");
}

self.addEventListener("install", (event) => {
  // skipWaiting BURADA çağrılmaz: yeni sürüm "waiting" durumunda bekler,
  // kullanıcı sw-register'daki "Yenile" çubuğuyla onaylayınca geçilir.
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_STATIC)),
      caches.open(PAGE_CACHE).then((cache) => cache.addAll(PRECACHE_PAGES)),
    ]),
  );
});

self.addEventListener("message", (event) => {
  // sw-register.tsx "Yenile" butonu: bekleyen sürümü hemen aktive et
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !CURRENT_CACHES.includes(k)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "EmlakSoft", body: "Yeni bildirim" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    /* metin payload olabilir */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/window.svg",
      badge: "/window.svg",
      data: { href: data.href || "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = event.notification.data?.href || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(href) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(href);
    }),
  );
});

/** Hash'li _next/static dosyaları immutable, ikon/manifest de nadiren değişir → cache-first. */
function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname === "/manifest.webmanifest" ||
    /\.(svg|png|ico|jpg|jpeg|webp|avif|woff2?)$/.test(pathname)
  );
}

/** Statik varlık: cache-first (yoksa ağdan al ve cache'e koy). */
function cacheFirst(req) {
  return caches.match(req).then(
    (cached) =>
      cached ||
      fetch(req).then((res) => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(STATIC_CACHE).then((c) => c.put(req, clone));
        }
        return res;
      }),
  );
}

/** Sayfa gezinmesi: network-first → cache → offline.html. */
function pageNetworkFirst(req) {
  return fetch(req)
    .then((res) => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(PAGE_CACHE).then((c) => c.put(req, clone));
      }
      return res;
    })
    .catch(() =>
      caches
        .match(req)
        .then((cached) => cached || caches.match(OFFLINE_URL))
        .then((fallback) => fallback || Response.error()),
    );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // POST / PUT / DELETE vb. ASLA cache'lenmez — service worker karışmaz
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API / auth asla cache'lenmez
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/giris")) return;

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (req.mode === "navigate") {
    if (isPrivatePage(url.pathname)) {
      // Auth'lu sayfa: cache'e yazma, cache'ten okuma — yalnız offline fallback
      event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL).then((f) => f || Response.error())));
      return;
    }
    event.respondWith(pageNetworkFirst(req));
  }
  // Diğer GET istekleri (RSC payload vb.) ağa bırakılır — cache'lenmez
});
