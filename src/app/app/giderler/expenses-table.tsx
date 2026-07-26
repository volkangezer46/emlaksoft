"use client";

import { useMemo, useState } from "react";
import { SearchX, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Table, TableEmptyRow, TableFrame, TBody, TD, TFoot, TH, THead, TR } from "@/components/ui/table";
import { ExpenseEditDialog, type Expense } from "./expense-edit-dialog";

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
  return date.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
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
  deleteAction,
}: {
  expenses: Expense[];
  categories: readonly Category[];
  canEdit: boolean;
  canDelete: boolean;
  deleteAction: (fd: FormData) => Promise<void>;
}) {
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

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Gider başlığı veya kategori ara…"
          aria-label="Gider başlığı veya kategori ara…"
          className="focus-ring surface-sunken w-full max-w-xs rounded-[10px] border border-hairline px-3 py-2 text-sm outline-none transition focus:bg-surface"
        />
        <span className="numeric ml-auto text-[11px] font-medium tracking-wide text-text-faint" aria-live="polite">
          {filtered.length} kayıt
          {filtered.length !== expenses.length ? ` · ${expenses.length} içinden` : ""}
        </span>
      </div>

      <TableFrame minWidth={600}>
        <Table>
          <THead>
            <TR>
              <TH>Başlık</TH>
              <TH>Kategori</TH>
              <TH align="right">Tutar</TH>
              <TH align="right">Tarih</TH>
              {hasActions ? (
                <TH align="right" className="w-px">
                  <span className="sr-only">İşlemler</span>
                </TH>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {filtered.length === 0 ? (
              <TableEmptyRow colSpan={hasActions ? 5 : 4}>
                <span className="inline-flex flex-col items-center gap-2">
                  <SearchX className="h-7 w-7 text-text-faint" />
                  <span className="font-semibold text-ink-950">
                    {query ? "Aramanızla eşleşen kayıt yok" : "Kayıt yok"}
                  </span>
                  <span className="max-w-sm text-text-muted">Arama terimini değiştirip tekrar deneyin.</span>
                </span>
              </TableEmptyRow>
            ) : (
              filtered.map((e) => (
                <TR key={e.id} interactive={canEdit}>
                  <TD className="font-semibold text-ink-950">
                    {canEdit ? (
                      // Satırı kaplayan görünmez buton: tıklama düzenleme diyaloğunu açar
                      // (DataTable'daki absolute-inset Link deseninin buton karşılığı)
                      <button
                        type="button"
                        onClick={() => setEditing(e)}
                        className="absolute inset-0"
                        aria-label={`${e.title} giderini düzenle`}
                      />
                    ) : null}
                    {e.title}
                    {e.notes ? (
                      <span className="mt-0.5 block text-[11px] font-normal text-text-faint">{e.notes}</span>
                    ) : null}
                  </TD>
                  <TD>{catLabel(e.category)}</TD>
                  <TD align="right">{tryFormatter.format(Number(e.amount))}</TD>
                  <TD align="right">{formatDate(e.expense_date)}</TD>
                  {hasActions ? (
                    <TD align="right" className="whitespace-nowrap">
                      <span className="relative z-10 inline-flex items-center gap-1">
                        <ConfirmDialog
                          title="Gideri sil"
                          description={`"${e.title}" kaydı kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
                          confirmLabel="Sil"
                          formAction={deleteAction}
                          hiddenFields={{ id: e.id }}
                          trigger={
                            <button
                              type="button"
                              className="focus-ring press grid h-7 w-7 min-h-9 min-w-9 place-items-center rounded-[7px] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-600"
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
                <TD>Toplam</TD>
                <TD />
                <TD align="right">{tryFormatter.format(total)}</TD>
                <TD />
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
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}
