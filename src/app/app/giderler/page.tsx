import { Receipt, Plus, Trash2 } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { listExpenses } from "@/app/actions/expenses";
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories";
import { getDefinitions } from "@/lib/definitions";
import { EmptyState } from "@/components/app/empty-state";
import { ChartFrame, DonutSplit } from "@/components/ui/chart";
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
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="border-b border-line bg-canvas/80 text-text-muted">
                <tr>
                  <th className="px-5 py-3 font-semibold">Başlık</th>
                  <th className="px-4 py-3 font-semibold">Kategori</th>
                  <th className="px-4 py-3 font-semibold">Tutar</th>
                  <th className="px-4 py-3 font-semibold">Tarih</th>
                  <th className="px-4 py-3 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0 hover:bg-canvas/40">
                    <td className="px-5 py-3 font-semibold text-ink-950">{e.title}</td>
                    <td className="px-4 py-3 text-text-muted">{catLabel(e.category)}</td>
                    <td className="px-4 py-3 font-bold text-ink-950">{money(Number(e.amount))}</td>
                    <td className="px-4 py-3 text-text-muted">{new Date(e.expense_date).toLocaleDateString("tr-TR")}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <ExpenseEditDialog
                            expense={{ id: e.id, title: e.title, amount: Number(e.amount), category: e.category, expense_date: e.expense_date, notes: e.notes }}
                            categories={categories}
                          />
                        )}
                        {canDelete && (
                          <form action={handleDelete.bind(null, e.id) as (fd: FormData) => Promise<void>}>
                            <button type="submit" className="grid h-7 w-7 place-items-center rounded-[7px] text-text-faint transition hover:bg-red-50 hover:text-red-600" aria-label="Sil">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
