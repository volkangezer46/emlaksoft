"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, Plus } from "lucide-react";
import { LocalReceiptPreview, RECEIPT_ACCEPT, receiptClientError, uploadExpenseReceipt } from "./expense-receipt-file";
import { createExpense, type ExpenseResult } from "@/app/actions/expenses";
import { useToast } from "@/components/app/toast-provider";
import { Combobox } from "@/components/ui/combobox";
import { searchProperties } from "@/app/actions/lookup";

type Category = { value: string; label: string };

const inputClass =
  "rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300";

export function ExpenseCreateForm({
  categories,
  defaultDate,
  defaultProperty = null,
  receiptUploads = false,
}: {
  categories: readonly Category[];
  defaultDate: string;
  /** Portföy detayından gelen ön seçim (?portfoy=). */
  defaultProperty?: { value: string; label: string } | null;
  /** Fiş DOSYASI yükleme etkin mi (20261007000700 uygulanmış + yetki). Kapalıysa yalnız https bağlantı alanı. */
  receiptUploads?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { push } = useToast();
  const [receipt, setReceipt] = useState<{ file: File; url: string | null } | null>(null);

  function clearReceipt() {
    if (receipt?.url) URL.revokeObjectURL(receipt.url);
    setReceipt(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function onReceiptPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (receipt?.url) URL.revokeObjectURL(receipt.url);
    if (!file) return setReceipt(null);
    const problem = receiptClientError(file);
    if (problem) {
      push(problem, "err");
      e.target.value = "";
      return setReceipt(null);
    }
    setReceipt({ file, url: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
  }

  const [state, action, pending] = useActionState<ExpenseResult, FormData>(
    async (previous, formData) => {
      const result = await createExpense(previous, formData);
      if (result.ok) {
        // Gider kaydı önce yazılır; fiş dosyası ardından güvenli hattan bu gidere yüklenir.
        if (receipt && result.id) {
          const uploaded = await uploadExpenseReceipt(result.id, receipt.file);
          if (uploaded.ok) push("Gider ve fiş dosyası kaydedildi", "ok");
          else push(`Gider kaydedildi; fiş yüklenemedi: ${uploaded.error}`, "err");
        } else {
          push("Gider kaydedildi", "ok");
        }
        formRef.current?.reset();
        clearReceipt();
        router.refresh();
      }
      return result;
    },
    {},
  );

  return (
    <form
      ref={formRef}
      action={action}
      aria-busy={pending}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
    >
      <label htmlFor="expense-title" className="sr-only">Gider başlığı</label>
      <input id="expense-title" name="title" required maxLength={160} placeholder="Başlık" className={inputClass} />
      <label htmlFor="expense-amount" className="sr-only">Tutar (TRY)</label>
      <input id="expense-amount" name="amount" type="number" min="0.01" max="9999999999.99" step="0.01" required placeholder="Tutar (TRY)" className={inputClass} />
      <label htmlFor="expense-category" className="sr-only">Gider kategorisi</label>
      <select id="expense-category" name="category" className={inputClass}>
        {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
      </select>
      <label htmlFor="expense-date" className="sr-only">Gider tarihi</label>
      <input id="expense-date" name="expense_date" type="date" min="1900-01-01" max="2100-12-31" defaultValue={defaultDate} className={inputClass} />
      <label htmlFor="expense-notes" className="sr-only">Not (opsiyonel)</label>
      <input id="expense-notes" name="notes" maxLength={2000} placeholder="Not (opsiyonel)" className={`sm:col-span-2 ${inputClass}`} />
      <Combobox
        name="property_id"
        aria-label="İlgili portföy (opsiyonel)"
        placeholder="Portföy (opsiyonel)"
        searchPlaceholder="Portföy kodu veya başlığı…"
        emptyText="Eşleşen portföy yok"
        onSearch={searchProperties}
        options={defaultProperty ? [defaultProperty] : []}
        defaultValue={defaultProperty?.value ?? ""}
      />
      <label htmlFor="expense-receipt" className="sr-only">Fiş bağlantısı (opsiyonel)</label>
      <input
        id="expense-receipt"
        name="receipt_url"
        type="url"
        inputMode="url"
        maxLength={500}
        placeholder="Fiş / e-Arşiv bağlantısı (https://…)"
        className={inputClass}
      />
      {receiptUploads ? (
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <input
            ref={fileRef}
            id="expense-receipt-file"
            type="file"
            accept={RECEIPT_ACCEPT}
            className="hidden"
            onChange={onReceiptPick}
          />
          <label
            htmlFor="expense-receipt-file"
            className="focus-ring press inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-line-strong px-3 py-2 text-sm font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" /> Fiş dosyası ekle (görsel / PDF, en fazla 10 MB)
          </label>
          {receipt ? <LocalReceiptPreview file={receipt.file} url={receipt.url} onClear={clearReceipt} /> : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="focus-ring press inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60 sm:col-span-2"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
        {pending ? "Kaydediliyor…" : "Kaydet"}
      </button>
      {state.error ? (
        <p className="text-sm font-semibold text-danger-600 sm:col-span-2 lg:col-span-4" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
