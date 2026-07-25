import { Receipt, Plus, Trash2 } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listExpenses } from "@/app/actions/expenses";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { getDefinitions } from "@/lib/definitions";
import { EmptyState } from "@/components/app/empty-state";
import { ChartFrame, DonutSplit } from "@/components/ui/chart";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";
import { ExpenseEditDialog } from "./expense-edit-dialog";

// Inline server action wrappers — void return için form action uyumlu
async function handleCreate(fd: FormData): Promise<void> {
  "use server";
  const { createExpense } = await import("@/app/actions/expenses");
  await createExpense({}, fd);
}

async function handleDelete(id: string, _fd: FormData): Promise<void> {
  "use server";
  const { deleteExpense: del } = await import("@/app/actions/expenses");
  await del(id);
}

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

export default async function GiderlerPage() {
  const { perms } = await requireModulePage("expenses");
  const [expenses, catDefs] = await Promise.all([listExpenses(), getDefinitions("expense_category")]);
  const canCreate = perms.expenses?.includes("create") ?? false;
  const canEdit = perms.expenses?.includes("edit") ?? false;
  const canDelete = perms.expenses?.includes("delete") ?? false;

  // DB-driven gider kategorileri (boşsa sabit yedeğe düş)
  const categories = catDefs.length > 0 ? catDefs.map((c) => ({ value: c.value, label: c.label })) : EXPENSE_CATEGORIES;
  const catLabel = (v: string) => categories.find((c) => c.value === v)?.label ?? v;

  const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const byCategory = categories.map((c) => ({
    ...c,
    total: expenses.filter((e) => e.category === c.value).reduce((s, e) => s + Number(e.amount), 0),
  }));
  const activeCategories = byCategory.filter((c) => c.total > 0);
  const categoryChart = activeCategories
    .sort((a, b) => b.total - a.total)
    .map((c) => ({ name: c.label, value: c.total }));

  const EXPENSE_COLUMNS: DataTableColumn[] = [
    { key: "title", header: "Başlık", sortable: true, subtitleKey: "notes" },
    { key: "category", header: "Kategori", sortable: true },
    { key: "amount", header: "Tutar", format: "money", align: "right", sortable: true, total: true },
    { key: "expense_date", header: "Tarih", format: "date", align: "right", sortable: true },
  ];

  const expenseRows: DataTableRow[] = expenses.map((e) => ({
    id:           e.id,
    title:        e.title,
    notes:        e.notes,
    category:     catLabel(e.category),
    amount:       Number(e.amount),
    expense_date: e.expense_date,
  }));

  // Satır aksiyonları sunucuda render edilip DataTable'a ELEMENT olarak
  // geçiyor. Fonksiyon geçirilemez ama React elementi RSC payload'ında taşınır.
  const expenseActions: Record<string, React.ReactNode> = Object.fromEntries(
    expenses.map((e) => [
      e.id,
      <>
        {canEdit && (
          <ExpenseEditDialog
            expense={{ id: e.id, title: e.title, amount: Number(e.amount), category: e.category, expense_date: e.expense_date, notes: e.notes }}
            categories={categories}
          />
        )}
        {canDelete && (
          <form action={handleDelete.bind(null, e.id) as (fd: FormData) => Promise<void>}>
            <button
              type="submit"
              className="focus-ring press grid h-7 w-7 place-items-center rounded-[7px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-600"
              aria-label={`${e.title} giderini sil`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </form>
        )}
      </>,
    ]),
  );

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
          <div className="flex gap-3">
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-2xl font-extrabold text-white">{expenses.length}</p>
              <p className="text-[10px] text-white/70">Kayıt</p>
            </div>
            <div className="rounded-[14px] border border-white/12 bg-white/8 p-3 text-center">
              <p className="font-display text-xl font-extrabold text-white">{money(total)}</p>
              <p className="text-[10px] text-white/70">Toplam gider</p>
            </div>
          </div>
        </div>
      </section>

      {/* Kategori özet — dağılım grafiği + kırılım kartları */}
      {activeCategories.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_1fr]">
          <ChartFrame title="Kategori dağılımı" subtitle="Tüm gider kayıtları" height={250}>
            <DonutSplit data={categoryChart} format="money" centerLabel="Toplam gider" />
          </ChartFrame>
          <div className="grid content-start grid-cols-2 gap-3 sm:grid-cols-3">
            {activeCategories.map((c) => (
              <div key={c.value} className="rounded-[16px] border border-line bg-surface p-3 text-center">
                <p className="text-xs font-semibold text-text-muted">{c.label}</p>
                <p className="mt-1 font-display text-base font-bold text-ink-950">{money(c.total)}</p>
              </div>
            ))}
          </div>
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

      {/* Liste */}
      {expenses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Henüz gider kaydı yok"
          description="Ofis giderlerinizi kategorilere göre ekleyin. Kayıtlar burada listelenir."
          tone="amber"
        />
      ) : (
        <DataTable
          columns={EXPENSE_COLUMNS}
          rows={expenseRows}
          rowActions={expenseActions}
          showTotals
          minWidth={600}
          searchPlaceholder="Gider başlığı veya kategori ara…"
          empty={{ description: "Arama terimini değiştirip tekrar deneyin." }}
        />
      )}
    </div>
  );
}
