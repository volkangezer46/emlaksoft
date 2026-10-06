import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimelineEvent } from "@/lib/activity-timeline";

/**
 * Zaman çizelgesi kaynakları için ortak yardımcılar (müşteri / portföy / anlaşma
 * detay sayfaları). Yalnız RLS'li kullanıcı istemcisiyle çalışır (admin client yok).
 */

export const OFFER_STATUS_LABEL: Record<string, string> = {
  draft: "Taslak",
  submitted: "Sunuldu",
  countered: "Karşı teklif",
  accepted: "Kabul edildi",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
};

export const CONTRACT_STATUS_LABEL: Record<string, string> = {
  draft: "Taslak",
  sent: "Gönderildi",
  signed: "İmzalandı",
  rejected: "Reddedildi",
  cancelled: "İptal",
};

export const APPT_TYPE_LABEL = APPOINTMENT_TYPE_LABELS;

export const APPT_STATUS_LABEL: Record<string, string> = {
  pending: "Teyit bekliyor",
  confirmed: "Onaylandı",
  signature: "İmza eksik",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export const PAYMENT_LINK_STATUS_LABEL: Record<string, string> = {
  open: "Açık",
  paid: "Ödendi",
  cancelled: "İptal",
  expired: "Süresi doldu",
};

export function tl(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Number(value)) + " ₺";
}

export function offerTone(status: string): TimelineEvent["tone"] {
  if (status === "accepted") return "success";
  if (status === "rejected") return "danger";
  if (status === "countered") return "warn";
  return "info";
}

export function apptTone(status: string): TimelineEvent["tone"] {
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  if (status === "signature") return "warn";
  return "info";
}

type Db = SupabaseClient;

/** profiles.id → ad (RLS'li; bulunamayan atlanır). */
export async function fetchActorNames(supabase: Db, ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const out = new Map<string, string>();
  if (uniq.length === 0) return out;
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", uniq);
  for (const p of (data ?? []) as { id: string; full_name: string | null }[]) {
    if (p.full_name) out.set(p.id, p.full_name);
  }
  return out;
}

type AuditRow = {
  id: string;
  action: string;
  actor_id: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
  entity_id: string | null;
};

/** audit_logs: entity_type='deal' kayıtları (aşama değişimi, kapora, kontrol listesi). */
export async function fetchDealAudit(supabase: Db, dealIds: string[], limit = 60): Promise<AuditRow[]> {
  if (dealIds.length === 0) return [];
  const { data } = await supabase
    .from("audit_logs")
    .select("id, action, actor_id, old_value, new_value, ip, created_at, entity_id")
    .eq("entity_type", "deal")
    .in("entity_id", dealIds)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as AuditRow[];
}

/** Anlaşma audit satırlarını olaylara çevirir (kategori: anlasma | belge). */
export function dealAuditEvents(
  rows: AuditRow[],
  names: Map<string, string>,
  stageNames: Record<string, string>,
  hrefFor?: (dealId: string) => string | undefined,
): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const r of rows) {
    const nv = r.new_value ?? {};
    const actor = r.actor_id ? names.get(r.actor_id) : undefined;
    const base = {
      id: `audit-${r.id}`,
      at: r.created_at,
      actor,
      ip: r.ip ?? undefined,
      href: r.entity_id ? hrefFor?.(r.entity_id) : undefined,
    };
    if (r.action === "deal.create") {
      out.push({ ...base, category: "anlasma", title: "Anlaşma oluşturuldu", icon: "deal", tone: "info" });
    } else if (r.action === "deal.update") {
      const stage = typeof nv.stage === "string" ? nv.stage : null;
      const oldStage = r.old_value && typeof r.old_value.stage === "string" ? r.old_value.stage : null;
      if (stage) {
        out.push({
          ...base,
          category: "anlasma",
          title: `Aşama: ${stageNames[stage] ?? stage}`,
          detail: oldStage ? `Önceki aşama: ${stageNames[oldStage] ?? oldStage}` : undefined,
          icon: "deal",
          tone: stage === "won" ? "success" : stage === "lost" ? "danger" : "info",
        });
      } else {
        out.push({
          ...base,
          category: "anlasma",
          title: nv.deal_value != null ? `Anlaşma tutarı güncellendi · ${tl(nv.deal_value as number)}` : "Anlaşma güncellendi",
          icon: "deal",
          tone: "neutral",
        });
      }
    } else if (r.action === "deal.kapora") {
      const label = typeof nv.label === "string" && nv.label ? nv.label : undefined;
      out.push({
        ...base,
        category: "anlasma",
        title: `Kapora alındı${nv.amount != null ? ` · ${tl(nv.amount as number)}` : ""}`,
        detail: label,
        icon: "money",
        tone: "success",
      });
    } else if (r.action.startsWith("deal.checklist.")) {
      const what = r.action.endsWith("toggle")
        ? "Kontrol listesi maddesi işaretlendi"
        : r.action.endsWith("add")
          ? "Kontrol listesine madde eklendi"
          : r.action.endsWith("template")
            ? "Kontrol listesi şablonu uygulandı"
            : r.action.endsWith("note")
              ? "Kontrol listesi notu güncellendi"
              : "Kontrol listesi maddesi silindi";
      out.push({ ...base, category: "belge", title: what, icon: "task", tone: "neutral" });
    }
  }
  return out;
}
