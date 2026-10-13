import { checkHref } from "@/lib/site-menu/schema-core";

/**
 * Zengin metin bağlantı denetimi (SAF; istemci editörü de içe aktarır). Tek güvenlik kapısı: ayrıştırıcı ve renderer
 * yalnız buradan `ok` dönen adresi `href` olarak basar.
 *  - REDDEDİLİR (hata): boş, boşluk/denetim karakteri/tırnak/açılı ayraç, protokol göreli `//`, `javascript:`, `data:`,
 *    `vbscript:` ve http(s)/mailto/tel dışındaki her şema, göreli yol ("foo"), kullanıcı bilgili ya da alan adsız URL.
 *  - Site içi yol (`/x`) yapısal olarak güvenlidir; sitede bilinmiyorsa (known-routes + verilen ek yollar) kırık iç
 *    bağlantı UYARISI olur (`broken`), kayıt engellenmez.
 *  - `#bolum` yalnız aynı sayfadaki başlık kimliği biçimindeyse kabul edilir.
 * Dış bağlantı (`external`) renderer'da `rel="noopener nofollow"` alır.
 */

export type RichHrefKind = "internal" | "anchor" | "external" | "mailto" | "tel";

export type RichHrefCheck =
  | { ok: true; href: string; kind: RichHrefKind; external: boolean; broken: boolean; warn?: string }
  | { ok: false; message: string };

const UNSAFE_CHARS = /[\s\u0000-\u001f\u007f-\u009f\\<>"'`]/;

/** Sorgu/parçayı ve sondaki '/'yi atar ("/rehber/x?y#z" -> "/rehber/x"). */
export function pathOnly(href: string): string {
  const p = href.replace(/[?#].*$/, "");
  return p.length > 1 ? p.replace(/\/+$/, "") : p;
}

export function checkRichHref(raw: string, extraPaths: readonly string[] = []): RichHrefCheck {
  const v = String(raw ?? "").trim();
  if (!v) return { ok: false, message: "Bağlantı boş olamaz." };
  if (v.length > 500) return { ok: false, message: "Bağlantı çok uzun." };
  if (UNSAFE_CHARS.test(v)) return { ok: false, message: "Bağlantıda boşluk veya geçersiz karakter var." };
  if (v.startsWith("//")) return { ok: false, message: "Çift eğik çizgiyle başlayan (protokol göreli) adres kabul edilmez." };

  if (v.startsWith("#")) {
    return /^#[a-z0-9]+(-[a-z0-9]+)*$/.test(v)
      ? { ok: true, href: v, kind: "anchor", external: false, broken: false }
      : { ok: false, message: "Sayfa içi bağlantı #kucuk-harf-ve-tire biçiminde olmalı." };
  }

  if (v.startsWith("/")) {
    const known = checkHref(v);
    if (known.ok) return { ok: true, href: v, kind: "internal", external: false, broken: false };
    if (extraPaths.includes(pathOnly(v))) return { ok: true, href: v, kind: "internal", external: false, broken: false };
    return { ok: true, href: v, kind: "internal", external: false, broken: true, warn: `Kırık iç bağlantı: ${known.message}` };
  }

  // Şema beyaz listesi: yalnız http(s), mailto, tel. javascript:, data:, vbscript: vb. burada düşer.
  if (/^https?:\/\//i.test(v)) {
    const r = checkHref(v);
    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, href: v, kind: "external", external: true, broken: false, warn: r.warn };
  }
  if (/^mailto:/i.test(v) || /^tel:/i.test(v)) {
    const r = checkHref(v);
    if (!r.ok) return { ok: false, message: r.message };
    return { ok: true, href: v, kind: /^mailto:/i.test(v) ? "mailto" : "tel", external: false, broken: false };
  }
  return { ok: false, message: "Yalnız / ile başlayan site yolu, https adresi, mailto ve tel kabul edilir." };
}
