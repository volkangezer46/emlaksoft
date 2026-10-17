"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStepUp } from "@/lib/platform-security/step-up";
import { logPlatformActivity } from "@/lib/platform-activity";
import { logActivity } from "@/lib/activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/clock";
import { isDemoTenantSlug, DEMO_TENANT_SLUG } from "@/lib/demo-tenant";
import { insertSampleRecords } from "@/lib/sample-data-seed";
import { purgeSampleData } from "@/lib/sample-data/purge";
import { removeSamplePersonaIdentities } from "@/lib/sample-data/personas";
import { normalizePack } from "@/lib/sample-data/seed";
import { runDemoNightlyReset } from "@/lib/demo-reset";

/**
 * PLATFORM DEMO VERİSİ KONTROLÜ (Ofis 360 > Demo verisi, /admin/tenants/demo). Üç işlem; her biri YALNIZ süper admin +
 * gerekçe (≥10 karakter) + doğrulayıcı kodu (AD11 step-up, `demo_data`) + hız sınırı + platform VE ofis denetim izi:
 *  1. Yeniden yükle: yalnız GERÇEK KAYDI OLMAYAN ofis. Varsa eski örnekler silinir, 10 dk'lık süper admin izniyle
 *     (`sample_seed_override_until`) yeni zengin set yüklenir, kilit kaldırılır. Gerçek kaydı olan ofiste DB de reddeder.
 *  2. Zorla temizle: ofisin tüm örnek verisini purge v2 ile siler (service_role) ve ofisi kilitler.
 *  3. Genel demo ofisini sıfırla: gece sıfırlamasını hemen çalıştırır (tabandan sonraki ekler + [SAHA] + tohum geri yükleme).
 */
export type AdminDemoResult = { ok?: boolean; error?: string; message?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_REASON = 10;
const OVERRIDE_MS = 10 * 60_000;
const DENIED = "Bu işlem yalnız süper admin tarafından yapılabilir.";

type Gate = { ok: true; staffId: string; reason: string } | { ok: false; error: string };

async function gate(staff: { id: string; role: string }, formData: FormData, key: string): Promise<Gate> {
  if (staff.role !== "super_admin") return { ok: false, error: DENIED };
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
  if (reason.length < MIN_REASON) return { ok: false, error: `Gerekçe en az ${MIN_REASON} karakter olmalı.` };
  const { allowed } = await checkRateLimit(`admin-demo:${key}:${staff.id}`, { limit: 12, windowSec: 3600, failurePolicy: "deny" });
  if (!allowed) return { ok: false, error: "Çok sık deneme. Lütfen biraz sonra tekrar deneyin." };
  const stepUp = await requireStepUp(formData, "demo_data", staff.id);
  if (!stepUp.ok) return { ok: false, error: stepUp.error };
  return { ok: true, staffId: staff.id, reason };
}

function tenantIdOf(formData: FormData): string | null {
  const id = String(formData.get("id") ?? "");
  return UUID_RE.test(id) ? id : null;
}

export async function adminReseedSampleData(formData: FormData): Promise<AdminDemoResult> {
  const g = await gate(await requirePlatformModule("tenants"), formData, "reseed");
  if (!g.ok) return { error: g.error };
  const tenantId = tenantIdOf(formData);
  if (!tenantId) return { error: "Ofis bulunamadı." };
  const pack = normalizePack(formData.get("pack"));

  const admin = createAdminClient();
  const [{ data: tenant }, real, { data: owner }] = await Promise.all([
    admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle(),
    admin.rpc("tenant_real_record_count", { p_tenant_id: tenantId }),
    admin.from("profiles").select("id").eq("tenant_id", tenantId).eq("role", "owner").eq("is_sample", false).eq("is_active", true).limit(1).maybeSingle(),
  ]);
  if (!tenant) return { error: "Ofis bulunamadı." };
  if (isDemoTenantSlug((tenant as { slug?: string | null }).slug)) return { error: "Genel demo ofisi buradan yüklenmez; 'Genel demo ofisini sıfırla' kullanın." };
  if (real.error) return { error: "Kilit durumu okunamadı (migration 20261024020000 uygulanmış olmalı)." };
  if (Number(real.data ?? 0) > 0) return { error: "Ofiste gerçek kayıt var; örnek veri yalnız gerçek kaydı olmayan ofise yüklenebilir." };
  const ownerId = (owner as { id?: string } | null)?.id;
  if (!ownerId) return { error: "Ofis sahibi bulunamadı." };

  // Eski örnekler (varsa) önce temizlenir; purge ofisi kilitler, ardından kısa süreli süper admin izni verilir.
  const purged = await purgeSampleData({ session: admin, tenantId, fallbackAdmin: admin });
  if (!purged.ok) return { error: purged.error };
  if (purged.personasRemoved.length) await removeSamplePersonaIdentities(admin, purged.personasRemoved);

  const until = new Date(now() + OVERRIDE_MS).toISOString();
  const { error: oErr } = await admin.from("tenants").update({ sample_seed_override_until: until, sample_seed_override_by: g.staffId }).eq("id", tenantId);
  if (oErr) return { error: "Yeniden yükleme izni yazılamadı; hiçbir şey değişmedi. Birkaç saniye sonra tekrar deneyin." };

  let counts: Record<string, number> = {};
  let failed: string[] = [];
  try {
    const report = await insertSampleRecords(admin, tenantId, ownerId, { extrasDb: admin, pack });
    counts = report.counts;
    failed = report.failed.map((f) => f.group);
    const { error: mErr } = await admin
      .from("tenants")
      .update({
        sample_seeded_at: new Date(now()).toISOString(),
        sample_pack: pack,
        sample_cleared_at: null,
        real_use_at: null,
        sample_seed_override_until: null,
        sample_seed_override_by: null,
      })
      .eq("id", tenantId);
    if (mErr) throw mErr;
  } catch (e) {
    console.error("adminReseedSampleData", e);
    await admin.from("tenants").update({ sample_seed_override_until: null, sample_seed_override_by: null }).eq("id", tenantId);
    return { error: "Örnek veriler yüklenemedi; ofis gerçek kullanım kilidinde kaldı. Tekrar deneyebilirsiniz." };
  }

  const meta = { reason: g.reason, pack, loaded: counts, failed, purged: purged.report.totalDeleted };
  await logPlatformActivity({ actorId: g.staffId, action: "tenant.sample_data.reseed", entityType: "tenant", entityId: tenantId, meta });
  await logActivity({ tenantId, actorId: null, action: "sample_data.seed", entityType: "tenant", entityId: tenantId, newValue: { by: "platform", ...meta } });
  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: true, message: `Örnek ofis yeniden yüklendi (${counts.customers ?? 0} müşteri, ${counts.properties ?? 0} portföy).` };
}

export async function adminForcePurgeSampleData(formData: FormData): Promise<AdminDemoResult> {
  const g = await gate(await requirePlatformModule("tenants"), formData, "purge");
  if (!g.ok) return { error: g.error };
  const tenantId = tenantIdOf(formData);
  if (!tenantId) return { error: "Ofis bulunamadı." };
  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
  if (!tenant) return { error: "Ofis bulunamadı." };
  if (isDemoTenantSlug((tenant as { slug?: string | null }).slug)) return { error: "Genel demo ofisi temizlenmez; 'Genel demo ofisini sıfırla' kullanın." };
  const result = await purgeSampleData({ session: admin, tenantId, fallbackAdmin: admin });
  if (!result.ok) return { error: result.error };
  const identities = result.personasRemoved.length ? await removeSamplePersonaIdentities(admin, result.personasRemoved) : null;
  const meta = { reason: g.reason, deleted: result.report.deleted, total: result.report.totalDeleted, team_removed: identities?.removed ?? 0 };
  await logPlatformActivity({ actorId: g.staffId, action: "tenant.sample_data.force_purge", entityType: "tenant", entityId: tenantId, meta });
  await logActivity({ tenantId, actorId: null, action: "sample_data.clear", entityType: "tenant", entityId: tenantId, newValue: { by: "platform", ...meta } });
  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: true, message: `${result.report.totalDeleted} örnek kayıt silindi; ofis gerçek kullanıma kilitlendi.` };
}

export async function adminResetPublicDemo(formData: FormData): Promise<AdminDemoResult> {
  const g = await gate(await requirePlatformModule("tenants"), formData, "public-reset");
  if (!g.ok) return { error: g.error };
  const admin = createAdminClient();
  const nowMs = now();
  const { data: demo } = await admin.from("tenants").select("id").eq("slug", DEMO_TENANT_SLUG).maybeSingle();
  if (!demo) return { error: "Genel demo ofisi bulunamadı." };
  const demoTenantId = String((demo as { id: string }).id);
  try {
    const out = await runDemoNightlyReset(admin, { nowMs });
    await logPlatformActivity({
      actorId: g.staffId,
      action: "demo_tenant.reset",
      entityType: "tenant",
      entityId: demoTenantId,
      meta: { reason: g.reason, slug: DEMO_TENANT_SLUG, tenant_id: demoTenantId, result: out },
    });
    revalidatePath("/admin/tenants/demo");
    if ("skipped" in out) {
      return { error: out.skipped === "no_demo_tenant" ? "Genel demo ofisi bulunamadı." : "Gece sıfırlama fonksiyonu kurulu değil (migration bekliyor)." };
    }
    return { ok: true, message: "Genel demo ofisi ilk haline döndürüldü." };
  } catch (e) {
    console.error("adminResetPublicDemo", e);
    return { error: "Sıfırlama başarısız. Ayrıntı sunucu günlüğünde." };
  }
}
