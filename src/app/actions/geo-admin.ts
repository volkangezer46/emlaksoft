"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformStaff } from "@/lib/platform";

export type GeoActionResult = { error?: string; ok?: boolean };

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
  await requirePlatformStaff();
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
  return { ok: true };
}

// ========== İLÇE ==========

export async function createDistrict(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformStaff();
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
  return { ok: true };
}

export async function updateDistrict(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformStaff();
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
  return { ok: true };
}

export async function deleteDistrict(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformStaff();
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
  return { ok: true };
}

// ========== MAHALLE ==========

export async function createNeighborhood(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformStaff();
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
  return { ok: true };
}

export async function updateNeighborhood(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformStaff();
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
  return { ok: true };
}

export async function deleteNeighborhood(formData: FormData): Promise<GeoActionResult> {
  await requirePlatformStaff();
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
  return { ok: true };
}
