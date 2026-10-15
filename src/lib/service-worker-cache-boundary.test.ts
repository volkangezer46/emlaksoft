import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const worker = readFileSync("public/sw.js", "utf8");
const registration = readFileSync("src/components/app/sw-register.tsx", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");

describe("service worker privacy boundary", () => {
  it("uses a reviewed public-page allowlist instead of a private-route denylist", () => {
    expect(worker).toContain("CACHEABLE_PUBLIC_PAGES");
    expect(worker).toContain("!isCacheablePublicPage(url.pathname) || url.search");
    expect(worker).not.toContain("TOKEN_PREFIXES");
    expect(worker).not.toContain("isPrivatePage");
  });

  it("does not cache arbitrary same-origin paths merely by file extension", () => {
    expect(worker).toContain("CACHEABLE_PUBLIC_ASSETS");
    expect(worker).not.toContain("svg|png|ico|jpg|jpeg|webp|avif|woff");
    expect(worker).toContain('url.pathname.startsWith("/api")');
  });

  it("rejects private, no-store, redirected-to-private and cross-origin responses", () => {
    expect(worker).toContain('policy.includes("no-store")');
    expect(worker).toContain('policy.includes("private")');
    expect(worker).toContain("finalUrl.origin !== self.location.origin");
    expect(worker).toContain("isCacheablePublicPage(finalUrl.pathname) && !finalUrl.search");
  });

  it("bounds push content and navigation to a same-origin relative URL", () => {
    expect(worker).toContain("safeNotificationHref");
    expect(worker).toContain('value.startsWith("//")');
    expect(worker).toContain("slice(0, 100)");
    expect(worker).toContain("slice(0, 300)");
  });

  it("keeps the one-time v6 force-activation marker (v7+ use the normal waiting update flow) and removes managed legacy caches", () => {
    expect(worker).toContain('const VERSION = "v7"');
    expect(worker).toContain('const FORCE_ACTIVATE_VERSION = "v6"');
    expect(worker).toContain("self.skipWaiting()");
    expect(worker).toContain("key.startsWith(MANAGED_CACHE_PREFIX)");
    expect(worker).toContain("caches.delete(key)");
  });

  it("push actions: tag dedupe, whitelisted actions, tel/entity sanitised, record actions only via same-origin POST", () => {
    expect(worker).toContain("options.tag = tag");
    expect(worker).toContain('new Set(["open", "call", "done", "snooze"])');
    expect(worker).toContain("function safeTel(");
    expect(worker).toContain("function safeEntity(");
    expect(worker).toContain('fetch("/api/app/push-eylem"');
    expect(worker).toContain('"x-emlaksoft-push": "1"');
    expect(worker).toContain('credentials: "same-origin"');
    expect(worker).toContain("setAppBadge");
  });

  it("share target files stay on the device in a separate TTL-bounded cache, never in page caches", () => {
    expect(worker).toContain('const SHARE_CACHE = "es-share-inbox"');
    expect(worker).not.toContain('SHARE_CACHE = "emlaksoft-');
    expect(worker).toContain("SHARE_TTL_MS");
    expect(worker).toContain("purgeOldShares");
    expect(worker).toContain('"PURGE_SHARES"');
    // POST is intercepted only for the exact share path; every other non-GET stays on the network.
    expect(worker).toContain('request.method === "POST" && url.origin === self.location.origin && url.pathname === SHARE_PATH');
    expect(worker).toContain('if (request.method !== "GET") return;');
  });

  it("purges the known v4 caches before registering an uncached worker update", () => {
    expect(registration).toContain('"emlaksoft-static-v4"');
    expect(registration).toContain('"emlaksoft-pages-v4"');
    expect(registration).toContain('updateViaCache: "none"');
    expect(registration).toContain("reg.update()");
  });

  it("serves sw.js with origin revalidation and no browser or CDN storage", () => {
    expect(nextConfig).toContain('source: "/sw.js"');
    expect(nextConfig).toContain('value: "no-store, no-cache, must-revalidate, proxy-revalidate"');
    expect(nextConfig).toContain('{ key: "CDN-Cache-Control", value: "no-store" }');
    expect(nextConfig).toContain('{ key: "Vercel-CDN-Cache-Control", value: "no-store" }');
  });
});
