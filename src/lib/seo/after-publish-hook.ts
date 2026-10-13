import { getBaseUrl } from "@/lib/base-url";
import { canonicalUrl } from "./rules";
import type { AfterPublishEvent, AfterPublishHook, AfterPublishHookResult } from "./contracts";
import { canAutoOptimize, isPublicScope, normalizePath } from "./scope";

/**
 * YAYIN SONRASI SEO KANCASI (K3, order 30). Kayıt: `publishing/after-publish.ts` HOOKS (bağdaştırıcı: site-issues/adapters.ts).
 * Yalnız ETKİLENEN yollar işlenir (ev.livePaths): IndexNow'a bildirilir (kapalıysa dış çağrı yok; yalnız
 * canAutoOptimize + indekslenebilir) ve o adresler yeniden denetlenir (son koşunun o adreslere ait bulguları yenilenir).
 * Hata yayını ETKİLEMEZ: çağıran (runAfterPublish) her kancayı try/catch + zaman aşımıyla yalıtır; burada da yutulur.
 */

/** Etkilenen yollar → kendi kökenimizde mutlak adresler (SAF; kapsam dışı yollar atılır, en çok 20). */
export function affectedUrls(livePaths: readonly string[], base: string): string[] {
  const out = new Set<string>();
  for (const raw of livePaths) {
    if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) continue;
    const path = normalizePath(raw);
    if (!isPublicScope(path)) continue;
    out.add(canonicalUrl(base, path));
    if (out.size >= 20) break;
  }
  return [...out];
}

export const seoAfterPublishHook: AfterPublishHook = {
  id: "seo",
  order: 30,
  async run(ev: AfterPublishEvent): Promise<AfterPublishHookResult> {
    const urls = affectedUrls(ev.livePaths, getBaseUrl());
    if (urls.length === 0) return { ok: true, message: "SEO: etkilenen herkese açık sayfa yok." };
    const parts: string[] = [];
    let ok = true;
    try {
      const { notifyIndexNow } = await import("./indexnow-events");
      const auto = urls.filter((u) => canAutoOptimize(new URL(u).pathname || "/"));
      const r = auto.length > 0 ? await notifyIndexNow(auto, { source: "yayin" }) : { sent: 0, status: "kapsam dışı" };
      parts.push(`IndexNow ${r.sent} adres (${r.status})`);
    } catch {
      ok = false;
      parts.push("IndexNow bildirilemedi");
    }
    try {
      const { reauditUrls } = await import("./audit-runner");
      const r = await reauditUrls(urls);
      parts.push(`${r.checked.length} sayfa yeniden denetlendi, ${r.findings.length} bulgu`);
    } catch {
      ok = false;
      parts.push("yeniden denetim yapılamadı");
    }
    return { ok, message: `SEO: ${parts.join(" · ")}.` };
  },
};
