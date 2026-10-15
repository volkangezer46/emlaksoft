/**
 * Hedef kapsamı ve toplu hedef yardımcıları (SAF; OA4). Kapsam: kişi (profile_id) · takım (team_id) · şube (branch_id) ·
 * ofis geneli (üçü de boş). Tablo kısıtı `targets_single_scope_check` en çok birinin dolu olmasını ister (20261018080001).
 */
import { shiftMonthKey } from "@/lib/clock";

export const TARGET_PERIODS = ["monthly", "quarterly", "yearly"] as const;
export type TargetPeriod = (typeof TARGET_PERIODS)[number];

export type TargetScopeKind = "kisi" | "takim" | "sube" | "ofis";

export type TargetScope =
  | { kind: "kisi"; profileId: string }
  | { kind: "takim"; teamId: string }
  | { kind: "sube"; branchId: string }
  | { kind: "ofis" };

export const PERIOD_MONTHS: Record<TargetPeriod, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export function isTargetPeriod(v: string): v is TargetPeriod {
  return (TARGET_PERIODS as readonly string[]).includes(v);
}

/** "YYYY-AA" ya da "YYYY-AA-GG" → "YYYY-AA-01"; geçersizse null. */
export function normalizePeriodStart(raw: string): string | null {
  const v = raw.trim();
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(v);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** Bir önceki eşdeğer dönemin başlangıcı (aylık −1 ay, çeyrek −3, yıllık −12). */
export function previousPeriodStart(period: TargetPeriod, start: string): string | null {
  const key = shiftMonthKey(start.slice(0, 7), -PERIOD_MONTHS[period]);
  return key ? `${key}-01` : null;
}

/** Hedef satırının kapsam kolonları (yalnız biri dolu). */
export function scopeColumns(s: TargetScope): { profile_id: string | null; team_id: string | null; branch_id: string | null } {
  return {
    profile_id: s.kind === "kisi" ? s.profileId : null,
    team_id: s.kind === "takim" ? s.teamId : null,
    branch_id: s.kind === "sube" ? s.branchId : null,
  };
}

/** Satırın kapsam anahtarı (eşleştirme/kopya için): "p:<id>" · "t:<id>" · "b:<id>" · "o". */
export function scopeKeyOf(row: { profile_id?: string | null; team_id?: string | null; branch_id?: string | null }): string {
  if (row.profile_id) return `p:${row.profile_id}`;
  if (row.team_id) return `t:${row.team_id}`;
  if (row.branch_id) return `b:${row.branch_id}`;
  return "o";
}

/**
 * Ofis toplamını n kişiye EŞİT dağıtır. Tam sayı (anlaşma/randevu/çağrı): kalan ilk kişilere birer eklenir (toplam korunur).
 * Tutar: kuruşa yuvarlanır, yuvarlama farkı ilk kişiye yazılır (toplam korunur).
 */
export function distributeInt(total: number, n: number): number[] {
  if (!(n > 0)) return [];
  const t = Math.max(0, Math.floor(total));
  const base = Math.floor(t / n);
  const rest = t - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

export function distributeMoney(total: number, n: number): number[] {
  if (!(n > 0)) return [];
  const cents = Math.max(0, Math.round(total * 100));
  const base = Math.floor(cents / n);
  const out = Array.from({ length: n }, () => base);
  out[0] += cents - base * n;
  return out.map((c) => c / 100);
}

/**
 * Geçen dönemin hedeflerini yeni döneme kopyalama planı: yeni dönemde AYNI kapsamda hedef varsa atlanır (idempotent).
 */
export function planCopy<T extends { profile_id?: string | null; team_id?: string | null; branch_id?: string | null }>(
  previous: readonly T[],
  existingInTarget: readonly { profile_id?: string | null; team_id?: string | null; branch_id?: string | null }[],
): { copy: T[]; skipped: number } {
  const taken = new Set(existingInTarget.map(scopeKeyOf));
  const copy: T[] = [];
  let skipped = 0;
  for (const row of previous) {
    const key = scopeKeyOf(row);
    if (taken.has(key)) {
      skipped += 1;
      continue;
    }
    taken.add(key);
    copy.push(row);
  }
  return { copy, skipped };
}

/* ------------------------------------------------------------------------------------------ */
/* Takım/şube hedefi gerçekleşmesi = üyelerin toplamı (hedefler sayfası + rapor merkezi ortak)  */
/* ------------------------------------------------------------------------------------------ */

export type ScopedTarget = {
  id: string;
  period: string;
  period_start: string;
  profile_id: string | null;
  team_id: string | null;
  branch_id: string | null;
};

export type MemberRow = { id: string; team_id: string | null; branch_id: string | null };

/** Hedefin profil listesi: kişi → [kendisi]; takım/şube → aktif üyeler; ofis geneli → null (kısıt yok). */
export function targetMembers(t: Pick<ScopedTarget, "profile_id" | "team_id" | "branch_id">, members: readonly MemberRow[]): string[] | null {
  if (t.profile_id) return [t.profile_id];
  if (t.team_id) return members.filter((m) => m.team_id === t.team_id).map((m) => m.id);
  if (t.branch_id) return members.filter((m) => m.branch_id === t.branch_id).map((m) => m.id);
  return null;
}

const SEP = "|";

/**
 * Takım/şube hedeflerini üye başına sentetik kişi hedefine açar (gerçekleşme okuyucusu kişi/ofis hedefi bilir).
 * Kişi ve ofis hedefleri aynen geçer. `foldActuals` sonuçları hedef kimliğine geri toplar.
 */
export function expandForActuals(targets: readonly ScopedTarget[], members: readonly MemberRow[]) {
  const out: { id: string; period: string; period_start: string; profile_id: string | null }[] = [];
  for (const t of targets) {
    if (!t.team_id && !t.branch_id) {
      out.push({ id: t.id, period: t.period, period_start: t.period_start, profile_id: t.profile_id });
      continue;
    }
    for (const pid of targetMembers(t, members) ?? []) out.push({ id: `${t.id}${SEP}${pid}`, period: t.period, period_start: t.period_start, profile_id: pid });
  }
  return out;
}

export function foldActuals(
  targets: readonly ScopedTarget[],
  actuals: ReadonlyMap<string, { deals: number; revenue: number; revenueVisible: boolean }>,
): Map<string, { deals: number; revenue: number; revenueVisible: boolean }> {
  const out = new Map<string, { deals: number; revenue: number; revenueVisible: boolean }>();
  for (const t of targets) {
    if (!t.team_id && !t.branch_id) {
      const a = actuals.get(t.id);
      if (a) out.set(t.id, a);
      continue;
    }
    let deals = 0;
    let revenue = 0;
    let visible = true;
    for (const [key, a] of actuals) {
      if (!key.startsWith(`${t.id}${SEP}`)) continue;
      deals += a.deals;
      revenue += a.revenue;
      visible = visible && a.revenueVisible;
    }
    out.set(t.id, { deals, revenue: visible ? revenue : 0, revenueVisible: visible });
  }
  return out;
}

