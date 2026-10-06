/**
 * Ofis nabzı (yönetim, ofis geneli) — SAF karar katmanı (vitest). İki soru:
 *  1. "Dünden beri ne değişti": son 24 saatte yeni talep/portföy + İlan Kontrol değişimleri (`listing_control_changes_since`
 *     RPC'si ve `buildChangeLines` — İlan Kontrol özetiyle AYNI kaynak, kopya hesap yok).
 *  2. "Bugün kimi uyarmalıyım": danışman başına GERÇEK sayımlar (geciken görev, hareketsiz açık anlaşma, SLA'sı aşılmış
 *     ilan uyarısı); her sayı o danışmanla süzülmüş listeye gider. Puan yalnız sıralama içindir, ekranda gösterilmez.
 * Kural: sayı 0 ise satır/çip yok; veri okunamadıysa (null) o sinyal hiç çizilmez (sahte sıfır yok).
 */

export type ChangeItem = { key: string; label: string; value: number; href: string };

export type CrmChangeInput = { newDemands: number | null; newProperties: number | null };

/** CRM tarafı "son 24 saat" kalemleri; hedef listeler `?eklenen=1` süzgeciyle AYNI koşulu (created_at >= 24 saat önce) uygular. */
export function crmChangeItems(i: CrmChangeInput): ChangeItem[] {
  const out: ChangeItem[] = [];
  if (i.newDemands) out.push({ key: "talep", label: "Yeni talep", value: i.newDemands, href: "/app/talepler?status=all&eklenen=1" });
  if (i.newProperties) out.push({ key: "portfoy", label: "Yeni portföy", value: i.newProperties, href: "/app/portfoyler?eklenen=1" });
  return out;
}

/** İlan Kontrol satırlarından yalnız sıfır olmayanlar (sıra korunur). */
export function nonZero<T extends { value: number }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.value > 0);
}

export type WarningSignal = "gorev" | "anlasma" | "sla";

export type AdvisorWarningInput = {
  advisors: readonly { id: string; name: string }[];
  /** Her dizi: ilgili kaydın danışman kimliği (null = atanmamış, sayılmaz). `null` dizi = okunamadı. */
  overdueTasks: readonly (string | null)[] | null;
  staleDeals: readonly (string | null)[] | null;
  slaBreaches: readonly (string | null)[] | null;
  staleDays: number;
};

export type AdvisorWarning = {
  id: string;
  name: string;
  href: string;
  chips: { signal: WarningSignal; label: string; count: number; href: string }[];
  /** Sıralama ağırlığı (gösterilmez). */
  weight: number;
};

const WEIGHT: Record<WarningSignal, number> = { gorev: 1, anlasma: 2, sla: 2 };

function countBy(ids: readonly (string | null)[] | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids ?? []) if (id) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export function buildAdvisorWarnings(i: AdvisorWarningInput, limit = 5): AdvisorWarning[] {
  const tasks = countBy(i.overdueTasks);
  const deals = countBy(i.staleDeals);
  const sla = countBy(i.slaBreaches);
  const rows: AdvisorWarning[] = [];
  for (const a of i.advisors) {
    const chips: AdvisorWarning["chips"] = [];
    const t = tasks.get(a.id) ?? 0;
    const d = deals.get(a.id) ?? 0;
    const s = sla.get(a.id) ?? 0;
    if (s > 0) chips.push({ signal: "sla", label: `${s} ilan uyarısı süresi aştı`, count: s, href: `/app/ilan-kontrol/anomaliler?danisman=${a.id}` });
    if (d > 0) chips.push({ signal: "anlasma", label: `${d} anlaşma ${i.staleDays}+ gündür hareketsiz`, count: d, href: `/app/anlasmalar?bayat=1&danisman=${a.id}` });
    if (t > 0) chips.push({ signal: "gorev", label: `${t} geciken görev`, count: t, href: `/app/gorevler?filter=overdue&danisman=${a.id}` });
    if (chips.length === 0) continue;
    const weight = chips.reduce((sum, c) => sum + c.count * WEIGHT[c.signal], 0);
    rows.push({ id: a.id, name: a.name, href: `/app/ekip/${a.id}`, chips, weight });
  }
  return rows.sort((x, y) => y.weight - x.weight || x.name.localeCompare(y.name, "tr")).slice(0, limit);
}
