import Link from "next/link";
import { Globe2, Receipt, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/format";

/**
 * Portföy künyesinin tabloda olup ekranda görünmeyen alanları + portföye bağlı giderler.
 * Kendi sorgusunu yapar (sayfa künye batch'ine dokunmaz); sütun yoksa (eski şema) sessizce gizlenir.
 * - source_agent: portföyü getiren danışman · assigned_at: danışmana atanma anı (geriye doldurulmaz)
 * - foreign_eligible / foreign_note: yabancıya satış uygunluğu (düzenleme: Yabancıya satış ekranı)
 * - expenses.property_id: bu portföy için yapılan giderler (liste: /app/giderler?portfoy=)
 */
export async function PropertyExtraPanel({ propertyId, canSeeExpenses, canCreateExpense }: { propertyId: string; canSeeExpenses: boolean; canCreateExpense: boolean }) {
  const supabase = await createClient();
  const [{ data: extra }, expenseRes] = await Promise.all([
    supabase
      .from("properties")
      .select("source_agent, assigned_at, foreign_eligible, foreign_note, source:profiles!properties_source_agent_fkey(full_name)")
      .eq("id", propertyId)
      .maybeSingle(),
    canSeeExpenses
      ? supabase
          .from("expenses")
          .select("id, title, amount, expense_date", { count: "exact" })
          .eq("property_id", propertyId)
          .order("expense_date", { ascending: false })
          .limit(200)
      : Promise.resolve({ data: [] as { id: string; title: string; amount: number; expense_date: string }[], count: 0 }),
  ]);

  const source = extra?.source ? (Array.isArray(extra.source) ? extra.source[0] : extra.source) as { full_name?: string } | null : null;
  const expenses = (expenseRes.data ?? []) as { id: string; title: string; amount: number; expense_date: string }[];
  const expenseCount = expenseRes.count ?? expenses.length;
  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const assignedAt = (extra?.assigned_at as string | null | undefined) ?? null;
  const foreignEligible = extra ? (extra.foreign_eligible as boolean | null) : null;
  const foreignNote = (extra?.foreign_note as string | null | undefined) ?? null;

  if (!extra && !canSeeExpenses) return null;

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      {extra ? (
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 className="font-display font-bold text-ink-950">Kaynak ve uygunluk</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-text-muted"><UserPlus className="h-3.5 w-3.5" /> Portföyü getiren</dt>
              <dd className="font-semibold text-ink-950">
                {extra.source_agent ? (
                  <Link href={`/app/ekip/${extra.source_agent}`} className="text-brand-600 hover:underline">{source?.full_name ?? "Ekip üyesi"}</Link>
                ) : (
                  <span className="text-text-faint">Kayıtlı değil</span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-text-muted">Danışmana atanma</dt>
              <dd className="font-semibold text-ink-950">
                {assignedAt ? new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" }).format(new Date(assignedAt)) : <span className="text-text-faint">Bilinmiyor</span>}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-text-muted"><Globe2 className="h-3.5 w-3.5" /> Yabancıya satış</dt>
              <dd className="text-right">
                <Link href="/app/yabanci-satis" className={`font-semibold hover:underline ${foreignEligible === false ? "text-danger-600" : "text-mint-700"}`}>
                  {foreignEligible === false ? "Uygun değil" : "Uygun"}
                </Link>
                {foreignNote ? <span className="mt-0.5 block text-xs text-text-muted">{foreignNote}</span> : null}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      {canSeeExpenses ? (
        <div className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950"><Receipt className="h-4 w-4 text-brand-600" /> Giderler</h2>
            <Link href={`/app/giderler?portfoy=${propertyId}`} className="text-xs font-semibold text-brand-600 hover:underline">
              {expenseCount > 0 ? `Tümü (${expenseCount}) →` : canCreateExpense ? "Gider ekle →" : "Giderler →"}
            </Link>
          </div>
          {expenseCount === 0 ? (
            <p className="mt-3 text-sm text-text-muted">Bu portföye bağlı gider yok (ilan, fotoğraf, tabela vb. giderleri buradan izlenir).</p>
          ) : (
            <>
              <p className="mt-2 font-display text-2xl font-extrabold text-ink-950">{formatTry(expenseTotal)}</p>
              <p className="text-xs text-text-muted">{expenseCount} kayıt{expenseCount > expenses.length ? ` (ilk ${expenses.length} toplandı)` : ""}</p>
              <ul className="mt-3 space-y-1.5 text-sm">
                {expenses.slice(0, 3).map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-ink-950">{x.title}</span>
                    <span className="shrink-0 text-text-muted">{formatTry(Number(x.amount))}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
