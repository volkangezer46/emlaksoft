"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Paperclip, Receipt, SearchX, Trash2 } from "lucide-react";
import { expenseReceiptHref } from "@/lib/expense-receipts";
import { BulkRowCheckbox, BulkSelectAll, BulkSelectionProvider } from "@/components/app/bulk-selection";
import { ExpenseBulkBar } from "./expense-bulk-bar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableEmptyRow, TableFrame, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { ExpenseEditDialog, type Expense } from "./expense-edit-dialog";
import { deleteExpense } from "@/app/actions/expenses";
import { useToast } from "@/components/app/toast-provider";
import { formatDateTr } from "@/lib/format";

/**
 * Gider listesi — satıra tıklayınca düzenleme diyaloğu açılır.
 *
 * DataTable yerine yerel tablo: DataTable satır etkileşimi olarak yalnızca
 * `_href` (Link) destekliyor; "satır tıklaması → dialog" için satır onClick'i
 * gerekiyor. Arama + alt toplam burada korunuyor.
 */

type Category = { value: string; label: string };

const tryFormatter = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatDateTr(date);
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase("tr")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function ExpensesTable({
  expenses,
  categories,
  canEdit,
  canDelete,
  receiptUploads = false,
}: {
  expenses: Expense[];
  categories: readonly Category[];
  canEdit: boolean;
  canDelete: boolean;
  /** Fiş dosyası yükleme etkin mi (düzenleme panelinde). */
  receiptUploads?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Expense | null>(null);

  const catLabel = useMemo(() => {
    const map = new Map(categories.map((c) => [c.value, c.label]));
    return (v: string) => map.get(v) ?? v;
  }, [categories]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return expenses;
    return expenses.filter((e) =>
      [e.title, e.notes ?? "", catLabel(e.category)].some((text) => normalize(text).includes(q)),
    );
  }, [expenses, query, catLabel]);

  const total = filtered.reduce((s, e) => s + Number(e.amount), 0);
  const hasActions = canDelete;
  const selectable = canEdit || canDelete;
  const colCount = (hasActions ? 5 : 4) + (selectable ? 1 : 0);

  return (
    <BulkSelectionProvider>
    <div className="space-y-3">
      {selectable ? <ExpenseBulkBar categories={categories} canEdit={canEdit} canDelete={canDelete} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Gider başlığı veya kategori ara…"
          aria-label="Gider başlığı veya kategori ara…"
          className="focus-ring surface-sunken w-full max-w-xs rounded-[var(--radius-control)] border border-hairline px-3 py-2 text-sm outline-none transition focus:bg-surface"
        />
        <span className="numeric ml-auto text-xs font-medium tracking-wide text-text-faint" aria-live="polite">
          {filtered.length} kayıt
          {filtered.length !== expenses.length ? ` · ${expenses.length} içinden` : ""}
        </span>
      </div>

      <TableFrame minWidth={600}>
        <Table>
          <THead>
            <TR>
              {selectable ? (
                <TH className="w-10">
                  <BulkSelectAll ids={filtered.map((x) => x.id)} noun="gider" />
                </TH>
              ) : null}
              <TH>Başlık</TH>
              <TH className="hidden sm:table-cell">Kategori</TH>
              <TH align="right">Tutar</TH>
              <TH align="right" className="hidden sm:table-cell">Tarih</TH>
              {hasActions ? (
                <TH align="right" className="w-px">
                  <span className="sr-only">İşlemler</span>
                </TH>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {filtered.length === 0 ? (
              <TableEmptyRow colSpan={colCount}>
                <span className="inline-flex flex-col items-center gap-2">
                  <SearchX className="h-7 w-7 text-text-faint" />
                  <span className="font-semibold text-text">
                    {query ? "Aramanızla eşleşen kayıt yok" : "Kayıt yok"}
                  </span>
                  <span className="max-w-sm text-text-muted">Arama terimini değiştirip tekrar deneyin.</span>
                </span>
              </TableEmptyRow>
            ) : (
              filtered.map((e) => (
                <TR key={e.id} interactive={canEdit}>
                  {selectable ? (
                    <TD>
                      <BulkRowCheckbox id={e.id} label={`${e.title} giderini`} />
                    </TD>
                  ) : null}
                  <TD className="font-semibold text-text">
                    {canEdit ? (
                      // Satırı kaplayan görünmez buton — YALNIZ sm+. Mobilde abs katman
                      // iOS Safari'de yatay-kaydırılabilir tabloyu belge scroll'una
                      // promote edip sayfayı yana kaydırıyor; mobilde başlık tıklanır.
                      <button
                        type="button"
                        onClick={() => setEditing(e)}
                        className="absolute inset-0 hidden sm:block"
                        aria-label={`${e.title} giderini düzenle`}
                      />
                    ) : null}
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setEditing(e)}
                        className="text-left sm:pointer-events-none"
                      >
                        {e.title}
                      </button>
                    ) : (
                      e.title
                    )}
                    {e.notes ? (
                      <span className="mt-0.5 block text-xs font-normal text-text-faint">{e.notes}</span>
                    ) : null}
                    {e.property_id || e.receipt_url || e.receipt_file ? (
                      <span className="relative z-10 mt-1 flex flex-wrap items-center gap-3 text-xs font-normal">
                        {e.property_id ? (
                          <Link href={`/app/portfoyler/${e.property_id}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                            <Building2 className="h-3 w-3" /> {e.property_label ?? "Portföy"}
                          </Link>
                        ) : null}
                        {e.receipt_url ? (
                          <a href={e.receipt_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand-600 hover:underline">
                            <Receipt className="h-3 w-3" /> Fiş
                          </a>
                        ) : null}
                        {e.receipt_file ? (
                          <a href={expenseReceiptHref(e.receipt_file.id, "preview")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline" title={e.receipt_file.name}>
                            <Paperclip className="h-3 w-3" /> Fiş dosyası
                          </a>
                        ) : null}
                      </span>
                    ) : null}
                  </TD>
                  <TD className="hidden sm:table-cell">{catLabel(e.category)}</TD>
                  <TD align="right">{tryFormatter.format(Number(e.amount))}</TD>
                  <TD align="right" className="hidden sm:table-cell">{formatDate(e.expense_date)}</TD>
                  {hasActions ? (
                    <TD align="right" className="whitespace-nowrap">
                      <span className="relative z-10 inline-flex items-center gap-1">
                        <ConfirmDialog
                          title="Gideri sil"
                          description={`"${e.title}" kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
                          confirmLabel="Sil"
                          onConfirm={async () => {
                            const result = await deleteExpense(e.id);
                            if (result.error) {
                              push(result.error, "err");
                              return;
                            }
                            push("Gider silindi", "ok");
                            router.refresh();
                          }}
                          trigger={
                            <button
                              type="button"
                              className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-600"
                              aria-label={`${e.title} giderini sil`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          }
                        />
                      </span>
                    </TD>
                  ) : null}
                </TR>
              ))
            )}
          </TBody>
          {filtered.length > 0 ? (
            <TFoot>
              <TR>
                {selectable ? <TD /> : null}
                <TD>Toplam</TD>
                <TD className="hidden sm:table-cell" />
                <TD align="right">{tryFormatter.format(total)}</TD>
                <TD className="hidden sm:table-cell" />
                {hasActions ? <TD /> : null}
              </TR>
            </TFoot>
          ) : null}
        </Table>
      </TableFrame>

      {editing ? (
        <ExpenseEditDialog
          key={editing.id}
          expense={editing}
          categories={categories}
          receiptUploads={receiptUploads}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </div>
    </BulkSelectionProvider>
  );
}
