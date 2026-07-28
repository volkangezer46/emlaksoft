import Link from "next/link";
import { ArrowUpRight, CalendarRange, Receipt, Plus, X } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { exportExpensesCsv } from "@/app/actions/export";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { listExpenses, listExpenseMonthlyTrend } from "@/app/actions/expenses";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { getDefinitions } from "@/lib/definitions";
import { EmptyState } from "@/components/app/empty-state";
import { ChartFrame } from "@/app/app/_ui/lazy-chart";
import { InteractiveChart } from "@/components/app/interactive-chart";
import { CategoryDonut } from "./category-donut-lazy";
import { ExpensesTable } from "./expenses-table";

// Inline server action wrappers — void return için form action uyumlu
async function handleCreate(fd: FormData): Promise<void> {
  "use server";
  const { createExpense } = await import("@/app/actions/expenses");
  await createExpense({}, fd);
}

async function handleDelete(fd: FormData): Promise<void> {
  "use server";
  const id = String(fd.get("id") ?? "").trim();
  if (!id) return;
  const { deleteExpense: del } = await import("@/app/actions/expenses");
  await del(id);
}

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fmtDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  searchParams?: Promise<{ kategori?: string; from?: string; to?: string }>;
}) {
  const { perms } = await requireModulePage("expenses");
  const params = (await searchParams) ?? {};
  const fromF = ISO_DATE.test(params.from ?? "") ? params.from! : null;
  const toF = ISO_DATE.test(params.to ?? "") ? params.to! : null;

  const [expenses, catDefs, trendRows] = await Promise.all([
    // ?from=&to= sunucu tarafında uygulanır (expense_date aralığı)
    listExpenses(undefined, { from: fromF ?? undefined, to: toF ?? undefined }),
    getDefinitions("expense_category"),
    listExpenseMonthlyTrend(),
  ]);
  const canCreate = perms.expenses?.includes("create") ?? false;
  const canEdit = perms.expenses?.includes("edit") ?? false;
  const canDelete = perms.expenses?.includes("delete") ?? false;

  // DB-driven gider kategorileri (boşsa sabit yedeğe düş)
  const categories = catDefs.length > 0 ? catDefs.map((c) => ({ value: c.value, label: c.label })) : EXPENSE_CATEGORIES;
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

  // Hızlı tarih çipleri — sunucu saatine göre
  const now = new Date();
  const presets = [
    { label: "Bu ay", from: fmtDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: fmtDate(now) },
    { label: "Geçen ay", from: fmtDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: fmtDate(new Date(now.getFullYear(), now.getMonth(), 0)) },
    { label: "Son 3 ay", from: fmtDate(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: fmtDate(now) },
  ];

  // Özet/kırılım tarih aralığına saygılıdır; ?kategori= yalnızca listeyi süzer
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory = categories.map((c) => ({
    ...c,
    total: expenses.filter((e) => e.category === c.value).reduce((s, e) => s + Number(e.amount), 0),
  }));
  const activeCategories = byCategory.filter((c) => c.total > 0);
  const categoryChart = activeCategories
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ name: c.label, value: c.total, category: c.value }));

  // Son 6 ay trendi — filtrelerden bağımsız (YYYY-MM anahtarıyla toplanır)
  const monthKeys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const trendTotals = new Map(monthKeys.map((k) => [k, 0]));
  for (const row of trendRows) {
    const key = String(row.expense_date ?? "").slice(0, 7);
    if (trendTotals.has(key)) trendTotals.set(key, (trendTotals.get(key) ?? 0) + Number(row.amount));
  }
  const ayFmt = new Intl.DateTimeFormat("tr-TR", { month: "short" });
  const trendChart = monthKeys.map((k) => ({
    ay: ayFmt.format(new Date(`${k}-01T00:00:00`)),
    tutar: Math.round(trendTotals.get(k) ?? 0),
  }));
  const hasTrend = trendChart.some((t) => t.tutar > 0);

  // Ay karşılaştırması — içinde bulunulan ay vs önceki ay (filtrelerden bağımsız)
  const buAyKey = monthKeys[monthKeys.length - 1];
  const gecenAyKey = monthKeys[monthKeys.length - 2];
  const buAyTutar = Math.round(trendTotals.get(buAyKey) ?? 0);
  const gecenAyTutar = Math.round(trendTotals.get(gecenAyKey) ?? 0);
  const ayUzunFmt = new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" });
  const buAyLabel = ayUzunFmt.format(new Date(`${buAyKey}-01T00:00:00`));
  const gecenAyLabel = ayUzunFmt.format(new Date(`${gecenAyKey}-01T00:00:00`));
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
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-brand-300">
              <Receipt className="h-4 w-4" /> Gider takibi
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Masraf &amp; Giderler</h1>
            <p className="mt-1 text-sm text-white/75">Ofis giderlerini kategorilere göre takip edin.</p>
          </div>
          <div className="flex items-center gap-3">
            <ExportCsvButton
              action={exportExpensesCsv}
              label="Dışa aktar"
              className="focus-ring press inline-flex items-center gap-1.5 rounded-[11px] border border-white/12 bg-white/8 px-3.5 py-2.5 text-sm font-semibold text-white/80 backdrop-blur transition hover:border-white/30 hover:text-white disabled:opacity-50"
            />
            {/* KPI kartları tüm filtreleri temizleyip tam listeye döner */}
            <Link
              href="/app/giderler"
              className="focus-ring press lift group block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
            >
              <p className="flex items-center justify-center gap-1 font-display text-2xl font-extrabold text-white">
                {expenses.length}
                <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
              </p>
              <p className="text-[11px] text-white/70">Kayıt</p>
            </Link>
            <Link
              href="/app/giderler"
              className="focus-ring press lift group block rounded-[14px] border border-white/12 bg-white/8 p-3 text-center hover:border-white/30"
            >
              <p className="flex items-center justify-center gap-1 font-display text-xl font-extrabold text-white">
                {money(total)}
                <ArrowUpRight className="hover-action h-3.5 w-3.5 text-white/30 opacity-0 transition group-hover:text-white group-hover:opacity-100" />
              </p>
              <p className="text-[11px] text-white/70">Toplam gider</p>
            </Link>
          </div>
        </div>
      </section>

      {/* Tarih aralığı filtresi — GET formu (?from=&to=) + hızlı çipler; ?kategori= korunur */}
      <div className="flex flex-wrap items-center gap-2 rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-text-muted"><CalendarRange className="h-3.5 w-3.5" /> Tarih:</span>
        {presets.map((p) => {
          const active = fromF === p.from && toF === p.to;
          return (
            <Link
              key={p.label}
              href={href({ from: p.from, to: p.to })}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                active
                  ? "border-brand-400/50 bg-brand-600/10 text-brand-600"
                  : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
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
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
          />
          <span className="text-xs text-text-faint">—</span>
          <input
            name="to"
            type="date"
            defaultValue={toF ?? ""}
            aria-label="Bitiş tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
          />
          <button type="submit" className="rounded-[9px] bg-brand-600 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-brand-700">
            Filtrele
          </button>
          {fromF || toF ? (
            <Link href={href({ from: null, to: null })} className="text-[11px] font-semibold text-text-muted hover:text-danger-500">
              Tarihi temizle
            </Link>
          ) : null}
        </form>
      </div>

      {/* Ay karşılaştırması — bu ay vs geçen ay; kartlar tarih aralığını uygular */}
      {buAyTutar > 0 || gecenAyTutar > 0 ? (
        <section className="grid gap-3 rounded-[18px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:grid-cols-[1fr_1fr_auto] sm:items-center">
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
                className={`focus-ring press lift group block rounded-[14px] border p-3 transition hover:border-brand-300 ${
                  aktif ? "border-brand-400 bg-brand-600/5" : "border-line bg-surface"
                }`}
              >
                <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">
                  {m.sub} · {m.label}
                  <ArrowUpRight className="hover-action h-3 w-3 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </p>
                <p className="numeric mt-1 font-display text-xl font-extrabold text-ink-950">{money(m.tutar)}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
                  <div className={`h-full rounded-full ${m.bar}`} style={{ width: `${Math.round((m.tutar / kiyasMax) * 100)}%` }} />
                </div>
              </Link>
            );
          })}
          <div className="px-1 text-center sm:px-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-faint">Aylık değişim</p>
            {aylikDegisim !== null ? (
              <p className={`mt-1 font-display text-xl font-extrabold ${aylikFark > 0 ? "text-danger-500" : "text-mint-600"}`}>
                {aylikFark > 0 ? "+" : ""}%{Math.abs(aylikDegisim) > 999 ? "999+" : aylikDegisim}
              </p>
            ) : (
              <p className="mt-1 font-display text-xl font-extrabold text-text-faint">—</p>
            )}
            <p className="mt-0.5 text-[11px] text-text-muted">
              {aylikFark === 0 ? "Değişim yok" : `${money(Math.abs(aylikFark))} ${aylikFark > 0 ? "artış" : "azalış"}`}
            </p>
          </div>
        </section>
      ) : null}

      {/* Kategori özet — dağılım + aylık trend + kırılım kartları */}
      {activeCategories.length > 0 || hasTrend ? (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,340px)_minmax(0,340px)_1fr]">
          {activeCategories.length > 0 ? (
            <ChartFrame
              title="Kategori dağılımı"
              subtitle={fromF || toF ? "Seçili tarih aralığı · segmente tıklayın" : "Tüm gider kayıtları · segmente tıklayın"}
              height={250}
            >
              <CategoryDonut data={categoryChart} centerLabel="Toplam gider" />
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
          {activeCategories.length > 0 ? (
            <div className="grid content-start grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-2 xl:col-span-1">
              {activeCategories.map((c) => {
                const active = kategoriF === c.value;
                return (
                  <Link
                    key={c.value}
                    href={href({ kategori: active ? null : c.value })}
                    aria-current={active ? "page" : undefined}
                    className={`focus-ring press lift group block rounded-[16px] border p-3 text-center transition ${
                      active ? "border-brand-400 bg-brand-600/5" : "border-line bg-surface hover:border-brand-300"
                    }`}
                  >
                    <p className="flex items-center justify-center gap-1 text-xs font-semibold text-text-muted">
                      {c.label}
                      <ArrowUpRight className="hover-action h-3.5 w-3.5 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                    </p>
                    <p className="mt-1 font-display text-base font-bold text-ink-950">{money(c.total)}</p>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Yeni gider formu */}
      {canCreate && (
        <section className="rounded-[20px] border border-line bg-surface p-5">
          <h2 className="mb-4 font-display font-bold text-ink-950">Yeni Gider Ekle</h2>
          <form action={handleCreate} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input name="title" required placeholder="Başlık" className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
            <input name="amount" type="number" min="0" step="0.01" required placeholder="Tutar (TRY)" className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
            <select name="category" className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300">
              {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <input name="expense_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
            <input name="notes" placeholder="Not (opsiyonel)" className="sm:col-span-2 rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300" />
            <button type="submit" className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 sm:col-span-2">
              <Plus className="h-4 w-4" /> Kaydet
            </button>
          </form>
        </section>
      )}

      {/* Aktif filtre çipleri */}
      {kategoriF || fromF || toF ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">Filtre:</span>
          {kategoriF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1 text-xs font-semibold text-brand-700">
              {catLabel(kategoriF)}
              <Link href={href({ kategori: null })} aria-label="Kategori filtresini temizle" className="focus-ring rounded-full hover:text-brand-900">
                <X className="h-3.5 w-3.5" />
              </Link>
            </span>
          ) : null}
          {fromF || toF ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1 text-xs font-semibold text-brand-700">
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
          <div className="grid place-items-center rounded-[18px] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
            <Receipt className="h-8 w-8 text-text-faint" />
            <h2 className="mt-3 font-display text-lg font-bold text-ink-950">Seçili tarih aralığında gider kaydı yok</h2>
            <Link href={href({ from: null, to: null })} className="mt-2 text-sm font-semibold text-brand-600 hover:underline">
              Tarih filtresini temizle
            </Link>
          </div>
        ) : (
          <EmptyState
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
          deleteAction={handleDelete}
        />
      )}
    </div>
  );
}
