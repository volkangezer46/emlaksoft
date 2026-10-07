import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimelineEvent } from "@/lib/activity-timeline";
import { COMM_CHANNELS } from "@/lib/comm-types";
import {
  APPT_STATUS_LABEL,
  APPT_TYPE_LABEL,
  OFFER_STATUS_LABEL,
  apptTone,
  fetchActorNames,
  offerTone,
  tl,
} from "@/lib/activity-timeline-sources";

/** Talep zaman çizelgesi kategorileri (URL ?kategori=). */
export const DEMAND_TIMELINE_CATEGORIES = [
  { key: "talep", label: "Talep" },
  { key: "gorev", label: "Görev" },
  { key: "randevu", label: "Randevu" },
  { key: "gorusme", label: "Görüşme" },
  { key: "teklif", label: "Teklif" },
] as const;

const PER_SOURCE = 40;

const DEMAND_AUDIT_LABEL: Record<string, string> = {
  "demand.create": "Talep oluşturuldu",
  "demand.update": "Talep güncellendi",
  "demand.bulk_status": "Talep durumu toplu değiştirildi",
  "demand.import": "Talep içe aktarımla eklendi",
};

export type DemandTaskRow = {
  id: string;
  title: string;
  kind: string;
  priority: string;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type DemandApptRow = {
  id: string;
  appointment_type: string;
  scheduled_at: string;
  location: string | null;
  status: string;
};

function cut(s: string | null | undefined, n = 160): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t || undefined;
}

/**
 * Talep birleşik olay akışı: talebin kendi denetim kaydı + bağlı müşterinin görev,
 * randevu, görüşme ve teklif olayları. Görev ve randevu satırları sayfanın zaten
 * çektiği listelerden gelir (`pre`), yalnız eksik kaynaklar burada çekilir.
 * Talep ↔ görev arasında doğrudan sütun yoktur; bağ müşteri üzerindendir (dürüst etiket).
 */
export async function buildDemandEvents(
  supabase: SupabaseClient,
  demand: { id: string; created_at: string; customerId: string | null },
  pre: { tasks: DemandTaskRow[]; appts: DemandApptRow[] },
): Promise<TimelineEvent[]> {
  const customerId = demand.customerId;
  const [{ data: audit }, { data: comms }, { data: offers }] = await Promise.all([
    supabase
      .from("audit_logs")
      .select("id, action, actor_id, created_at")
      .eq("entity_id", demand.id)
      .order("created_at", { ascending: false })
      .limit(PER_SOURCE),
    customerId
      ? supabase
          .from("communications")
          .select("id, channel, direction, subject, body, created_at")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE)
      : Promise.resolve({ data: [] }),
    customerId
      ? supabase
          .from("offers")
          .select("id, amount, status, created_at")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(PER_SOURCE)
      : Promise.resolve({ data: [] }),
  ]);

  const auditRows = (audit ?? []) as { id: string; action: string; actor_id: string | null; created_at: string }[];
  const names = await fetchActorNames(supabase, auditRows.map((a) => a.actor_id));
  const ev: TimelineEvent[] = [];

  let sawCreate = false;
  for (const a of auditRows) {
    const label = DEMAND_AUDIT_LABEL[a.action];
    if (!label) continue;
    if (a.action === "demand.create" || a.action === "demand.import") sawCreate = true;
    ev.push({
      id: `aud-${a.id}`,
      at: a.created_at,
      category: "talep",
      title: label,
      actor: a.actor_id ? names.get(a.actor_id) : undefined,
      icon: "history",
      tone: "neutral",
    });
  }
  if (!sawCreate) {
    ev.push({ id: "created", at: demand.created_at, category: "talep", title: "Talep açıldı", icon: "history", tone: "neutral" });
  }

  for (const t of pre.tasks) {
    const done = t.status === "done";
    const at = done ? t.completed_at ?? t.due_at ?? t.created_at : t.created_at;
    if (!at) continue;
    ev.push({
      id: `task-${t.id}`,
      at,
      category: "gorev",
      title: `${done ? "Görev tamamlandı" : t.status === "cancelled" ? "Görev iptal edildi" : "Görev açıldı"} · ${t.title}`,
      icon: "task",
      tone: done ? "success" : t.status === "cancelled" ? "neutral" : "warn",
      href: customerId ? `/app/musteriler/${customerId}?sekme=gorevler` : "/app/gorevler",
    });
  }

  for (const a of pre.appts) {
    ev.push({
      id: `appt-${a.id}`,
      at: a.scheduled_at,
      category: "randevu",
      title: `${APPT_TYPE_LABEL[a.appointment_type] ?? "Randevu"} · ${APPT_STATUS_LABEL[a.status] ?? a.status}`,
      detail: a.location ?? undefined,
      icon: "calendar",
      tone: apptTone(a.status),
      href: customerId ? `/app/randevular?customer=${customerId}` : "/app/randevular",
    });
  }

  for (const c of (comms ?? []) as { id: string; channel: string; direction: string; subject: string | null; body: string | null; created_at: string }[]) {
    const isNote = c.channel === "note" || c.direction === "internal";
    const label = COMM_CHANNELS.find((ch) => ch.value === c.channel)?.label ?? c.channel;
    const dir = c.direction === "inbound" ? " · Gelen" : c.direction === "outbound" ? " · Giden" : "";
    ev.push({
      id: `comm-${c.id}`,
      at: c.created_at,
      category: "gorusme",
      title: isNote ? "Not eklendi" : `${label}${dir}`,
      detail: cut(c.subject || c.body),
      icon: isNote ? "note" : c.channel === "email" ? "mail" : c.channel === "call" ? "phone" : "message",
      tone: "neutral",
      href: customerId ? `/app/musteriler/${customerId}?sekme=zaman&kategori=gorusme` : undefined,
    });
  }

  for (const o of (offers ?? []) as { id: string; amount: number | null; status: string; created_at: string }[]) {
    ev.push({
      id: `offer-${o.id}`,
      at: o.created_at,
      category: "teklif",
      title: `Teklif · ${tl(o.amount)} · ${OFFER_STATUS_LABEL[o.status] ?? o.status}`,
      icon: "offer",
      tone: offerTone(o.status),
      href: `/app/teklifler/${o.id}`,
    });
  }

  return ev;
}
