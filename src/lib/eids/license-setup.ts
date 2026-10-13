import type { SupabaseClient } from "@supabase/supabase-js";
import { TTBS_BELGE_SORGULA_URL } from "@/lib/license";
import { LICENSE_SETTINGS_HREF } from "./links";

/**
 * YETKİ BELGESİ NO KURULUM GÖREVİ (EİDS, EP5): `tenants.license_no` boş olan ofiste ofis sahibine TEK SEFERLİK görev açılır.
 * Malikler e-Devlet'te ofise bu numarayla yetki verir; numara yoksa EİDS akışı ve ilan yüzeylerindeki belge bilgisi eksik kalır.
 *
 * Çalıştıran: mevcut `gunluk-ozet` cron'unda ayrık adım (yeni cron yok). Tek seferlik: aynı başlıklı görev ofiste HERHANGİ
 * bir durumda (açık/bitti/iptal) varsa yeniden açılmaz; sahibi görevi kapatırsa bir daha rahatsız edilmez. Numara girilince
 * (Ayarlar ya da kurulum sihirbazı) ofis listeden çıkar ve AÇIK kalan görev aynı turda `done` olarak kapatılır (gecikmiş
 * görünmesin). Hata diğer cron adımlarını bozmaz (çağıran sayar).
 */

export const LICENSE_SETUP_TASK_TITLE = "Yetki belgesi numaranızı girin (EİDS)";
export const LICENSE_SETUP_DUE_DAYS = 7;
const CHUNK = 200;

export const LICENSE_SETUP_TASK_NOTES = [
  "Malikler e-Devlet'te (EİDS) ofisinize ilan yetkisini yetki belge numaranızla verir. Numara ilan, vitrin, sunum ve broşürde de görünmelidir.",
  `Yapılacak: Ayarlar > Marka ve kimlik > Yetki belgesi no alanına numarayı girin (${LICENSE_SETTINGS_HREF}).`,
  `Numaranızı TTBS'de "Yetki Belgelerim" bölümünde ya da BelgeSorgula ekranında bulabilirsiniz: ${TTBS_BELGE_SORGULA_URL}`,
].join("\n");

export type LicenseSetupTenant = { id: string; license_no: string | null };
export type LicenseSetupOwner = { id: string; tenant_id: string };

/** SAF karar: numarası boş, daha önce görevi açılmamış ve etkin sahibi olan ofisler → atanacak sahip. */
export function pickLicenseSetupTargets(
  tenants: readonly LicenseSetupTenant[],
  tenantsWithTask: ReadonlySet<string>,
  owners: readonly LicenseSetupOwner[],
): { tenantId: string; ownerId: string }[] {
  const ownerByTenant = new Map<string, string>();
  for (const o of owners) if (!ownerByTenant.has(o.tenant_id)) ownerByTenant.set(o.tenant_id, o.id);
  const out: { tenantId: string; ownerId: string }[] = [];
  for (const t of tenants) {
    if (String(t.license_no ?? "").trim()) continue;
    if (tenantsWithTask.has(t.id)) continue;
    const ownerId = ownerByTenant.get(t.id);
    if (ownerId) out.push({ tenantId: t.id, ownerId });
  }
  return out;
}

export type LicenseSetupSummary = { opened: number; closed: number; failed: number };

/** SAF: numarası girilmiş ofisler (açık kurulum görevi kapatılacaklar). */
export function licenseFilledTenantIds(tenants: readonly LicenseSetupTenant[]): string[] {
  return tenants.filter((t) => String(t.license_no ?? "").trim()).map((t) => t.id);
}

export async function runLicenseSetupTasks(admin: SupabaseClient, tenantIds: readonly string[], nowMs: number): Promise<LicenseSetupSummary> {
  let opened = 0;
  let closed = 0;
  let failed = 0;
  const nowIso = new Date(nowMs).toISOString();
  const dueAt = new Date(nowMs + LICENSE_SETUP_DUE_DAYS * 86_400_000).toISOString();
  for (let i = 0; i < tenantIds.length; i += CHUNK) {
    const ids = tenantIds.slice(i, i + CHUNK);
    const { data: tenants, error: tErr } = await admin.from("tenants").select("id, license_no").in("id", ids);
    if (tErr) {
      failed += 1;
      continue;
    }
    const rows = (tenants ?? []) as LicenseSetupTenant[];
    const filledIds = licenseFilledTenantIds(rows);
    if (filledIds.length > 0) {
      const { data: done, error: cErr } = await admin
        .from("tasks")
        .update({ status: "done", completed_at: nowIso })
        .in("tenant_id", filledIds)
        .eq("title", LICENSE_SETUP_TASK_TITLE)
        .eq("status", "open")
        .select("id");
      if (cErr) failed += 1;
      else closed += (done ?? []).length;
    }
    const missing = rows.filter((t) => !String(t.license_no ?? "").trim());
    if (missing.length === 0) continue;
    const missingIds = missing.map((t) => t.id);
    const [taskRes, ownerRes] = await Promise.all([
      admin.from("tasks").select("tenant_id").in("tenant_id", missingIds).eq("title", LICENSE_SETUP_TASK_TITLE),
      admin
        .from("profiles")
        .select("id, tenant_id")
        .in("tenant_id", missingIds)
        .eq("role", "owner")
        .eq("is_active", true)
        .order("created_at", { ascending: true }),
    ]);
    if (taskRes.error || ownerRes.error) {
      failed += 1;
      continue;
    }
    const withTask = new Set(((taskRes.data ?? []) as { tenant_id: string }[]).map((r) => r.tenant_id));
    const targets = pickLicenseSetupTargets(missing, withTask, (ownerRes.data ?? []) as LicenseSetupOwner[]);
    if (targets.length === 0) continue;
    const { error } = await admin.from("tasks").insert(
      targets.map((t) => ({
        tenant_id: t.tenantId,
        title: LICENSE_SETUP_TASK_TITLE,
        notes: LICENSE_SETUP_TASK_NOTES,
        kind: "document",
        priority: "high",
        status: "open",
        due_at: dueAt,
        assigned_to: t.ownerId,
      })),
    );
    if (error) failed += 1;
    else opened += targets.length;
  }
  return { opened, closed, failed };
}
