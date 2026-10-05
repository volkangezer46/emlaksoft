import { updateTag } from "next/cache";
import { logPlatformActivity } from "@/lib/platform-activity";
import { guardPlatformAction } from "@/lib/platform-guards";
import type { PlatformStaff } from "@/lib/platform";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import { requirePermission } from "@/lib/require-permission";
import { getSettingHistory } from "./history";
import { SETTINGS_PLATFORM_TAG, settingsTenantTag } from "./read";
import { prepareWrite, type WriteItem as Item } from "./prepare";
import { getSettingDef, isSecretDef, listSettingDefs, storageKeyOf } from "./registry";
import { isSealed, revealSecret, sealSecret, secretFingerprint } from "./secrets";
import type { AnySettingDef, SettingScope, WriteSettingInput, WriteSettingResult } from "./types";

/**
 * Ayar YAZMA (sunucu) — platform_settings / tenant_settings için TEK yazma yolu.
 *
 *  1. yetki (platform: guardPlatformAction + hız limiti; ofis: requirePermission(mod, "edit"))
 *  2. tip/sınır/çapraz kural (zod + codec) ve risk=high ise gerekçe zorunlu
 *  3. gizliyse şifrele (PLATFORM_SECRETS_KEY / türetilmiş anahtar yoksa DÜZ METİN YAZMA, özellik kapalı)
 *  4. ATOMİK yazım: `write_setting` RPC (değer + settings_history aynı işlemde; gizlide değer YOK, parmak izi var)
 *  5. platform_audit_logs satırı (gizlide değer YOK), önbellek etiketi tazelenir
 *
 * Geri al = yeni sürüm yazar (`revertSettingToVersion`); varsayılana dön = null yazar (`resetSetting`).
 * RPC henüz uygulanmamışsa (migration 20260826002400) platform kapsamında eski doğrudan yazıma düşülür (`degraded`).
 */

export const SETTINGS_RATE = { key: "settings-write", limit: 30, windowSec: 600 } as const;

type Actor = { id: string; scope: SettingScope; tenantId?: string; role?: string };

function invalidate(scope: SettingScope, tenantId?: string) {
  try {
    updateTag(scope === "platform" ? SETTINGS_PLATFORM_TAG : settingsTenantTag(tenantId ?? ""));
  } catch {
    /* sunucu eylemi dışı bağlam: 30 sn'lik önbellek süresi yeter */
  }
}

async function applyItems(
  actor: Actor,
  items: Item[],
  opts: { reason?: string; audit?: boolean; expectedVersion?: number | null; summary?: string },
): Promise<WriteSettingResult> {
  let version = 0;
  let degraded = false;
  let changedAny = false;
  for (const it of items) {
    const secret = isSecretDef(it.def);
    if (actor.scope === "platform" && !secret) {
      const current = await getPlatformSetting(it.storage);
      if ((current ?? null) === it.formatted) continue; // değişiklik yok: gürültü satırı yazma
    }
    const out: { version?: number; conflict?: boolean; degraded?: boolean } = {};
    const ok = await setPlatformSetting(it.storage, it.formatted, actor.id, {
      scope: actor.scope === "tenant" ? "tenant" : "platform",
      tenantId: actor.tenantId ?? null,
      isSecret: secret,
      actorType: actor.scope === "tenant" ? "tenant_user" : "platform_staff",
      reason: opts.reason ?? null,
      fingerprint: it.plain ? secretFingerprint(it.storage, it.plain) : null,
      summary: opts.summary ?? (secret ? (it.formatted === null ? "silindi" : "değiştirildi") : it.formatted === null ? "varsayılana dönüldü" : null),
      expectedVersion: opts.expectedVersion ?? null,
      out,
    });
    if (out.conflict) return { ok: false, error: "Ayar başka biri tarafından değiştirildi; sayfayı yenileyip tekrar deneyin.", conflict: true };
    if (!ok) return { ok: false, error: "Ayar kaydedilemedi. Lütfen tekrar deneyin." };
    changedAny = true;
    version = out.version ?? version;
    degraded = degraded || Boolean(out.degraded);
    if (opts.audit !== false && actor.scope === "platform") {
      await logPlatformActivity({
        actorId: actor.id,
        action: "settings.write",
        entityType: "platform_settings",
        meta: {
          key: it.def.key,
          storage: it.storage,
          version: out.version ?? null,
          secret,
          // Gizlide değer YOK; yalnız parmak izi. Gizli olmayanda yeni değer (kısa) yazılır.
          ...(secret ? { fingerprint: it.plain ? secretFingerprint(it.storage, it.plain) : null, cleared: it.formatted === null } : { new: it.formatted }),
          reason: opts.reason ?? null,
          degraded: Boolean(out.degraded),
        },
      });
    }
  }
  invalidate(actor.scope, actor.tenantId);
  return { ok: true, version, changed: changedAny, degraded: degraded || undefined };
}

/**
 * Kapıdan geçmiş PLATFORM personeli adına toplu yazım (mevcut eylemler kendi kapısını/hız sınırını korur).
 * Önce HEPSİ doğrulanır; biri geçersizse hiçbiri yazılmaz.
 */
export async function applyPlatformWrites(
  staff: Pick<PlatformStaff, "id">,
  writes: { key: string; value: unknown }[],
  opts: { reason?: string; audit?: boolean; fromBridge?: boolean; summary?: string },
): Promise<WriteSettingResult> {
  const items: Item[] = [];
  for (const w of writes) {
    const p = prepareWrite({ key: w.key, value: w.value, reason: opts.reason, fromBridge: opts.fromBridge });
    if (!p.ok) return { ok: false, error: p.error };
    if (p.item.def.scope !== "platform") return { ok: false, error: "Bu ayar platform kapsamında değil." };
    items.push(p.item);
  }
  return applyItems({ id: staff.id, scope: "platform" }, items, opts);
}

/** Tek ayar yazımı (kapı dahil). Ayar merkezi ve yeni ekranların kullanacağı giriş noktası. */
export async function writeSetting(input: WriteSettingInput & { fromBridge?: boolean }): Promise<WriteSettingResult> {
  const def = getSettingDef(input.key);
  if (!def) return { ok: false, error: `Bilinmeyen ayar: ${input.key}` };
  const scope = input.scope ?? def.scope;
  if (scope !== def.scope) {
    return { ok: false, error: "Ayar kapsamı uyuşmuyor." };
  }

  let actor: Actor;
  if (scope === "platform") {
    const gate = await guardPlatformAction({
      module: def.permission.platformModule ?? "sistem",
      roles: def.permission.superAdminOnly ? ["super_admin"] : undefined,
      rate: SETTINGS_RATE,
    });
    if ("error" in gate) return { ok: false, error: gate.error };
    actor = { id: gate.staff.id, scope: "platform", role: gate.staff.role };
  } else if (scope === "tenant") {
    if (!def.permission.appModule) return { ok: false, error: "Bu ayar için ofis yetkisi tanımlı değil." };
    const gate = await requirePermission(def.permission.appModule, "edit");
    if (!gate.ok) return { ok: false, error: gate.error };
    actor = { id: gate.userId, scope: "tenant", tenantId: gate.tenantId };
  } else {
    return { ok: false, error: "Şube/kullanıcı kapsamı henüz desteklenmiyor." };
  }

  const p = prepareWrite({ key: input.key, value: input.value, reason: input.reason, fromBridge: input.fromBridge });
  if (!p.ok) return { ok: false, error: p.error };
  return applyItems(actor, [p.item], { reason: input.reason, expectedVersion: input.expectedVersion });
}

/** Varsayılana dön (null yazar; geçmişe işler). */
export function resetSetting(key: string, reason: string, scope?: SettingScope): Promise<WriteSettingResult> {
  return writeSetting({ key, value: null, scope, reason: reason || "Varsayılana dönüldü" });
}

/** Geçmişteki bir sürüme dön = O sürümün değeriyle YENİ sürüm yazar. Gizli ayarlar geri alınamaz. */
export async function revertSettingToVersion(key: string, version: number, reason: string): Promise<WriteSettingResult> {
  const def = getSettingDef(key);
  if (!def) return { ok: false, error: `Bilinmeyen ayar: ${key}` };
  if (isSecretDef(def)) return { ok: false, error: "Gizli ayarlar geri alınamaz; yeni değeri girin." };
  const history = await getSettingHistory(key, { limit: 100 });
  const row = history.find((h) => h.version === version);
  if (!row) return { ok: false, error: "Sürüm bulunamadı." };
  if (row.actorType === "direct" && row.newValue == null) {
    return { ok: false, error: "Doğrudan yazılan sürümün değeri kayıtlı değil; geri alınamaz." };
  }
  const value = row.newValue == null ? null : row.newValue;
  return writeSetting({ key, value, reason: reason || `v${version} sürümüne dönüldü` });
}

export type EncryptPlaintextReport = {
  ok: boolean;
  dryRun: boolean;
  error?: string;
  found: { key: string; storage: string; state: "düz metin" | "şifreli" | "tanımsız" }[];
  encrypted: string[];
  failed: string[];
};

/**
 * TEK SEFERLİK, süper admin onaylı: düz metin saklanan gizli ayarları şifreler. OTOMATİK DEĞİL.
 * Doğrulayıcı: yazmadan önce şifrele-çöz turu eşit olmalı; yazdıktan sonra okuma yeniden açılıp karşılaştırılır;
 * uyuşmazsa eski değer otomatik geri yazılır. Düz değer log/geçmiş/denetime ASLA yazılmaz (yalnız parmak izi).
 */
export async function encryptPlaintextSecrets(opts: { dryRun: boolean }): Promise<EncryptPlaintextReport> {
  const report: EncryptPlaintextReport = { ok: false, dryRun: opts.dryRun, found: [], encrypted: [], failed: [] };
  const gate = await guardPlatformAction({
    module: "sistem",
    roles: ["super_admin"],
    rate: { key: "settings-encrypt-secrets", limit: 4, windowSec: 3600 },
  });
  if ("error" in gate) return { ...report, error: gate.error };
  if (!secretsWritable()) {
    return { ...report, error: "Şifreli saklama etkin değil (PLATFORM_SECRETS_KEY tanımlı değil); hiçbir şey değiştirilmedi." };
  }
  const defs = listSettingDefs({ scope: "platform" }).filter(isSecretDef);
  const todo: { def: AnySettingDef; storage: string; plain: string }[] = [];
  for (const def of defs) {
    const storage = storageKeyOf(def);
    const raw = await getPlatformSetting(storage);
    if (!raw) report.found.push({ key: def.key, storage, state: "tanımsız" });
    else if (isSealed(raw)) report.found.push({ key: def.key, storage, state: "şifreli" });
    else {
      report.found.push({ key: def.key, storage, state: "düz metin" });
      todo.push({ def, storage, plain: raw });
    }
  }
  if (opts.dryRun) return { ...report, ok: true };

  for (const t of todo) {
    const sealed = sealSecret(t.storage, t.plain);
    if (!sealed || revealSecret(t.storage, sealed) !== t.plain) {
      report.failed.push(t.def.key);
      continue;
    }
    const ok = await applyItems(
      { id: gate.staff.id, scope: "platform" },
      [{ def: t.def, storage: t.storage, formatted: sealed, plain: t.plain }],
      { reason: "Düz metin sır şifrelendi (tek seferlik geçiş)", summary: "düz metin şifrelendi" },
    );
    const after = ok.ok ? revealSecret(t.storage, await getPlatformSetting(t.storage)) : null;
    if (!ok.ok || after !== t.plain) {
      // Otomatik geri alma: eski düz değeri geri yaz (kayıp olmasın).
      await setPlatformSetting(t.storage, t.plain, gate.staff.id);
      report.failed.push(t.def.key);
      continue;
    }
    report.encrypted.push(t.def.key);
  }
  await logPlatformActivity({
    actorId: gate.staff.id,
    action: "settings.encrypt_plaintext_secrets",
    entityType: "platform_settings",
    meta: { encrypted: report.encrypted, failed: report.failed },
  });
  return { ...report, ok: report.failed.length === 0 };
}