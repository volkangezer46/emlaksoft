"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { logPlatformActivity } from "@/lib/platform-activity";
import { checkRateLimit } from "@/lib/rate-limit";
import { actionErrorMessage } from "@/lib/action-errors";
import { now } from "@/lib/clock";
import { isClosedStatus, isImpact, isIncidentKind, isStatusFor, parseIstanbulLocal } from "@/lib/status-page/model";
import { bustStatusPage } from "@/lib/status-page/cache";

/**
 * Durum sayfası olay/bakım eylemleri (Sistem > Durum sayfası). Kapı: `requirePlatformModule("sistem")` (süper admin ve
 * operasyon); kaydı tamamen silmek yalnız süper admin. Yazılan metin KAMUYA AÇIKTIR (/durum); iç ayrıntı yazılmaz.
 * Her değişiklik /durum'u anında tazeler (ISR etiketi yerine yol yeniden doğrulaması) ve denetim kaydına düşer.
 */

export type StatusResult = { ok?: boolean; error?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETUP_PENDING = "Durum sayfası tabloları henüz kurulmadı (migration 20261014005000 bekliyor).";
const missingTable = (e: { code?: string } | null) => Boolean(e && (e.code === "42P01" || e.code === "PGRST205"));

async function gate(opts: { superAdmin?: boolean } = {}): Promise<{ staffId: string } | { error: string }> {
  const staff = await requirePlatformModule("sistem");
  if (opts.superAdmin && staff.role !== "super_admin") return { error: "Bu işlem yalnız süper admin içindir." };
  const { allowed } = await checkRateLimit(`status-page:${staff.id}`, { limit: 40, windowSec: 600, failurePolicy: "deny" });
  if (!allowed) return { error: "Çok sık işlem yapıldı. Lütfen biraz sonra tekrar deneyin." };
  return { staffId: staff.id };
}

function refresh() {
  // /durum dinamik; veri önbelleği (30 sn) etiketle anında düşer (B017).
  bustStatusPage();
  revalidatePath("/durum");
  revalidatePath("/admin/sistem");
}

const text = (fd: FormData, key: string, max: number) => String(fd.get(key) ?? "").trim().slice(0, max);

export async function createStatusIncident(fd: FormData): Promise<StatusResult> {
  const g = await gate();
  if ("error" in g) return g;
  const kind = String(fd.get("kind") ?? "");
  if (!isIncidentKind(kind)) return { error: "Tür seçin: olay ya da planlı bakım." };
  const title = text(fd, "title", 140);
  if (title.length < 3) return { error: "Başlık en az 3 karakter olmalı (kamuya açık görünür)." };
  const message = text(fd, "message", 2000);
  if (!message) return { error: "İlk bilgilendirme metnini yazın (kamuya açık görünür)." };
  const impact = String(fd.get("impact") ?? "minor");
  if (!isImpact(impact)) return { error: "Etki düzeyi seçin." };

  const stamp = new Date(now()).toISOString();
  let status: string;
  let scheduledStart: string | null = null;
  let scheduledEnd: string | null = null;
  if (kind === "maintenance") {
    scheduledStart = parseIstanbulLocal(String(fd.get("scheduledStart") ?? ""));
    scheduledEnd = parseIstanbulLocal(String(fd.get("scheduledEnd") ?? ""));
    if (!scheduledStart || !scheduledEnd) return { error: "Bakımın başlangıç ve bitiş zamanını girin (İstanbul saati)." };
    if (scheduledEnd <= scheduledStart) return { error: "Bakım bitişi başlangıçtan sonra olmalı." };
    status = "scheduled";
  } else {
    status = String(fd.get("status") ?? "investigating");
    if (!isStatusFor("incident", status) || isClosedStatus(status)) return { error: "Başlangıç durumu seçin (İnceleniyor, Neden bulundu ya da İzleniyor)." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("status_incidents")
    .insert({
      kind,
      title,
      impact: kind === "maintenance" ? "minor" : impact,
      status,
      started_at: kind === "maintenance" ? scheduledStart : stamp,
      scheduled_start: scheduledStart,
      scheduled_end: scheduledEnd,
      created_by: g.staffId,
      updated_at: stamp,
    })
    .select("id")
    .single();
  if (error || !data) return { error: missingTable(error) ? SETUP_PENDING : actionErrorMessage(error, "Kayıt oluşturulamadı.") };
  const { error: upErr } = await admin.from("status_incident_updates").insert({ incident_id: data.id, status, message, created_by: g.staffId });
  if (upErr) return { error: actionErrorMessage(upErr, "Kayıt açıldı ama ilk bilgilendirme yazılamadı; güncelleme olarak tekrar ekleyin.") };
  await logPlatformActivity({ actorId: g.staffId, action: "status_incident.create", entityType: "status_incident", entityId: data.id, meta: { kind, title, impact, status } });
  refresh();
  return { ok: true };
}

/** Güncelleme: yeni durum + kamuya açık metin; olayda etki de değişebilir. Kapanış durumu resolved_at yazar, geri açma siler. */
export async function addStatusUpdate(fd: FormData): Promise<StatusResult> {
  const g = await gate();
  if ("error" in g) return g;
  const id = String(fd.get("incidentId") ?? "");
  if (!UUID_RE.test(id)) return { error: "Kayıt bulunamadı." };
  const message = text(fd, "message", 2000);
  if (!message) return { error: "Güncelleme metnini yazın (kamuya açık görünür)." };
  const admin = createAdminClient();
  const { data: cur, error: curErr } = await admin.from("status_incidents").select("id, kind, status, impact, resolved_at").eq("id", id).maybeSingle();
  if (curErr) return { error: missingTable(curErr) ? SETUP_PENDING : actionErrorMessage(curErr, "Kayıt okunamadı.") };
  if (!cur || !isIncidentKind(cur.kind)) return { error: "Kayıt bulunamadı (silinmiş olabilir). Sayfayı yenileyin." };
  const status = String(fd.get("status") ?? cur.status);
  if (!isStatusFor(cur.kind, status)) return { error: "Bu kayıt türü için geçerli bir durum seçin." };
  const impactRaw = String(fd.get("impact") ?? cur.impact);
  const impact = cur.kind === "incident" && isImpact(impactRaw) ? impactRaw : cur.impact;
  const stamp = new Date(now()).toISOString();
  const closed = isClosedStatus(status);
  const { error } = await admin
    .from("status_incidents")
    .update({ status, impact, resolved_at: closed ? (cur.resolved_at ?? stamp) : null, updated_at: stamp })
    .eq("id", id);
  if (error) return { error: actionErrorMessage(error, "Durum güncellenemedi.") };
  const { error: upErr } = await admin.from("status_incident_updates").insert({ incident_id: id, status, message, created_by: g.staffId });
  if (upErr) return { error: actionErrorMessage(upErr, "Durum değişti ama bilgilendirme metni yazılamadı; tekrar ekleyin.") };
  await logPlatformActivity({ actorId: g.staffId, action: "status_incident.update", entityType: "status_incident", entityId: id, meta: { from: cur.status, to: status, impact } });
  refresh();
  return { ok: true };
}

/** Kaydı tamamen kaldırır (yanlış açılmış olay). Kamu geçmişinden de silinir; yalnız süper admin. */
export async function deleteStatusIncident(id: string): Promise<StatusResult> {
  const g = await gate({ superAdmin: true });
  if ("error" in g) return g;
  if (!UUID_RE.test(id ?? "")) return { error: "Kayıt bulunamadı." };
  const admin = createAdminClient();
  const { data, error } = await admin.from("status_incidents").delete().eq("id", id).select("title, kind").maybeSingle();
  if (error) return { error: missingTable(error) ? SETUP_PENDING : actionErrorMessage(error, "Kayıt silinemedi.") };
  if (!data) return { error: "Kayıt bulunamadı (başka biri silmiş olabilir). Sayfayı yenileyin." };
  await logPlatformActivity({ actorId: g.staffId, action: "status_incident.delete", entityType: "status_incident", entityId: id, meta: { title: data.title, kind: data.kind } });
  refresh();
  return { ok: true };
}
