/**
 * Yayın sonrası ilan numarası / bağlantısı çıkarma (SAF, testli). İki kaynak: (1) kullanıcının açtığı portal sayfasının adresi ve
 * kısa görünür metni ("İlan No: 1234567890"), (2) kullanıcının yapıştırdığı numara ya da bağlantı. Sonuç sunucuda ayrıca doğrulanır
 * (`tamamla` ucu: portal adaptörü + 6-12 hane). Okunamazsa null: kullanıcı elle yazar (tahmin yok).
 */

export type ListingRef = { externalId: string; url: string | null; source: "url" | "text" | "input" };

const ID = /\b(\d{6,12})\b/;

function idFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // Yol sonundan geriye doğru ilk 6-12 haneli blok ("…-1234567890/detay", "/ilan/…/1234567/").
    const parts = u.pathname.split("/").filter(Boolean).reverse();
    for (const part of parts) {
      const m = /(?:^|[-_])(\d{6,12})(?:$|[-_])/.exec(part);
      if (m) return m[1]!;
    }
    const q = u.searchParams.get("id") ?? u.searchParams.get("ilan") ?? u.searchParams.get("adId");
    return q && /^\d{6,12}$/.test(q) ? q : null;
  } catch {
    return null;
  }
}

/** Sayfa özeti (adres + metin) → ilan başvurusu. Adres yalnız https portal bağlantısı ise geri yazılır. */
export function extractListingRef(page: { url: string; text: string }): ListingRef | null {
  const fromUrl = idFromUrl(page.url);
  if (fromUrl) return { externalId: fromUrl, url: /^https:\/\//i.test(page.url) ? page.url.split("#")[0]!.slice(0, 2048) : null, source: "url" };
  const labelled = /[iİ]lan\s*(?:no|numaras[ıiI])\D{0,8}(\d{6,12})/i.exec(page.text);
  if (labelled) return { externalId: labelled[1]!, url: null, source: "text" };
  return null;
}

/** Kullanıcının yapıştırdığı değer: yalnız numara ya da portal bağlantısı. */
export function parseListingInput(raw: string): ListingRef | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^https:\/\//i.test(s)) {
    const id = idFromUrl(s);
    return id ? { externalId: id, url: s.split("#")[0]!.slice(0, 2048), source: "input" } : null;
  }
  const m = ID.exec(s.replace(/^#/, ""));
  return m && /^#?\d{6,12}$/.test(s) ? { externalId: m[1]!, url: null, source: "input" } : null;
}
