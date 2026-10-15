/**
 * Serbest adres metni → il / ilçe / mahalle (SAF çekirdek; veritabanı yok, birim testli).
 *
 * Girdi iki biçimde gelir ve birlikte kullanılabilir:
 *  - yapılandırılmış: ayrı il / ilçe / mahalle sütunları (içe aktarma, form, webhook) → yazım toleranslı eşleşme;
 *  - serbest metin: "Caferağa Mah. Moda Cad. No:12 Kadıköy/İstanbul" → Türkçe katlanmış kelime dizilerinde TAM eşleşme
 *    (serbest metinde yazım toleransı yalnız "… Mah." ile işaretlenmiş mahalle parçasında uygulanır; aksi halde
 *    "Moda Cad." gibi sokak adları yanlışlıkla mahalle sanılırdı).
 *
 * Kural (coğrafya merkezi ile aynı): belirsiz sonuç TAHMİN EDİLMEZ. Aynı adda iki ilçe varsa ve il bilinmiyorsa
 * ilçe boş kalır, sonuç "ambiguous" döner. Sunucu sarmalayıcısı: `address-resolve-server.ts`.
 */
import { pickMatch, type MatchAlias } from "./match";
import { geoKey } from "./normalize";
import type { ResolvedGeo } from "./types";

export type AddressInput = {
  text?: string | null;
  province?: string | null;
  district?: string | null;
  neighborhood?: string | null;
};

export type AddressIndex = {
  provinces: readonly { id: string; name: string; plateCode?: number | null }[];
  districts: readonly { id: string; name: string; provinceId: string }[];
  neighborhoodsOf: (districtId: string) => Promise<readonly { id: string; name: string }[]>;
  aliases?: { province?: readonly MatchAlias[]; district?: readonly MatchAlias[]; neighborhood?: readonly MatchAlias[] };
};

export type AddressResolution = {
  /** ok: en az ilçe çözüldü (ve istenen mahalle de); partial: bir kısmı çözüldü; ambiguous: aday birden çok; none: hiçbiri. */
  status: "ok" | "partial" | "ambiguous" | "none";
  geo: ResolvedGeo;
  /** Kullanıcıya gösterilecek kısa açıklama (yalnız ok dışı durumlarda). */
  reason?: string;
};

export const EMPTY_GEO: ResolvedGeo = {
  provinceId: null,
  provinceName: null,
  districtId: null,
  districtName: null,
  neighborhoodId: null,
  neighborhoodName: null,
};

/** Serbest metinde ilçe sayılmayacak genel kelimeler (yalnız il biliniyorsa "Merkez" ilçesi kabul edilir). */
const GENERIC_DISTRICT = new Set(["merkez"]);
const NEIGHBORHOOD_MARK = /^(mahallesi|mah|mh|mahalle)$/;
const MAX_NGRAM = 4;

type Gram = { key: string; start: number; end: number };

/** Metni katlanmış kelimelere böler ("No:12", "D:3" gibi kapı bilgisi sayı olduğundan eşleşmeye karışmaz). */
export function addressWords(text: string | null | undefined): string[] {
  return geoKey(text).replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
}

function grams(words: readonly string[]): Gram[] {
  const out: Gram[] = [];
  for (let n = Math.min(MAX_NGRAM, words.length); n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) out.push({ key: words.slice(i, i + n).join(" "), start: i, end: i + n });
  }
  return out;
}

const overlaps = (a: Gram, used: readonly Gram[]) => used.some((u) => a.start < u.end && u.start < a.end);

/** "Caferağa Mah." → ["caferaga"]; işaretin önündeki 1-3 kelimelik adaylar (uzundan kısaya). */
export function markedNeighborhoodCandidates(words: readonly string[]): { key: string; gram: Gram }[] {
  const out: { key: string; gram: Gram }[] = [];
  words.forEach((w, i) => {
    if (!NEIGHBORHOOD_MARK.test(w) || i === 0) return;
    for (let n = Math.min(3, i); n >= 1; n--) {
      out.push({ key: words.slice(i - n, i).join(" "), gram: { key: "", start: i - n, end: i + 1 } });
    }
  });
  return out;
}

function findExact<T extends { id: string; name: string }>(
  all: readonly Gram[],
  used: readonly Gram[],
  pool: readonly T[],
  level: "province" | "district" | "neighborhood",
): { item: T; gram: Gram }[] {
  const byKey = new Map<string, T[]>();
  for (const p of pool) {
    const k = geoKey(p.name, level).replace(/[^a-z0-9]+/g, " ").trim();
    if (!k) continue;
    const list = byKey.get(k) ?? [];
    list.push(p);
    byKey.set(k, list);
  }
  const hits: { item: T; gram: Gram }[] = [];
  for (const g of all) {
    if (overlaps(g, used)) continue;
    const found = byKey.get(g.key);
    if (found) for (const item of found) hits.push({ item, gram: g });
  }
  return hits;
}

/** Aynı kayda birden çok vuruş olabilir; kayıt başına en sondaki (adreste il/ilçe sonda yazılır) tutulur. */
function lastPerItem<T extends { id: string }>(hits: { item: T; gram: Gram }[]): { item: T; gram: Gram }[] {
  const m = new Map<string, { item: T; gram: Gram }>();
  for (const h of hits) {
    const cur = m.get(h.item.id);
    if (!cur || h.gram.start > cur.gram.start || (h.gram.start === cur.gram.start && h.gram.end > cur.gram.end)) m.set(h.item.id, h);
  }
  return [...m.values()];
}

export async function resolveAddressCore(input: AddressInput, index: AddressIndex): Promise<AddressResolution> {
  const provText = (input.province ?? "").trim();
  const distText = (input.district ?? "").trim();
  const neighText = (input.neighborhood ?? "").trim();
  const words = addressWords(input.text);
  if (!provText && !distText && !neighText && !words.length) return { status: "none", geo: { ...EMPTY_GEO }, reason: "Adres boş." };

  const all = grams(words);
  const used: Gram[] = [];
  const geo: ResolvedGeo = { ...EMPTY_GEO };
  const provinceById = new Map(index.provinces.map((p) => [p.id, p]));
  let ambiguous: string | null = null;
  let problem: string | null = null;

  // ---- il
  if (provText) {
    const plate = /^\d{1,2}$/.test(provText) ? Number(provText) : null;
    const byPlate = plate ? index.provinces.find((p) => p.plateCode === plate) : null;
    const m = byPlate ? { status: "ok" as const, id: byPlate.id } : pickMatch(provText, "province", index.provinces, index.aliases?.province);
    if (m.status === "ok") {
      geo.provinceId = m.id;
      geo.provinceName = provinceById.get(m.id)?.name ?? null;
    } else problem = `İl bulunamadı: "${provText}"`;
  }
  if (!geo.provinceId && words.length) {
    const hits = lastPerItem(findExact(all, used, index.provinces, "province"));
    if (hits.length) {
      const last = hits.sort((a, b) => b.gram.start - a.gram.start)[0]!;
      geo.provinceId = last.item.id;
      geo.provinceName = last.item.name;
      used.push(last.gram);
    }
  }

  // ---- ilçe
  const districtPool = geo.provinceId ? index.districts.filter((d) => d.provinceId === geo.provinceId) : index.districts;
  if (distText) {
    const m = pickMatch(distText, "district", districtPool, index.aliases?.district);
    if (m.status === "ok") {
      const d = index.districts.find((x) => x.id === m.id)!;
      geo.districtId = d.id;
      geo.districtName = d.name;
    } else if (m.status === "ambiguous") ambiguous = `"${distText}" adında birden çok ilçe var; il de belirtin.`;
    else problem ??= `İlçe bulunamadı: "${distText}"`;
  }
  if (!geo.districtId && !ambiguous && words.length) {
    let hits = lastPerItem(findExact(all, used, districtPool, "district"));
    if (!geo.provinceId) hits = hits.filter((h) => !GENERIC_DISTRICT.has(geoKey(h.item.name, "district")));
    if (hits.length) {
      // En sondaki vuruş kazanır; aynı konumda farklı illerden aynı adlı ilçeler = belirsiz.
      const maxStart = Math.max(...hits.map((h) => h.gram.start));
      const atLast = hits.filter((h) => h.gram.start === maxStart);
      const ids = new Set(atLast.map((h) => h.item.id));
      if (ids.size === 1) {
        const h = atLast[0]!;
        geo.districtId = h.item.id;
        geo.districtName = h.item.name;
        used.push(h.gram);
      } else if (!distText) {
        ambiguous = `"${atLast[0]!.item.name}" adında birden çok ilçe var; il de belirtin.`;
      }
    }
  }
  if (geo.districtId && !geo.provinceId) {
    const d = index.districts.find((x) => x.id === geo.districtId);
    const p = d ? provinceById.get(d.provinceId) : undefined;
    if (p) {
      geo.provinceId = p.id;
      geo.provinceName = p.name;
    }
  }

  // ---- mahalle (ilçe gerekir)
  const wantsNeighborhood = Boolean(neighText) || markedNeighborhoodCandidates(words).length > 0;
  if (geo.districtId) {
    const pool = await index.neighborhoodsOf(geo.districtId);
    if (neighText) {
      const m = pickMatch(neighText, "neighborhood", pool, index.aliases?.neighborhood);
      if (m.status === "ok") {
        geo.neighborhoodId = m.id;
        geo.neighborhoodName = pool.find((n) => n.id === m.id)?.name ?? null;
      } else if (m.status === "ambiguous") ambiguous ??= `"${neighText}" için birden çok mahalle var.`;
      else problem ??= `Mahalle bulunamadı: "${neighText}"`;
    }
    if (!geo.neighborhoodId && words.length) {
      // 1) "… Mah." ile işaretli parça: yazım toleranslı eşleşme.
      for (const c of markedNeighborhoodCandidates(words)) {
        if (overlaps(c.gram, used)) continue;
        const m = pickMatch(c.key, "neighborhood", pool, index.aliases?.neighborhood);
        if (m.status === "ok") {
          geo.neighborhoodId = m.id;
          geo.neighborhoodName = pool.find((n) => n.id === m.id)?.name ?? null;
          used.push(c.gram);
          break;
        }
      }
      // 2) işaretsiz: tam eşleşen en uzun kelime dizisi (tek aday ise).
      if (!geo.neighborhoodId) {
        const hits = lastPerItem(findExact(all, used, pool, "neighborhood"));
        if (hits.length) {
          const longest = Math.max(...hits.map((h) => h.gram.end - h.gram.start));
          const top = hits.filter((h) => h.gram.end - h.gram.start === longest);
          if (new Set(top.map((h) => h.item.id)).size === 1) {
            geo.neighborhoodId = top[0]!.item.id;
            geo.neighborhoodName = top[0]!.item.name;
          }
        }
      }
      if (!geo.neighborhoodId && markedNeighborhoodCandidates(words).length && !problem) {
        problem = "Mahalle adı ilçede bulunamadı.";
      }
    }
  } else if (neighText) {
    problem ??= "Mahalle için ilçe gerekli.";
  }

  const any = Boolean(geo.provinceId || geo.districtId || geo.neighborhoodId);
  if (ambiguous && !geo.districtId) return { status: "ambiguous", geo, reason: ambiguous };
  if (!any) return { status: "none", geo, reason: problem ?? "Adreste il/ilçe bulunamadı." };
  const complete = Boolean(geo.districtId) && (!wantsNeighborhood || Boolean(geo.neighborhoodId)) && !problem;
  if (complete) return { status: "ok", geo };
  return {
    status: "partial",
    geo,
    reason: problem ?? (geo.districtId ? "Mahalle çözülemedi." : "İlçe çözülemedi; yalnız il eşlendi."),
  };
}

/** Önbellek anahtarı (aynı adres metni tekrar tekrar çözülmesin). */
export function addressInputKey(input: AddressInput): string {
  return [input.province, input.district, input.neighborhood, input.text].map((v) => geoKey(v ?? "")).join("|");
}

/** Önizleme satırına yazılacak kısa konum özeti: "Kadıköy / İstanbul · Caferağa". */
export function describeResolvedGeo(geo: ResolvedGeo): string {
  const head = [geo.districtName, geo.provinceName].filter(Boolean).join(" / ");
  return [head, geo.neighborhoodName].filter(Boolean).join(" · ");
}
