/* EmlakSoft PWA: privacy-bounded offline shell and push notifications. */
const VERSION = "v6";
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
const PRECACHE_STATIC = [OFFLINE_URL, "/manifest.webmanifest", "/icon.svg"];

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
  "/emlaksoft-premium-team.png",
  "/file.svg",
  "/globe.svg",
  "/icon.svg",
  "/listing-aegean-villa.png",
  "/listing-bosphorus-villa.png",
  "/listing-istanbul-penthouse.png",
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
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: { href },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const href = safeNotificationHref(event.notification.data?.href);
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      const targetUrl = new URL(href, self.location.origin).href;
      for (const client of clients) {
        if (client.url === targetUrl && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(href);
    }),
  );
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
  if (request.method !== "GET") return;

  const url = new URL(request.url);
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
