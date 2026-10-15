"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ClipboardPaste, Copy, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import { recordCashEntry } from "@/app/actions/finance-accounts";
import { recordEntryV2 } from "@/app/actions/finance-ledger";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { now as nowMs } from "@/lib/clock";
import { parseAmountShorthand } from "@/lib/finance/amount-shorthand";
import { SALARY_CATEGORY, expenseCategoryFor } from "@/lib/finance/cash/categories";
import { formatAccountMoney } from "@/lib/finance/cash/money";
import {
  BULK_MAX_ROWS,
  bulkTotals,
  draftKey,
  emptyBulkRow,
  findDuplicates,
  parseBulkPaste,
  validateBulkRow,
  type BulkCategory,
  type BulkRow,
  type BulkRowError,
} from "@/lib/finance/entry-workspace";
import { LEDGER_VAT_RATES } from "@/lib/finance/ledger/vat";
import { cn } from "@/lib/utils";
import type { EntryFormContext } from "./entry-form";
import { Section } from "./entry-ui";

/**
 * Toplu giriş: çok satırlı tablo. Excel/Sheets'ten kopyalanan satırlar (sekme), TR CSV (;) ya da EN CSV (,) yapıştırılabilir;
 * başlık satırı varsa sütunlar adla, yoksa hücre türüyle eşlenir. Her satır yazarken doğrulanır (tutar, tarih, kategori);
 * "Tümünü kaydet" yalnız geçerli satırları sırayla mevcut eylemlerle yazar (ofis → recordEntryV2, kişisel → recordCashEntry),
 * başarısız satır hatasıyla tabloda kalır. Satırlar taslak olarak bu cihazda saklanır.
 */

type RowStatus = { state: "saved" } | { state: "error"; message: string };

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* saklanamadı: sorun değil */
  }
}

const noopSubscribe = () => () => undefined;

const cellCls =
  "h-10 w-full min-w-0 rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-sm text-text outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-500/30 touch:h-11 aria-[invalid=true]:border-danger-400";

export function BulkEntry({ ctx, hidden }: { ctx: EntryFormContext; hidden?: boolean }) {
  const router = useRouter();
  const { push } = useToast();
  const { today, office } = ctx;
  const categories = useMemo<BulkCategory[]>(
    () => ctx.categories.filter((c) => ctx.canSalary || c.value !== SALARY_CATEGORY).map((c) => ({ value: c.value, label: c.label, direction: c.direction })),
    [ctx.categories, ctx.canSalary],
  );
  const accountOptions = ctx.accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})`, hint: a.scope === "office" ? "Ofis hesabı" : "Kişisel hesabım" }));
  const seq = useRef(0);
  const nextKey = () => `b${++seq.current}`;
  const dKey = draftKey(ctx.userId, ctx.personal, "toplu");

  const [rows, setRows] = useState<BulkRow[]>(() => [emptyBulkRow("b0", today, "out")]);
  const [accountId, setAccountId] = useState(() => (ctx.accounts.find((a) => a.scope === "office" && a.kind === "cash") ?? ctx.accounts[0])?.id ?? "");
  const [vatIncluded, setVatIncluded] = useState(ctx.vatIncludedDefault);
  const [pasteText, setPasteText] = useState("");
  const [status, setStatus] = useState<Record<string, RowStatus>>({});
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draftHandled, setDraftHandled] = useState(false);

  const account = ctx.accounts.find((a) => a.id === accountId);
  const officeMode = office && account?.scope !== "user";
  const currency = account?.currency ?? "TRY";
  const totals = bulkTotals(rows, today, categories);
  const errorsOf = (r: BulkRow): BulkRowError[] => validateBulkRow(r, today, categories);
  const hasContent = rows.some((r) => r.amountText || r.title || r.counterparty);

  // Taslak: satırlar her değişiklikte (gecikmeli) yerel olarak saklanır; açılışta "Geri yükle" önerilir.
  const storedRaw = useSyncExternalStore(noopSubscribe, () => readStorage(dKey), () => null);
  const stored = useMemo(() => {
    if (draftHandled || hasContent || !storedRaw) return null;
    try {
      const d = JSON.parse(storedRaw) as { rows?: BulkRow[] };
      return Array.isArray(d.rows) && d.rows.length > 0 ? d.rows.slice(0, BULK_MAX_ROWS) : null;
    } catch {
      return null;
    }
  }, [draftHandled, hasContent, storedRaw]);
  const rowsJson = JSON.stringify(rows);
  useEffect(() => {
    if (!hasContent) return;
    const timer = window.setTimeout(() => writeStorage(dKey, JSON.stringify({ rows: JSON.parse(rowsJson), savedAt: nowMs() })), 800);
    return () => window.clearTimeout(timer);
  }, [rowsJson, hasContent, dKey]);

  function update(key: string, patch: Partial<BulkRow>) {
    setRows((list) =>
      list.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // Yön değişince yönle uyuşmayan kategori temizlenir.
        if (patch.direction && !categories.some((c) => c.value === next.category && c.direction === next.direction)) next.category = "";
        return next;
      }),
    );
    setStatus((s) => {
      if (!s[key]) return s;
      const copy = { ...s };
      delete copy[key];
      return copy;
    });
  }

  function addRows(parsed: BulkRow[], replaceKey?: string) {
    if (parsed.length === 0) {
      push("Yapıştırılan metinde satır bulunamadı.", "err");
      return;
    }
    const withKeys = parsed.map((r) => ({ ...r, key: nextKey() }));
    setRows((list) => {
      const base = list.filter((r) => r.amountText || r.title || r.counterparty || r.key === replaceKey);
      const idx = replaceKey ? base.findIndex((r) => r.key === replaceKey) : -1;
      const merged = idx >= 0 ? [...base.slice(0, idx), ...withKeys, ...base.slice(idx + 1)] : [...base, ...withKeys];
      return merged.slice(0, BULK_MAX_ROWS);
    });
    push(`${parsed.length} satır eklendi; kontrol edip kaydedin.`, "ok");
  }

  function parse(text: string) {
    return parseBulkPaste(text, { categories, today, defaultDirection: "out", keyPrefix: "p" });
  }

  function onCellPaste(e: React.ClipboardEvent<HTMLInputElement>, key: string) {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\t\n]/.test(text.trim())) return;
    e.preventDefault();
    addRows(parse(text), key);
  }

  function addEmpty() {
    const last = rows[rows.length - 1];
    setRows((list) => [...list, emptyBulkRow(nextKey(), last?.date ?? today, last?.direction ?? "out")].slice(0, BULK_MAX_ROWS));
  }

  function duplicateRow(r: BulkRow) {
    setRows((list) => {
      const i = list.findIndex((x) => x.key === r.key);
      const copy = { ...r, key: nextKey() };
      return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)].slice(0, BULK_MAX_ROWS);
    });
  }

  function remove(key: string) {
    setRows((list) => (list.length > 1 ? list.filter((r) => r.key !== key) : [emptyBulkRow(nextKey(), today, "out")]));
  }

  async function saveAll() {
    if (busy) return;
    setShowErrors(true);
    if (!accountId) {
      push("Kayıtların yazılacağı hesabı seçin.", "err");
      document.getElementById("bk-account")?.focus();
      return;
    }
    const valid = rows.filter((r) => (r.amountText || r.title) && errorsOf(r).length === 0 && status[r.key]?.state !== "saved");
    if (valid.length === 0) {
      push("Kaydedilecek geçerli satır yok; kırmızı alanları düzeltin.", "err");
      return;
    }
    setBusy(true);
    let saved = 0;
    const next: Record<string, RowStatus> = { ...status };
    for (const r of valid) {
      const amount = parseAmountShorthand(r.amountText)!;
      const meta = ctx.categories.find((c) => c.value === r.category && c.direction === r.direction);
      let err: string | null = null;
      if (officeMode) {
        const expenseCategory = r.direction === "out" && r.category !== SALARY_CATEGORY ? (meta?.expenseCategory ?? expenseCategoryFor(r.category)) : null;
        const res = await recordEntryV2({
          accountId,
          direction: r.direction,
          amount,
          entryDate: r.date,
          category: r.category,
          title: r.title.trim() || null,
          counterparty: r.counterparty.trim() || null,
          vatRate: r.vatRate,
          vatIncluded,
          createExpense: expenseCategory !== null,
          expenseCategory,
        });
        err = res.ok ? null : res.error;
      } else {
        const res = await recordCashEntry(r.direction, {
          accountId,
          amount: String(amount),
          category: r.category,
          title: r.title.trim(),
          date: r.date,
          counterparty: r.counterparty.trim(),
          note: "",
        });
        err = res.error ?? (res.ok === false ? "Kaydedilemedi." : null);
      }
      if (err) next[r.key] = { state: "error", message: err };
      else {
        next[r.key] = { state: "saved" };
        saved++;
      }
    }
    setStatus(next);
    setBusy(false);
    const failed = valid.length - saved;
    if (saved > 0) push(`${saved} kayıt eklendi${failed ? `, ${failed} satır kaydedilemedi` : ""}.`, failed ? "err" : "ok");
    else push("Satırlar kaydedilemedi; hataları kontrol edin.", "err");
    // Kaydedilen satırlar listeden çıkar; hatalılar düzeltilmek üzere kalır.
    const remaining = rows.filter((r) => next[r.key]?.state !== "saved");
    if (remaining.length === 0) {
      writeStorage(dKey, null);
      router.push(ctx.returnHref);
      return;
    }
    setRows(remaining);
  }

  const dupOf = (r: BulkRow) => {
    const amount = parseAmountShorthand(r.amountText);
    return amount ? findDuplicates({ direction: r.direction, cash: amount, date: r.date, counterparty: r.counterparty || null, category: r.category || null }, ctx.recent)[0] : undefined;
  };

  return (
    <div hidden={hidden} className="grid gap-4">
      {stored ? (
        <div role="status" className="tone-info flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">Kaydedilmemiş {stored.length} satırlık bir toplu giriş taslağınız var.</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setRows(stored.map((r) => ({ ...r, key: nextKey() })));
              setDraftHandled(true);
            }}
          >
            Geri yükle
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            onClick={() => {
              writeStorage(dKey, null);
              setDraftHandled(true);
            }}
          >
            Sil
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Section title="Excel'den yapıştırın" icon={ClipboardPaste} description="Satırları Excel, Google E-Tablolar ya da CSV'den kopyalayın. Başlık satırı (Tarih, Tür, Tutar, Kategori, Açıklama, Cari, KDV) varsa sütunlar adla eşlenir.">
          <FormField label="Yapıştırılacak satırlar" htmlFor="bk-paste" hint="Bir tablo hücresine de doğrudan yapıştırabilirsiniz; satırlar oradan itibaren eklenir.">
            <FormTextarea
              id="bk-paste"
              rows={3}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={"01.10.2026\tGider\t12.500\tKira\tEkim kirası\n03.10.2026\tGelir\t48.000\tKomisyon\tSatış"}
              className="font-mono text-xs"
            />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={ClipboardPaste}
              disabled={!pasteText.trim()}
              onClick={() => {
                addRows(parse(pasteText));
                setPasteText("");
              }}
            >
              Satırlara ekle
            </Button>
          </div>
        </Section>

        <Section title="Hesap ve varsayılanlar" icon={Save}>
          <FormField label="Hangi hesaba yazılsın?" htmlFor="bk-account" required>
            <Combobox id="bk-account" value={accountId} onValueChange={setAccountId} required options={accountOptions} placeholder="Hesap seçin" searchPlaceholder="Hesap ara…" emptyText="Eşleşen hesap yok" />
          </FormField>
          {officeMode ? (
            <FormField label="KDV oranı girilen satırlarda tutar" htmlFor="bk-vat-incl">
              <FormSelect id="bk-vat-incl" value={vatIncluded ? "1" : "0"} onChange={(e) => setVatIncluded(e.target.value === "1")}>
                <option value="1">KDV dahil</option>
                <option value="0">KDV hariç</option>
              </FormSelect>
            </FormField>
          ) : null}
          <dl className="numeric grid grid-cols-3 gap-2 text-center text-xs" aria-live="polite">
            <div className="rounded-[var(--radius-control)] bg-canvas p-2">
              <dt className="text-text-muted">Gelir</dt>
              <dd className="font-bold text-success-strong">{formatAccountMoney(totals.income, currency)}</dd>
            </div>
            <div className="rounded-[var(--radius-control)] bg-canvas p-2">
              <dt className="text-text-muted">Gider</dt>
              <dd className="font-bold text-danger-strong">{formatAccountMoney(totals.expense, currency)}</dd>
            </div>
            <div className="rounded-[var(--radius-control)] bg-canvas p-2">
              <dt className="text-text-muted">Net</dt>
              <dd className="font-bold text-text">{formatAccountMoney(totals.net, currency)}</dd>
            </div>
          </dl>
          <p className="text-xs text-text-muted">
            {totals.valid} geçerli satır{totals.invalid > 0 ? ` · ${totals.invalid} satırda eksik/hatalı alan` : ""}. En çok {BULK_MAX_ROWS} satır.
          </p>
        </Section>
      </div>

      <section aria-label="Toplu giriş satırları" className="rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--elev-1)]">
        <div className="hidden grid-cols-[8.5rem_6.5rem_8rem_minmax(8rem,1fr)_minmax(8rem,1.4fr)_minmax(7rem,1fr)_5rem_4.5rem] gap-2 border-b border-line px-3 py-2 text-xs font-semibold text-text-muted lg:grid">
          <span>Tarih</span>
          <span>Tür</span>
          <span>Tutar</span>
          <span>Kategori</span>
          <span>Açıklama</span>
          <span>Karşı taraf</span>
          <span>{officeMode ? "KDV" : ""}</span>
          <span className="sr-only">Satır eylemleri</span>
        </div>
        <ol className="divide-y divide-line">
          {rows.map((r, i) => {
            const errs = showErrors || r.amountText ? errorsOf(r) : [];
            const has = (f: BulkRowError["field"]) => errs.some((e) => e.field === f);
            const st = status[r.key];
            const dup = dupOf(r);
            const errId = `bk-err-${r.key}`;
            return (
              <li key={r.key} className={cn("px-3 py-2", st?.state === "error" && "bg-danger-500/5")}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-[8.5rem_6.5rem_8rem_minmax(8rem,1fr)_minmax(8rem,1.4fr)_minmax(7rem,1fr)_5rem_4.5rem] lg:items-center">
                  <input
                    type="date"
                    aria-label={`${i + 1}. satır tarihi`}
                    className={cellCls}
                    value={/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : ""}
                    max={today}
                    aria-invalid={has("date") || undefined}
                    aria-describedby={errs.length ? errId : undefined}
                    onChange={(e) => update(r.key, { date: e.target.value })}
                  />
                  <select aria-label={`${i + 1}. satır türü`} className={cellCls} value={r.direction} onChange={(e) => update(r.key, { direction: e.target.value === "in" ? "in" : "out" })}>
                    <option value="out">Gider</option>
                    <option value="in">Gelir</option>
                  </select>
                  <input
                    aria-label={`${i + 1}. satır tutarı`}
                    className={cn(cellCls, "numeric text-right font-semibold")}
                    inputMode="decimal"
                    placeholder="0,00"
                    value={r.amountText}
                    aria-invalid={has("amount") || undefined}
                    aria-describedby={errs.length ? errId : undefined}
                    onPaste={(e) => onCellPaste(e, r.key)}
                    onChange={(e) => update(r.key, { amountText: e.target.value })}
                  />
                  <select
                    aria-label={`${i + 1}. satır kategorisi`}
                    className={cellCls}
                    value={r.category}
                    aria-invalid={has("category") || undefined}
                    aria-describedby={errs.length ? errId : undefined}
                    onChange={(e) => update(r.key, { category: e.target.value })}
                  >
                    <option value="">Kategori…</option>
                    {categories
                      .filter((c) => c.direction === r.direction)
                      .map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                  </select>
                  <input
                    aria-label={`${i + 1}. satır açıklaması`}
                    className={cn(cellCls, "col-span-2 sm:col-span-1")}
                    maxLength={160}
                    placeholder="Açıklama"
                    value={r.title}
                    onPaste={(e) => onCellPaste(e, r.key)}
                    onChange={(e) => update(r.key, { title: e.target.value })}
                  />
                  <input
                    aria-label={`${i + 1}. satır karşı tarafı`}
                    className={cellCls}
                    maxLength={120}
                    placeholder="Karşı taraf"
                    value={r.counterparty}
                    onChange={(e) => update(r.key, { counterparty: e.target.value })}
                  />
                  {officeMode ? (
                    <select aria-label={`${i + 1}. satır KDV oranı`} className={cellCls} value={r.vatRate == null ? "" : String(r.vatRate)} onChange={(e) => update(r.key, { vatRate: e.target.value === "" ? null : Number(e.target.value) })}>
                      <option value="">Yok</option>
                      {LEDGER_VAT_RATES.filter((v) => v > 0).map((v) => (
                        <option key={v} value={v}>
                          %{v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="hidden lg:block" />
                  )}
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="icon" icon={Copy} onClick={() => duplicateRow(r)} aria-label={`${i + 1}. satırı çoğalt`} title="Çoğalt" />
                    <Button variant="ghost" size="icon" icon={Trash2} onClick={() => remove(r.key)} aria-label={`${i + 1}. satırı sil`} title="Sil" className="hover:text-danger-600" />
                  </div>
                </div>
                {errs.length > 0 || st?.state === "error" || dup ? (
                  <p id={errId} className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                    {errs.map((e) => (
                      <span key={e.field} className="font-medium text-danger-600">
                        {e.message}
                      </span>
                    ))}
                    {st?.state === "error" ? <span className="font-medium text-danger-600">Kaydedilemedi: {st.message}</span> : null}
                    {dup ? (
                      <span className="inline-flex items-center gap-1 font-medium text-warning-strong">
                        <TriangleAlert className="h-3 w-3" aria-hidden="true" /> Olası mükerrer: {dup.reason.toLocaleLowerCase("tr-TR")}
                      </span>
                    ) : null}
                  </p>
                ) : st?.state === "saved" ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-success-strong">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Kaydedildi
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-3">
          <Button variant="secondary" icon={Plus} onClick={addEmpty} disabled={rows.length >= BULK_MAX_ROWS}>
            Satır ekle
          </Button>
          <span className="flex-1" />
          <Button variant="primary" size="lg" icon={Save} loading={busy} onClick={saveAll} disabled={totals.valid === 0}>
            {busy ? "Kaydediliyor…" : `Tümünü kaydet (${totals.valid})`}
          </Button>
        </div>
      </section>
    </div>
  );
}
