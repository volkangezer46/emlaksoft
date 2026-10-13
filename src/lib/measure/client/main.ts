/**
 * Ölçüm istemcisi (TARAYICI giriş noktası; `scripts/build-measure-client.ts` → public/statik/m-<özet>.js, ≤3 KB gzip).
 * <PublicMeasure /> yalnız herkese açık sayfalarda `<script src defer data-static-keep data-a="0|1">` olarak basar.
 *
 * - Sayfa görüntüleme + gerçek kullanıcı hız ölçümü (web-vitals@4 aynı dosyada; CDN yok) sayfa gizlenirken
 *   (`visibilitychange` hidden / `pagehide`) `sendBeacon` ile /api/v'ye gider. Çerez/kalıcı depolama kullanılmaz.
 * - DNT ya da GPC açıksa hiçbir şey gönderilmez (sunucu da ayrıca atar).
 * - `data-a="1"` ise atıf taşıma kurulur (carry.ts); "0" iken sessionStorage'a dokunulmaz, bağlantılar değişmez.
 */
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";
import { now } from "@/lib/clock";
import { installCarry, utmOf } from "./carry";

const d = document;
const w = window as Window & { next?: unknown };
const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
const a = (d.currentScript as HTMLScriptElement | null)?.dataset.a;

if (nav.doNotTrack !== "1" && !nav.globalPrivacyControl) {
  let ref = "";
  try {
    ref = new URL(d.referrer).host;
  } catch {
    /* referrer yok/geçersiz */
  }
  installCarry(a === "1", { storage: () => w.sessionStorage, loc: location, refHost: ref, doc: d, now: now() });

  const queue: [string, number][] = [];
  const add = (m: Metric) => queue.push([m.name, m.value]);
  onLCP(add);
  onINP(add);
  onCLS(add);
  onFCP(add);
  onTTFB(add);

  let sent = 0;
  const send = () => {
    if (sent && !queue.length) return;
    try {
      nav.sendBeacon(
        "/api/v",
        JSON.stringify({
          p: location.pathname,
          r: ref,
          u: utmOf(location.search),
          d: innerWidth < 768 ? "m" : "d",
          v: queue.splice(0, 10),
          // Statik ana sayfa HTML'inde Next çalışma zamanı yoktur (window.next tanımsız).
          s: w.next ? 0 : 1,
          n: sent ? 0 : 1,
        }),
      );
    } catch {
      /* gönderilemedi: sayfa etkilenmez */
    }
    sent = 1;
  };
  addEventListener("pagehide", send);
  d.addEventListener("visibilitychange", () => d.visibilityState === "hidden" && send());
}
