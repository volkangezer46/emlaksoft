"use server";

import { emitWebhook } from "@/lib/integrations-api/webhooks";
import { revalidatePath, revalidateTag } from "next/cache";
import { ignoredFieldsWarning, parsePortalFeatureFieldsDetailed } from "@/lib/portal-transfer/features";
import { parseAreaInput } from "@/lib/area-input";
import { fetchLatestRates } from "@/lib/fx";
import { currencyFeatureValue, normalizePropertyCurrency, priceForHealth, propertyCurrency, type PropertyCurrency } from "@/lib/property-currency";
import { parsePropertyDescription, withDescription } from "@/lib/property-description";
import { parseVirtualTourUrl, withVirtualTour } from "@/lib/virtual-tour";
import { revalidateTenantData } from "@/lib/revalidate";
import { redirect } from "next/navigation";
import { afterSafe } from "@/lib/after-safe";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { planLimitErrorMessage } from "@/lib/billing/plan-limit-error";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { resolvePriceHealth } from "@/lib/comparables";
import { notifyMatchingDemandsForProperty } from "@/lib/match-notify";
import { notifyTenant } from "@/lib/notify";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand, type MatchProperty } from "@/lib/matching";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { triggerPlaybooks } from "@/lib/playbook-trigger";
import { parseMoneyInput } from "@/lib/money-input";
import { findPropertyDuplicates } from "@/lib/duplicate-finders";
import { getDistrictName, getProvinceName } from "@/lib/geo/reader";
import { PHONE_ERROR_MESSAGE } from "@/lib/phone";
import { parsePhoneStrict } from "@/lib/phone-rules";
import { EMAIL_ERROR_MESSAGE, isValidEmail, normalizeEmail } from "@/lib/email";
import { parseOwnerInfoForm, type OwnerInfoInput } from "@/lib/property-owner/info";
import { saveOwnerInfo } from "@/lib/property-owner/persist";
import { publishBlockReason } from "@/lib/property-owner/server";
import { enqueueListingPool, isPoolEnabled, toPoolProperty } from "@/lib/pool/server";
import { assignPoolEntryAsSystem } from "@/lib/pool/system-assign";
import { isIncomingPoolSource, parseIncomingPoolSource } from "@/lib/pool/sources";
import { requestApprovalIfNeeded } from "@/lib/oversight/approval-gate";
import { notifyNewListing, notifyPoolAssigned, notifyPoolEntry } from "@/lib/pool/notify";
import { shortAuthorityWarning } from "@/lib/eids/authority-term";
import { now as clockNow, trDayKey } from "@/lib/clock";
import { notifyAssignment } from "@/lib/assignment-notify";
import { actionErrorMessage } from "@/lib/action-errors";
import { linkConvertedFsboLead } from "@/lib/prospecting/convert";
import { prepareCustomFieldInputs, writeCustomFieldInputs } from "@/lib/custom-fields/save";

export type PropertyResult = {
  error?: string;
  ok?: boolean;
  matchedDemands?: number;
  /** İlan sahibi bilgi tamamlama puanı (0-100); form gönderilmediyse yok. */
  ownerInfoScore?: number;
  /** Yayın için eksik zorunlu ilan sahibi alanları (boşsa yayına hazır). */
  ownerMissing?: string[];
  /** İlan havuzuna gönderildi (atama bekliyor / sahiplenme / otomatik atandı). */
  pooled?: boolean;
  /** Yetki süresi EİDS kuralına (en az 3 ay) uymuyorsa uyarı; kayıt yapılmıştır. */
  authorityWarning?: string;
  /** Oluşan portföyün kimliği (hızlı kayıt fotoğrafı aynı ekranda bağlar). */
  id?: string;
  /** Giriş anı mükerrer kontrolü takıldı: aynı form `allow_duplicate=1` ile yeniden gönderilebilir. */
  duplicate?: boolean;
  /** Kayıt yapıldı ama geçersiz ek alanlar yok sayıldı (ör. 'yok sayıldı: Aidat "abc"'). */
  warnings?: string[];
};

/** Havuza yönlendirmede "kendi adına ekleyen" sayılan roller; diğer roller (ör. çağrı merkezi) ilanı atanmamış açar. */
const LISTING_OWNER_ROLES = ["owner", "gm", "branch_manager", "team_lead", "advisor"];

/** Boş ise null; geçerli bir enlem/boylam sayısıysa döndürür. */
function parseCoord(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < -180 || n > 180) return null;
  return n;
}

const MANUAL_STATUSES = ["draft", "live", "reserved", "archived"];

/**
 * Public vitrin sayfaları ISR'lı (`export const revalidate = 120`). Yayın
 * içeriğini değiştiren mutasyonlarda 2 dk beklemeden tazelensin diye path
 * bazlı invalidation yapılır. Tag'li cache yok (cacheComponents kapalı,
 * `use cache`/`cacheTag` kullanılamıyor) → `revalidateTag` burada no-op olurdu;
 * doğru mekanizma route-pattern'li `revalidatePath`. `[slug]` deseni tüm
 * tenant vitrinlerini kapsar; bir sonraki ziyarette yeniden üretilir (ucuz).
 */
function revalidateVitrinPaths() {
  revalidatePath("/vitrin/[slug]", "page");
  revalidatePath("/vitrin/[slug]/[id]", "page");
  // Liste verisi unstable_cache içinde ("vitrin" etiketi) — yol geçersizleştirmesine ek olarak etiket de düşer.
  revalidateTag("vitrin", "max");
}

/**
 * Kat/bina yaşı: boş → null; tam sayıya çevrilebiliyorsa değer. Geçersiz metin ("Bahçe katı") kaydı durdurmaz
 * ama `invalid` ile çağırana döner: sessizce silinmez, "yok sayıldı" uyarısı üretilir (B093).
 */
function parseIntField(raw: FormDataEntryValue | null): { value: number | null; invalid: boolean } {
  const s = String(raw ?? "").trim();
  if (!s) return { value: null, invalid: false };
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return { value: null, invalid: true };
  return { value: Math.trunc(n), invalid: false };
}

/** Para birimi: Fiyat sekmesindeki seçici (`currency`, TL|USD|EUR). Formda yoksa null (mevcut değer korunur). */
function parseCurrencyField(formData: FormData): PropertyCurrency | null {
  if (!formData.has("currency")) return null;
  return normalizePropertyCurrency(formData.get("currency")) ?? "TRY";
}

/**
 * Formdaki detay alanlarını features jsonb anahtarlarına çevirir.
 * Anahtar adları portal-publish.ts / broşür / property-health.ts ile AYNI:
 * rooms, sqm, floor, heating, building_age, facade. Geçersiz ek alanlar `warnings` ile döner.
 */
function parseFeatureFields(
  formData: FormData,
  base: { rooms: string; sqm: number | null; currency: PropertyCurrency | null },
): { features: Record<string, unknown>; warnings: string[] } {
  const heating = String(formData.get("heating") ?? "").trim();
  const facade = String(formData.get("facade") ?? "").trim();
  const floor = parseIntField(formData.get("floor"));
  const buildingAge = parseIntField(formData.get("building_age"));
  // Portal formlarının istediği ek alanlar: yalnız formda alanı VARSA yazılır (düzenleme formu göstermiyorsa mevcut değer silinmez).
  const portal = parsePortalFeatureFieldsDetailed(formData);
  const ignored = [
    ...(floor.invalid ? [{ label: "Kat", raw: String(formData.get("floor") ?? "").trim().slice(0, 40) }] : []),
    ...(buildingAge.invalid ? [{ label: "Bina yaşı", raw: String(formData.get("building_age") ?? "").trim().slice(0, 40) }] : []),
    ...portal.ignored,
  ];
  const warning = ignoredFieldsWarning(ignored);
  return {
    features: {
      rooms: base.rooms || null,
      sqm: base.sqm,
      floor: floor.value,
      heating: heating || null,
      building_age: buildingAge.value,
      facade: facade || null,
      ...portal.values,
      // Sözleşme (f): para birimi sütunla birlikte features.currency'ye de yazılır (portal aktarımı + herkese açık yüzeyler).
      ...(base.currency ? { currency: currencyFeatureValue(base.currency) } : {}),
    },
    warnings: warning ? [warning] : [],
  };
}

/** Fiyat sağlığı için ₺ ölçeğinde fiyat: döviz fiyatı TCMB kuruyla çevrilir; kur yoksa sağlık hesaplanmaz (null). */
async function healthPriceTry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  listPrice: number,
  currency: PropertyCurrency,
): Promise<{ priceTry: number | null; unrated: boolean }> {
  if (currency === "TRY") return { priceTry: listPrice, unrated: false };
  return priceForHealth(listPrice, currency, await fetchLatestRates(supabase));
}

/**
 * Fiyat DÜŞTÜĞÜNDE eşleşen açık taleplerin danışmanlarına bildirim gönderir.
 *
 * match-notify.ts'teki desenin fiyat-düşüşü varyantı: aynı skorlayıcı
 * (scoreDemandProperty) yeniden kullanılır; talep sahibinin danışmanı
 * (customers.assigned_to) hedeflenir, danışman atanmamışsa fiyatı güncelleyen
 * kullanıcıya düşer. Bildirim patlamasını önlemek için en iyi 10 eşleşmeyle
 * sınırlı. Best-effort: hata fiyat güncellemesini asla bozmaz.
 *
 * Not: export EDİLMİYOR — "use server" dosyasında export edilen her fonksiyon
 * tarayıcıdan çağrılabilir bir uç nokta olur (bkz. lib/notify.ts açıklaması).
 */
async function notifyPriceDropToMatchingDemands(input: {
  tenantId: string;
  fallbackUserId: string;
  property: MatchProperty;
  oldPrice: number;
  newPrice: number;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    // Ofise özel ağırlıklar — döngü DIŞINDA tek sorgu; tanımsızsa varsayılan davranış.
    const weightsPromise = fetchTenantMatchingWeights(admin, input.tenantId);
    const { data: demands } = await admin
      .from("customer_demands")
      .select(
        "id, transaction_type, property_type, province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, customer:customers!customer_demands_customer_id_fkey(full_name, assigned_to)",
      )
      .eq("tenant_id", input.tenantId)
      .in("status", ["new", "active", "matched"])
      .limit(500);

    if (!demands?.length) return;

    const weights = await weightsPromise;
    const MATCH_THRESHOLD = 60; // match-notify.ts ile aynı "iyi/güçlü" eşiği
    type CustomerRel = { full_name?: string | null; assigned_to?: string | null };
    const matched: { customerName: string; advisorId: string | null; score: number }[] = [];
    for (const d of demands) {
      const result = scoreDemandProperty(d as unknown as MatchDemand, input.property, weights);
      if (!result.eliminated && result.score >= MATCH_THRESHOLD) {
        const rel = d.customer as CustomerRel | CustomerRel[] | null;
        const customer = Array.isArray(rel) ? rel[0] : rel;
        matched.push({
          customerName: customer?.full_name ?? "Müşteri",
          advisorId: customer?.assigned_to ?? null,
          score: result.score,
        });
      }
    }

    if (!matched.length) return;
    matched.sort((a, b) => b.score - a.score);

    const fmt = (v: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(v);
    const label = input.property.title ?? input.property.property_code;
    for (const m of matched.slice(0, 10)) {
      await notifyTenant({
        tenantId: input.tenantId,
        userId: m.advisorId ?? input.fallbackUserId,
        title: `${label} fiyatı düştü: ₺${fmt(input.oldPrice)} → ₺${fmt(input.newPrice)}`,
        body: `${m.customerName} talebiyle eşleşiyor.`,
        href: `/app/talepler?sekme=eslesme&property=${input.property.id}`,
        kind: "info",
        prefKey: "priceDrop",
      });
    }
  } catch (e) {
    console.error("notifyPriceDropToMatchingDemands", e);
  }
}

/**
 * Fiyat sağlığı modelinin konum ipucu: önce ilçe adı, yoksa il adı.
 *
 * İlçe belirgin şekilde daha iyi bir sinyal — Kadıköy ile Sultanbeyli'nin m²
 * fiyatı arasındaki fark, İstanbul ile Konya arasındakinden büyük. Bu yüzden
 * ilçe varsa il adı hiç sorgulanmıyor: tek bir gidiş-dönüş yeter.
 */
async function resolveGeoHint(provinceId: string, districtId: string): Promise<string | null> {
  if (districtId) {
    const name = await getDistrictName(districtId);
    if (name) return name;
  }
  if (provinceId) return getProvinceName(provinceId);
  return null;
}

export async function createProperty(formData: FormData): Promise<PropertyResult> {
  const gate = await requirePermission("properties", "create");
  if (!gate.ok) return { error: gate.error };

  const supabase = await createClient();
  const title = String(formData.get("title") ?? "").trim();
  const transactionType = String(formData.get("transaction_type") ?? "").trim();
  const propertyType = String(formData.get("property_type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const districtId = String(formData.get("district_id") ?? "").trim();
  const neighborhoodId = String(formData.get("neighborhood_id") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const addressLine = String(formData.get("address_line") ?? "").trim();
  const latVal = parseCoord(formData.get("lat"));
  const lngVal = parseCoord(formData.get("lng"));
  const rooms = String(formData.get("rooms") ?? "").trim();
  const priceResult = parseMoneyInput(formData.get("list_price"), { max: 1_000_000_000_000 });
  const commissionResult = parseMoneyInput(formData.get("commission_rate"), { max: 100 });
  const parcelBlock = String(formData.get("parcel_block") ?? "").trim();
  const parcelLot = String(formData.get("parcel_lot") ?? "").trim();
  const currency = parseCurrencyField(formData) ?? "TRY";

  if (!title || !transactionType || !propertyType) {
    return { error: "Başlık, işlem türü ve portföy türü zorunlu." };
  }
  // Çekirdek alan: geçersiz m² alan adıyla reddedilir ("1.250" → 1250, "" → null; B093).
  const sqmResult = parseAreaInput(formData.get("sqm"), { label: "Brüt m²", propertyType });
  if (!sqmResult.ok) return { error: sqmResult.error };
  const sqmValue = sqmResult.value;
  if (!priceResult.ok || priceResult.value == null) {
    return { error: "Geçerli bir liste fiyatı girin." };
  }
  if (!commissionResult.ok || commissionResult.value == null) {
    return { error: "Komisyon oranı 0'dan büyük, en fazla 100 ve en çok iki ondalık haneli olmalıdır." };
  }
  const priceValue = priceResult.value;
  const commissionValue = commissionResult.value;

  // İlan sahibi (malik) bilgileri: yalnız yeni formda (owner_info_present) okunur; eski çağrılar etkilenmez.
  let ownerInfo: OwnerInfoInput | null = null;
  let ownerPhoneStored = "";
  let ownerEmail = "";
  if (formData.has("owner_info_present")) {
    const parsed = parseOwnerInfoForm((n) => {
      const v = formData.get(n);
      return typeof v === "string" ? v : null;
    });
    if (parsed.error) return { error: parsed.error };
    ownerInfo = parsed.value;
    if (ownerInfo.minPrice != null && ownerInfo.minPrice > priceValue) {
      return { error: "Minimum fiyat liste fiyatından yüksek olamaz." };
    }
    if (ownerInfo.ownerPhone) {
      const phone = parsePhoneStrict(ownerInfo.ownerPhone);
      if (!phone.ok) return { error: phone.error ?? PHONE_ERROR_MESSAGE };
      ownerPhoneStored = phone.stored;
    }
    ownerEmail = normalizeEmail(ownerInfo.ownerEmail);
    if (ownerEmail && !isValidEmail(ownerEmail)) return { error: EMAIL_ERROR_MESSAGE };
    if (ownerInfo.ownerCustomerId) {
      const { data: ownerCustomer } = await supabase
        .from("customers")
        .select("id, phone")
        .eq("id", ownerInfo.ownerCustomerId)
        .eq("tenant_id", gate.tenantId)
        .is("deleted_at", null)
        .maybeSingle();
      if (!ownerCustomer) return { error: "Seçilen ilan sahibi müşteri bulunamadı." };
      ownerInfo = { ...ownerInfo, existingOwnerHasPhone: Boolean((ownerCustomer as { phone?: string | null }).phone) };
    }
  }

  // Havuz yönlendirmesi: havuz açıksa ve (danışman istediyse ya da ilanı kendi adına açamayacak bir rolse) ilan atanmamış açılır.
  // Dış kaynaktan gelen ilan (portal/form, ağ, API, eklenti) danışmansız açılır ve havuza düşer; kaynak havuz kaydına yazılır.
  const poolSource = parseIncomingPoolSource(formData.get("pool_source"));
  const wantsPool = isIncomingPoolSource(poolSource) || formData.get("send_to_pool") === "1" || !LISTING_OWNER_ROLES.includes(gate.role);
  const routeToPool = wantsPool ? await isPoolEnabled(supabase, gate.tenantId) : false;

  // Giriş anı mükerrer kontrolü: aynı ada/parsel, adres ya da başlık+mahalle varsa kasıtlı onay (allow_duplicate=1) gerekir.
  if (String(formData.get("allow_duplicate") ?? "") !== "1") {
    const dups = await findPropertyDuplicates(
      supabase,
      {
        tenantId: gate.tenantId,
        probe: {
          title,
          address: addressLine,
          block: parcelBlock,
          lot: parcelLot,
          propertyType,
          transactionType,
          districtId,
          neighborhoodId,
        },
      },
      { userId: gate.userId, officeWide: false },
    );
    if (dups.length > 0) {
      return {
        duplicate: true,
        error:
          "Benzer bir portföy zaten var. Formdaki uyarıyı inceleyin; yine de yeni kayıt açmak için \"Yine de yeni kayıt\" seçin.",
      };
    }
  }

  const stamp = new Date().toISOString().slice(2, 7).replace("-", "");
  const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  const propertyCode = `ES-${stamp}-${suffix}`;

  // `districtHint` adi ilce demek ama ONCEDEN IL adi geciriliyordu; formda
  // ilce alani hic yoktu. Artik once ilce, yoksa il adi kullaniliyor —
  // ilce bazli m2 referanslari (Kadikoy, Cankaya, Nilufer...) ancak boyle devreye giriyor.
  const [districtHint, healthPrice] = await Promise.all([
    resolveGeoHint(provinceId, districtId),
    healthPriceTry(supabase, priceValue, currency),
  ]);
  // Tek sefer hesaplanır — hem emsal düzeltmesine hem insert'e aynı nesne girer.
  const { features, warnings } = parseFeatureFields(formData, { rooms, sqm: sqmValue, currency });
  // Önce emsal motoru, yetersizse m² referans modeli — kalıcı price_health tek karar noktasından.
  // Döviz fiyat ₺ karşılığıyla değerlendirilir; kur yoksa sağlık yazılmaz (sahte "Riskli" yok; B094).
  const health = healthPrice.priceTry == null
    ? null
    : await resolvePriceHealth(supabase, {
        tenantId: gate.tenantId,
        listPrice: healthPrice.priceTry,
        sqm: sqmValue,
        districtId: districtId || null,
        propertyType,
        transactionType,
        districtHint,
        targetFloor: features.floor as number | null,
        targetBuildingAge: features.building_age as number | null,
        targetHeating: features.heating as string | null,
        targetFacade: features.facade as string | null,
      });

  // Özel alanlar: kayıttan ÖNCE doğrulanır (zorunlu/tür hatası portföyü yazdırmaz).
  const customFields = await prepareCustomFieldInputs(supabase, gate.tenantId, "property", formData);
  if (!customFields.ok) return { error: customFields.error };

  const { data, error } = await supabase
    .from("properties")
    .insert({
      tenant_id: gate.tenantId,
      property_code: propertyCode,
      title,
      transaction_type: transactionType,
      property_type: propertyType,
      status: "draft",
      list_price: priceValue,
      currency,
      commission_rate: commissionValue,
      province_id: provinceId || null,
      district_id: districtId || null,
      neighborhood_id: neighborhoodId || null,
      branch_id: branchId || null,
      address_line: addressLine || null,
      lat: latVal,
      lng: lngVal,
      parcel_block: parcelBlock || null,
      parcel_lot: parcelLot || null,
      features,
      price_health: health,
      assigned_to: routeToPool ? null : gate.userId,
      created_by: gate.userId,
      // Yetki sözleşmesi ve minimum fiyat mevcut properties sütunlarına yazılır (yetki belgesi paneliyle aynı alanlar).
      ...(ownerInfo
        ? {
            min_price: ownerInfo.minPrice,
            authorization_type: ownerInfo.authorizationType || null,
            authorization_start: ownerInfo.authorizationStart || null,
            authorization_end: ownerInfo.authorizationEnd || null,
            // Yalnız girildiyse yazılır: sütun henüz yoksa (migration 20260826002950 uygulanmamış) eski kayıt akışı bozulmaz.
            ...(ownerInfo.eidsNo ? { eids_property_no: ownerInfo.eidsNo } : {}),
          }
        : {}),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createProperty", error);
    return { error: planLimitErrorMessage(error) ?? actionErrorMessage(error, "Portföy eklenemedi. Lütfen tekrar deneyin.") };
  }
  await writeCustomFieldInputs(supabase, { tenantId: gate.tenantId, userId: gate.userId, recordId: data.id }, customFields.value);

  // İlan sahibi: müşteri kaydına bağla + ayrıntıları yaz (şema yoksa notlara düşer; ilan her durumda oluşur).
  let ownerInfoScore: number | undefined;
  let ownerMissing: string[] | undefined;
  let ownerCustomerId: string | null = null;
  if (ownerInfo) {
    const saved = await saveOwnerInfo(supabase, {
      tenantId: gate.tenantId,
      userId: gate.userId,
      propertyId: data.id,
      propertyCode,
      info: ownerInfo,
      phoneStored: ownerPhoneStored,
      emailNormalized: ownerEmail,
      branchId: branchId || null,
    });
    ownerInfoScore = saved.evaluation.score;
    ownerMissing = saved.evaluation.missing.map((m) => m.label);
    if (saved.error) console.error("createProperty owner info", saved.error);
    if (saved.customerId) revalidatePath("/app/musteriler");
    ownerCustomerId = saved.customerId ?? null;
  }

  // Sahibinden ilan adayından gelen portföy (?fsbo=<id>): aday "Portföye döndü" olur (hata portföyü etkilemez).
  const fsboLeadId = String(formData.get("fsbo_lead_id") ?? "").trim();
  if (fsboLeadId) {
    const linked = await linkConvertedFsboLead(supabase, {
      tenantId: gate.tenantId,
      userId: gate.userId,
      role: gate.role,
      leadId: fsboLeadId,
      propertyId: data.id,
      customerId: ownerCustomerId,
    });
    if (linked.ok) revalidatePath("/app/portfoy-avi");
    else console.error("createProperty fsbo dönüşümü", linked.error);
  }

  // Havuz: kayıt aç, öneri üret, moda göre (otomatik atama / sahiplenme / yönetici bekler) karar ver.
  let pooled = false;
  if (routeToPool) {
    const queued = await enqueueListingPool(supabase, {
      tenantId: gate.tenantId,
      propertyId: data.id,
      actorId: gate.userId,
      source: poolSource,
      property: toPoolProperty({
        property_type: propertyType,
        transaction_type: transactionType,
        province_id: provinceId || null,
        district_id: districtId || null,
        neighborhood_id: neighborhoodId || null,
        list_price: priceValue,
      }),
    });
    const poolLabel = title || propertyCode;
    if (queued.queued) {
      pooled = true;
      let finalDecision = queued.decision;
      if (queued.decision.kind === "auto_assign") {
        const res = await assignPoolEntryAsSystem({
          tenantId: gate.tenantId,
          entryId: queued.entryId,
          profileId: queued.decision.profileId,
          method: "auto",
          score: queued.decision.score,
          reason: "Puan eşiği aşıldı; otomatik atandı.",
        });
        if (res.ok) {
          const assigneeId = queued.decision.profileId;
          afterSafe(() =>
            notifyPoolAssigned(supabase, {
              tenantId: gate.tenantId,
              actorId: gate.userId,
              assigneeId,
              propertyId: data.id,
              label: poolLabel,
              method: "auto",
            }),
          );
        } else {
          finalDecision = { kind: "await_owner", reason: "below_threshold" };
        }
      }
      if (finalDecision.kind !== "auto_assign") {
        const awaitingDecision = finalDecision;
        afterSafe(() =>
          notifyPoolEntry(supabase, {
            tenantId: gate.tenantId,
            actorId: gate.userId,
            propertyId: data.id,
            label: poolLabel,
            decision: awaitingDecision,
          }),
        );
      }
    } else {
      // Havuz kaydı açılamadı: ilan sahipsiz kalmasın, ekleyen danışmana verilir.
      await supabase.from("properties").update({ assigned_to: gate.userId }).eq("id", data.id).eq("tenant_id", gate.tenantId);
    }
  }

  // Ofis sahibine bildirim/görev: yeni ilan + (varsa) eksik ilan sahibi bilgisi.
  if (!pooled) {
    afterSafe(() =>
      notifyNewListing(supabase, {
        tenantId: gate.tenantId,
        actorId: gate.userId,
        propertyId: data.id,
        label: title || propertyCode,
        ownerInfoScore: ownerInfoScore ?? null,
        missing: ownerMissing ?? [],
      }),
    );
  }

  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.create",
    entityType: "property",
    entityId: data.id,
    newValue: { property_code: propertyCode, title },
  }));

  // Otomatik eşleştirme bildirimi — yeni portföyü aktif taleplerle skorla, güçlü eşleşme varsa danışmanı uyar
  const matchedDemands = await notifyMatchingDemandsForProperty(gate.tenantId, gate.userId, {
    id: data.id,
    property_code: propertyCode,
    title,
    transaction_type: transactionType,
    property_type: propertyType,
    status: "draft",
    // Talep bütçeleri ₺: döviz fiyat ₺ karşılığıyla eşleşir (kur yoksa ham fiyat — eski davranış).
    list_price: healthPrice.priceTry ?? priceValue,
    province_id: provinceId || null,
    // Onceden burada `district_id: null` sabiti vardi: talep eslestirme ilceye
    // gore puanladigi icin ilce esmesi HIC calismiyordu.
    district_id: districtId || null,
    neighborhood_id: neighborhoodId || null,
    features: features as MatchProperty["features"],
  });

  // Otomasyon tetikle — hata ana işlemi asla bozmasın
  afterSafe(() =>
    Promise.resolve()
      .then(() => dispatchAutomationEvent(gate.tenantId, "new_property", {
      entityType: "property",
      entityId: data.id,
      propertyId: data.id,
      label: [propertyCode, title].filter(Boolean).join(" · "),
      assignedTo: gate.userId,
      fields: { transaction_type: transactionType, property_type: propertyType, list_price: priceValue },
    }))
      .catch((e) => console.error("automation new_property", e)),
    );

  // İş akışı (playbook) tetikle — çok adımlı görev paketi; hata ana işlemi bozmaz
  afterSafe(() => triggerPlaybooks({
    tenantId: gate.tenantId,
    event: "yeni_portfoy",
    actorId: gate.userId,
    entity: {
      type: "property",
      id: data.id,
      label: [propertyCode, title].filter(Boolean).join(" · "),
      ownerId: gate.userId,
      propertyId: data.id,
      fields: { transaction_type: transactionType, property_type: propertyType },
    },
  }));

  emitWebhook("property.created", "property", data.id);
  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${data.id}`);
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  const authorityWarning = ownerInfo
    ? (shortAuthorityWarning(ownerInfo.authorizationStart, ownerInfo.authorizationEnd, clockNow()) ?? undefined)
    : undefined;
  return {
    ok: true,
    id: data.id,
    matchedDemands,
    ownerInfoScore,
    ownerMissing,
    pooled,
    authorityWarning,
    ...(warnings.length ? { warnings } : {}),
  };
}

export async function updateProperty(formData: FormData): Promise<PropertyResult> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return { error: gate.error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "Portföy bulunamadı." };

  const title = String(formData.get("title") ?? "").trim();
  const transactionType = String(formData.get("transaction_type") ?? "").trim();
  const propertyType = String(formData.get("property_type") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const districtId = String(formData.get("district_id") ?? "").trim();
  const neighborhoodId = String(formData.get("neighborhood_id") ?? "").trim();
  const branchId = String(formData.get("branch_id") ?? "").trim();
  const hasBranch = formData.has("branch_id");
  const addressLine = String(formData.get("address_line") ?? "").trim();
  const latVal = parseCoord(formData.get("lat"));
  const lngVal = parseCoord(formData.get("lng"));
  const rooms = String(formData.get("rooms") ?? "").trim();
  const priceResult = parseMoneyInput(formData.get("list_price"), { max: 1_000_000_000_000 });
  const commissionResult = parseMoneyInput(formData.get("commission_rate"), { max: 100 });
  const minResult = parseMoneyInput(formData.get("min_price"), { max: 1_000_000_000_000 });
  const formCurrency = parseCurrencyField(formData);
  const parcelBlock = String(formData.get("parcel_block") ?? "").trim();
  const parcelLot = String(formData.get("parcel_lot") ?? "").trim();

  if (!title || !transactionType || !propertyType) {
    return { error: "Başlık, işlem türü ve portföy türü zorunlu." };
  }
  // Çekirdek alan: geçersiz m² alan adıyla reddedilir ("1.250" → 1250, "" → null; B093).
  const sqmResult = parseAreaInput(formData.get("sqm"), { label: "m²", propertyType });
  if (!sqmResult.ok) return { error: sqmResult.error };
  const sqmValue = sqmResult.value;
  if (!priceResult.ok || priceResult.value == null) {
    return { error: "Geçerli bir liste fiyatı girin." };
  }
  if (!commissionResult.ok || commissionResult.value == null) {
    return { error: "Komisyon oranı 0'dan büyük, en fazla 100 ve en çok iki ondalık haneli olmalıdır." };
  }
  if (!minResult.ok) return { error: "Geçerli bir minimum fiyat girin." };
  const priceValue = priceResult.value;
  const commissionValue = commissionResult.value;
  const minValue = minResult.value;
  if (minValue != null && minValue > priceValue) {
    return { error: "Minimum fiyat liste fiyatından yüksek olamaz." };
  }

  const supabase = await createClient();

  // Fiyat düşüş bildirimi için eski fiyatı (ve eşleştirmede gereken kod/durumu)
  // güncellemeden ÖNCE oku — trigger tarihçeyi zaten yazıyor, burada tek amaç kıyas.
  const { data: existing } = await supabase
    .from("properties")
    .select("list_price, currency, commission_rate, property_code, status, features")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  // Para birimi: formda seçici varsa o, yoksa kayıttaki (sütun → features.currency → TRY).
  const currency: PropertyCurrency = formCurrency ?? propertyCurrency(existing);
  const oldPrice = existing?.list_price != null ? Number(existing.list_price) : null;
  const oldCommissionRate = existing?.commission_rate != null ? Number(existing.commission_rate) : null;

  // Ofis kontrol onay kapısı (varsayılan kapalı): yalnız fiyat DÜŞÜRME ve komisyon oranı İNDİRİMİ.
  // pending/requested/error → işlem durur; approved/not_required → devam.
  if (oldPrice != null && Number.isFinite(oldPrice) && priceValue < oldPrice) {
    const approval = await requestApprovalIfNeeded(gate.tenantId, gate.userId, "price_drop", {
      oldPrice,
      newPrice: priceValue,
      entityId: id,
      entityType: "property",
      title,
    });
    if (approval.status !== "not_required" && approval.status !== "approved") return { error: approval.message };
  }
  if (oldCommissionRate != null && Number.isFinite(oldCommissionRate) && commissionValue < oldCommissionRate) {
    const approval = await requestApprovalIfNeeded(gate.tenantId, gate.userId, "commission_discount", {
      standardRate: oldCommissionRate,
      requestedRate: commissionValue,
      entityId: id,
      entityType: "property",
      title,
    });
    if (approval.status !== "not_required" && approval.status !== "approved") return { error: approval.message };
  }

  // `districtHint` adi ilce demek ama ONCEDEN IL adi geciriliyordu; formda
  // ilce alani hic yoktu. Artik once ilce, yoksa il adi kullaniliyor —
  // ilce bazli m2 referanslari (Kadikoy, Cankaya, Nilufer...) ancak boyle devreye giriyor.
  const [districtHint, healthPrice] = await Promise.all([
    resolveGeoHint(provinceId, districtId),
    healthPriceTry(supabase, priceValue, currency),
  ]);

  // Mevcut features MERGE edilir: OCR/AI gibi form dışı kaynakların yazdığı
  // anahtarlar (ör. tapu alan bilgisi) form kaydında silinip gitmesin.
  const prevFeatures = (existing?.features ?? {}) as Record<string, unknown>;
  const parsedFeatures = parseFeatureFields(formData, { rooms, sqm: sqmValue, currency });
  const warnings = parsedFeatures.warnings;
  let mergedFeatures: Record<string, unknown> = { ...prevFeatures, ...parsedFeatures.features, currency: currencyFeatureValue(currency) };
  // İlan açıklaması yalnız formda alan VARSA yazılır (tek yazma kuralı: lib/property-description.ts).
  if (formData.has("description")) {
    const d = parsePropertyDescription(formData.get("description"));
    if (!d.ok) return { error: d.error };
    mergedFeatures = withDescription(mergedFeatures, d.value);
  }
  // 360° tur / video bağlantısı: yalnız formda alan VARSA yazılır (https + izinli alan adı; lib/virtual-tour.ts).
  if (formData.has("virtual_tour_url")) {
    const t = parseVirtualTourUrl(formData.get("virtual_tour_url"));
    if (!t.ok) return { error: t.error };
    mergedFeatures = withVirtualTour(mergedFeatures, t.value ? t.value.url : null);
  }

  // Fiyat her güncellendiğinde sağlık ANINDA yeniden hesaplanır — önce emsal, yetersizse m² modeli.
  // Döviz fiyat ₺ karşılığıyla; kur yoksa sağlık boş kalır ("döviz: değerlendirilemedi"; B094).
  const health = healthPrice.priceTry == null
    ? null
    : await resolvePriceHealth(supabase, {
        tenantId: gate.tenantId,
        listPrice: healthPrice.priceTry,
        sqm: sqmValue,
        districtId: districtId || null,
        propertyType,
        transactionType,
        districtHint,
        excludePropertyId: id,
        targetFloor: mergedFeatures.floor as number | null,
        targetBuildingAge: mergedFeatures.building_age as number | null,
        targetHeating: mergedFeatures.heating as string | null,
        targetFacade: mergedFeatures.facade as string | null,
      });

  const updatePatch: Record<string, unknown> = {
    title,
    transaction_type: transactionType,
    property_type: propertyType,
    list_price: priceValue,
    currency,
    min_price: minValue,
    commission_rate: commissionValue,
    province_id: provinceId || null,
    district_id: districtId || null,
    neighborhood_id: neighborhoodId || null,
    address_line: addressLine || null,
    lat: latVal,
    lng: lngVal,
    features: mergedFeatures,
    price_health: health,
    updated_at: new Date().toISOString(),
  };
  if (hasBranch) updatePatch.branch_id = branchId || null;
  // Ada/parsel yalnız formda alan VARSA yazılır — eski/başka formlar OCR'ın
  // doldurduğu tapu bilgisini istemeden null'a çekmesin (branch_id deseni).
  if (formData.has("parcel_block")) updatePatch.parcel_block = parcelBlock || null;
  if (formData.has("parcel_lot")) updatePatch.parcel_lot = parcelLot || null;

  const { error } = await supabase
    .from("properties")
    .update(updatePatch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  if (error) {
    console.error("updateProperty", error);
    return { error: actionErrorMessage(error, "Portföy güncellenemedi.") };
  }

  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.update",
    entityType: "property",
    entityId: id,
    newValue: { title, list_price: priceValue },
  }));

  // Fiyat DÜŞTÜYSE eşleşen taleplerin danışmanlarını uyar; artışta hiçbir şey yapma.
  if (oldPrice != null && Number.isFinite(oldPrice) && priceValue < oldPrice) {
    await notifyPriceDropToMatchingDemands({
      tenantId: gate.tenantId,
      fallbackUserId: gate.userId,
      property: {
        id,
        property_code: existing?.property_code ?? "",
        title,
        transaction_type: transactionType,
        property_type: propertyType,
        status: existing?.status ?? "live",
        // Talep bütçeleri ₺: döviz fiyat ₺ karşılığıyla eşleşir.
        list_price: healthPrice.priceTry ?? priceValue,
        province_id: provinceId || null,
        district_id: districtId || null,
        neighborhood_id: neighborhoodId || null,
        features: { rooms: rooms || null, sqm: sqmValue },
      },
      oldPrice,
      newPrice: priceValue,
    });
  }

  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${id}`);
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  revalidateVitrinPaths(); // live ilanın başlık/fiyat/özellik değişikliği vitrine yansısın
  // IndexNow: yalnız arama onaylı vitrindeki yayında ilan (indexnow-public.ts); yanıt sonrası, eylemi bekletmez.
  afterSafe(async () => {
    const { notifyListingIndexNow } = await import("@/lib/seo/indexnow-public");
    await notifyListingIndexNow(supabase, gate.tenantId, id);
  }, "ilan IndexNow");
  emitWebhook("property.updated", "property", id);
  return warnings.length ? { ok: true, warnings } : { ok: true };
}

export async function setPropertyStatus(formData: FormData): Promise<void> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return;

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id || !MANUAL_STATUSES.includes(status)) return;

  // Yayın kapısı: ilan sahibi kaydı tamamlanmamış ya da il/ilçesi seçilmemiş ilan yayına alınamaz (taslak kalır; B163).
  if (status === "live") {
    const blocked = await publishBlockReason(await createClient(), gate.tenantId, id);
    if (blocked) redirect(`/app/portfoyler/${id}?sekme=sahip&yayin=eksik`);
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("transition_property_status_atomic", {
    p_tenant_id: gate.tenantId,
    p_actor_id: gate.userId,
    p_property_ids: [id],
    p_status: status,
    p_reason: "Portföy detayından güncelleme",
  });
  const outcome = String((data as { outcome?: string } | null)?.outcome ?? "");
  // DB kapısı (aynı kural, RPC içinde): uygulama kapısıyla yarışan bir değişiklikte de yayına alınmaz.
  if (!error && outcome === "publish_blocked") redirect(`/app/portfoyler/${id}?sekme=sahip&yayin=eksik`);
  if (error || (outcome !== "applied" && outcome !== "replay")) {
    console.error("setPropertyStatus atomic", { code: error?.code, outcome });
    return;
  }

  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${id}`);
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  revalidateVitrinPaths(); // yayına alma/çıkarma vitrin listesini anında değiştirir
  if (status === "live") {
    // IndexNow: yalnız arama onaylı vitrindeki yayında ilan (indexnow-public.ts); yanıt sonrası, eylemi bekletmez.
    afterSafe(async () => {
      const { notifyListingIndexNow } = await import("@/lib/seo/indexnow-public");
      await notifyListingIndexNow(admin, gate.tenantId, id);
    }, "ilan IndexNow");
  }
}

export async function deleteProperty(formData: FormData): Promise<{ error?: string } | void> {
  const gate = await requirePermission("properties", "delete");
  if (!gate.ok) return { error: gate.error };
  const id = String(formData.get("id") ?? "").trim();
  const redirectTo = String(formData.get("redirect_to") ?? "").trim();
  if (!id) return;

  // Ofis kontrol onay kapısı (varsayılan kapalı): kural açıksa silme yönetici onayı bekler.
  const approval = await requestApprovalIfNeeded(gate.tenantId, gate.userId, "listing_delete", {
    entityId: id,
    entityType: "property",
  });
  if (approval.status !== "not_required" && approval.status !== "approved") return { error: approval.message };

  const supabase = await createClient();
  // Bağlı açık kayıt varsa silme (canlı ilan sahipsiz kalmasın): açık anlaşma, canlı portal ilanı,
  // dışarıdaki anahtar, planlı/aktif açık ev.
  const [deals, portals, keys, openHouses] = await Promise.all([
    supabase.from("deals").select("id", { count: "exact", head: true }).eq("tenant_id", gate.tenantId).eq("property_id", id).not("stage", "in", "(won,lost)"),
    supabase.from("portal_listings").select("id", { count: "exact", head: true }).eq("tenant_id", gate.tenantId).eq("property_id", id).eq("status", "live"),
    supabase.from("property_keys").select("id", { count: "exact", head: true }).eq("tenant_id", gate.tenantId).eq("property_id", id).not("status", "in", "(ofiste,kayip)"),
    supabase.from("open_houses").select("id", { count: "exact", head: true }).eq("tenant_id", gate.tenantId).eq("property_id", id).in("status", ["planned", "active"]),
  ]);
  if ((deals.count ?? 0) + (portals.count ?? 0) + (keys.count ?? 0) + (openHouses.count ?? 0) > 0) {
    if (redirectTo) redirect(`/app/portfoyler/${id}?silme=engellendi`);
    return;
  }
  const { error } = await supabase
    .from("properties")
    .update({ deleted_at: new Date().toISOString(), status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("deleteProperty", error);
    return { error: "Portföy arşivlenemedi." };
  }
  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.delete",
    entityType: "property",
    entityId: id,
  }));
  revalidatePath("/app/portfoyler");
  revalidatePath("/app");
  revalidateTenantData(gate.tenantId);
  revalidateVitrinPaths(); // silinen (arşivlenen) live ilan vitrinden düşsün
  if (redirectTo) redirect(redirectTo);
}

/** Danışman (assigned_to) yeniden atama. */
export async function reassignProperty(formData: FormData): Promise<void> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  const assignedTo = String(formData.get("assigned_to") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("properties")
    .select("id, property_code, title, assigned_to")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!current) return;
  const previous = (current.assigned_to as string | null) ?? null;
  if ((assignedTo || null) === previous) return;
  // Hedef danışman bu ofisin AKTİF kullanıcısı olmalı (müşteri devriyle aynı kural; başka ofisin kimliği yazılamaz).
  if (assignedTo) {
    const { data: target } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", assignedTo)
      .eq("tenant_id", gate.tenantId)
      .eq("is_active", true)
      .maybeSingle();
    if (!target) return;
  }
  const { error } = await supabase
    .from("properties")
    .update({ assigned_to: assignedTo || null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("reassignProperty", error);
    return;
  }
  afterSafe(() => logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.reassign",
    entityType: "property",
    entityId: id,
    oldValue: { assigned_to: previous },
    newValue: { assigned_to: assignedTo || null },
  }));
  if (assignedTo && assignedTo !== gate.userId) {
    const label = [current.property_code, current.title].filter(Boolean).join(" ") || "Portföy";
    await notifyAssignment({
      tenantId: gate.tenantId,
      userId: assignedTo,
      title: `Size portföy atandı: ${String(label).slice(0, 80)}`,
      body: "Portföy kartını inceleyin; malik ve ilan durumunu kontrol edip ilk adımı planlayın.",
      href: `/app/portfoyler/${id}`,
      dedupeKey: `property-assign:${id}:${previous ?? "yok"}:${assignedTo}:${trDayKey()}`,
    });
  }
  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${id}`);
  revalidateTenantData(gate.tenantId);
}
