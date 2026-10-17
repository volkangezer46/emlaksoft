import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { secretCandidates, type SecretCandidate } from "@/lib/settings/secret-health";
import { EF_SETTING } from "@/lib/integrations/emlakfiyati/keys";
import { PSI_KEY_SETTING } from "@/lib/perf/store";
import { ENV_SECRETS, panelSecretGroup, parseRotatedAt, rotatedAtVar, rotationAge, sortRotationRows, type SecretRotationRow } from "./secret-rotation";

/**
 * Sır rotasyon yaşı okuyucusu (SUNUCU; sayfa `requirePlatformModule("sistem")` kapısından SONRA). DEĞER OKUNMAZ:
 *  - platform_settings'ten yalnız `key, updated_at` seçilir ve "değer dolu mu" süzgeci veritabanında uygulanır;
 *  - settings_history'den yalnız `key, created_at, fingerprint, summary` (gizli satırda değer zaten yoktur, CHECK);
 *  - ortam anahtarında yalnız "tanımlı mı" (boş olmayan) ve isteğe bağlı `<AD>_ROTATED_AT` tarihi.
 * Okunamazsa satır "izlenmiyor" kalır; tarih uydurulmaz.
 */

const PSI_CANDIDATE: SecretCandidate = { key: PSI_KEY_SETTING, storageKey: PSI_KEY_SETTING, label: "PageSpeed API anahtarı", href: "/admin/site/hiz" };

function envSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export async function loadSecretRotation(): Promise<SecretRotationRow[]> {
  const nowMs = now();
  const panel = [...secretCandidates(), PSI_CANDIDATE];
  const storageKeys = [...new Set(panel.map((c) => c.storageKey))];

  const present = new Map<string, string | null>();
  const rotated = new Map<string, string>();
  let efChangedAt: string | null = null;
  try {
    const admin = createAdminClient();
    const [p, h, ef] = await Promise.all([
      admin.from("platform_settings").select("key, updated_at").in("key", storageKeys).not("value", "is", null).neq("value", ""),
      admin
        .from("settings_history")
        .select("key, created_at, fingerprint, summary")
        .eq("scope", "platform")
        .in("key", storageKeys)
        .order("created_at", { ascending: false })
        .limit(1000),
      admin.from("platform_settings").select("value").eq("key", EF_SETTING.changedAt).maybeSingle(),
    ]);
    for (const r of (p.data ?? []) as { key: string; updated_at: string | null }[]) present.set(r.key, r.updated_at);
    for (const r of (h.data ?? []) as { key: string; created_at: string; fingerprint: string | null; summary: string | null }[]) {
      if (rotated.has(r.key)) continue;
      // Döndürme = yeni değer yazımı (parmak izi var). "silindi" satırı döndürme sayılmaz.
      if (r.fingerprint || r.summary === "değiştirildi") rotated.set(r.key, r.created_at);
    }
    const efRaw = (ef.data as { value?: string | null } | null)?.value ?? null;
    efChangedAt = parseRotatedAt(efRaw, nowMs);
  } catch (e) {
    console.error("loadSecretRotation", e instanceof Error ? e.message : e);
  }

  const rows: SecretRotationRow[] = panel.map((c) => {
    const set = present.has(c.storageKey);
    const rotatedAt = c.storageKey === EF_SETTING.current ? (efChangedAt ?? rotated.get(c.storageKey) ?? null) : (rotated.get(c.storageKey) ?? present.get(c.storageKey) ?? null);
    return { id: `panel:${c.storageKey}`, label: c.label, group: panelSecretGroup(c.storageKey), source: "panel", set, rotatedAt, ...rotationAge(rotatedAt, set, nowMs), href: c.href };
  });
  for (const e of ENV_SECRETS) {
    const set = envSet(e.name);
    const rotatedAt = parseRotatedAt(process.env[rotatedAtVar(e.name)], nowMs);
    rows.push({ id: `env:${e.name}`, label: `${e.label} (${e.name})`, group: e.group, source: "ortam", set, rotatedAt, ...rotationAge(rotatedAt, set, nowMs), href: null, trackVar: rotatedAtVar(e.name) });
  }
  return sortRotationRows(rows);
}
