import "server-only";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPublicTenantActive } from "@/lib/public-tenant";
import { isPublicFeatureClosed } from "@/lib/modules/public";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { isPast, now } from "@/lib/clock";
import type { FeatureKey } from "@/lib/modules/registry";
import { isSurveyTaskLinkExpired } from "@/lib/surveys/task-expiry";
import {
  firstPublicImageByProperty,
  PUBLIC_COVER_COLUMNS,
  selectWithDocumentFlag,
  type PublicCoverCandidate,
} from "@/lib/public-property-media";
import { renderVitrinOg, type VitrinOgInput } from "@/lib/vitrin-og";

/**
 * Müşteriye giden token'lı sayfaların (sunum, paylaşım, değerleme raporu, randevu teyidi, anket, imza) WhatsApp /
 * sosyal önizlemesi — TEK KAYNAK.
 *
 * NEDEN: bu linklerin ana dağıtım kanalı WhatsApp. Önizleme kartı kök `opengraph-image` (EmlakSoft markası) olarak
 * düşüyordu; müşteri linki "EmlakSoft" diye görüyordu, ofisi değil. Burada token tek kayda çözülür ve kart OFİS
 * markasıyla (ad, logo, marka rengi) çizilir; sunum/paylaşımda ilk ilan fotoğrafı arka plan olur.
 *
 * KURALLAR:
 *  - Token sayfanın kendi asgari kapılarıyla çözülür (kart sayfadan GEVŞEK olamaz; belge türlerinde bilerek daha
 *    sıkı: iptal/süresi dolmuş randevu ve sözleşme kart vermez): ofis aktif (isPublicTenantActive), süresi dolmuş
 *    paylaşım yok, kapalı modülde (presentations, valuation, surveys, contracts) içerik yok, örnek/silinmiş/taslak
 *    kayıt yok (ayrıntı `resolveDocTenant`). Kapı geçmezse `null` → kart genel ("Bağlantı bulunamadı") çizilir.
 *  - Kişisel/ticari ayrıntı karta YAZILMAZ: değerleme, randevu, anket ve imza kartında yalnız ofis adı + belge türü
 *    (ileten kişiye adres, tarih, tutar ya da sözleşme başlığı açılmaz). Sunum/paylaşım zaten ilan vitrinidir.
 *  - Fotoğraf yalnız public ilan görseli kuralından geçen ilk görseldir (KVKK P0-9, `isPublicListingImage`) ve
 *    sunucuda yeniden kodlanır (sharp; EXIF/GPS üst verisi atılır), ham bayt dışarı verilmez.
 *  - Sayfalar `robots: { index: false }` taşımaya DEVAM eder (seo-contract); bu modül yalnız önizleme alanlarını verir.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PHOTO_MAX_BYTES = 15 * 1024 * 1024;
const PHOTO_MIME_RE = /^image\/(?:jpeg|png|webp|avif|gif)$/i;

export type PublicLinkOg = Omit<VitrinOgInput, "photo"> & {
  /** Önizleme açıklaması (og:description), ≤160 karakter. */
  description: string;
  tenantId: string;
  /** Kart fotoğrafı için sıralı portföy id'leri (ilk public görsel kullanılır). Boşsa fotoğrafsız kart. */
  photoPropertyIds: string[];
};

export type PublicDocKind = "valuation" | "appointment" | "survey" | "contract";

type TenantBrand = { name?: string | null; status?: string | null; logo_url?: string | null; brand_color?: string | null };
type Rel<T> = T | T[] | null | undefined;
const one = <T,>(v: Rel<T>): T | null => (v == null ? null : Array.isArray(v) ? (v[0] ?? null) : v);
const relName = (v: Rel<{ name?: string | null }>) => one(v)?.name ?? null;

function clip(text: string, max = 160): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function money(n: number | null, tx: string | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  const t = (tx ?? "").toLowerCase();
  const rent = t === "rent" || t.includes("kira");
  return `${new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n)} ₺${rent ? "/ay" : ""}`;
}

/** Kapı geçmeyen/bulunamayan token'ın kartı — içerik taşımaz. */
export const PUBLIC_LINK_OG_FALLBACK: VitrinOgInput = { office: "EmlakSoft", title: "Bağlantı bulunamadı" };

/**
 * Sunum (/sunum/[token]): ofis adı + logo, sunum başlığı, portföy sayısı, ilk portföyün konumu ve fotoğrafı.
 * Sayfayla aynı süzgeç: örnek/silinmiş/taslak portföy atlanır, hiç portföy kalmazsa kart yok.
 */
export async function loadPresentationOg(token: string): Promise<PublicLinkOg | null> {
  if (!UUID_RE.test(token)) return null;
  const admin = createAdminClient();
  const { data: pres } = await admin
    .from("presentations")
    .select("tenant_id, title, property_ids, tenant:tenants(name, status, logo_url, brand_color)")
    .eq("public_token", token)
    .maybeSingle();
  const tenant = one(pres?.tenant as Rel<TenantBrand>);
  if (!pres || !tenant || !isPublicTenantActive(tenant.status)) return null;
  const ids = ((pres.property_ids ?? []) as string[]).filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return null;

  const [closed, { data: props }] = await Promise.all([
    isPublicFeatureClosed(admin, pres.tenant_id, "presentations"),
    admin
      .from("properties")
      .select("id, status, province:geo_provinces(name), district:geo_districts(name)")
      .in("id", ids)
      .eq("tenant_id", pres.tenant_id)
      .eq("is_sample", false)
      .is("deleted_at", null),
  ]);
  if (closed) return null;
  const byId = new Map(
    ((props ?? []) as { id: string; status: string | null; province: unknown; district: unknown }[])
      .filter((p) => p.status !== "draft")
      .map((p) => [p.id, p]),
  );
  const ordered = ids.map((id) => byId.get(id)).filter((p) => p != null);
  if (ordered.length === 0) return null;

  const office = tenant.name?.trim() || "Emlak ofisi";
  const first = ordered[0]!;
  const location =
    [relName(first.district as Rel<{ name?: string }>), relName(first.province as Rel<{ name?: string }>)].filter(Boolean).join(", ") || null;
  return {
    tenantId: pres.tenant_id,
    office,
    logoUrl: tenant.logo_url,
    brandColor: tenant.brand_color,
    badge: "Portföy sunumu",
    title: String(pres.title ?? "Portföy sunumu"),
    location,
    specs: [`${ordered.length} portföy`],
    description: clip(`${office} sizin için ${ordered.length} portföylük bir sunum hazırladı. Portföyleri inceleyin, beğendiğinizi danışmanınıza tek dokunuşla iletin.`),
    photoPropertyIds: ordered.map((p) => p.id),
  };
}

/** Tek portföy paylaşımı (/paylas/[token]): sayfanın kapıları (tür, süre, ofis, modül) + kapak fotoğrafı. */
export async function loadShareOg(token: string): Promise<PublicLinkOg | null> {
  const clean = (token ?? "").trim();
  if (!clean || clean.length > 128) return null;
  const admin = createAdminClient();
  const { data: share } = await admin
    .from("share_links")
    .select("tenant_id, entity_type, entity_id, expires_at, tenant:tenants(name, status, logo_url, brand_color)")
    .eq("token", clean)
    .maybeSingle();
  const tenant = one(share?.tenant as Rel<TenantBrand>);
  if (!share || share.entity_type !== "property" || isPast(share.expires_at) || !tenant || !isPublicTenantActive(tenant.status)) {
    return null;
  }
  const [closed, { data: p }] = await Promise.all([
    isPublicFeatureClosed(admin, share.tenant_id, "presentations"),
    admin
      .from("properties")
      .select("id, title, property_code, transaction_type, list_price, features, province:geo_provinces(name), district:geo_districts(name)")
      .eq("id", share.entity_id)
      .eq("tenant_id", share.tenant_id)
      .eq("is_sample", false)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  if (closed || !p) return null;

  const office = tenant.name?.trim() || "Emlak ofisi";
  const feat = (p.features ?? {}) as { rooms?: string; sqm?: number | string };
  const price = money(p.list_price != null ? Number(p.list_price) : null, p.transaction_type);
  const title = String(p.title || p.property_code || "Portföy");
  return {
    tenantId: share.tenant_id,
    office,
    logoUrl: tenant.logo_url,
    brandColor: tenant.brand_color,
    badge: p.transaction_type ?? null,
    title,
    location: [relName(p.district as Rel<{ name?: string }>), relName(p.province as Rel<{ name?: string }>)].filter(Boolean).join(", ") || null,
    price,
    specs: [feat.rooms ? String(feat.rooms) : null, feat.sqm ? `${feat.sqm} m²` : null].filter(Boolean) as string[],
    description: clip(`${title}${price ? ` · ${price}` : ""} — ${office} tarafından paylaşıldı.`),
    photoPropertyIds: [p.id as string],
  };
}

const DOC_LABEL: Record<PublicDocKind, { title: string; description: (office: string) => string }> = {
  valuation: { title: "Değerleme raporu", description: (o) => `${o} tarafından sizin için hazırlanan değerleme raporu.` },
  appointment: { title: "Randevu teyidi", description: (o) => `${o} ile randevunuzu tek dokunuşla onaylayın ya da değiştirin.` },
  survey: { title: "Memnuniyet anketi", description: (o) => `${o} hizmetini değerlendirin; bir dakikanızı alır.` },
  contract: { title: "Sözleşme imzası", description: (o) => `${o} tarafından imzanıza sunulan sözleşme.` },
};

type DocTenant = { tenantId: string; tenant: TenantBrand; feature: FeatureKey | null };

/**
 * Token → kiracı markası, sayfanın kendi asgari kapısıyla (kapı geçmezse null → genel kart):
 *  - değerleme: modül `valuation` kapalıysa kart yok (sayfa PublicModuleClosed gösterir);
 *  - randevu: örnek kayıt, iptal edilmiş ya da saati geçmiş randevu kart vermez;
 *  - anket: kapanış anketi örnek/silinmiş müşteriye bağlıysa yok; anketör görevi şablonsuz, örnek kayda bağlı,
 *    süresi dolmuş (cevaplanmamış) ya da `surveys` modülü kapalıysa yok;
 *  - imza: iptal edilmiş, süresi dolmuş ya da örnek sözleşme ve kapalı `contracts` modülü kart vermez.
 * Ofis durumu (isPublicTenantActive) ve modül kapısı tüm türlerde ortak uygulanır.
 */
async function resolveDocTenant(kind: PublicDocKind, token: string): Promise<DocTenant | null> {
  const admin = createAdminClient();
  const brand = "name, status, logo_url, brand_color";
  const pick = async (row: { tenant_id?: string; tenant?: unknown } | null | undefined, feature: FeatureKey | null): Promise<DocTenant | null> => {
    const tenant = one(row?.tenant as Rel<TenantBrand>);
    if (!row?.tenant_id || !tenant || !isPublicTenantActive(tenant.status)) return null;
    if (feature && (await isPublicFeatureClosed(admin, row.tenant_id, feature))) return null;
    return { tenantId: row.tenant_id, tenant, feature };
  };
  if (kind === "contract") {
    const clean = (token ?? "").trim();
    if (!clean || clean.length > 128) return null;
    const { data: signer } = await admin.from("contract_signers").select("contract_id").eq("token", clean).maybeSingle();
    if (!signer?.contract_id) return null;
    const { data: contract } = await admin
      .from("contracts")
      .select(`tenant_id, status, expires_at, is_sample, tenant:tenants(${brand})`)
      .eq("id", signer.contract_id)
      .maybeSingle();
    if (!contract || contract.status === "cancelled" || contract.is_sample === true || isPast(contract.expires_at)) return null;
    return pick(contract, "contracts");
  }
  if (!UUID_RE.test(token)) return null;
  if (kind === "valuation") {
    const { data } = await admin.from("valuations").select(`tenant_id, tenant:tenants(${brand})`).eq("share_token", token).maybeSingle();
    return pick(data, "valuation");
  }
  if (kind === "appointment") {
    const { data } = await admin
      .from("appointments")
      .select(`tenant_id, status, scheduled_at, tenant:tenants(${brand})`)
      .eq("confirm_token", token)
      .eq("is_sample", false)
      .maybeSingle();
    if (!data || data.status === "cancelled" || isPast(data.scheduled_at)) return null;
    return pick(data, null);
  }
  const { data: survey } = await admin
    .from("surveys")
    .select(`tenant_id, customer_id, tenant:tenants(${brand})`)
    .eq("public_token", token)
    .maybeSingle();
  if (survey) {
    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("id", survey.customer_id)
      .eq("tenant_id", survey.tenant_id)
      .eq("is_sample", false)
      .is("deleted_at", null)
      .maybeSingle();
    return customer ? pick(survey, null) : null;
  }
  const { data: task, error } = await admin
    .from("survey_tasks")
    .select(`tenant_id, status, template_id, customer_id, property_id, due_at, tenant:tenants(${brand})`)
    .eq("public_token", token)
    .maybeSingle();
  if (error || !task?.template_id) return null;
  if (task.status !== "completed" && isSurveyTaskLinkExpired(task.due_at as string | null, now())) return null;
  const [{ data: c }, { data: p }] = await Promise.all([
    task.customer_id
      ? admin.from("customers").select("id").eq("id", task.customer_id).eq("tenant_id", task.tenant_id).eq("is_sample", false).is("deleted_at", null).maybeSingle()
      : Promise.resolve({ data: { id: "" } }),
    task.property_id
      ? admin.from("properties").select("id").eq("id", task.property_id).eq("tenant_id", task.tenant_id).eq("is_sample", false).maybeSingle()
      : Promise.resolve({ data: { id: "" } }),
  ]);
  return c && p ? pick(task, "surveys") : null;
}

/** Belge linkleri (değerleme, randevu teyidi, anket, imza): yalnız ofis markası + belge türü; ayrıntı yazılmaz. */
export async function loadDocLinkOg(kind: PublicDocKind, token: string): Promise<PublicLinkOg | null> {
  const resolved = await resolveDocTenant(kind, token);
  if (!resolved) return null;
  const office = resolved.tenant.name?.trim() || "Emlak ofisi";
  const label = DOC_LABEL[kind];
  return {
    tenantId: resolved.tenantId,
    office,
    logoUrl: resolved.tenant.logo_url,
    brandColor: resolved.tenant.brand_color,
    title: label.title,
    location: "Size özel bağlantı",
    description: clip(label.description(office)),
    photoPropertyIds: [],
  };
}

/**
 * Önizleme metadata'sı: başlık OFİS markalı (`<başlık> · <ofis>`, kök "| EmlakSoft" eki yok), og:site_name ofis adı,
 * büyük görselli kart. Görsel URL'i Next.js dosya kuralından (`opengraph-image.tsx`) otomatik eklenir.
 * `robots` çağıranın elindedir (sayfada `index: false` literal kalır — seo-contract).
 */
export function publicLinkMetadata(og: PublicLinkOg | null, fallbackTitle: string): Metadata {
  if (!og) return { title: fallbackTitle };
  const title = `${og.title} · ${og.office}`;
  return {
    title: { absolute: title },
    description: og.description,
    openGraph: { type: "website", locale: "tr_TR", siteName: og.office, title, description: og.description },
    twitter: { card: "summary_large_image", title, description: og.description },
  };
}

/**
 * Maliyet kalkanı: token'lı kart rotaları önbelleksiz (kapılar her istekte değerlendirilir), ama pahalı kısım —
 * depodan ≤15 MB indirme + sharp — ayni görsel için isolate-yerel kısa önbellekten gelir (anahtar: medya id + depo
 * yolu; görsel kapıdan düşerse sorgu onu seçmez, önbellek de kullanılmaz). Önbellekte olmayan her yeniden kodlama
 * IP başına sınırlanır; aşımda fotoğrafsız markalı kart çizilir (önizleme kırılmaz). WhatsApp/Meta tarayıcıları ortak
 * IP'lerden geldiği için sınır cömerttir ve yalnız fotoğrafı keser, kartı değil.
 */
const PHOTO_CACHE_TTL_MS = 10 * 60 * 1000;
const PHOTO_CACHE_MAX = 64;
const photoCache = new Map<string, { dataUrl: string; expiresAt: number }>();

function cachedPhoto(key: string, at: number): string | null {
  const hit = photoCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= at) {
    photoCache.delete(key);
    return null;
  }
  return hit.dataUrl;
}

function rememberPhoto(key: string, dataUrl: string, at: number) {
  if (photoCache.size >= PHOTO_CACHE_MAX) {
    for (const [k, v] of photoCache) if (v.expiresAt <= at) photoCache.delete(k);
    while (photoCache.size >= PHOTO_CACHE_MAX) photoCache.delete(photoCache.keys().next().value as string);
  }
  photoCache.set(key, { dataUrl, expiresAt: at + PHOTO_CACHE_TTL_MS });
}

/** Test yardımcısı: isolate-yerel fotoğraf önbelleğini boşaltır. */
export function __resetOgPhotoCacheForTests() {
  photoCache.clear();
}

/**
 * Kart fotoğrafı: sıralı portföylerden ilk public ilan görseli (kapak önde, sonra sort_order), sunucuda 1200x630
 * JPEG'e yeniden kodlanır ve data: URL olarak döner. Görsel yok/okunamıyor/işlenemiyor → null (fotoğrafsız yedek
 * kart çizilir; önizleme asla kırılmaz).
 */
export async function loadOgPhoto(tenantId: string, propertyIds: readonly string[]): Promise<string | null> {
  const ids = propertyIds.filter((id) => UUID_RE.test(id)).slice(0, 5);
  if (ids.length === 0) return null;
  try {
    const admin = createAdminClient();
    type Row = PublicCoverCandidate & { storage_path: string | null; file_size: number | null };
    const { data: rows } = await selectWithDocumentFlag<Row[]>(`${PUBLIC_COVER_COLUMNS}, storage_path, file_size`, (columns) =>
      admin
        .from("property_media")
        .select(columns)
        .in("property_id", ids)
        .eq("tenant_id", tenantId)
        .eq("kind", "image")
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true })
        .limit(60),
    );
    const usable = (rows ?? []).filter(
      (r) => r.storage_path && r.file_type && PHOTO_MIME_RE.test(r.file_type) && (r.file_size ?? 0) <= PHOTO_MAX_BYTES,
    );
    const firstByProperty = firstPublicImageByProperty(usable);
    const mediaId = ids.map((id) => firstByProperty.get(id)).find(Boolean);
    const media = mediaId ? usable.find((r) => r.id === mediaId) : null;
    if (!media?.storage_path) return null;

    const at = now();
    const cacheKey = `${tenantId}:${media.id}:${media.storage_path}`;
    const hit = cachedPhoto(cacheKey, at);
    if (hit) return hit;
    const { allowed } = await checkRateLimit(`og-photo:${await clientIp()}`, {
      limit: 60,
      windowSec: 600,
      failurePolicy: "allow",
      localAllowance: 15,
    });
    if (!allowed) return null;

    const { data: blob, error } = await admin.storage.from("property-media").download(media.storage_path);
    if (error || !blob) return null;
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(Buffer.from(await blob.arrayBuffer()), { limitInputPixels: 60_000_000 })
      .rotate()
      .resize(1200, 630, { fit: "cover", position: "attention" })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    rememberPhoto(cacheKey, dataUrl, at);
    return dataUrl;
  } catch (e) {
    console.error("loadOgPhoto", e instanceof Error ? e.message : e);
    return null;
  }
}

// Token'lı kart: süresi dolan/iptal edilen link ya da pasifleşen ofis anında yansısın (ImageResponse varsayılanı 1 yıl immutable).
const NO_STORE = { headers: { "Cache-Control": "private, no-store, max-age=0" } };

/** `opengraph-image.tsx` / `twitter-image.tsx` gövdesi: kapı geçmeyen token genel kart, geçen ofis markalı (+fotoğraf). */
export async function renderPublicLinkOgImage(og: PublicLinkOg | null) {
  if (!og) return renderVitrinOg(PUBLIC_LINK_OG_FALLBACK, NO_STORE);
  const photo = og.photoPropertyIds.length > 0 ? await loadOgPhoto(og.tenantId, og.photoPropertyIds) : null;
  return renderVitrinOg({
    office: og.office,
    logoUrl: og.logoUrl,
    brandColor: og.brandColor,
    badge: og.badge,
    title: og.title,
    location: og.location,
    price: og.price,
    specs: og.specs,
    photo,
  }, NO_STORE);
}
