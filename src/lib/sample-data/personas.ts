import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SAMPLE_TEAM, SAMPLE_TEAM_PHONES } from "./catalog";

/**
 * DEMO EKİP ÜYELERİ (sunucu). Örnek ofisin ekip, lig, atama ve performans ekranları dolu görünsün diye 3 örnek profil.
 *
 * Güvenlik: her biri için GİRİŞ YAPAMAYAN bir kimlik açılır — rastgele (saklanmayan) parola, kalıcı yasak (`ban_duration`),
 * `account_active:false`, e-posta `.invalid` alan adında (RFC 2606; hiçbir zaman çözülmez, e-posta gitmez). Profil satırı
 * `is_sample=true` taşır; koltuk sayımına girmez (migration 20261024020100) ve "Gerçek kullanıma geç" (purge v2) profili
 * pasifleştirip siler, kimliği burada `removeSamplePersonaIdentities` siler. Gerçek kullanıcıya hiçbir adımda dokunulmaz:
 * yalnız `is_sample=true` profil + bu alan adındaki kimlik.
 */

export const SAMPLE_PERSONA_EMAIL_DOMAIN = "ornek.emlaksoft.invalid";

export function samplePersonaEmail(tenantId: string, key: string): string {
  return `${key}.${tenantId.replace(/-/g, "").slice(0, 12)}@${SAMPLE_PERSONA_EMAIL_DOMAIN}`;
}

export function isSamplePersonaEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.toLowerCase().endsWith(`@${SAMPLE_PERSONA_EMAIL_DOMAIN}`);
}

export type SeedPersonasResult = { ids: string[]; failed: string | null };

/** Demo ekibini açar (idempotent: aynı e-posta varsa o kimlik kullanılır). Hata ekipsiz devam eder (kayıtlar sahibe düşer). */
export async function seedSamplePersonas(admin: SupabaseClient, tenantId: string): Promise<SeedPersonasResult> {
  const ids: string[] = [];
  let failed: string | null = null;
  for (const [i, m] of SAMPLE_TEAM.entries()) {
    const email = samplePersonaEmail(tenantId, m.key);
    try {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: randomBytes(24).toString("base64url"),
        email_confirm: true,
        ban_duration: "876000h",
        user_metadata: { full_name: m.full_name },
        app_metadata: { tenant_id: tenantId, role: m.role, account_active: false, sample: true },
      });
      let id = data.user?.id ?? null;
      if (!id && error && /already|registered|exists|duplicate/i.test(error.message ?? "")) {
        const { data: prof } = await admin.from("profiles").select("id").eq("tenant_id", tenantId).eq("is_sample", true).eq("full_name", m.full_name).maybeSingle();
        id = (prof as { id?: string } | null)?.id ?? null;
      }
      if (!id) throw new Error(error?.message ?? "kimlik açılamadı");
      const { error: pErr } = await admin.from("profiles").upsert(
        {
          id,
          tenant_id: tenantId,
          full_name: m.full_name,
          role: m.role,
          title: m.title,
          phone: SAMPLE_TEAM_PHONES[i],
          is_active: true,
          is_sample: true,
        },
        { onConflict: "id" },
      );
      if (pErr) {
        await admin.auth.admin.deleteUser(id);
        throw pErr;
      }
      ids.push(id);
    } catch (e) {
      failed = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? "bilinmeyen hata");
      console.error("seedSamplePersonas", { key: m.key, message: failed });
      break; // ekip yarım kalırsa kalanları denemeyiz; kayıtlar mevcut ekip + sahibe dağılır
    }
  }
  return { ids, failed };
}

/**
 * Purge v2 RPC'sinin döndürdüğü (profili silinmiş ya da pasifleştirilmiş) örnek kişiliklerin kimliklerini siler.
 * Kimlik yalnız `.invalid` örnek alan adındaysa silinir (savunma derinliği: yanlış kimlik listesi gerçek kullanıcıyı silemez).
 */
export async function removeSamplePersonaIdentities(admin: SupabaseClient, ids: readonly string[]): Promise<{ removed: number; kept: number }> {
  let removed = 0;
  let kept = 0;
  for (const id of ids) {
    try {
      const { data } = await admin.auth.admin.getUserById(id);
      if (!isSamplePersonaEmail(data.user?.email)) {
        kept++;
        continue;
      }
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) kept++;
      else removed++;
    } catch {
      kept++;
    }
  }
  return { removed, kept };
}
