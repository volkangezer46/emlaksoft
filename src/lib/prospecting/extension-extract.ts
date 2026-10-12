import { parsePriceText } from "@/lib/listing-control/adapters/inventory-csv";

/**
 * Eklentiden "EmlakSoft'a sahibinden ilan olarak kaydet" — sayfa anlık görüntüsünden kayıt alanları (SAF, testli).
 *
 * Eklenti, kullanıcı tıkladığında YALNIZ açık sekmenin DOM'undan küçük bir anlık görüntü (`PageSnapshot`) alır (arka planda
 * gezinme/izleme YOK); alanlar burada yorumlanır, açılır pencerede kullanıcıya düzenlettirilerek gösterilir. Kalıplar
 * DOĞRULANMAMIŞTIR (portal sayfa yapısı değişir): tutmayan alan boş kalır ve kullanıcı elle girer; yanlış değer uydurulmaz.
 * Açıklama metni ve fotoğraf ALINMAZ (telif); numara için "göster" düğmesine TIKLANMAZ — yalnız sayfada zaten görünen
 * `tel:` bağlantısı/metni önerilir ve kullanıcı onayı olmadan gönderilmez.
 */
export type PageSnapshot = {
  url: string;
  title: string;
  h1: string;
  /** JSON-LD betiklerinin ham metni (en çok 3, her biri kısaltılmış). */
  jsonLd: string[];
  metaPrice: string;
  /** Görünen sayfa metninin ilk bölümü (kısaltılmış). */
  text: string;
  /** Konum kırıntısı metinleri (ör. "İstanbul", "Kadıköy"). */
  crumbs: string[];
  /** Sayfada ZATEN görünen `tel:` bağlantıları. */
  telLinks: string[];
  ownerName: string;
};

export type ExtractedListing = {
  url: string;
  title: string | null;
  price: number | null;
  rooms: string | null;
  grossM2: number | null;
  locationText: string | null;
  listedAt: string | null;
  transactionType: "sale" | "rent";
  ownerName: string | null;
  /** Önerilen telefon (sayfada görünürse); kullanıcı onaylamadan gönderilmez. */
  phoneCandidate: string | null;
};

const TR_MONTHS: Record<string, string> = {
  ocak: "01", şubat: "02", subat: "02", mart: "03", nisan: "04", mayıs: "05", mayis: "05", haziran: "06",
  temmuz: "07", ağustos: "08", agustos: "08", eylül: "09", eylul: "09", ekim: "10", kasım: "11", kasim: "11", aralık: "12", aralik: "12",
};

function clean(v: string | null | undefined, max: number): string | null {
  const t = (v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function fromJsonLd(blocks: readonly string[]): { price: number | null; name: string | null } {
  for (const raw of blocks) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const n of nodes) {
        const o = n as { name?: unknown; offers?: { price?: unknown; lowPrice?: unknown } | { price?: unknown }[] };
        const offer = Array.isArray(o.offers) ? o.offers[0] : o.offers;
        const p = offer && "price" in offer ? offer.price : undefined;
        const price = typeof p === "number" ? p : typeof p === "string" ? parsePriceText(p) : null;
        if (price || typeof o.name === "string") return { price: price && price > 0 ? price : null, name: typeof o.name === "string" ? o.name : null };
      }
    } catch {
      /* geçersiz JSON-LD: yok sayılır */
    }
  }
  return { price: null, name: null };
}

/** "Oda Sayısı  3+1" / "m² (Brüt) 120" / "İlan Tarihi 12 Ekim 2026" biçimli etiket-değer çiftleri. */
function labelled(text: string, label: RegExp): string | null {
  // Türkçe büyük/küçük harf katlaması (İ/I): "İlan Tarihi" ile "ilan tarihi" aynı etiket sayılır.
  const m = text.toLocaleLowerCase("tr-TR").match(new RegExp(`${label.source}\\s*[:\\-]?\\s*([^\\n\\r]{1,40})`));
  return m ? clean(m[1], 40) : null;
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  return digits.replace(/\D/g, "").length >= 10 ? digits.slice(0, 20) : null;
}

export function extractListing(s: PageSnapshot): ExtractedListing {
  const ld = fromJsonLd(s.jsonLd);
  const text = s.text;
  const price = ld.price ?? parsePriceText(s.metaPrice) ?? parsePriceText(labelled(text, /fiyat/) ?? undefined);
  const roomsRaw = labelled(text, /oda\s*say[ıi]s[ıi]/) ?? "";
  const rooms = /^(\d{1,2}\s*\+\s*\d{1,2}|st[üu]dyo)/i.exec(roomsRaw)?.[1]?.replace(/\s+/g, "") ?? null;
  const m2raw = labelled(text, /m²\s*\(?br[üu]t\)?/) ?? labelled(text, /br[üu]t\s*m²/);
  const m2 = m2raw ? Number(m2raw.replace(/\./g, "").replace(",", ".").match(/[\d.]+/)?.[0]) : NaN;
  const dateRaw = labelled(text, /ilan\s*tarihi/);
  let listedAt: string | null = null;
  const dm = dateRaw?.match(/(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/);
  if (dm && TR_MONTHS[dm[2].toLocaleLowerCase("tr-TR")]) listedAt = `${dm[3]}-${TR_MONTHS[dm[2].toLocaleLowerCase("tr-TR")]}-${dm[1].padStart(2, "0")}`;
  const tel = s.telLinks.map((t) => normalizePhone(t.replace(/^tel:/i, ""))).find((t): t is string => !!t) ?? null;
  const rent = /kiral[ıi]k/i.test(s.url) || /kiral[ıi]k/i.test(s.title);
  return {
    url: s.url.split(/[?#]/)[0].slice(0, 600),
    title: clean(s.h1, 200) ?? clean(ld.name, 200) ?? clean(s.title, 200),
    price,
    rooms,
    grossM2: Number.isFinite(m2) && m2 > 0 ? m2 : null,
    locationText: clean(s.crumbs.filter(Boolean).slice(0, 4).join(" / "), 200),
    listedAt,
    transactionType: rent ? "rent" : "sale",
    ownerName: clean(s.ownerName, 120),
    phoneCandidate: tel,
  };
}
