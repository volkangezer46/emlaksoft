import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimelineEvent } from "@/lib/activity-timeline";
import { getPropertyTimeline, type TimelineKind } from "@/app/actions/property-timeline";
import { dealAuditEvents, fetchActorNames, fetchDealAudit, tl } from "@/lib/activity-timeline-sources";

/** Portföy zaman çizelgesi kategorileri (URL ?kategori=). */
export const PROPERTY_TIMELINE_CATEGORIES = [
  { key: "fiyat", label: "Fiyat" },
  { key: "durum", label: "Durum" },
  { key: "gosterim", label: "Gösterim" },
  { key: "randevu", label: "Randevu" },
  { key: "teklif", label: "Teklif" },
  { key: "anlasma", label: "Anlaşma" },
  { key: "portal", label: "Portal" },
  { key: "anahtar", label: "Anahtar" },
  { key: "medya", label: "Medya" },
] as const;

const KIND_CATEGORY: Record<TimelineKind, string> = {
  price: "fiyat",
  status: "durum",
  portal: "portal",
  appointment: "randevu",
  offer: "teklif",
  openhouse: "randevu",
  media: "medya",
};
const KIND_ICON: Record<TimelineKind, string> = {
  price: "money",
  status: "history",
  portal: "portal",
  appointment: "calendar",
  offer: "offer",
  openhouse: "property",
  media: "file",
};
const TONE = { ok: "success", warn: "warn", danger: "danger", neutral: "neutral" } as const;

const KEY_ACTION: Record<string, { title: string; tone: TimelineEvent["tone"] }> = {
  olusturma: { title: "Anahtar kaydı açıldı", tone: "neutral" },
  cikis: { title: "Anahtar çıkışı", tone: "info" },
  iade: { title: "Anahtar iade edildi", tone: "success" },
  kayip: { title: "Anahtar kayıp bildirildi", tone: "danger" },
  not: { title: "Anahtar notu", tone: "neutral" },
};

const PROPERTY_AUDIT: Record<string, string> = {
  "property.create": "Portföy kaydı oluşturuldu",
  "property.update": "Portföy bilgileri güncellendi",
  "property.reassign": "Portföy başka danışmana atandı",
  "property.restore": "Portföy geri alındı",
  "property.doc_ocr_apply": "Belgeden okunan bilgiler uygulandı",
};

/**
 * Portföy birleşik olay akışı. Fiyat/durum/portal/randevu/teklif/açık ev/medya
 * `getPropertyTimeline` (yetki kapılı) kaynağından gelir; gösterim, anahtar,
 * anlaşma ve kayıt (audit) olayları burada eklenir. Tek Promise.all.
 */
export async function buildPropertyEvents(
  supabase: SupabaseClient,
  propertyId: string,
  stageNames: Record<string, string>,
): Promise<TimelineEvent[]> {
  const [base, { data: views }, { data: keys }, { data: deals }, { data: audit }] = await Promise.all([
    getPropertyTimeline(propertyId),
    supabase.from("listing_views").select("id, day, count").eq("property_id", propertyId).gt("count", 0).order("day", { ascending: false }).limit(30),
    supabase.from("property_keys").select("id, label").eq("property_id", propertyId),
    supabase.from("deals").select("id, stage, deal_type, deal_value, updated_at").eq("property_id", propertyId).order("updated_at", { ascending: false }).limit(20),
    supabase.from("audit_logs").select("id, action, actor_id, ip, created_at").eq("entity_id", propertyId).order("created_at", { ascending: false }).limit(40),
  ]);

  const keyRows = (keys ?? []) as { id: string; label: string | null }[];
  const dealRows = (deals ?? []) as { id: string; stage: string; deal_type: string; deal_value: number | null; updated_at: string }[];
  const auditRows = (audit ?? []) as { id: string; action: string; actor_id: string | null; ip: string | null; created_at: string }[];

  const [{ data: keyEvents }, dealAudit] = await Promise.all([
    keyRows.length
      ? supabase
          .from("property_key_events")
          .select("id, key_id, action, holder_name, staff_id, note, created_at")
          .in("key_id", keyRows.map((k) => k.id))
          .order("created_at", { ascending: false })
          .limit(40)
      : Promise.resolve({ data: [] }),
    fetchDealAudit(supabase, dealRows.map((d) => d.id)),
  ]);

  const keyEventRows = (keyEvents ?? []) as { id: string; key_id: string; action: string; holder_name: string | null; staff_id: string | null; note: string | null; created_at: string }[];
  const names = await fetchActorNames(supabase, [
    ...auditRows.map((a) => a.actor_id),
    ...keyEventRows.map((k) => k.staff_id),
    ...dealAudit.map((a) => a.actor_id),
  ]);

  const ev: TimelineEvent[] = [];

  for (const e of base) {
    ev.push({
      id: `pt-${e.id}`,
      at: e.at,
      category: KIND_CATEGORY[e.kind],
      title: e.title,
      detail: e.detail || undefined,
      icon: KIND_ICON[e.kind],
      tone: TONE[e.tone ?? "neutral"],
      href: e.kind === "offer" ? "/app/teklifler" : e.kind === "appointment" ? `/app/randevular` : undefined,
    });
  }

  for (const v of (views ?? []) as { id: string; day: string; count: number }[]) {
    ev.push({
      id: `view-${v.id}`,
      at: `${v.day}T00:00:00+03:00`,
      category: "gosterim",
      title: `Vitrin gösterimi · ${v.count}`,
      detail: "Günlük toplam",
      icon: "view",
      tone: "info",
    });
  }

  const keyLabel = new Map(keyRows.map((k) => [k.id, k.label ?? "Anahtar"]));
  for (const k of keyEventRows) {
    const meta = KEY_ACTION[k.action] ?? { title: "Anahtar hareketi", tone: "neutral" as const };
    ev.push({
      id: `key-${k.id}`,
      at: k.created_at,
      category: "anahtar",
      title: meta.title,
      detail: [keyLabel.get(k.key_id), k.holder_name, k.note].filter(Boolean).join(" · ") || undefined,
      actor: k.staff_id ? names.get(k.staff_id) : undefined,
      icon: "key",
      tone: meta.tone,
    });
  }

  ev.push(...dealAuditEvents(dealAudit, names, stageNames, (id) => `/app/anlasmalar/${id}`));
  const audited = new Set(dealAudit.map((a) => a.entity_id));
  for (const d of dealRows) {
    if (audited.has(d.id)) continue;
    ev.push({
      id: `deal-${d.id}`,
      at: d.updated_at,
      category: "anlasma",
      title: `${d.deal_type === "rent" ? "Kiralama" : "Satış"} anlaşması · ${stageNames[d.stage] ?? d.stage}`,
      detail: d.deal_value != null ? tl(d.deal_value) : undefined,
      icon: "deal",
      tone: d.stage === "won" ? "success" : d.stage === "lost" ? "danger" : "info",
      href: `/app/anlasmalar/${d.id}`,
    });
  }

  for (const a of auditRows) {
    const label = PROPERTY_AUDIT[a.action];
    if (!label) continue;
    ev.push({
      id: `aud-${a.id}`,
      at: a.created_at,
      category: "durum",
      title: label,
      actor: a.actor_id ? names.get(a.actor_id) : undefined,
      ip: a.ip ?? undefined,
      icon: "history",
      tone: "neutral",
    });
  }

  return ev;
}
