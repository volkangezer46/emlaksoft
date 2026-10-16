import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { PrintButton } from "@/components/ui/print-button";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { batchAll } from "@/lib/supabase/query-batch";
import { formatDateTr, formatTryDecimal } from "@/lib/format";
import { advanceRoundingGap, BUDGET_STATUS_LABELS, budgetPeriodLabel, monthlyAdvance } from "@/lib/building-management/budget";
import { loadBudgetById } from "@/lib/building-management/budget-load";
import { compareUnits, DISTRIBUTION_LABELS, distributeAmount, unitLabel } from "@/lib/building-management/distribution";

export const metadata = { title: "İşletme projesi karar özeti" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Rel<T> = T | T[] | null;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/**
 * Yıllık işletme projesi — kat malikleri kurulu için YAZDIRILABİLİR karar özeti: kalemler, yıllık toplam, aylık avans ve daire başı
 * avans cetveli (arsa payı / eşit / m²) + imza alanları. Hukuki metinler BİLGİ/ÖNERİ niteliğindedir; resmî karar defterinin yerine
 * geçmez. Okuma RLS'li kullanıcı oturumuyla; yazma yok.
 */
export default async function IsletmeProjesiPage({ params }: { params: Promise<{ budgetId: string }> }) {
  const { tenantId } = await requireModulePage("expenses", "/app/aidat");
  const { budgetId } = await params;
  if (!UUID.test(budgetId)) notFound();
  const supabase = await createClient();
  const loaded = await loadBudgetById(supabase, { tenantId: tenantId ?? "", budgetId });
  if (!loaded) notFound();
  const { budget, building } = loaded;

  type UnitRaw = { id: string; block: string | null; floor: number | null; unit_no: string; area_m2: number | string | null; land_share: number | string | null; owner: Rel<{ full_name: string | null }> };
  // batchAll: okuma hatası boş cetvele dönüşmez (hata sınırına düşer).
  const [{ data: tenant }, { data: unitRows }] = await batchAll("isletme-projesi", ["ofis", "daireler"], [
    supabase.from("tenants").select("name").eq("id", tenantId ?? "").maybeSingle(),
    fetchAllRows<UnitRaw>((from, to) =>
      supabase
        .from("building_units")
        .select("id, block, floor, unit_no, area_m2, land_share, owner:customers!building_units_owner_customer_fkey(full_name)")
        .eq("tenant_id", tenantId ?? "")
        .eq("building_id", building.id)
        .eq("active", true)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{ data: UnitRaw[] | null; error: { message: string } | null }>, 1000, 5),
  ] as const);
  const units = unitRows
    .map((u) => ({ id: u.id, block: u.block, floor: u.floor, unitNo: u.unit_no, areaM2: u.area_m2 == null ? null : Number(u.area_m2), landShare: u.land_share == null ? null : Number(u.land_share), owner: one(u.owner)?.full_name ?? null }))
    .sort(compareUnits);

  const money = (n: number) => formatTryDecimal(n, 2);
  const monthly = monthlyAdvance(budget.total, budget.months);
  const gap = advanceRoundingGap(budget.total, budget.months);
  const dist = units.length > 0
    ? distributeAmount({ method: budget.distribution, total: monthly, units: units.map((u) => ({ id: u.id, label: unitLabel(u), areaM2: u.areaM2, landShare: u.landShare })) })
    : null;
  const shareById = new Map(dist && dist.ok ? dist.shares.map((s) => [s.unitId, s.amount]) : []);
  const weightLabel = budget.distribution === "land_share" ? "Arsa payı" : budget.distribution === "area" ? "m²" : null;
  const address = [building.address, building.district, building.city].filter(Boolean).join(", ");
  const draft = budget.status !== "approved";

  return (
    <main id="main-content" className="mx-auto max-w-3xl space-y-5 p-4 py-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/app/aidat?sekme=binalar&bina=${building.id}&bolum=butce&proje=${budget.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 hover:underline">← İşletme projesi</Link>
        <PrintButton />
      </div>

      <article className="space-y-6 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)] sm:p-7 print:border-0 print:p-0 print:shadow-none">
        <header className="border-b border-line pb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">{building.name}{address ? ` · ${address}` : ""}</p>
          <h1 className="mt-1 font-display text-2xl font-extrabold text-ink-950">Yıllık İşletme Projesi</h1>
          <p className="mt-1 text-sm text-text-muted">
            {budget.title} · {budgetPeriodLabel(budget.periodStart, budget.months)} ({budget.months} ay) · {BUDGET_STATUS_LABELS[budget.status]}
          </p>
          {draft ? <p className="mt-2 inline-block rounded-[var(--radius-control)] bg-amber-400/15 px-2.5 py-1 text-xs font-bold text-amber-800">TASLAK: kat malikleri kurulunun onayına sunulacak öneridir.</p> : null}
        </header>

        <section aria-labelledby="kalemler">
          <h2 id="kalemler" className="text-sm font-bold uppercase tracking-wide text-text-muted">1. Gider kalemleri</h2>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-text-muted">
                <th scope="col" className="py-1.5 pr-2 font-semibold">Kalem</th>
                <th scope="col" className="hidden py-1.5 pr-2 font-semibold sm:table-cell print:table-cell">Kategori</th>
                <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Yıllık</th>
                <th scope="col" className="py-1.5 text-right font-semibold">Aylık</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {budget.lines.map((l, i) => (
                <tr key={`${l.label}-${i}`}>
                  <td className="py-1.5 pr-2 text-ink-950">{l.label}</td>
                  <td className="hidden py-1.5 pr-2 text-text-muted sm:table-cell print:table-cell">{l.category ?? "Diğer"}</td>
                  <td className="numeric py-1.5 pr-2 text-right text-ink-950">{money(l.amount)}</td>
                  <td className="numeric py-1.5 text-right text-text-muted">{money(l.amount / budget.months)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-ink-950/20 font-bold text-ink-950">
                <td className="py-2 pr-2">Toplam</td>
                <td className="hidden sm:table-cell print:table-cell" />
                <td className="numeric py-2 pr-2 text-right">{money(budget.total)}</td>
                <td className="numeric py-2 text-right">{money(monthly)}</td>
              </tr>
            </tfoot>
          </table>
          {gap !== 0 ? <p className="mt-1 text-xs text-text-faint">Aylık avans kuruşa yuvarlanmıştır; dönem sonunda toplam {money(Math.abs(gap))} {gap > 0 ? "fazla" : "eksik"} tahsil edilir.</p> : null}
        </section>

        <section aria-labelledby="cetvel">
          <h2 id="cetvel" className="text-sm font-bold uppercase tracking-wide text-text-muted">2. Bağımsız bölüm başına aylık avans ({DISTRIBUTION_LABELS[budget.distribution]})</h2>
          {dist && !dist.ok ? <p className="mt-2 text-sm text-danger-600">{dist.error}</p> : null}
          {units.length === 0 ? <p className="mt-2 text-sm text-text-muted">Binada etkin daire yok.</p> : (
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-text-muted">
                  <th scope="col" className="py-1.5 pr-2 font-semibold">Bölüm</th>
                  <th scope="col" className="hidden py-1.5 pr-2 font-semibold sm:table-cell print:table-cell">Kat maliki</th>
                  {weightLabel ? <th scope="col" className="py-1.5 pr-2 text-right font-semibold">{weightLabel}</th> : null}
                  <th scope="col" className="py-1.5 pr-2 text-right font-semibold">Aylık</th>
                  <th scope="col" className="py-1.5 text-right font-semibold">Dönem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {units.map((u) => {
                  const m = shareById.get(u.id);
                  const w = budget.distribution === "land_share" ? u.landShare : budget.distribution === "area" ? u.areaM2 : null;
                  return (
                    <tr key={u.id}>
                      <td className="py-1.5 pr-2 text-ink-950">{unitLabel(u)}</td>
                      <td className="hidden py-1.5 pr-2 text-text-muted sm:table-cell print:table-cell">{u.owner ?? "—"}</td>
                      {weightLabel ? <td className="numeric py-1.5 pr-2 text-right text-text-muted">{w ?? "—"}</td> : null}
                      <td className="numeric py-1.5 pr-2 text-right font-semibold text-ink-950">{m != null ? money(m) : "—"}</td>
                      <td className="numeric py-1.5 text-right text-text-muted">{m != null ? money(m * budget.months) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <section aria-labelledby="karar" className="space-y-2">
          <h2 id="karar" className="text-sm font-bold uppercase tracking-wide text-text-muted">3. Karar</h2>
          <p className="text-sm text-ink-950">
            {budget.decisionDate
              ? `Kat malikleri kurulunun ${formatDateTr(budget.decisionDate, { day: "2-digit", month: "long", year: "numeric" })} tarihli${budget.decisionNo ? ` ${budget.decisionNo} sayılı` : ""} toplantısında yukarıdaki işletme projesi görüşülmüştür.`
              : "Bu işletme projesi kat malikleri kurulunun onayına sunulmak üzere hazırlanmıştır."}
            {" "}Aylık avanslar her ay ilgili bağımsız bölümün ödeyeni (malik ya da kiracı) adına tahakkuk ettirilir; son ödeme günü her ayın {building.due_day}. günüdür.
          </p>
          {budget.decisionNote ? <p className="whitespace-pre-line rounded-[var(--radius-control)] bg-canvas px-3 py-2 text-sm text-ink-950">{budget.decisionNote}</p> : null}
        </section>

        <section aria-label="İmzalar" className="grid grid-cols-1 gap-6 pt-4 sm:grid-cols-3 print:grid-cols-3">
          {["Yönetici", "Denetçi", "Kat malikleri adına"].map((r) => (
            <div key={r} className="border-t border-ink-950/30 pt-2 text-center text-xs text-text-muted">{r}<br />Ad soyad / imza</div>
          ))}
        </section>

        <footer className="space-y-1 border-t border-line pt-3 text-xs text-text-muted">
          <p className="font-semibold text-ink-950">Bilgi notu (öneri niteliğindedir, hukuki görüş değildir)</p>
          <p>634 sayılı Kat Mülkiyeti Kanunu’na göre yönetici yıllık işletme projesi hazırlar (m.35); ortak giderler, aksine anlaşma yoksa arsa payı oranında paylaşılır (m.20). Kat malikleri kurulunca kabul edilen ya da tebliğinden sonra yedi gün içinde itiraz edilmeyen işletme projesi kesinleşir (m.37). Kesin metin ve süreler için güncel mevzuatı ve hukuk danışmanınızı esas alın.</p>
          <p>Hazırlayan: {tenant?.name ?? "Yönetim ofisi"}</p>
        </footer>
      </article>
    </main>
  );
}
