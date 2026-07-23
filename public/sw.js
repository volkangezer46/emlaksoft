/* EmlakSoft PWA — offline shell iskeleti */
const CACHE = "emlaksoft-shell-v1";
const PRECACHE = ["/", "/app", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API / auth asla cache’lenmez
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/giris")) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok && (url.pathname === "/" || url.pathname.startsWith("/app"))) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
