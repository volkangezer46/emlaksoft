import Link from "next/link";
import { ArrowUpRight, CalendarRange, Receipt, X } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { now as nowMs } from "@/lib/clock";
import { createClient } from "@/lib/supabase/server";
import { exportExpensesCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { listExpenses } from "@/app/actions/expenses";
import { getDefinitionsOrDefault } from "@/lib/definitions";
import { requireReportingData } from "@/lib/reporting/result";
import { EmptyState } from "@/components/ui/empty-state";
import { ChartFrame, DonutSplit } from "@/app/app/_ui/lazy-chart";
import { InteractiveChart } from "@/components/app/interactive-chart";
import { CategoryBars } from "./category-bars";
import { categoryChartMode } from "@/lib/expense-category-chart";
import { ExpensesTable } from "./expenses-table";
import { ExpenseCreateForm } from "./expense-create-form";

import { PageHeader } from "@/components/ui/page-header";
// Inline server action wrappers — void return için form action uyumlu
function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// UTC getter'lar kullanılır — bu yardımcı yalnız istanbulMonthUtc ile Date.UTC(...)
// üzerinden kurulan tarihleri biçimlendirir, sunucunun yerel saat dilimine bağımlı olmaz.
function fmtDate(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Verilen anın İstanbul yerel takvim bileşenleri (yıl, ay [0-indeksli], gün). */
function istanbulDateParts(ms: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month") - 1, day: get("day") };
}

/** İstanbul takvimine göre bir ayın 1'i (UTC-getter'larla okunacak şekilde Date.UTC ile kurulur). */
function istanbulMonthUtc(year: number, month: number, day = 1) {
  return new Date(Date.UTC(year, month, day));
}

/** Boş olmayan paramlardan query string üretir — mevcut filtreler korunur. */
function qs(params: Record<string, string | null | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

function tarihKisa(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${iso}T00:00:00`));
}

export default async function GiderlerPage({
  searchParams,
}: {
  searchParams?: Promise<{ kategori?: string; from?: string; to?: string; adet?: string }>;
}) {
  const { perms } = await requireModulePage("expenses", "/app/giderler");
  const params = (await searchParams) ?? {};
  const fromF = ISO_DATE.test(params.from ?? "") ? params.from! : null;
  const toF = ISO_DATE.test(params.to ?? "") ? params.to! : null;
  const now = new Date(nowMs());
  // Sayfalama: ?adet= 200'den başlar, "Daha fazla göster" 200 artırır (tavan 1000).
  const adet = Math.min(Math.max(Math.trunc(Number(params.adet)) || 200, 200), 1000);

  const supabase = await createClient();
  const [expenses, catDefs, aggregateResult] = await Promise.all([
    // Tablo listesi — ?from=&to= sunucu tarafında uygulanır (expense_date aralığı).
    // NOT: KPI/kırılım/trend artık aşağıdaki RPC'den gelir, bu diziden DEĞİL —
    // liste görünümü için 200 kayıt tavanı yeterli, ama toplam/tutar asla bu
    // tavana bağlı olmamalı (bkz. tenant_expense_aggregates).
    listExpenses(undefined, { from: fromF ?? undefined, to: toF ?? undefined }, adet),
    getDefinitionsOrDefault("expense_category"),
    supabase.rpc("tenant_expense_aggregates", { p_from: fromF, p_to: toF, p_as_of: now.toISOString() }),
  ]);
  const aggregate = requireReportingData("tenant-expense-aggregates", aggregateResult) as unknown as {
    total: number;
    record_count: number;
    by_category: { category: string; total: number }[];
    monthly: { month_start: string; total: number }[];
  };
  const canCreate = perms.expenses?.includes("create") ?? false;
  const canEdit = perms.expenses?.includes("edit") ?? false;
  const canDelete = perms.expenses?.includes("delete") ?? false;

  // DB-driven gider kategorileri (boşsa definition-defaults.ts yedeği)
  const categories = catDefs.map((c) => ({ value: c.value, label: c.label }));
  const catLabel = (v: string) => categories.find((c) => c.value === v)?.label ?? v;

  // ?kategori= sunucu filtresi — yalnızca tanımlı kategori değerleri kabul edilir
  const kategoriF = categories.some((c) => c.value === params.kategori) ? params.kategori! : "";
  const filteredExpenses = kategoriF ? expenses.filter((e) => e.category === kategoriF) : expenses;

  // Mevcut filtreleri koruyan link üretici
  const href = (next: { kategori?: string | null; from?: string | null; to?: string | null }) =>
    `/app/giderler${qs({
      kategori: next.kategori === undefined ? kategoriF || null : next.kategori,
      from: next.from === undefined ? fromF : next.from,
      to: next.to === undefined ? toF : next.to,
    })}`;

  // Hızlı tarih çipleri — İstanbul takvimine göre (sunucu UTC olabilir)
  const istNow = istanbulDateParts(nowMs());
  const istToday = istanbulMonthUtc(istNow.year, istNow.month, istNow.day);
  const presets = [
    { label: "Bu ay", from: fmtDate(istanbulMonthUtc(istNow.year, istNow.month)), to: fmtDate(istToday) },
    { label: "Geçen ay", from: fmtDate(istanbulMonthUtc(istNow.year, istNow.month - 1)), to: fmtDate(istanbulMonthUtc(istNow.year, istNow.month, 0)) },
    { label: "Son 3 ay", from: fmtDate(istanbulMonthUtc(istNow.year, istNow.month - 2)), to: fmtDate(istToday) },
  ];

  // Özet/kırılım tarih aralığına saygılıdır (RPC p_from/p_to); ?kategori= yalnızca listeyi süzer
  const total = Number(aggregate.total);
  const byCategory = categories.map((c) => ({
    ...c,
    total: Number(aggregate.by_category.find((bc) => bc.category === c.value)?.total ?? 0),
  }));
  const activeCategories = byCategory.filter((c) => c.total > 0);
  const categoryChart = activeCategories
    .sort((a, b) => b.total - a.total)
    // href: dilime tıklayınca liste o kategoriye süzülür, tarih filtresi korunur (kanonik DonutSplit `hrefKey`)
    .map((c) => ({ name: c.label, value: c.total, href: href({ kategori: c.value }) }));

  const barsMode = categoryChartMode(activeCategories.length) === "bars";

  // Son 6 ay trendi — filtrelerden bağımsız, RPC'den (İstanbul ay sınırlarıyla)
  const ayFmt = new Intl.DateTimeFormat("tr-TR", { month: "short", timeZone: "Europe/Istanbul" });
  const trendChart = aggregate.monthly.map((row) => ({
    ay: ayFmt.format(new Date(row.month_start)),
    tutar: Math.round(Number(row.total)),
  }));
  const hasTrend = trendChart.some((t) => t.tutar > 0);

  // Ay karşılaştırması — içinde bulunulan ay vs önceki ay (filtrelerden bağımsız)
  const buAyRow = aggregate.monthly[aggregate.monthly.length - 1];
  const gecenAyRow = aggregate.monthly[aggregate.monthly.length - 2];
  const buAyTutar = Math.round(Number(buAyRow?.total ?? 0));
  const gecenAyTutar = Math.round(Number(gecenAyRow?.total ?? 0));
  const ayUzunFmt = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
  const buAyLabel = buAyRow ? ayUzunFmt.format(new Date(buAyRow.month_start)) : "";
  const gecenAyLabel = gecenAyRow ? ayUzunFmt.format(new Date(gecenAyRow.month_start)) : "";
  const aylikFark = buAyTutar - gecenAyTutar;
  const aylikDegisim = gecenAyTutar > 0 ? Math.round((aylikFark / gecenAyTutar) * 100) : null;
  const kiyasMax = Math.max(1, buAyTutar, gecenAyTutar);

  const tableExpenses = filteredExpenses.map((e) => ({
    id:           e.id,
    title:        e.title,
    amount:       Number(e.amount),
    category:     e.category,
    expense_date: e.expense_date,
    notes:        e.notes,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Masraf & Giderler" eyebrow="Gider takibi" description="Ofis giderlerini kategorilere göre takip edin." actions={
<div className="theme-dark flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] bg-[image:var(--grad-ink)] p-2"><div className="flex items-center gap-3">
            <ExportCsvButton
              action={exportExpensesCsv}
              label="Dışa aktar"
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-white/12 bg-white/8 px-3.5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white disabled:opacity-50"
            />
            {/* KPI kartları tüm filtreleri temizleyip tam listeye döner */}
            <Link
              href="/app/giderler"
              className="focus-ring press lift group block rounded-[var(--radius-card)] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
            >
              <p className="flex items-center justify-center gap-1 font-display text-2xl font-extrabold text-white">
                {aggregate.record_count}
                <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
              </p>
              <p className="text-xs text-white/70">Kayıt</p>
            </Link>
            <Link
              href="/app/giderler"
              className="focus-ring press lift group block rounded-[var(--radius-card)] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
            >
              <p className="flex items-center justify-center gap-1 font-display text-xl font-extrabold text-white">
                {money(total)}
                <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
              </p>
              <p className="text-xs text-white/70">Toplam gider</p>
            </Link>
          </div></div>
} />

      {/* Tarih aralığı filtresi — GET formu (?from=&to=) + hızlı çipler; ?kategori= korunur */}
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted"><CalendarRange className="h-3.5 w-3.5" /> Tarih:</span>
        {presets.map((p) => {
          const active = fromF === p.from && toF === p.to;
          return (
            <Link
              key={p.label}
              href={href({ from: p.from, to: p.to })}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                active
                  ? "border-brand-400/50 bg-surface-accent-soft text-accent-text"
                  : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-accent-text"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
        <form action="/app/giderler" className="flex flex-wrap items-center gap-2">
          {kategoriF ? <input type="hidden" name="kategori" value={kategoriF} /> : null}
          <input
            name="from"
            type="date"
            defaultValue={fromF ?? ""}
            aria-label="Başlangıç tarihi"
            className="min-w-0 max-w-[140px] flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400 sm:flex-none"
          />
          <span className="text-xs text-text-faint">—</span>
          <input
            name="to"
            type="date"
            defaultValue={toF ?? ""}
            aria-label="Bitiş tarihi"
            className="min-w-0 max-w-[140px] flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400 sm:flex-none"
          />
          <button type="submit" className="rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700">
            Filtrele
          </button>
          {fromF || toF ? (
            <Link href={href({ from: null, to: null })} className="text-xs font-semibold text-text-muted hover:text-danger-strong">
              Tarihi temizle
            </Link>
          ) : null}
        </form>
      </div>

      {/* Ay karşılaştırması — bu ay vs geçen ay; kartlar tarih aralığını uygular */}
      {buAyTutar > 0 || gecenAyTutar > 0 ? (
        <section className="grid gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:grid-cols-[1fr_1fr_auto] sm:items-center">
          {[
            { label: buAyLabel, sub: "Bu ay", tutar: buAyTutar, preset: presets[0], bar: "bg-brand-600" },
            { label: gecenAyLabel, sub: "Geçen ay", tutar: gecenAyTutar, preset: presets[1], bar: "bg-brand-300" },
          ].map((m) => {
            const aktif = fromF === m.preset.from && toF === m.preset.to;
            return (
              <Link
                key={m.sub}
                href={href({ from: m.preset.from, to: m.preset.to })}
                aria-current={aktif ? "page" : undefined}
                className={`focus-ring press lift group block rounded-[var(--radius-card)] border p-3 transition hover:border-brand-300 ${
                  aktif ? "border-brand-400 bg-surface-accent-soft" : "border-line bg-surface"
                }`}
              >
                <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">
                  {m.sub} · {m.label}
                  <ArrowUpRight className="hover-action h-3 w-3 text-text-faint opacity-0 transition group-hover:text-accent-text group-hover:opacity-100" />
                </p>
                <p className="numeric mt-1 font-display text-xl font-extrabold text-text">{money(m.tutar)}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                  <div className={`h-full rounded-full ${m.bar}`} style={{ width: `${Math.round((m.tutar / kiyasMax) * 100)}%` }} />
                </div>
              </Link>
            );
          })}
          <div className="px-1 text-center sm:px-3">
            <p className="text-xs font-semibold uppercase tracking-[0.06em] text-text-faint">Aylık değişim</p>
            {aylikDegisim !== null ? (
              <p className={`mt-1 font-display text-xl font-extrabold ${aylikFark > 0 ? "text-danger-strong" : "text-success-strong"}`}>
                {aylikFark > 0 ? "+" : ""}%{Math.abs(aylikDegisim) > 999 ? "999+" : aylikDegisim}
              </p>
            ) : (
              <p className="mt-1 font-display text-xl font-extrabold text-text-faint">—</p>
            )}
            <p className="mt-0.5 text-xs text-text-muted">
              {aylikFark === 0 ? "Değişim yok" : `${money(Math.abs(aylikFark))} ${aylikFark > 0 ? "artış" : "azalış"}`}
            </p>
          </div>
        </section>
      ) : null}

      {/* Kategori özet — dağılım + aylık trend + kırılım kartları */}
      {activeCategories.length > 0 || hasTrend ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,340px)_minmax(0,340px)_1fr]">
          {activeCategories.length > 0 && barsMode ? (
            <ChartFrame
              title="Kategori dağılımı"
              subtitle={`${activeCategories.length} kalem · büyükten küçüğe · satıra tıklayın`}
              height={Math.max(250, activeCategories.length * 40 + 8)}
              className="lg:col-span-2 xl:col-span-2"
            >
              <CategoryBars
                items={activeCategories.map((c) => ({ value: c.value, label: c.label, total: c.total }))}
                activeValue={kategoriF}
                hrefFor={(v) => href({ kategori: v })}
                formatMoney={money}
              />
            </ChartFrame>
          ) : null}
          {activeCategories.length > 0 && !barsMode ? (
            <ChartFrame
              title="Kategori dağılımı"
              subtitle={fromF || toF ? "Seçili tarih aralığı · segmente tıklayın" : "Tüm gider kayıtları · segmente tıklayın"}
              height={250}
            >
              <DonutSplit data={categoryChart} format="money" centerLabel="Toplam gider" hrefKey="href" hint="Kategoriye süzmek için tıklayın" />
            </ChartFrame>
          ) : null}
          {hasTrend ? (
            <ChartFrame title="Aylık gider trendi" subtitle="Son 6 ay · filtrelerden bağımsız" height={250}>
              {/* Etkileşimli çizgi trend — crosshair + aylık tutar tooltip'i */}
              <InteractiveChart
                data={trendChart.map((t) => ({ label: t.ay, value: t.tutar }))}
                name="Gider"
                color="var(--brand-600)"
                format="money"
                height={210}
              />
            </ChartFrame>
          ) : null}
          {activeCategories.length > 0 && !barsMode ? (
            <div className="grid content-start grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-2 xl:col-span-1">
              {activeCategories.map((c) => {
                const active = kategoriF === c.value;
                return (
                  <Link
                    key={c.value}
                    href={href({ kategori: active ? null : c.value })}
                    aria-current={active ? "page" : undefined}
                    className={`focus-ring press lift group block rounded-[var(--radius-card)] border p-3 text-center transition ${
                      active ? "border-brand-400 bg-surface-accent-soft" : "border-line bg-surface hover:border-brand-300"
                    }`}
                  >
                    <p className="flex items-center justify-center gap-1 text-xs font-semibold text-text-muted">
                      {c.label}
                      <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-accent-text group-hover:opacity-100" />
                    </p>
                    <p className="mt-1 font-display text-base font-bold text-text">{money(c.total)}</p>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Yeni gider formu */}
      {canCreate && (
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
          <h2 className="mb-4 font-display font-bold text-text">Yeni Gider Ekle</h2>
          <ExpenseCreateForm
            categories={categories}
            defaultDate={new Date(nowMs()).toISOString().slice(0, 10)}
          />
        </section>
      )}

      {/* Aktif filtre çipleri */}
      {kategoriF || fromF || toF ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">Filtre:</span>
          {kategoriF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-accent-soft px-3 py-1 text-xs font-semibold text-accent-text">
              {catLabel(kategoriF)}
              <Link href={href({ kategori: null })} aria-label="Kategori filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : null}
          {fromF || toF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-accent-soft px-3 py-1 text-xs font-semibold text-accent-text">
              {fromF ? tarihKisa(fromF) : "…"} — {toF ? tarihKisa(toF) : "…"}
              <Link href={href({ from: null, to: null })} aria-label="Tarih filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : null}
          <span className="numeric text-xs text-text-faint">{filteredExpenses.length} kayıt</span>
        </div>
      ) : null}

      {/* Liste */}
      {expenses.length === 0 ? (
        fromF || toF ? (
          <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
            <Receipt className="h-8 w-8 text-text-faint" />
            <h2 className="mt-3 font-display text-lg font-bold text-text">Seçili tarih aralığında gider kaydı yok</h2>
            <Link href={href({ from: null, to: null })} className="mt-2 text-sm font-semibold text-accent-text hover:underline">
              Tarih filtresini temizle
            </Link>
          </div>
        ) : (
          <EmptyState illustration="komisyon"
            icon={Receipt}
            title="Henüz gider kaydı yok"
            description="Ofis giderlerinizi kategorilere göre ekleyin. Kayıtlar burada listelenir."
            tone="amber"
          />
        )
      ) : (
        <ExpensesTable
          expenses={tableExpenses}
          categories={categories}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      )}
      {expenses.length >= adet && adet < 1000 ? (
        <div className="text-center">
          <Link
            href={qs({ kategori: kategoriF || null, from: fromF, to: toF, adet: String(adet + 200) })}
            className="focus-ring inline-flex rounded-[var(--radius-control)] border border-line px-4 py-2 text-sm font-semibold text-accent-text hover:border-brand-300"
          >
            Daha fazla göster ({adet} kayıt gösteriliyor)
          </Link>
        </div>
      ) : null}
    </div>
  );
}
