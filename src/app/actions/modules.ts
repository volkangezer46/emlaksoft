"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { OFFICE_ADMIN_DENIED, officeAdminCan } from "@/lib/admin/office-admin-access";
import { getTenantGateContext } from "@/lib/cache/request";
import { now } from "@/lib/clock";
import {
  computeBundleChanges,
  computePresetChanges,
  computeSetupChanges,
  isMissingTableError,
  MODULE_PRESETS,
  resolveModuleState,
  type ModuleRow,
  type PresetChange,
} from "@/lib/modules/logic";
import { canManageModules } from "@/lib/modules/permissions";
import { planLockedKeys } from "@/lib/modules/plan";
import {
  BUNDLES,
  closedDependencies,
  dependentsOf,
  getBundle,
  getModuleDef,
  type BundleId,
  isFeatureKey,
  type FeatureKey,
} from "@/lib/modules/registry";
import { getTenantModuleState } from "@/lib/modules/state";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { requirePermission } from "@/lib/require-permission";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { actionErrorMessage } from "@/lib/action-errors";

export type ModuleActionResult = { ok?: boolean; error?: string; message?: string };

const UNAVAILABLE = "Modül yönetimi henüz etkin değil.";
const DENIED = "Modülleri yalnız ofis sahibi ve genel müdür değiştirebilir.";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function labelOf(key: FeatureKey): string {
  return getModuleDef(key).label;
}

type Change = { key: FeatureKey; enabled: boolean };

/** Ofis tarafı yazımı: RLS'li client (yalnız owner/gm, platform kilidi olmayan satır). */
async function writeChanges(tenantId: string, userId: string, changes: Change[]): Promise<ModuleActionResult | null> {
  if (changes.length === 0) return null;
  const supabase = await createClient();
  const stamp = new Date(now()).toISOString();
  const { error } = await supabase.from("tenant_modules").upsert(
    changes.map((c) => ({
      tenant_id: tenantId,
      module_key: c.key,
      enabled: c.enabled,
      updated_by: userId,
      updated_at: stamp,
    })),
    { onConflict: "tenant_id,module_key" },
  );
  if (error) {
    if (isMissingTableError(error)) return { error: UNAVAILABLE };
    console.error("tenant_modules yazılamadı", error);
    return { error: "Modül durumu kaydedilemedi. Platform kilidi olan bir modül olabilir." };
  }
  return null;
}

async function auditChanges(tenantId: string, userId: string, before: ReadonlySet<string>, changes: Change[]) {
  for (const c of changes) {
    await logActivity({
      tenantId,
      actorId: userId,
      action: "module.toggle",
      entityType: "module",
      entityId: null,
      oldValue: { module: c.key, enabled: !before.has(c.key) },
      newValue: { module: c.key, enabled: c.enabled },
    });
  }
}

/**
 * Tek modülü aç/kapat. Kapatırken bağlı modüller de kapanır: onay (`cascade`) yoksa hata ile listelenir.
 * Açarken kapalı bağımlılık varsa önce onu açmak gerekir.
 */
export async function setModuleEnabled(moduleKey: string, enabled: boolean, cascade = false): Promise<ModuleActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating || !canManageModules(gate.role)) return { error: DENIED };
  if (!isFeatureKey(moduleKey)) return { error: "Çekirdek ve sistem modülleri kapatılamaz." };

  const state = await getTenantModuleState(gate.tenantId);
  if (state.status === "unavailable") return { error: UNAVAILABLE };
  if (state.locked.includes(moduleKey)) return { error: `${labelOf(moduleKey)} platform tarafından kilitlenmiş; değiştirilemez.` };
  const planCtx = await getTenantGateContext(gate.tenantId);
  if (planLockedKeys(planCtx).includes(moduleKey)) return { error: `${labelOf(moduleKey)} paketinize dahil değil.` };

  const closed = new Set<string>(state.closed);
  const changes: Change[] = [];
  if (enabled) {
    const missing = closedDependencies(moduleKey, closed);
    if (missing.length > 0) return { error: `Önce şunları açın: ${missing.map(labelOf).join(", ")}.` };
    if (closed.has(moduleKey)) changes.push({ key: moduleKey, enabled: true });
  } else {
    if (!closed.has(moduleKey)) changes.push({ key: moduleKey, enabled: false });
    const dependents = dependentsOf(moduleKey).filter((k) => !closed.has(k));
    if (dependents.length > 0) {
      const lockedOpen = dependents.filter((k) => state.locked.includes(k));
      if (lockedOpen.length > 0) return { error: `${lockedOpen.map(labelOf).join(", ")} platform tarafından kilitli olduğu için ${labelOf(moduleKey)} kapatılamaz.` };
      if (!cascade) return { error: `${labelOf(moduleKey)} kapanınca şunlar da kapanır: ${dependents.map(labelOf).join(", ")}. Onaylayın.` };
      for (const k of dependents) changes.push({ key: k, enabled: false });
    }
  }
  if (changes.length === 0) return { ok: true, message: "Değişiklik yok." };

  const failed = await writeChanges(gate.tenantId, gate.userId, changes);
  if (failed) return failed;
  await auditChanges(gate.tenantId, gate.userId, closed, changes);
  revalidatePath("/app", "layout");
  return { ok: true, message: enabled ? `${labelOf(moduleKey)} açıldı.` : `${labelOf(moduleKey)} kapatıldı. Verileriniz silinmedi.` };
}

/** Ofis tipi ön ayarını uygular (önizleme ile AYNI hesap: computePresetChanges). */
export async function applyModulePreset(presetId: string): Promise<ModuleActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating || !canManageModules(gate.role)) return { error: DENIED };
  const preset = MODULE_PRESETS.find((p) => p.id === presetId);
  if (!preset) return { error: "Ön ayar bulunamadı." };

  const state = await getTenantModuleState(gate.tenantId);
  if (state.status === "unavailable") return { error: UNAVAILABLE };
  const planCtx = await getTenantGateContext(gate.tenantId);
  const diff = computePresetChanges(preset, state.closed, { locked: state.locked, planLocked: planLockedKeys(planCtx) });
  const changes: Change[] = [
    ...diff.toClose.map((key) => ({ key, enabled: false })),
    ...diff.toOpen.map((key) => ({ key, enabled: true })),
  ];
  if (changes.length === 0) return { ok: true, message: "Bu ön ayar zaten uygulanmış durumda." };

  const failed = await writeChanges(gate.tenantId, gate.userId, changes);
  if (failed) return failed;
  await auditChanges(gate.tenantId, gate.userId, new Set(state.closed), changes);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: "module.preset",
    entityType: "module",
    newValue: { preset: preset.id, closed: diff.toClose, opened: diff.toOpen },
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: `${preset.title} ön ayarı uygulandı: ${diff.toClose.length} modül kapandı, ${diff.toOpen.length} modül açıldı.` };
}

/** Paket (bundle) aç/kapat ya da ilk kurulum cevabı: ortak uygulama (önizleme ile AYNI hesap). */
async function applyBundleChanges(
  build: (state: { closed: FeatureKey[]; locked: FeatureKey[] }, planLocked: FeatureKey[]) => PresetChange,
  describe: (diff: PresetChange) => string,
  audit: { action: string; payload: Record<string, unknown> },
): Promise<ModuleActionResult> {
  const gate = await requirePermission("settings", "edit");
  if (!gate.ok) return { error: gate.error };
  if (gate.impersonating || !canManageModules(gate.role)) return { error: DENIED };

  const state = await getTenantModuleState(gate.tenantId);
  if (state.status === "unavailable") return { error: UNAVAILABLE };
  const planCtx = await getTenantGateContext(gate.tenantId);
  const diff = build(state, planLockedKeys(planCtx));
  const changes: Change[] = [
    ...diff.toClose.map((key) => ({ key, enabled: false })),
    ...diff.toOpen.map((key) => ({ key, enabled: true })),
  ];
  if (changes.length === 0) return { ok: true, message: "Değişiklik yok." };

  const failed = await writeChanges(gate.tenantId, gate.userId, changes);
  if (failed) return failed;
  await auditChanges(gate.tenantId, gate.userId, new Set(state.closed), changes);
  await logActivity({
    tenantId: gate.tenantId,
    actorId: gate.userId,
    action: audit.action,
    entityType: "module",
    newValue: { ...audit.payload, closed: diff.toClose, opened: diff.toOpen },
  });
  revalidatePath("/app", "layout");
  return { ok: true, message: describe(diff) };
}

/** Modül paketini tek anahtarla aç/kapat (üyeler + bağımlılık zinciri; kilitli üyelere dokunulmaz). */
export async function setBundleEnabled(bundleId: string, enabled: boolean): Promise<ModuleActionResult> {
  const bundle = getBundle(bundleId);
  if (!bundle) return { error: "Paket bulunamadı." };
  return applyBundleChanges(
    (state, planLocked) => computeBundleChanges(bundle.id, enabled, state.closed, { locked: state.locked, planLocked }),
    (diff) =>
      enabled
        ? `${bundle.title} paketi açıldı (${diff.toOpen.length} modül). Verileriniz silinmedi.`
        : `${bundle.title} paketi kapatıldı (${diff.toClose.length} modül). Verileriniz silinmedi.`,
    { action: "module.bundle", payload: { bundle: bundle.id, enabled } },
  );
}

/** İlk kurulum sihirbazı: paket soruları cevaplarına göre (evet=açık, hayır=kapalı) tek seferde uygular. */
export async function applyModuleSetup(answers: Record<string, boolean>): Promise<ModuleActionResult> {
  const clean: Partial<Record<BundleId, boolean>> = {};
  for (const b of BUNDLES) if (typeof answers?.[b.id] === "boolean") clean[b.id] = answers[b.id];
  if (Object.keys(clean).length === 0) return { error: "Önce soruları yanıtlayın." };
  return applyBundleChanges(
    (state, planLocked) => computeSetupChanges(clean, state.closed, { locked: state.locked, planLocked }),
    (diff) => `Kurulum uygulandı: ${diff.toClose.length} modül kapandı, ${diff.toOpen.length} modül açıldı.`,
    { action: "module.setup", payload: { answers: clean } },
  );
}

/**
 * Admin (Ofis 360 > Yönetim): ofis için modülü ZORUNLU aç/kapa ya da platform kilidini kaldır.
 * `mode`: "force_on" | "force_off" (locked_by_platform=true yazar; ofis değiştiremez) | "release" (kilidi kaldırır, durum kalır).
 */
export async function setTenantModuleByAdmin(officeId: string, moduleKey: string, mode: string): Promise<ModuleActionResult> {
  const tenantId = officeId;
  const staff = await requirePlatformModule("tenants");
  if (!officeAdminCan(staff.role, "plan_status")) return { error: OFFICE_ADMIN_DENIED };
  if (!UUID_RE.test(tenantId)) return { error: "Ofis bulunamadı." };
  if (!isFeatureKey(moduleKey)) return { error: "Çekirdek ve sistem modülleri kapatılamaz." };
  if (mode !== "force_on" && mode !== "force_off" && mode !== "release") return { error: "Geçersiz işlem." };

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("id").eq("id", tenantId).maybeSingle();
  if (!tenant) return { error: "Ofis bulunamadı." };

  const { data: existing, error: readError } = await admin
    .from("tenant_modules")
    .select("module_key, enabled, locked_by_platform")
    .eq("tenant_id", tenantId)
    .eq("module_key", moduleKey)
    .maybeSingle();
  if (readError) return { error: isMissingTableError(readError) ? UNAVAILABLE : actionErrorMessage(readError, "Modül durumu okunamadı.") };
  const before = (existing as ModuleRow | null) ?? null;
  const beforeEnabled = before ? before.enabled : true;
  const beforeLocked = before?.locked_by_platform === true;

  let enabled = beforeEnabled;
  let locked = beforeLocked;
  if (mode === "force_on") {
    enabled = true;
    locked = true;
  } else if (mode === "force_off") {
    enabled = false;
    locked = true;
  } else {
    locked = false;
  }

  if (mode === "force_on") {
    // Bağımlılık: açılacak modülün bağımlılığı kapalıysa zorunlu açma tutarsız olur.
    const rows = await admin.from("tenant_modules").select("module_key, enabled, locked_by_platform").eq("tenant_id", tenantId);
    const closed = new Set(resolveModuleState((rows.data ?? []) as ModuleRow[]).closed as string[]);
    const missing = closedDependencies(moduleKey, closed);
    if (missing.length > 0) return { error: `Önce şunları açın: ${missing.map(labelOf).join(", ")}.` };
  }

  const { error } = await admin.from("tenant_modules").upsert(
    {
      tenant_id: tenantId,
      module_key: moduleKey,
      enabled,
      locked_by_platform: locked,
      updated_by: null,
      updated_at: new Date(now()).toISOString(),
    },
    { onConflict: "tenant_id,module_key" },
  );
  if (error) {
    if (isMissingTableError(error)) return { error: UNAVAILABLE };
    console.error("setTenantModuleByAdmin", error);
    return { error: actionErrorMessage(error, "Modül durumu kaydedilemedi.") };
  }

  await logPlatformActivity({
    actorId: staff.id,
    action: "tenant.module",
    entityType: "tenant",
    entityId: tenantId,
    meta: { module: moduleKey, mode, from: { enabled: beforeEnabled, locked: beforeLocked }, to: { enabled, locked } },
  });
  await logActivity({
    tenantId,
    actorId: null,
    action: "module.platform_set",
    entityType: "module",
    oldValue: { module: moduleKey, enabled: beforeEnabled, locked: beforeLocked },
    newValue: { module: moduleKey, enabled, locked, by: "platform" },
  });
  revalidatePath(`/admin/tenants/${tenantId}`);
  return {
    ok: true,
    message:
      mode === "release"
        ? `${labelOf(moduleKey)} için platform kilidi kaldırıldı.`
        : `${labelOf(moduleKey)} ofis için ${enabled ? "zorunlu açık" : "zorunlu kapalı"}.`,
  };
}
