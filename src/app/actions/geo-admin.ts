"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { checkRateLimit } from "@/lib/rate-limit";
import { logPlatformActivity } from "@/lib/platform-activity";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";

export type GeoActionResult = { error?: string; ok?: boolean };
export type GeoSyncActionResult = GeoActionResult & {
  jobId?: string;
  status?: string;
  message?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanName(raw: FormDataEntryValue | null): string {
  return String(raw ?? "").trim().replace(/\s+/g, " ");
}

function parseCoord(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ========== İL ==========

export async function updateProvince(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformModule("geo");
  const id = String(formData.get("id") ?? "").trim();
  const name = cleanName(formData.get("name"));
  const lat = parseCoord(formData.get("lat"));
  const lng = parseCoord(formData.get("lng"));
  const isActive = formData.get("is_active") === "on";

  if (!id) return { error: "İl bulunamadı." };
  if (!name) return { error: "İl adı boş olamaz." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("geo_provinces")
    .update({ name, lat, lng, is_active: isActive })
    .eq("id", id);

  if (error) {
    console.error("updateProvince", error);
    return { error: "İl güncellenemedi (isim çakışması olabilir)." };
  }

  revalidatePath("/admin/geo");
  revalidateTag("geo", "max");
  return { ok: true };
}

/**
 * Only enqueues work. The provider request and atomic database merge run in a
 * leased cron worker, so closing the browser cannot leave a partial province.
 */
export async function enqueueProvinceGeoSync(formData: FormData): Promise<GeoSyncActionResult> {
  const staff = await requirePlatformModule("geo");
  const provinceId = String(formData.get("province_id") ?? "").trim();
  if (!UUID_PATTERN.test(provinceId)) return { error: "Geçersiz il seçimi." };

  const rateLimit = await checkRateLimit(`platform:geo-sync:${staff.id}`, {
    limit: 12,
    windowSec: 60,
    failurePolicy: "deny",
  });
  if (!rateLimit.allowed) {
    return { error: "Çok sık tarama isteği gönderildi. Lütfen kısa süre sonra tekrar deneyin." };
  }

  const admin = createAdminClient();
  const { data: province, error: provinceError } = await admin
    .from("geo_provinces")
    .select("id, plate_code, name, is_active")
    .eq("id", provinceId)
    .maybeSingle();
  if (provinceError || !province) return { error: "İl bulunamadı." };
  if (!province.is_active) return { error: "Pasif bir il otomatik taranamaz." };

  const { data, error } = await admin.rpc("enqueue_geo_province_sync", {
    p_province_id: province.id,
    p_requested_by: staff.id,
    p_priority: province.plate_code === 46 ? 1_000 : 100,
  });
  if (error) {
    console.error("enqueueProvinceGeoSync", { code: error.code || "unknown" });
    return { error: "Tarama kuyruğa alınamadı. Lütfen sistem durumunu kontrol edip yeniden deneyin." };
  }

  const raw = Array.isArray(data) ? data[0] : data;
  const result = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const jobId = typeof result?.id === "string"
    ? result.id
    : typeof result?.job_id === "string"
      ? result.job_id
      : undefined;
  const status = typeof result?.status === "string" ? result.status : "queued";
  if (!jobId) return { error: "Tarama işi doğrulanamadı; işlem başlatılmadı." };

  await logPlatformActivity({
    actorId: staff.id,
    action: "geo.province_sync.enqueue",
    entityType: "geo_province",
    entityId: province.id,
    meta: {
      jobId,
      plateCode: province.plate_code,
      previousGeoJobsPaused: true,
    },
  });
  revalidatePath("/admin/geo");
  revalidateTag("geo", "max");
  return {
    ok: true,
    jobId,
    status,
    message: `${province.name} taraması kuyruğa alındı. Diğer il taramaları bekletiliyor.`,
  };
}

// ========== İLÇE ==========

export async function createDistrict(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformModule("geo");
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const name = cleanName(formData.get("name"));
  const lat = parseCoord(formData.get("lat"));
  const lng = parseCoord(formData.get("lng"));

  if (!provinceId) return { error: "İl bulunamadı." };
  if (!name) return { error: "İlçe adı boş olamaz." };

  const admin = createAdminClient();
  const { error } = await admin.from("geo_districts").insert({
    province_id: provinceId,
    name,
    lat,
    lng,
  });

  if (error) {
    console.error("createDistrict", error);
    return { error: error.code === "23505" ? "Bu isimde bir ilçe zaten var." : "İlçe eklenemedi." };
  }

  revalidatePath(`/admin/geo/${provinceId}`);
  revalidateTag("geo", "max");
  return { ok: true };
}

export async function updateDistrict(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformModule("geo");
  const id = String(formData.get("id") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const name = cleanName(formData.get("name"));
  const lat = parseCoord(formData.get("lat"));
  const lng = parseCoord(formData.get("lng"));
  const isActive = formData.get("is_active") === "on";

  if (!id) return { error: "İlçe bulunamadı." };
  if (!name) return { error: "İlçe adı boş olamaz." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("geo_districts")
    .update({ name, lat, lng, is_active: isActive })
    .eq("id", id);

  if (error) {
    console.error("updateDistrict", error);
    return { error: "İlçe güncellenemedi (isim çakışması olabilir)." };
  }

  revalidatePath(`/admin/geo/${provinceId}`);
  revalidateTag("geo", "max");
  return { ok: true };
}

export async function deleteDistrict(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformModule("geo");
  const id = String(formData.get("id") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  if (!id) return { error: "İlçe bulunamadı." };

  const admin = createAdminClient();
  const { count } = await admin
    .from("geo_neighborhoods")
    .select("id", { count: "exact", head: true })
    .eq("district_id", id);

  if ((count ?? 0) > 0) {
    return { error: `Bu ilçeye bağlı ${count} mahalle var; önce onları silin ya da ilçeyi pasifleştirin.` };
  }

  const { error } = await admin.from("geo_districts").delete().eq("id", id);
  if (error) {
    console.error("deleteDistrict", error);
    return { error: "İlçe silinemedi." };
  }

  revalidatePath(`/admin/geo/${provinceId}`);
  revalidateTag("geo", "max");
  return { ok: true };
}

// ========== MAHALLE ==========

export async function createNeighborhood(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformModule("geo");
  const districtId = String(formData.get("district_id") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const name = cleanName(formData.get("name"));
  const postalCode = cleanName(formData.get("postal_code")) || null;

  if (!districtId) return { error: "İlçe bulunamadı." };
  if (!name) return { error: "Mahalle adı boş olamaz." };

  const admin = createAdminClient();
  const { error } = await admin.from("geo_neighborhoods").insert({
    district_id: districtId,
    name,
    postal_code: postalCode,
  });

  if (error) {
    console.error("createNeighborhood", error);
    return { error: error.code === "23505" ? "Bu isimde bir mahalle zaten var." : "Mahalle eklenemedi." };
  }

  revalidatePath(`/admin/geo/${provinceId}/${districtId}`);
  revalidateTag("geo", "max");
  return { ok: true };
}

export async function updateNeighborhood(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformModule("geo");
  const id = String(formData.get("id") ?? "").trim();
  const districtId = String(formData.get("district_id") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  const name = cleanName(formData.get("name"));
  const postalCode = cleanName(formData.get("postal_code")) || null;
  const isActive = formData.get("is_active") === "on";

  if (!id) return { error: "Mahalle bulunamadı." };
  if (!name) return { error: "Mahalle adı boş olamaz." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("geo_neighborhoods")
    .update({ name, postal_code: postalCode, is_active: isActive })
    .eq("id", id);

  if (error) {
    console.error("updateNeighborhood", error);
    return { error: "Mahalle güncellenemedi (isim çakışması olabilir)." };
  }

  revalidatePath(`/admin/geo/${provinceId}/${districtId}`);
  revalidateTag("geo", "max");
  return { ok: true };
}

export async function deleteNeighborhood(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformModule("geo");
  const id = String(formData.get("id") ?? "").trim();
  const districtId = String(formData.get("district_id") ?? "").trim();
  const provinceId = String(formData.get("province_id") ?? "").trim();
  if (!id) return { error: "Mahalle bulunamadı." };

  const admin = createAdminClient();
  const { error } = await admin.from("geo_neighborhoods").delete().eq("id", id);
  if (error) {
    console.error("deleteNeighborhood", error);
    return { error: "Mahalle silinemedi (kayıtlarda kullanılıyor olabilir)." };
  }

  revalidatePath(`/admin/geo/${provinceId}/${districtId}`);
  revalidateTag("geo", "max");
  return { ok: true };
}
