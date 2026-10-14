"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import type { PlatformStaff } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { getBaseUrl } from "@/lib/base-url";
import { CRON_JOBS } from "@/lib/cron-jobs";
import { secretsWritable } from "@/lib/settings/secrets";
import { channelTargetHint, parseChannelInput } from "@/lib/alerts/channel-config";
import { openChannelConfig, sealChannelConfig, sendToChannel } from "@/lib/alerts/channels";
import { formatAlertText } from "@/lib/alerts/evaluate";
import { emailSchema } from "@/lib/validation/contact";
import { ALERT_RULES, isAlertRuleKey } from "@/lib/alerts/rules";

/**
 * Operasyon ve uyarı merkezi eylemleri (Sistem > Uyarılar, cron duraklatma, hata triyajı).
 * Kapı: `requirePlatformModule("sistem")`; kanal/kural/duraklatma yazımı yalnız süper admin, hata triyajı modül erişimi
 * olan tüm personel. Kanal sırları yalnız şifreli yazılır (anahtar yoksa kanal KAYDEDİLMEZ); düz değer denetim kaydına,
 * yanıta veya günlüğe girmez (yalnız maskeli hedef).
 */

export type OpsResult = { ok?: boolean; error?: string; detail?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETUP_PENDING = "Uyarı merkezi tabloları henüz kurulmadı (migration 20261013004900 bekliyor).";
const missingTable = (e: { code?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "42703" || e.code === "PGRST204"));
// Kural anahtarı CHECK'te yok: kuralı ekleyen migration bekliyor (ör. engine_stalled, 20261014022000).
const ruleSetupPending = (e: { code?: string } | null) => Boolean(e && e.code === "23514");
const RULE_SETUP_PENDING = "Bu kural için veritabanı kurulumu bekliyor (kuralı ekleyen migration henüz uygulanmadı); kural varsayılan değerlerle çalışır.";

async function opsGate(opts: { superAdmin?: boolean; rate?: { key: string; limit: number; windowSec: number } }): Promise<{ staff: PlatformStaff } | { error: string }> {
  const staff = await requirePlatformModule("sistem");
  if (opts.superAdmin && staff.role !== "super_admin") return { error: "Bu işlem yalnız süper admin içindir." };
  if (opts.rate) {
    const { allowed } = await checkRateLimit(`${opts.rate.key}:${staff.id}`, { limit: opts.rate.limit, windowSec: opts.rate.windowSec, failurePolicy: "deny" });
    if (!allowed) return { error: "Çok sık işlem yapıldı. Lütfen biraz sonra tekrar deneyin." };
  }
  return { staff };
}

function refresh() {
  revalidatePath("/admin/sistem");
}

/* ───────────────────────── Cron duraklatma ───────────────────────── */

export async function setCronPaused(fd: FormData): Promise<OpsResult> {
  const g = await opsGate({ superAdmin: true, rate: { key: "ops-cron-pause", limit: 20, windowSec: 600 } });
  if ("error" in g) return g;
  const job = String(fd.get("job") ?? "").trim();
  if (!CRON_JOBS.some((j) => j.job === job)) return { error: "Bilinmeyen zamanlanmış iş." };
  const paused = String(fd.get("paused") ?? "") === "1";
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 300) || null;
  const stamp = new Date(now()).toISOString();
  const admin = createAdminClient();
  const { error } = await admin.from("cron_job_state").upsert(
    { job, paused, paused_at: paused ? stamp : null, paused_by: paused ? g.staff.id : null, reason: paused ? reason : null, updated_at: stamp },
    { onConflict: "job" },
  );
  if (error) return { error: missingTable(error) ? SETUP_PENDING : actionErrorMessage(error, "Durum kaydedilemedi.") };
  await logPlatformActivity({ actorId: g.staff.id, action: paused ? "platform_cron.pause" : "platform_cron.resume", entityType: "cron_job", meta: { job, reason } });
  refresh();
  return { ok: true };
}

/* ───────────────────────── Uyarı kanalları ───────────────────────── */

export async function createAlertChannel(fd: FormData): Promise<OpsResult> {
  const g = await opsGate({ superAdmin: true, rate: { key: "ops-alert-channel", limit: 20, windowSec: 600 } });
  if ("error" in g) return g;
  if (!secretsWritable()) return { error: "Şifreleme anahtarı tanımlı değil (PLATFORM_SECRETS_KEY); kanal sırları düz metin saklanmaz." };
  const kind = String(fd.get("kind") ?? "");
  // E-posta: tek doğrulayıcı (validation/contact); normalleştirilmiş adres saklanır.
  const email = kind === "email" ? emailSchema.safeParse(String(fd.get("email") ?? "")) : null;
  if (email && !email.success) return { error: email.error.issues[0]?.message ?? "Geçerli bir e-posta adresi girin." };
  const parsed = parseChannelInput({
    kind,
    name: String(fd.get("name") ?? ""),
    botToken: String(fd.get("botToken") ?? ""),
    chatId: String(fd.get("chatId") ?? ""),
    email: email?.success ? email.data : "",
    url: String(fd.get("url") ?? ""),
    secret: String(fd.get("secret") ?? ""),
  });
  if (!parsed.ok) return { error: parsed.error };
  const id = randomUUID();
  const sealed = sealChannelConfig(id, parsed.config);
  if (!sealed) return { error: "Kanal yapılandırması şifrelenemedi." };
  const hint = channelTargetHint(parsed.config);
  const admin = createAdminClient();
  const { error } = await admin.from("alert_channels").insert({
    id,
    kind: parsed.config.kind,
    name: parsed.name,
    enabled: true,
    config_sealed: sealed,
    target_hint: hint,
    created_by: g.staff.id,
  });
  if (error) return { error: missingTable(error) ? SETUP_PENDING : actionErrorMessage(error, "Kanal kaydedilemedi.") };
  await logPlatformActivity({ actorId: g.staff.id, action: "alert_channel.create", entityType: "alert_channel", entityId: id, meta: { kind: parsed.config.kind, name: parsed.name, target: hint } });
  refresh();
  return { ok: true };
}

export async function setAlertChannelEnabled(id: string, enabled: boolean): Promise<OpsResult> {
  const g = await opsGate({ superAdmin: true });
  if ("error" in g) return g;
  if (!UUID_RE.test(id ?? "")) return { error: "Kanal bulunamadı." };
  const admin = createAdminClient();
  const { error } = await admin.from("alert_channels").update({ enabled: Boolean(enabled), updated_at: new Date(now()).toISOString() }).eq("id", id);
  if (error) return { error: actionErrorMessage(error, "Kanal güncellenemedi.") };
  await logPlatformActivity({ actorId: g.staff.id, action: enabled ? "alert_channel.enable" : "alert_channel.disable", entityType: "alert_channel", entityId: id });
  refresh();
  return { ok: true };
}

export async function deleteAlertChannel(id: string): Promise<OpsResult> {
  const g = await opsGate({ superAdmin: true });
  if ("error" in g) return g;
  if (!UUID_RE.test(id ?? "")) return { error: "Kanal bulunamadı." };
  const admin = createAdminClient();
  const { error } = await admin.from("alert_channels").delete().eq("id", id);
  if (error) return { error: actionErrorMessage(error, "Kanal silinemedi.") };
  await logPlatformActivity({ actorId: g.staff.id, action: "alert_channel.delete", entityType: "alert_channel", entityId: id });
  refresh();
  return { ok: true };
}

/** Deneme mesajı: gerçek gönderim; sonuç kanal satırına (son deneme) ve yanıta yazılır. */
export async function testAlertChannel(id: string): Promise<OpsResult> {
  const g = await opsGate({ superAdmin: true, rate: { key: "ops-alert-test", limit: 10, windowSec: 600 } });
  if ("error" in g) return g;
  if (!UUID_RE.test(id ?? "")) return { error: "Kanal bulunamadı." };
  const admin = createAdminClient();
  const { data, error } = await admin.from("alert_channels").select("id, kind, name, config_sealed").eq("id", id).maybeSingle();
  if (error || !data) return { error: error && missingTable(error) ? SETUP_PENDING : "Kanal bulunamadı." };
  const row = data as { id: string; kind: string; name: string; config_sealed: string };
  const cfg = openChannelConfig(row.id, row.kind, row.config_sealed);
  const stamp = new Date(now()).toISOString();
  let result: { ok: boolean; detail: string };
  if (!cfg) {
    result = { ok: false, detail: "Yapılandırma çözülemedi (şifreleme anahtarı değişmiş olabilir); kanalı silip yeniden ekleyin." };
  } else {
    const msg = { title: "EmlakSoft uyarı kanalı denemesi", body: `“${row.name}” kanalı uyarı merkezine bağlı. Bu bir deneme mesajıdır.`, href: "/admin/sistem?sekme=uyarilar" };
    const { subject, text } = formatAlertText(msg, "test", getBaseUrl());
    result = await sendToChannel(cfg, { subject, text, payload: { event: "test", title: msg.title, body: msg.body, href: msg.href, at: stamp } });
  }
  await admin.from("alert_channels").update({ last_test_at: stamp, last_test_ok: result.ok, last_test_detail: result.detail.slice(0, 300) }).eq("id", id);
  await logPlatformActivity({ actorId: g.staff.id, action: "alert_channel.test", entityType: "alert_channel", entityId: id, meta: { ok: result.ok, detail: result.detail.slice(0, 200) } });
  refresh();
  return result.ok ? { ok: true, detail: result.detail } : { error: result.detail };
}

/* ───────────────────────── Uyarı kuralları ───────────────────────── */

export async function updateAlertRule(fd: FormData): Promise<OpsResult> {
  const g = await opsGate({ superAdmin: true, rate: { key: "ops-alert-rule", limit: 40, windowSec: 600 } });
  if ("error" in g) return g;
  const key = String(fd.get("key") ?? "");
  if (!isAlertRuleKey(key)) return { error: "Bilinmeyen kural." };
  const def = ALERT_RULES[key];
  const enabled = fd.get("enabled") === "on" || fd.get("enabled") === "1";
  const repeat = Number(String(fd.get("repeat") ?? "").trim());
  if (!Number.isInteger(repeat) || repeat < 5 || repeat > 10_080) return { error: "Tekrar aralığı 5-10080 dakika olmalı." };
  let threshold: number | null = null;
  if (def.threshold) {
    const raw = String(fd.get("threshold") ?? "").trim().replace(",", ".");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < def.threshold.min || n > def.threshold.max) {
      return { error: `${def.threshold.label} ${def.threshold.min}-${def.threshold.max} ${def.threshold.unit} aralığında olmalı.` };
    }
    threshold = n;
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("alert_rules")
    .upsert({ key, enabled, threshold, repeat_minutes: repeat, updated_by: g.staff.id, updated_at: new Date(now()).toISOString() }, { onConflict: "key" });
  if (error) return { error: missingTable(error) ? SETUP_PENDING : ruleSetupPending(error) ? RULE_SETUP_PENDING : actionErrorMessage(error, "Kural kaydedilemedi.") };
  await logPlatformActivity({ actorId: g.staff.id, action: "alert_rule.update", entityType: "alert_rule", meta: { key, enabled, threshold, repeat_minutes: repeat } });
  refresh();
  return { ok: true };
}

/** Sessize al: `minutes` = 0 sessizliği kaldırır; en çok 7 gün. */
export async function muteAlertRule(key: string, minutes: number): Promise<OpsResult> {
  const g = await opsGate({ superAdmin: true });
  if ("error" in g) return g;
  if (!isAlertRuleKey(key)) return { error: "Bilinmeyen kural." };
  const m = Math.trunc(Number(minutes));
  if (!Number.isFinite(m) || m < 0 || m > 10_080) return { error: "Sessize alma süresi geçersiz." };
  const until = m > 0 ? new Date(now() + m * 60_000).toISOString() : null;
  const admin = createAdminClient();
  const { error } = await admin
    .from("alert_rules")
    .upsert({ key, muted_until: until, updated_by: g.staff.id, updated_at: new Date(now()).toISOString() }, { onConflict: "key" });
  if (error) return { error: missingTable(error) ? SETUP_PENDING : ruleSetupPending(error) ? RULE_SETUP_PENDING : actionErrorMessage(error, "Kural güncellenemedi.") };
  await logPlatformActivity({ actorId: g.staff.id, action: m > 0 ? "alert_rule.mute" : "alert_rule.unmute", entityType: "alert_rule", meta: { key, muted_until: until } });
  refresh();
  return { ok: true };
}

/* ───────────────────────── Hata triyajı ───────────────────────── */

const TRIAGE_STATUSES = ["open", "ignored", "snoozed", "resolved"] as const;
type TriageStatus = (typeof TRIAGE_STATUSES)[number];

/** Durum + atanan + not. "Ertelendi" için saat (1-720) zorunlu; süre dolunca uyarı motoru kaydı yeniden açar. */
export async function triageErrorLog(fd: FormData): Promise<OpsResult> {
  const g = await opsGate({ rate: { key: "ops-error-triage", limit: 120, windowSec: 600 } });
  if ("error" in g) return g;
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id)) return { error: "Kayıt bulunamadı." };
  const status = String(fd.get("status") ?? "") as TriageStatus;
  if (!TRIAGE_STATUSES.includes(status)) return { error: "Geçersiz durum." };
  const assignee = String(fd.get("assignee") ?? "").trim();
  if (assignee && !UUID_RE.test(assignee)) return { error: "Geçersiz atanan kişi." };
  const note = String(fd.get("note") ?? "").trim().slice(0, 2000) || null;
  const patch: Record<string, unknown> = { status, assignee_id: assignee || null, note };
  if (status === "snoozed") {
    const hours = Number(fd.get("snoozeHours") ?? "");
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) return { error: "Erteleme süresi 1-720 saat olmalı." };
    patch.snoozed_until = new Date(now() + hours * 3_600_000).toISOString();
  }
  const admin = createAdminClient();
  if (assignee) {
    const { data: st } = await admin.from("platform_staff").select("id").eq("id", assignee).eq("is_active", true).maybeSingle();
    if (!st) return { error: "Atanan kişi aktif bir platform personeli değil." };
  }
  const { error } = await admin.from("error_logs").update(patch).eq("id", id);
  if (error) {
    if (missingTable(error)) return { error: SETUP_PENDING };
    // 23505: aynı hata için zaten açık bir satır var (çözülmüşü yeniden açarken).
    return { error: error.code === "23505" ? "Bu hata için zaten açık bir kayıt var; o kaydı düzenleyin." : actionErrorMessage(error, "Kaydedilemedi.") };
  }
  await logPlatformActivity({ actorId: g.staff.id, action: "error_log.triage", entityType: "error_log", entityId: id, meta: { status, assignee: assignee || null, has_note: Boolean(note) } });
  refresh();
  return { ok: true };
}
