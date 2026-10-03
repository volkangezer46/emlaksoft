import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimelineEvent } from "@/lib/activity-timeline";
import {
  CONTRACT_STATUS_LABEL,
  OFFER_STATUS_LABEL,
  PAYMENT_LINK_STATUS_LABEL,
  dealAuditEvents,
  fetchActorNames,
  fetchDealAudit,
  offerTone,
  tl,
} from "@/lib/activity-timeline-sources";

/** Anlaşma zaman çizelgesi kategorileri (URL ?kategori=). */
export const DEAL_TIMELINE_CATEGORIES = [
  { key: "anlasma", label: "Aşama" },
  { key: "not", label: "Not" },
  { key: "teklif", label: "Teklif" },
  { key: "belge", label: "Belge" },
  { key: "gorev", label: "Görev" },
  { key: "finans", label: "Komisyon ve ödeme" },
] as const;

const COST_KIND: Record<string, string> = {
  kapora: "Kapora",
  tapu_harci: "Tapu harcı",
  ekspertiz: "Ekspertiz",
  komisyon_dis: "Dış komisyon",
  diger: "Diğer masraf",
};

/**
 * Anlaşma birleşik olay akışı. Teklif ve sözleşmede `deal_id` yoktur; sayfadaki
 * "aynı portföy + müşteri" eşleştirmesi aynen kullanılır.
 *
 * Gizlilik (earnings_all): `showCommission` yalnız sayfanın `canSeeCommission`
 * değeridir (başkasının anlaşmasında earnings_all yoksa false) — false iken
 * komisyon olayları hiç üretilmez; `showActors` false iken kişi adı da yazılmaz.
 */
export async function buildDealEvents(
  supabase: SupabaseClient,
  deal: { id: string; created_at: string; property_id: string | null; customer_id: string | null },
  opts: { stageNames: Record<string, string>; showCommission: boolean; showActors: boolean },
): Promise<TimelineEvent[]> {
  const pair = Boolean(deal.property_id && deal.customer_id);
  const [
    dealAudit,
    { data: notes },
    { data: tasks },
    { data: costs },
    { data: commissions },
    { data: offers },
    { data: contracts },
  ] = await Promise.all([
    fetchDealAudit(supabase, [deal.id]),
    supabase.from("deal_notes").select("id, author_id, body, created_at").eq("deal_id", deal.id).order("created_at", { ascending: false }).limit(40),
    supabase.from("tasks").select("id, title, status, completed_at, created_at").eq("deal_id", deal.id).order("created_at", { ascending: false }).limit(40),
    supabase.from("deal_costs").select("id, kind, label, amount, paid, paid_at, created_at").eq("deal_id", deal.id).order("created_at", { ascending: false }).limit(40),
    opts.showCommission
      ? supabase.from("commissions").select("id, gross_amount, status, created_at").eq("deal_id", deal.id).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
    pair
      ? supabase.from("offers").select("id, amount, status, created_at").eq("property_id", deal.property_id!).eq("customer_id", deal.customer_id!).order("created_at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [] }),
    pair
      ? supabase.from("contracts").select("id, title, status, signed_at, created_at").eq("property_id", deal.property_id!).eq("customer_id", deal.customer_id!).order("created_at", { ascending: false }).limit(40)
      : Promise.resolve({ data: [] }),
  ]);

  const noteRows = (notes ?? []) as { id: string; author_id: string | null; body: string; created_at: string }[];
  const contractRows = (contracts ?? []) as { id: string; title: string; status: string; signed_at: string | null; created_at: string }[];
  const commissionRows = (commissions ?? []) as { id: string; gross_amount: number; status: string; created_at: string }[];

  const [{ data: signers }, { data: payLinks }, names] = await Promise.all([
    contractRows.length
      ? supabase.from("contract_signers").select("id, contract_id, full_name, ip_address, signed_at").in("contract_id", contractRows.map((c) => c.id)).not("signed_at", "is", null)
      : Promise.resolve({ data: [] }),
    commissionRows.length
      ? supabase.from("payment_links").select("id, title, amount_try, status, paid_at, created_at").in("commission_id", commissionRows.map((c) => c.id)).limit(20)
      : Promise.resolve({ data: [] }),
    opts.showActors
      ? fetchActorNames(supabase, [...noteRows.map((n) => n.author_id), ...dealAudit.map((a) => a.actor_id)])
      : Promise.resolve(new Map<string, string>()),
  ]);

  const ev: TimelineEvent[] = [];

  const audited = dealAudit.map((r) => r.action);
  ev.push(...dealAuditEvents(dealAudit, names, opts.stageNames).map((e) => (opts.showActors ? e : { ...e, ip: undefined })));
  if (!audited.includes("deal.create")) {
    ev.push({ id: "deal-created", at: deal.created_at, category: "anlasma", title: "Anlaşma açıldı", icon: "deal", tone: "info" });
  }

  for (const n of noteRows) {
    ev.push({
      id: `note-${n.id}`,
      at: n.created_at,
      category: "not",
      title: "Not eklendi",
      detail: n.body.replace(/\s+/g, " ").trim().slice(0, 160),
      actor: n.author_id ? names.get(n.author_id) : undefined,
      icon: "note",
      tone: "neutral",
    });
  }

  for (const o of (offers ?? []) as { id: string; amount: number | null; status: string; created_at: string }[]) {
    ev.push({
      id: `offer-${o.id}`,
      at: o.created_at,
      category: "teklif",
      title: `Teklif · ${tl(o.amount)} · ${OFFER_STATUS_LABEL[o.status] ?? o.status}`,
      detail: "Aynı portföy + müşteri",
      icon: "offer",
      tone: offerTone(o.status),
      href: `/app/teklifler/${o.id}`,
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
      detail: contractRows.find((c) => c.id === s.contract_id)?.title,
      actor: s.full_name,
      ip: s.ip_address ?? undefined,
      icon: "sign",
      tone: "success",
      href: `/app/sozlesmeler/${s.contract_id}`,
    });
  }

  for (const t of (tasks ?? []) as { id: string; title: string; status: string; completed_at: string | null; created_at: string }[]) {
    const done = t.status === "done";
    ev.push({
      id: `task-${t.id}`,
      at: done ? t.completed_at ?? t.created_at : t.created_at,
      category: "gorev",
      title: `${done ? "Görev tamamlandı" : t.status === "cancelled" ? "Görev iptal edildi" : "Görev açıldı"} · ${t.title}`,
      icon: "task",
      tone: done ? "success" : "neutral",
      href: "/app/gorevler",
    });
  }

  for (const c of (costs ?? []) as { id: string; kind: string; label: string | null; amount: number; paid: boolean; paid_at: string | null; created_at: string }[]) {
    // Kapora zaten audit'ten "Kapora alındı" olarak geliyor; mükerrer olmasın.
    if (c.kind !== "kapora") {
      ev.push({
        id: `cost-${c.id}`,
        at: c.created_at,
        category: "finans",
        title: `${COST_KIND[c.kind] ?? "Masraf"} kalemi · ${tl(c.amount)}`,
        detail: c.label ?? undefined,
        icon: "money",
        tone: "neutral",
      });
    }
    if (c.paid && c.paid_at) {
      ev.push({ id: `costpaid-${c.id}`, at: c.paid_at, category: "finans", title: `${COST_KIND[c.kind] ?? "Masraf"} ödendi · ${tl(c.amount)}`, detail: c.label ?? undefined, icon: "money", tone: "success" });
    }
  }

  for (const c of commissionRows) {
    ev.push({
      id: `comm-${c.id}`,
      at: c.created_at,
      category: "finans",
      title: `Komisyon kaydı oluşturuldu · ${tl(c.gross_amount)} (brüt)`,
      detail: c.status === "paid" || c.status === "Tahsil edildi" ? "Tahsil edildi" : undefined,
      icon: "money",
      tone: c.status === "paid" || c.status === "Tahsil edildi" ? "success" : "info",
      href: "/app/komisyon",
    });
  }
  for (const p of (payLinks ?? []) as { id: string; title: string; amount_try: number; status: string; paid_at: string | null; created_at: string }[]) {
    ev.push({
      id: `pay-${p.id}`,
      at: p.created_at,
      category: "finans",
      title: `Ödeme linki oluşturuldu · ${tl(p.amount_try)}`,
      detail: `${p.title} · ${PAYMENT_LINK_STATUS_LABEL[p.status] ?? p.status}`,
      icon: "money",
      tone: "info",
    });
    if (p.paid_at) {
      ev.push({ id: `paid-${p.id}`, at: p.paid_at, category: "finans", title: `Ödeme alındı · ${tl(p.amount_try)}`, detail: p.title, icon: "money", tone: "success" });
    }
  }

  return ev;
}
