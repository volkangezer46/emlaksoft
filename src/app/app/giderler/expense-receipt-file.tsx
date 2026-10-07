"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, FileText, Loader2, Paperclip, Trash2 } from "lucide-react";
import {
  deleteExpenseReceipt,
  finalizeExpenseReceiptUpload,
  prepareExpenseReceiptUpload,
} from "@/app/actions/expense-receipts";
import { uploadToDirectFileTarget } from "@/lib/direct-file-upload-client";
import { useToast } from "@/components/app/toast-provider";
import { EXPENSE_RECEIPT_ACCEPT, expenseReceiptHref as receiptHref } from "@/lib/expense-receipts";

export const RECEIPT_ACCEPT = EXPENSE_RECEIPT_ACCEPT;

const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
const RECEIPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

export type ReceiptFileRef = { id: string; name: string; type: string };

/** İstemci ön denetimi (sunucu baytları yeniden doğrular). */
export function receiptClientError(file: File): string | null {
  if (!RECEIPT_TYPES.has(file.type)) return "Fiş için JPEG, PNG, WEBP görsel veya PDF seçin.";
  if (file.size <= 0) return "Boş dosya yüklenemez.";
  if (file.size > RECEIPT_MAX_BYTES) return "Fiş dosyası en fazla 10 MB olabilir.";
  return null;
}

/** Güvenli yükleme hattı: jeton → özel kovaya doğrudan yükleme → bayt doğrulamalı kayıt. */
export async function uploadExpenseReceipt(expenseId: string, file: File): Promise<{ ok: true } | { ok: false; error: string }> {
  const local = receiptClientError(file);
  if (local) return { ok: false, error: local };
  const prepared = await prepareExpenseReceiptUpload({ expenseId, fileName: file.name, fileSize: file.size, fileType: file.type });
  if (!prepared.ok) return { ok: false, error: prepared.error };
  const uploaded = await uploadToDirectFileTarget(prepared.upload, file);
  if (!uploaded.ok) return uploaded;
  const finalized = await finalizeExpenseReceiptUpload(expenseId, prepared.upload.sessionId);
  if (!finalized.ok) return { ok: false, error: finalized.error };
  return { ok: true };
}

/**
 * Seçilen dosyanın yerel önizlemesi (görselse küçük resim, PDF ise simge). Nesne URL'ini çağıran seçim anında
 * üretir ve temizlerken `URL.revokeObjectURL` ile bırakır (efekt içinde setState yok).
 */
export function LocalReceiptPreview({ file, url, onClear }: { file: File; url: string | null; onClear: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-xs">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-8 w-8 rounded object-cover" />
      ) : (
        <FileText className="h-4 w-4 text-text-faint" aria-hidden="true" />
      )}
      <span className="truncate font-medium text-text">{file.name}</span>
      <button type="button" onClick={onClear} className="focus-ring rounded px-1 text-text-faint hover:text-danger-600" aria-label="Seçilen fişi kaldır">
        ×
      </button>
    </span>
  );
}

/** Düzenleme panelindeki fiş dosyası denetimi: önizle / indir / değiştir / kaldır. */
export function ExpenseReceiptFileControl({
  expenseId,
  file,
  canEdit,
}: {
  expenseId: string;
  file: ReceiptFileRef | null;
  canEdit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (!picked) return;
    setBusy(true);
    try {
      const res = await uploadExpenseReceipt(expenseId, picked);
      if (!res.ok) push(res.error, "err");
      else {
        push(file ? "Fiş dosyası değiştirildi" : "Fiş dosyası yüklendi", "ok");
        router.refresh();
      }
    } catch {
      push("Yükleme başarısız. Bağlantınızı kontrol edin.", "err");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const btn =
    "focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2 py-1 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {file ? (
        <>
          <span className="inline-flex min-w-0 items-center gap-1 text-xs font-medium text-text">
            <Paperclip className="h-3.5 w-3.5 text-text-faint" aria-hidden="true" />
            <span className="truncate">{file.name}</span>
          </span>
          <a href={receiptHref(file.id, "preview")} target="_blank" rel="noreferrer" className={btn}>
            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Önizle
          </a>
          <a href={receiptHref(file.id)} className={btn}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> İndir
          </a>
        </>
      ) : (
        <span className="text-xs text-text-faint">Fiş dosyası yok</span>
      )}
      {canEdit ? (
        <>
          <input ref={inputRef} type="file" accept={RECEIPT_ACCEPT} className="hidden" onChange={onFile} aria-label="Fiş dosyası seç" />
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={btn}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />}
            {file ? "Değiştir" : "Dosya yükle"}
          </button>
          {file ? (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await deleteExpenseReceipt(expenseId);
                  if (res.error) push(res.error, "err");
                  else {
                    push("Fiş dosyası kaldırıldı", "ok");
                    router.refresh();
                  }
                })
              }
              className={`${btn} hover:border-danger-300 hover:text-danger-600`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Kaldır
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
