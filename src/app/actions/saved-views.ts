"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireActiveTenant } from "@/lib/tenant-guard";

/**
 * Kayıtlı görünümler — kullanıcının liste sayfası filtre kombinasyonlarını
 * adlandırıp kaydetmesi. Kayıtlar kişiseldir (RLS: tenant + user_id).
 *
 * params'a YALNIZ aşağıdaki beyaz-listeli anahtarlar yazılır; listeler
 * sayfaların gerçek searchParams sözleşmesinden çıkarıldı. "sayfa"
 * (sayfalama) bilinçli olarak hiçbir listede yok — kayıtlı görünüm her zaman
 * 1. sayfadan açılır.
 */
const ROUTE_PARAM_WHITELIST: Record<string, readonly string[]> = {
  // src/app/app/musteriler/page.tsx
  "/app/musteriler": ["q", "type", "source", "etiket", "from", "to", "assigned", "sort", "sirala", "yon"],
  // src/app/app/portfoyler/page.tsx
  "/app/portfoyler": ["q", "status", "saglik", "gorunum"],
  // src/app/app/komisyon/page.tsx
  "/app/komisyon": ["durum", "from", "to"],
  // src/app/app/gelen-kutusu/page.tsx
  "/app/gelen-kutusu": ["q", "kanal", "from", "to", "durum"],
};

const NAME_MAX = 60;
const VALUE_MAX = 200;

export type SavedView = {
  id: string;
  route: string;
  name: string;
  params: Record<string, string>;
};

export type SavedViewResult = { error?: string; view?: SavedView };

/** Yalnız beyaz-listeli anahtarları, boş olmayan string değerlerle bırakır. Route tanınmıyorsa null. */
function sanitizeParams(route: string, params: unknown): Record<string, string> | null {
  const allowed = ROUTE_PARAM_WHITELIST[route];
  if (!allowed) return null;
  const source = (params ?? {}) as Record<string, unknown>;
  const clean: Record<string, string> = {};
  for (const key of allowed) {
    const value = source[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    clean[key] = trimmed.slice(0, VALUE_MAX);
  }
  return clean;
}

export async function listSavedViews(route: string): Promise<SavedView[]> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return [];
  if (!ROUTE_PARAM_WHITELIST[route]) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_views")
    .select("id, route, name, params")
    .eq("tenant_id", gate.tenantId)
    .eq("user_id", gate.userId)
    .eq("route", route)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("listSavedViews", error);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    route: String(row.route),
    name: String(row.name),
    // Eski kayıtlarda beyaz liste dışı anahtar kalmışsa okurken de süz
    params: sanitizeParams(route, row.params) ?? {},
  }));
}

export async function createSavedView(
  route: string,
  name: string,
  params: Record<string, string>,
): Promise<SavedViewResult> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };

  if (!ROUTE_PARAM_WHITELIST[route]) return { error: "Bu sayfa için görünüm kaydedilemez." };

  const trimmedName = String(name ?? "").trim();
  if (!trimmedName) return { error: "Görünüm adı zorunlu." };
  if (trimmedName.length > NAME_MAX) return { error: `Görünüm adı en fazla ${NAME_MAX} karakter olabilir.` };

  const cleanParams = sanitizeParams(route, params);
  if (!cleanParams || Object.keys(cleanParams).length === 0) {
    return { error: "Kaydedilecek aktif filtre yok." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_views")
    .insert({
      tenant_id: gate.tenantId,
      user_id: gate.userId,
      route,
      name: trimmedName,
      params: cleanParams,
    })
    .select("id, route, name, params")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Bu adla kayıtlı bir görünüm zaten var." };
    console.error("createSavedView", error);
    return { error: "Görünüm kaydedilemedi." };
  }

  revalidatePath(route);
  return {
    view: {
      id: String(data.id),
      route: String(data.route),
      name: String(data.name),
      params: sanitizeParams(route, data.params) ?? {},
    },
  };
}

export async function deleteSavedView(id: string): Promise<{ error?: string; ok?: boolean }> {
  const gate = await requireActiveTenant();
  if (!gate.ok) return { error: gate.error };

  const viewId = String(id ?? "").trim();
  if (!viewId) return { error: "Görünüm bulunamadı." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("saved_views")
    .delete()
    .eq("id", viewId)
    .eq("tenant_id", gate.tenantId)
    .eq("user_id", gate.userId)
    .select("route");

  if (error) {
    console.error("deleteSavedView", error);
    return { error: "Görünüm silinemedi." };
  }
  if (!data || data.length === 0) return { error: "Görünüm bulunamadı." };

  revalidatePath(String(data[0].route));
  return { ok: true };
}
