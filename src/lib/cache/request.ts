import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * İstek-içi (React `cache()`) tekilleştirme yardımcıları. Süreçler/istekler
 * ARASI paylaşım YOKTUR: değerler istek bitince atılır, bu yüzden rol/plan
 * değişikliği bir sonraki istekte hemen yansır (yetki eskimesi riski sıfır).
 * Çağrılar RLS'li kullanıcı client'ı ile yapılır (admin client yok).
 */

/** Oturumdaki kullanıcının profil satırı (rol + tenant) — istek başına tek sorgu. */
export const getRequestProfile = cache(async (userId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("role, tenant_id")
    .eq("id", userId)
    .maybeSingle();
  return data ?? null;
});

/** Tenant'ın paket ve deneme bilgisi — istek başına tek sorgu. */
export const getTenantGateContext = cache(async (tenantId: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tenants")
    .select("plan, status, created_at")
    .eq("id", tenantId)
    .maybeSingle();
  return {
    plan: data?.plan ?? null,
    trial: data?.status === "trial",
    tenantCreatedAt: data?.created_at ?? null,
  };
});
