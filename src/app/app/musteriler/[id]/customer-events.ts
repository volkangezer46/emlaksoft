import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimelineEvent } from "@/lib/activity-timeline";
import { COMM_CHANNELS } from "@/lib/comm-types";
import { formatTurkishPhone } from "@/lib/phone";
import {
  APPT_STATUS_LABEL,
  APPT_TYPE_LABEL,
  CONTRACT_STATUS_LABEL,
  OFFER_STATUS_LABEL,
  PAYMENT_LINK_STATUS_LABEL,
  apptTone,
  dealAuditEvents,
  fetchActorNames,
  fetchDealAudit,
  offerTone,
  tl,
} from "@/lib/activity-timeline-sources";

/** Müşteri zaman çizelgesi kategorileri (URL ?kategori=). */
export const CUSTOMER_TIMELINE_CATEGORIES = [
  { key: "gorusme", label: "Görüşme" },
  { key: "randevu", label: "Randevu" },
  { key: "teklif", label: "Teklif" },
  { key: "anlasma", label: "Anlaşma" },
  { key: "gorev", label: "Görev" },
  { key: "not", label: "Not" },
  { key: "portal", label: "Portal" },
  { key: "belge", label: "Belge" },
] as const;

const PER_SOURCE = 40;

const DIR_LABEL: Record<string, string> = { inbound: "Gelen", outbound: "Giden", missed: "Cevapsız", internal: "İç not" };
const CONSENT_LABEL: Record<string, string> = { granted: "izin verdi", denied: "reddetti", unknown: "belirsiz", pending: "beklemede" };
const CHANNEL_LABEL: Record<string, string> = { sms: "SMS", email: "E-posta", whatsapp: "WhatsApp", call: "Arama" };
const CUSTOMER_AUDIT_LABEL: Record<string, string> = {
  "customer.create": "Müşteri kaydı oluşturuldu",
  "customer.update": "Müşteri bilgileri güncellendi",
  "customer.reassign": "Müşteri başka danışmana atandı",
  "customer.bulk_assign": "Müşteri toplu atamayla devredildi",
  "customer.bulk_reheat": "Müşteri yeniden ısıtma listesine alındı",
  "customer.bulk_tag": "Müşteriye toplu etiket eklendi",
  "customer.tag_add": "Etiket eklendi",
  "customer.tag_remove": "Etiket kaldırıldı",
  "customer.note_append": "Müşteri notuna ekleme yapıldı",
  "customer.restore": "Müşteri kaydı geri alındı",
  "customer.import": "Müşteri içe aktarımla eklendi",
  "customer_file.upload": "Dosya yüklendi",
  "customer_file.delete": "Dosya silindi",
};

type Call = { id: string; direction: string; phone: string; duration_sec: number | null; disposition: string | null; notes: string | null; started_at: string };
type Appt = { id: string; appointment_type: string; scheduled_at: string; location: string | null; status: string };
type Comm = {
  id: string; channel: string; direction: string; subject: string | null; body: string | null; outcome: string | null; created_at: string;
  created_by: { full_name?: string } | { full_name?: string }[] | null;
};
type Offer = { id: string; amount: number | null; status: string; created_at: string };
type Task = { id: string; title: string; status: string; due_at: string | null; completed_at?: string | null; created_at?: string | null };
type Deal = { id: string; stage: string; deal_type: string; deal_value: number | null; updated_at: string };

function cut(s: string | null | undefined, n = 160): string | undefined {
  if (!s) return undefined;
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t || undefined;
}

function firstName(v: { full_name?: string } | { full_name?: string }[] | null): string | undefined {
  const o = Array.isArray(v) ? v[0] : v;
  return o?.full_name || undefined;
}

/**
 * Müşteri birleşik olay akışı. Sayfanın zaten çektiği kaynaklar (çağrı, randevu,
 * iletişim, teklif, görev, anlaşma) `pre` ile gelir; yalnız eksik kaynaklar
 * burada tek Promise.all ile çekilir (her kaynaktan son N).
 */
export async function buildCustomerEvents(
  supabase: SupabaseClient,
  customerId: string,
  customerCreatedAt: string,
  pre: {
    calls: Call[];
    appts: Appt[];
    comms: Comm[];
    offers: Offer[];
    tasks: Task[];
    deals: Deal[];
    stageNames: Record<string, string>;
  },
): Promise<TimelineEvent[]> {
  const dealIds = pre.deals.map((d) => d.id);
  const [
    { data: contracts },
    { data: payLinks },
    { data: tokens },
    { data: feedback },
    { data: shares },
    { data: iys },
    { data: audit },
    { data: visits },
    dealAudit,
  ] = await Promise.all([
    supabase.from("contracts").select("id, title, status, signed_at, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(PER_SOURCE),
    supabase.from("payment_links").select("id, title, amount_try, status, paid_at, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(PER_SOURCE),
    supabase.from("customer_portal_tokens").select("id, created_at, last_seen_at, created_by").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(10),
    supabase.from("portal_match_feedback").select("id, property_id, verdict, updated_at").eq("customer_id", customerId).order("updated_at", { ascending: false }).limit(PER_SOURCE),
    supabase.from("share_links").select("id, label, view_count, created_at, created_by").eq("entity_type", "customer").eq("entity_id", customerId).order("created_at", { ascending: false }).limit(10),
    supabase.from("iys_consent_events").select("id, channel, to_status, source, actor_id, occurred_at").eq("customer_id", customerId).order("occurred_at", { ascending: false }).limit(PER_SOURCE),
    supabase.from("audit_logs").select("id, action, actor_id, ip, created_at").eq("entity_id", customerId).order("created_at", { ascending: false }).limit(PER_SOURCE),
    supabase.from("open_house_visitors").select("id, registered_at").eq("created_customer_id", customerId).order("registered_at", { ascending: false }).limit(10),
    fetchDealAudit(supabase, dealIds),
  ]);

  const contractRows = (contracts ?? []) as { id: string; title: string; status: string; signed_at: string | null; created_at: string }[];
  const feedbackRows = (feedback ?? []) as { id: string; property_id: string; verdict: string; updated_at: string }[];
  const propIds = [...new Set(feedbackRows.map((f) => f.property_id))];

  const [{ data: signers }, { data: props }, names] = await Promise.all([
    contractRows.length
      ? supabase
          .from("contract_signers")
          .select("id, contract_id, full_name, status, ip_address, signed_at")
          .in("contract_id", contractRows.map((c) => c.id))
          .not("signed_at", "is", null)
      : Promise.resolve({ data: [] }),
    propIds.length
      ? supabase.from("properties").select("id, title, property_code").in("id", propIds)
      : Promise.resolve({ data: [] }),
    fetchActorNames(supabase, [
      ...((audit ?? []) as { actor_id: string | null }[]).map((a) => a.actor_id),
      ...((iys ?? []) as { actor_id: string | null }[]).map((a) => a.actor_id),
      ...((tokens ?? []) as { created_by: string | null }[]).map((a) => a.created_by),
      ...((shares ?? []) as { created_by: string | null }[]).map((a) => a.created_by),
      ...dealAudit.map((a) => a.actor_id),
    ]),
  ]);

  const propName = new Map(
    ((props ?? []) as { id: string; title: string | null; property_code: string | null }[]).map((p) => [p.id, p.title ?? p.property_code ?? "Portföy"]),
  );
  const contractTitle = new Map(contractRows.map((c) => [c.id, c.title]));

  const ev: TimelineEvent[] = [];

  for (const c of pre.calls) {
    const mins = c.duration_sec ? `${Math.floor(c.duration_sec / 60)}:${String(c.duration_sec % 60).padStart(2, "0")} sn` : null;
    ev.push({
      id: `call-${c.id}`,
      at: c.started_at,
      category: "gorusme",
      title: `${DIR_LABEL[c.direction] ?? ""} çağrı${c.disposition ? ` · ${c.disposition}` : ""}`.trim(),
      detail: cut(c.notes) ?? [formatTurkishPhone(c.phone), mins].filter(Boolean).join(" · "),
      icon: "phone",
      tone: c.direction === "missed" ? "danger" : "info",
    });
  }

  for (const c of pre.comms) {
    const isNote = c.channel === "note" || c.direction === "internal";
    const label = COMM_CHANNELS.find((ch) => ch.value === c.channel)?.label ?? c.channel;
    const dir = c.direction === "inbound" ? " · Gelen" : c.direction === "outbound" ? " · Giden" : "";
    ev.push({
      id: `comm-${c.id}`,
      at: c.created_at,
      category: isNote ? "not" : "gorusme",
      title: isNote ? "Not eklendi" : `${label}${dir}`,
      detail: cut(c.subject || c.body),
      actor: firstName(c.created_by),
      icon: isNote ? "note" : c.channel === "email" ? "mail" : c.channel === "call" ? "phone" : "message",
      tone: "neutral",
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
      href: `/app/randevular?customer=${customerId}`,
    });
  }

  for (const v of (visits ?? []) as { id: string; registered_at: string }[]) {
    ev.push({ id: `visit-${v.id}`, at: v.registered_at, category: "randevu", title: "Açık ev ziyaretçisi olarak kaydoldu", icon: "property", tone: "info" });
  }

  for (const t of pre.tasks) {
    const done = t.status === "done";
    const at = (done ? t.completed_at ?? t.due_at ?? t.created_at : t.created_at ?? t.due_at) ?? null;
    if (!at) continue;
    ev.push({
      id: `task-${t.id}`,
      at,
      category: "gorev",
      title: `${done ? "Görev tamamlandı" : t.status === "cancelled" ? "Görev iptal edildi" : "Görev açıldı"} · ${t.title}`,
      icon: "task",
      tone: done ? "success" : t.status === "cancelled" ? "neutral" : "warn",
      href: "/app/gorevler",
    });
  }

  for (const o of pre.offers) {
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

  ev.push(
    ...dealAuditEvents(dealAudit, names, pre.stageNames, (id) => `/app/anlasmalar/${id}`),
  );
  // Aşama kaydı hiç yoksa (eski anlaşmalar) en azından son güncellemeyi göster
  const auditedDeals = new Set(dealAudit.map((a) => a.entity_id));
  for (const d of pre.deals) {
    if (auditedDeals.has(d.id)) continue;
    ev.push({
      id: `deal-${d.id}`,
      at: d.updated_at,
      category: "anlasma",
      title: `${d.deal_type === "rent" ? "Kiralama" : "Satış"} anlaşması · ${pre.stageNames[d.stage] ?? d.stage}`,
      detail: d.deal_value != null ? tl(d.deal_value) : undefined,
      icon: "deal",
      tone: d.stage === "won" ? "success" : d.stage === "lost" ? "danger" : "info",
      href: `/app/anlasmalar/${d.id}`,
    });
  }

  for (const c of contractRows) {
    ev.push({
      id: `contract-${c.id}`,
      at: c.created_at,
      category: "belge",
      title: `Sözleşme · ${CONTRACT_STATUS_LABEL[c.status] ?? c.status}`,
      detail: c.title,
      icon: "file",
      tone: c.status === "signed" ? "success" : c.status === "rejected" || c.status === "cancelled" ? "danger" : "neutral",
      href: `/app/sozlesmeler/${c.id}`,
    });
  }
  for (const s of (signers ?? []) as { id: string; contract_id: string; full_name: string; ip_address: string | null; signed_at: string }[]) {
    ev.push({
      id: `sign-${s.id}`,
      at: s.signed_at,
      category: "belge",
      title: "Sözleşme imzalandı",
      detail: contractTitle.get(s.contract_id),
      actor: s.full_name,
      ip: s.ip_address ?? undefined,
      icon: "sign",
      tone: "success",
      href: `/app/sozlesmeler/${s.contract_id}`,
    });
  }
  for (const p of (payLinks ?? []) as { id: string; title: string; amount_try: number; status: string; paid_at: string | null; created_at: string }[]) {
    ev.push({
      id: `pay-${p.id}`,
      at: p.created_at,
      category: "belge",
      title: `Ödeme linki oluşturuldu · ${tl(p.amount_try)}`,
      detail: `${p.title} · ${PAYMENT_LINK_STATUS_LABEL[p.status] ?? p.status}`,
      icon: "money",
      tone: "info",
    });
    if (p.paid_at) {
      ev.push({ id: `paid-${p.id}`, at: p.paid_at, category: "belge", title: `Ödeme alındı · ${tl(p.amount_try)}`, detail: p.title, icon: "money", tone: "success" });
    }
  }
  for (const e of (iys ?? []) as { id: string; channel: string; to_status: string; source: string; actor_id: string | null; occurred_at: string }[]) {
    ev.push({
      id: `iys-${e.id}`,
      at: e.occurred_at,
      category: "belge",
      title: `${CHANNEL_LABEL[e.channel] ?? e.channel} ticari ileti izni: ${CONSENT_LABEL[e.to_status] ?? e.to_status}`,
      detail: `Kaynak: ${e.source}`,
      actor: e.actor_id ? names.get(e.actor_id) : undefined,
      icon: "shield",
      tone: e.to_status === "granted" ? "success" : e.to_status === "denied" ? "danger" : "neutral",
    });
  }

  for (const t of (tokens ?? []) as { id: string; created_at: string; last_seen_at: string | null; created_by: string | null }[]) {
    ev.push({
      id: `ptok-${t.id}`, at: t.created_at, category: "portal", title: "Müşteri portalı bağlantısı oluşturuldu",
      actor: t.created_by ? names.get(t.created_by) : undefined, icon: "portal", tone: "info",
    });
    if (t.last_seen_at) {
      ev.push({ id: `pseen-${t.id}`, at: t.last_seen_at, category: "portal", title: "Müşteri portalını açtı", icon: "view", tone: "success" });
    }
  }
  for (const f of feedbackRows) {
    ev.push({
      id: `fb-${f.id}`,
      at: f.updated_at,
      category: "portal",
      title: f.verdict === "liked" ? "Portalda bir portföyü beğendi" : "Portalda bir portföyü beğenmedi",
      detail: propName.get(f.property_id),
      icon: "portal",
      tone: f.verdict === "liked" ? "success" : "warn",
      href: `/app/portfoyler/${f.property_id}`,
    });
  }
  for (const s of (shares ?? []) as { id: string; label: string | null; view_count: number; created_at: string; created_by: string | null }[]) {
    ev.push({
      id: `share-${s.id}`,
      at: s.created_at,
      category: "portal",
      title: "Paylaşım bağlantısı oluşturuldu",
      detail: [s.label, s.view_count > 0 ? `${s.view_count} görüntüleme` : null].filter(Boolean).join(" · ") || undefined,
      actor: s.created_by ? names.get(s.created_by) : undefined,
      icon: "portal",
      tone: "info",
    });
  }

  for (const a of (audit ?? []) as { id: string; action: string; actor_id: string | null; ip: string | null; created_at: string }[]) {
    const label = CUSTOMER_AUDIT_LABEL[a.action];
    if (!label) continue;
    ev.push({
      id: `aud-${a.id}`,
      at: a.created_at,
      category: a.action.startsWith("customer_file") ? "belge" : "not",
      title: label,
      actor: a.actor_id ? names.get(a.actor_id) : undefined,
      ip: a.ip ?? undefined,
      icon: a.action.startsWith("customer_file") ? "file" : "history",
      tone: "neutral",
    });
  }

  ev.push({ id: "created", at: customerCreatedAt, category: "not", title: "Müşteri kaydı açıldı", icon: "user", tone: "neutral" });

  return ev;
}
