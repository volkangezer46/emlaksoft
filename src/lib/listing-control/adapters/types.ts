import type { CheckResultKind, SourceKind } from "../types";

/**
 * PORTAL ADAPTÖR ARAYÜZÜ (okuma/doğrulama). Yayın adaptörü (`src/lib/integrations/portals/index.ts`) AYRI kalır.
 *
 * İLKE: ofis kendi ilanlarını kendi oturumundan/kendi verisiyle doğrular. YASAK (hiçbir adaptör yapmaz): CAPTCHA
 * atlatma/çözme, erişim kontrolü aşma, rate-limit bypass, IP rotasyonu/UA taklidi, merkezi sunucudan portal sayfası
 * çekme (scrape), portal şifresi alma. `userAssisted` yalnız İSTEMCİDEN GELEN, kullanıcının görünen verisini
 * (fiyat, başlık, durum) işler; sunucu portala istek ATMAZ. Yeni portal = yeni dosya + `adapters/index.ts` satırı.
 */

export type AdapterCapabilities = {
  /** Resmi API ile ilan durumu okunabilir (anahtar/sözleşme gerekir; yoksa kapalı). */
  api: boolean;
  /** Portalın verdiği XML/feed içe aktarılabilir. */
  feed: boolean;
  csvImport: boolean;
  /** Kullanıcı destekli (istemciden gelen anlık görüntü) doğrulama. */
  userAssisted: boolean;
  manual: boolean;
};

/** Bir portal ilanının gözlemi (envanter satırı veya tek ilan kontrolü sonucu). */
export type ObservedListing = {
  portal: string;
  externalId: string;
  url?: string | null;
  title?: string | null;
  price?: number | null;
  currency?: string | null;
  advisorName?: string | null;
  status: "active" | "passive" | "removed" | "unknown";
  seenAt: string;
};

/** Tek ilan kontrolü sonucu şeması. `found=null`: belirlenemedi (ASLA "yok" sayılmaz). */
export type ListingCheckResult = {
  found: boolean | null;
  active: boolean | null;
  price: number | null;
  title: string | null;
  advisorName: string | null;
  listingNo: string | null;
  seenAt: string;
  confidence: number;
  /** Hata kodu (ör. `http_429`, `captcha`, `login_required`, `timeout`, `parse_error`). */
  error: string | null;
};

export type ListingRef = { portal: string; externalId: string | null; url: string | null };

export type AssistedRecipe = {
  allowedHosts: readonly string[];
  urlPattern: RegExp;
  /** İşler arası asgari bekleme (ms). */
  minIntervalMs: number;
  maxPerHour: number;
  /** İstemcinin gönderebileceği alanlar (başka alan sunucuda atılır). */
  fields: readonly ("price" | "title" | "status" | "advisorName")[];
};

export interface PortalAdapter {
  id: string;
  label: string;
  capabilities: AdapterCapabilities;
  /** Bu adaptörün tanıdığı ilan host'ları (SSRF/host allowlist ile aynı kaynaktan beslenir). */
  hosts: readonly string[];
  /** URL ve/veya ilan no → kanonik (ilan no, url). SAF, ağsız. */
  normalize(input: { url?: string | null; externalId?: string | null }): { externalId: string; url: string | null } | null;
  /** Dosya içe aktarma (CSV/XML) → gözlemler. Ağ yok. */
  parseInventory?(format: "csv" | "xml", data: string, seenAt: string): ObservedListing[];
  /** Yalnız RESMİ API (anahtar varsa). Sunucu portal sayfası çekmez. */
  checkListing?(ref: ListingRef): Promise<ListingCheckResult>;
  /** İstemciden gelen anlık görüntüyü gözleme çevirir (yalnız izinli alanlar). */
  parseAssistedSnapshot?(payload: unknown, schemaVersion: number): ObservedListing[];
  assistedRecipe?: AssistedRecipe;
}

const BLOCK_CODES = /^(http_(401|403|429)|captcha|login_required|blocked|rate_limited|timeout|http_5\d\d)$/;

/** Kontrol sonucunu durum makinesi gözlemine çevirir. found=false ve hata yok → absent; hata → blocked/error. */
export function listingCheckToResult(r: ListingCheckResult): CheckResultKind {
  if (r.error) return BLOCK_CODES.test(r.error) ? "blocked" : "error";
  if (r.found === true) return "present";
  if (r.found === false) return "absent";
  return "error";
}

export function defaultConfidence(kind: SourceKind): number {
  return kind === "api" ? 0.95 : kind === "manual" ? 0.9 : kind === "assisted" ? 0.7 : 0.85;
}
