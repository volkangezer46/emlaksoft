"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePermission } from "@/lib/require-permission";
import { logActivity } from "@/lib/activity";
import { resolvePriceHealth } from "@/lib/comparables";
import { notifyMatchingDemandsForProperty } from "@/lib/match-notify";
import { notifyTenant } from "@/lib/notify";
import { fetchTenantMatchingWeights, scoreDemandProperty, type MatchDemand, type MatchProperty } from "@/lib/matching";
import { dispatchAutomationEvent } from "@/lib/automation-engine";
import { triggerPlaybooks } from "@/lib/playbook-trigger";

export type PropertyResult = { error?: string; ok?: boolean; matchedDemands?: number };

/** Boş ise null; geçerli bir enlem/boylam sayısıysa döndürür. */
function parseCoord(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < -180 || n > 180) return null;
  return n;
}

const STATUSES = ["draft", "live", "reserved", "sold", "rented", "archived"];

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
}

/** Boş ise null; pozitif tam sayıya çevrilebiliyorsa döndürür (kat/bina yaşı). */
function parseIntOrNull(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * Formdaki detay alanlarını features jsonb anahtarlarına çevirir.
 * Anahtar adları portal-publish.ts / broşür / property-health.ts ile AYNI:
 * rooms, sqm, floor, heating, building_age, facade.
 */
function parseFeatureFields(formData: FormData, base: { rooms: string; sqm: number }): Record<string, unknown> {
  const heating = String(formData.get("heating") ?? "").trim();
  const facade = String(formData.get("facade") ?? "").trim();
  return {
    rooms: base.rooms || null,
    sqm: Number.isFinite(base.sqm) ? base.sqm : null,
    floor: parseIntOrNull(formData.get("floor")),
    heating: heating || null,
    building_age: parseIntOrNull(formData.get("building_age")),
    facade: facade || null,
  };
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
        "id, transaction_type, property_type, province_id, district_id, budget_min, budget_max, rooms, min_sqm, urgency, status, customer:customers(full_name, assigned_to)",
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
      if (result.score >= MATCH_THRESHOLD) {
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
        href: `/app/eslestirme?property=${input.property.id}`,
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
async function resolveGeoHint(
  supabase: Awaited<ReturnType<typeof createClient>>,
  provinceId: string,
  districtId: string,
): Promise<string | null> {
  if (districtId) {
    const { data } = await supabase.from("geo_districts").select("name").eq("id", districtId).maybeSingle();
    if (data?.name) return data.name;
  }
  if (provinceId) {
    const { data } = await supabase.from("geo_provinces").select("name").eq("id", provinceId).maybeSingle();
    return data?.name ?? null;
  }
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
  const sqmValue = Number(String(formData.get("sqm") ?? "").replace(",", "."));
  const rawPrice = String(formData.get("list_price") ?? "").replace(/[^\d.,]/g, "");
  const priceValue = Number(rawPrice.replace(/\./g, "").replace(",", "."));
  const commissionValue = Number(String(formData.get("commission_rate") ?? "").replace(",", "."));
  const parcelBlock = String(formData.get("parcel_block") ?? "").trim();
  const parcelLot = String(formData.get("parcel_lot") ?? "").trim();

  if (!title || !transactionType || !propertyType) {
    return { error: "Başlık, işlem türü ve portföy türü zorunlu." };
  }
  if (!Number.isFinite(priceValue) || priceValue <= 0) {
    return { error: "Geçerli bir liste fiyatı girin." };
  }

  const stamp = new Date().toISOString().slice(2, 7).replace("-", "");
  const suffix = crypto.randomUUID().slice(0, 6).toUpperCase();
  const propertyCode = `ES-${stamp}-${suffix}`;

  // `districtHint` adi ilce demek ama ONCEDEN IL adi geciriliyordu; formda
  // ilce alani hic yoktu. Artik once ilce, yoksa il adi kullaniliyor —
  // ilce bazli m2 referanslari (Kadikoy, Cankaya, Nilufer...) ancak boyle devreye giriyor.
  const districtHint = await resolveGeoHint(supabase, provinceId, districtId);
  // Önce emsal motoru, yetersizse m² referans modeli — kalıcı price_health tek karar noktasından.
  const health = await resolvePriceHealth(supabase, {
    tenantId: gate.tenantId,
    listPrice: priceValue,
    sqm: Number.isFinite(sqmValue) ? sqmValue : null,
    districtId: districtId || null,
    propertyType,
    transactionType,
    districtHint,
  });

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
      commission_rate: Number.isFinite(commissionValue) ? commissionValue : null,
      province_id: provinceId || null,
      district_id: districtId || null,
      neighborhood_id: neighborhoodId || null,
      branch_id: branchId || null,
      address_line: addressLine || null,
      lat: latVal,
      lng: lngVal,
      parcel_block: parcelBlock || null,
      parcel_lot: parcelLot || null,
      features: parseFeatureFields(formData, { rooms, sqm: sqmValue }),
      price_health: health,
      assigned_to: gate.userId,
      created_by: gate.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createProperty", error);
    return { error: "Portföy eklenemedi. Lütfen tekrar deneyin." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.create",
    entityType: "property",
    entityId: data.id,
    newValue: { property_code: propertyCode, title },
  });

  // Otomatik eşleştirme bildirimi — yeni portföyü aktif taleplerle skorla, güçlü eşleşme varsa danışmanı uyar
  const matchedDemands = await notifyMatchingDemandsForProperty(gate.tenantId, gate.userId, {
    id: data.id,
    property_code: propertyCode,
    title,
    transaction_type: transactionType,
    property_type: propertyType,
    status: "draft",
    list_price: priceValue,
    province_id: provinceId || null,
    // Onceden burada `district_id: null` sabiti vardi: talep eslestirme ilceye
    // gore puanladigi icin ilce esmesi HIC calismiyordu.
    district_id: districtId || null,
    features: { rooms: rooms || null, sqm: Number.isFinite(sqmValue) ? sqmValue : null },
  });

  // Otomasyon tetikle — hata ana işlemi asla bozmasın
  try {
    await dispatchAutomationEvent(gate.tenantId, "new_property", {
      entityType: "property",
      entityId: data.id,
      propertyId: data.id,
      label: [propertyCode, title].filter(Boolean).join(" · "),
      assignedTo: gate.userId,
      fields: { transaction_type: transactionType, property_type: propertyType, list_price: priceValue },
    });
  } catch (e) {
    console.error("automation new_property", e);
  }

  // İş akışı (playbook) tetikle — çok adımlı görev paketi; hata ana işlemi bozmaz
  await triggerPlaybooks({
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
  });

  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${data.id}`);
  revalidatePath("/app");
  return { ok: true, matchedDemands };
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
  const sqmValue = Number(String(formData.get("sqm") ?? "").replace(",", "."));
  const rawPrice = String(formData.get("list_price") ?? "").replace(/[^\d.,]/g, "");
  const priceValue = Number(rawPrice.replace(/\./g, "").replace(",", "."));
  const commissionValue = Number(String(formData.get("commission_rate") ?? "").replace(",", "."));
  const minRaw = String(formData.get("min_price") ?? "").replace(/[^\d.,]/g, "");
  const minValue = minRaw ? Number(minRaw.replace(/\./g, "").replace(",", ".")) : null;
  const parcelBlock = String(formData.get("parcel_block") ?? "").trim();
  const parcelLot = String(formData.get("parcel_lot") ?? "").trim();

  if (!title || !transactionType || !propertyType) {
    return { error: "Başlık, işlem türü ve portföy türü zorunlu." };
  }
  if (!Number.isFinite(priceValue) || priceValue <= 0) {
    return { error: "Geçerli bir liste fiyatı girin." };
  }

  const supabase = await createClient();

  // Fiyat düşüş bildirimi için eski fiyatı (ve eşleştirmede gereken kod/durumu)
  // güncellemeden ÖNCE oku — trigger tarihçeyi zaten yazıyor, burada tek amaç kıyas.
  const { data: existing } = await supabase
    .from("properties")
    .select("list_price, property_code, status, features")
    .eq("id", id)
    .eq("tenant_id", gate.tenantId)
    .maybeSingle();
  const oldPrice = existing?.list_price != null ? Number(existing.list_price) : null;

  // `districtHint` adi ilce demek ama ONCEDEN IL adi geciriliyordu; formda
  // ilce alani hic yoktu. Artik once ilce, yoksa il adi kullaniliyor —
  // ilce bazli m2 referanslari (Kadikoy, Cankaya, Nilufer...) ancak boyle devreye giriyor.
  const districtHint = await resolveGeoHint(supabase, provinceId, districtId);
  // Fiyat her güncellendiğinde sağlık ANINDA yeniden hesaplanır — önce emsal, yetersizse m² modeli.
  const health = await resolvePriceHealth(supabase, {
    tenantId: gate.tenantId,
    listPrice: priceValue,
    sqm: Number.isFinite(sqmValue) ? sqmValue : null,
    districtId: districtId || null,
    propertyType,
    transactionType,
    districtHint,
    excludePropertyId: id,
  });

  // Mevcut features MERGE edilir: OCR/AI gibi form dışı kaynakların yazdığı
  // anahtarlar (ör. tapu alan bilgisi) form kaydında silinip gitmesin.
  const prevFeatures = (existing?.features ?? {}) as Record<string, unknown>;

  const updatePatch: Record<string, unknown> = {
    title,
    transaction_type: transactionType,
    property_type: propertyType,
    list_price: priceValue,
    min_price: minValue != null && Number.isFinite(minValue) ? minValue : null,
    commission_rate: Number.isFinite(commissionValue) ? commissionValue : null,
    province_id: provinceId || null,
    district_id: districtId || null,
    neighborhood_id: neighborhoodId || null,
    address_line: addressLine || null,
    lat: latVal,
    lng: lngVal,
    features: { ...prevFeatures, ...parseFeatureFields(formData, { rooms, sqm: sqmValue }) },
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
    return { error: "Portföy güncellenemedi." };
  }

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.update",
    entityType: "property",
    entityId: id,
    newValue: { title, list_price: priceValue },
  });

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
        list_price: priceValue,
        province_id: provinceId || null,
        district_id: districtId || null,
        features: { rooms: rooms || null, sqm: Number.isFinite(sqmValue) ? sqmValue : null },
      },
      oldPrice,
      newPrice: priceValue,
    });
  }

  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${id}`);
  revalidatePath("/app");
  revalidateVitrinPaths(); // live ilanın başlık/fiyat/özellik değişikliği vitrine yansısın
  return { ok: true };
}

export async function setPropertyStatus(formData: FormData): Promise<void> {
  const gate = await requirePermission("properties", "edit");
  if (!gate.ok) return;

  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!id || !STATUSES.includes(status)) return;

  const supabase = await createClient();
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  // Gerçek yayın damgası: İLK kez live'a geçişte published_at set edilir.
  // Zaten doluysa DOKUNMA — yeniden yayına almada (reserved→live gibi)
  // orijinal yayın tarihi korunur ("Yeni" rozeti/cron sahte tazelenmesin).
  if (status === "live") {
    const { data: cur } = await supabase
      .from("properties")
      .select("published_at")
      .eq("id", id)
      .eq("tenant_id", gate.tenantId)
      .maybeSingle();
    if (cur && cur.published_at == null) patch.published_at = new Date().toISOString();
  }
  await supabase
    .from("properties")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);

  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.status",
    entityType: "property",
    entityId: id,
    newValue: { status },
  });

  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${id}`);
  revalidatePath("/app");
  revalidateVitrinPaths(); // yayına alma/çıkarma vitrin listesini anında değiştirir
}

export async function deleteProperty(formData: FormData): Promise<void> {
  const gate = await requirePermission("properties", "delete");
  if (!gate.ok) return;
  const id = String(formData.get("id") ?? "").trim();
  const redirectTo = String(formData.get("redirect_to") ?? "").trim();
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("properties")
    .update({ deleted_at: new Date().toISOString(), status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("deleteProperty", error);
    return;
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.delete",
    entityType: "property",
    entityId: id,
  });
  revalidatePath("/app/portfoyler");
  revalidatePath("/app");
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
  const { error } = await supabase
    .from("properties")
    .update({ assigned_to: assignedTo || null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", gate.tenantId);
  if (error) {
    console.error("reassignProperty", error);
    return;
  }
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "property.reassign",
    entityType: "property",
    entityId: id,
    newValue: { assigned_to: assignedTo || null },
  });
  revalidatePath("/app/portfoyler");
  revalidatePath(`/app/portfoyler/${id}`);
}
