/**
 * DEMO OFİS — KOMİSYON ÇEŞİTLİLİĞİ (F4 tohum kısmı). Demo ofisteki 16 komisyonun hepsi "tahsil edildi" ve hepsi tek
 * danışmanındı: muhasebe ana ekranı "bekleyen komisyon" göremiyor, takım liderinin "Bu ay kazancım" kartı hep boş kalıyordu.
 * SAF karar (DB'siz test: rich-pack.test.ts): en yeni `pending` komisyon (kasa hareketi ve hakediş ödemesi OLMAYAN) "hesaplandı"
 * (tahakkuk; tahsil bekliyor) durumuna çekilir; sonraki `shared` komisyona takım liderinin kimlikli payı eklenir (danışman payı
 * aynı kalır, ofis payından düşülür). Uygulama `scripts/seed-demo.ts` (idempotent: hedef durum zaten varsa satır seçilmez).
 */
import { roleLabel } from "@/lib/role-labels";

export type SpreadCommission = {
  id: string;
  status: string;
  created_at: string;
  splits: { kind?: string; label?: string; rate?: number; amount?: number; profile_id?: string | null }[] | null;
  gross_amount: number | string;
  hasCashEntry: boolean;
  hasPayout: boolean;
};

export type CommissionSpreadChange = { id: string; status?: "calculated"; splits?: SpreadCommission["splits"] };

export function planCommissionSpread(
  rows: readonly SpreadCommission[],
  teamLeadId: string | null,
  opts: { pending?: number; shared?: number; leadRate?: number } = {},
): CommissionSpreadChange[] {
  const pendingN = opts.pending ?? 3;
  const sharedN = opts.shared ?? 3;
  const leadRate = opts.leadRate ?? 15;
  const newest = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const out: CommissionSpreadChange[] = [];
  const already = newest.filter((r) => r.status === "calculated").length;
  const free = newest.filter((r) => !r.hasCashEntry && !r.hasPayout && r.status !== "calculated");
  const pendingIds = new Set(free.slice(0, Math.max(0, pendingN - already)).map((r) => r.id));
  for (const id of pendingIds) out.push({ id, status: "calculated" });
  if (teamLeadId) {
    const hasLead = (r: SpreadCommission) => (r.splits ?? []).some((s) => s.profile_id === teamLeadId);
    const sharedAlready = newest.filter(hasLead).length;
    const candidates = newest.filter((r) => !hasLead(r) && !pendingIds.has(r.id) && (r.splits ?? []).some((s) => s.kind === "office" && Number(s.rate) > leadRate));
    for (const r of candidates.slice(0, Math.max(0, sharedN - sharedAlready))) {
      const gross = Number(r.gross_amount) || 0;
      const splits = (r.splits ?? []).map((s) =>
        s.kind === "office" ? { ...s, rate: Number(s.rate) - leadRate, amount: Math.round((gross * (Number(s.rate) - leadRate)) / 100) } : s,
      );
      splits.push({ kind: "advisor", label: roleLabel("team_lead"), rate: leadRate, amount: Math.round((gross * leadRate) / 100), profile_id: teamLeadId });
      const merged = out.find((c) => c.id === r.id);
      if (merged) merged.splits = splits;
      else out.push({ id: r.id, splits });
    }
  }
  return out;
}
