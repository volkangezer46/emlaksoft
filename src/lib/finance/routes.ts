/**
 * Finans ve Kazancım adreslerinin TEK üreticisi (WP6, docs/design/FINANS_ENTEGRASYON_2026-10.md "Bilgi mimarisi").
 * `?sekme=` yok: her alt alan gerçek bir yol bölümüdür. Bu dosya bağımlılıksızdır (sunucu, istemci, test ve betikler
 * aynı fonksiyonu kullanır). Yönlendirme/takma ad YOKTUR; eski yollar hiçbir yerde üretilmez (sözleşme testi
 * `routes.test.ts`).
 */

export const FINANCE_ROOT = "/app/finans";
export const EARNINGS_ROOT = "/app/kazancim";

/** Finans alt alanları; sıra = menü/şerit sırası. `genel` kök yoldur (`/app/finans`). */
export const FINANCE_SECTIONS = [
  "genel",
  "hareketler",
  "kasa-banka",
  "cari",
  "komisyon",
  "hakedis",
  "tahsilat",
  "faturalar",
  "belgeler",
  "tekrarlayan",
  "butce",
  "vergi",
  "raporlar",
  "ayarlar",
  "kayit",
] as const;

export type FinanceSection = (typeof FINANCE_SECTIONS)[number];

/** Kazancım alt alanları: `benim` kök yoldur (`/app/kazancim`), `kasam` kişisel kasa. */
export type EarningsSection = "benim" | "kasam";

export type RouteQuery = Readonly<Record<string, string | number | boolean | null | undefined>>;

const SECTION_SET: ReadonlySet<string> = new Set(FINANCE_SECTIONS);

export function isFinanceSection(value: unknown): value is FinanceSection {
  return typeof value === "string" && SECTION_SET.has(value);
}

/** Sorgu ve çapa ekler; boş/null/false değerler yazılmaz. Çapa `#` ile ya da onsuz verilebilir. */
export function withQuery(path: string, query?: RouteQuery | URLSearchParams, hash?: string | null): string {
  const sp = new URLSearchParams();
  if (query instanceof URLSearchParams) {
    for (const [k, v] of query) if (v !== "") sp.set(k, v);
  } else if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === null || v === undefined || v === "" || v === false) continue;
      sp.set(k, String(v));
    }
  }
  const s = sp.toString();
  const h = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  return `${path}${s ? `?${s}` : ""}${h}`;
}

/** Alt alanın yolu (sorgusuz): `genel` → `/app/finans`, diğerleri `/app/finans/<bölüm>`. */
export function financePath(section: FinanceSection = "genel"): string {
  return section === "genel" ? FINANCE_ROOT : `${FINANCE_ROOT}/${section}`;
}

/** Finans adresi: alt alan + isteğe bağlı sorgu ve çapa. */
export function financeHref(section: FinanceSection = "genel", query?: RouteQuery | URLSearchParams, hash?: string | null): string {
  return withQuery(financePath(section), query, hash);
}

/** Cari detayı (`/app/finans/cari/<id>`). */
export function financePartyHref(partyId: string, query?: RouteQuery, hash?: string | null): string {
  return withQuery(`${financePath("cari")}/${encodeURIComponent(partyId)}`, query, hash);
}

/** Kayıt düzenleme sayfası (`/app/finans/kayit/<id>`). */
export function financeEntryPath(entryId: string): string {
  return `${financePath("kayit")}/${encodeURIComponent(entryId)}`;
}

/** Kazancım yolu: `benim` → `/app/kazancim`, `kasam` → `/app/kazancim/kasam`. */
export function earningsPath(section: EarningsSection = "benim"): string {
  return section === "benim" ? EARNINGS_ROOT : `${EARNINGS_ROOT}/${section}`;
}

/** Kazancım adresi (sorgu + çapa). */
export function earningsHref(section: EarningsSection = "benim", query?: RouteQuery, hash?: string | null): string {
  return withQuery(earningsPath(section), query, hash);
}

/** Bir yol Finans alanında mı (kök dahil)? Etkin menü, gerçek zamanlı tablo ve konu eşlemesi için. */
export function isFinancePath(pathname: string): boolean {
  const path = pathname.split(/[?#]/)[0] ?? pathname;
  return path === FINANCE_ROOT || path.startsWith(`${FINANCE_ROOT}/`) || path === EARNINGS_ROOT || path.startsWith(`${EARNINGS_ROOT}/`);
}

/** Yoldan Finans alt alanı: `/app/finans` → `genel`, `/app/finans/cari/<id>` → `cari`; Finans dışı yol → null. */
export function financeSectionOf(pathname: string): FinanceSection | null {
  const path = (pathname.split(/[?#]/)[0] ?? pathname).replace(/\/+$/, "");
  if (path === FINANCE_ROOT) return "genel";
  if (!path.startsWith(`${FINANCE_ROOT}/`)) return null;
  const seg = path.slice(FINANCE_ROOT.length + 1).split("/")[0];
  return isFinanceSection(seg) && seg !== "genel" ? seg : null;
}
