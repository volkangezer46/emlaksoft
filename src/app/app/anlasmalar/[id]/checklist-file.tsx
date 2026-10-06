"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, Unlink } from "lucide-react";
import { finalizeCustomerFileUpload, prepareCustomerFileUpload } from "@/app/actions/customer-files";
import { attachChecklistFile, detachChecklistFile } from "@/app/actions/deal-checklist";
import { uploadToDirectFileTarget } from "@/lib/direct-file-upload-client";
import { useToast } from "@/components/app/toast-provider";

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx";

/** Dahili güvenli uç mu (müşteri belgesi)? Önizleme bağlantısı için. */
function previewHref(url: string): string {
  return url.startsWith("/api/customer-files/") ? `${url}?onizle=1` : url;
}

/**
 * Evrak maddesi dosyası: yükleme mevcut güvenli hattan (imzalı tek nesne + bayt doğrulaması)
 * anlaşmanın müşterisine belge olarak yapılır, ardından maddeye bağlanır.
 */
export function ChecklistFileControl({
  itemId,
  dealId,
  label,
  fileUrl,
  customerId,
  canEdit,
  canUpload,
}: {
  itemId: string;
  dealId: string;
  label: string;
  fileUrl: string | null;
  customerId: string | null;
  canEdit: boolean;
  canUpload: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !customerId) return;
    setBusy(true);
    try {
      const prepared = await prepareCustomerFileUpload({ customerId, fileName: file.name, fileSize: file.size, fileType: file.type, label });
      if (!prepared.ok) return push(prepared.error, "err");
      const uploaded = await uploadToDirectFileTarget(prepared.upload, file);
      if (!uploaded.ok) return push(uploaded.error, "err");
      const finalized = await finalizeCustomerFileUpload(customerId, prepared.upload.sessionId);
      if (!finalized.ok) return push(finalized.error, "err");
      const attached = await attachChecklistFile(itemId, dealId, finalized.id);
      if (attached.error) return push(attached.error, "err");
      push("Dosya yüklendi ve evrak tamamlandı", "ok");
      router.refresh();
    } catch {
      push("Yükleme başarısız. Bağlantınızı kontrol edin.", "err");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  if (fileUrl) {
    return (
      <span className="inline-flex items-center gap-1">
        <a
          href={previewHref(fileUrl)}
          target="_blank"
          rel="noreferrer"
          className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] px-1.5 py-1 text-xs font-semibold text-brand-600 hover:underline"
          title="Evrak dosyasını aç"
        >
          <Paperclip className="h-3.5 w-3.5" /> Dosya
        </a>
        {canEdit ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await detachChecklistFile(itemId, dealId);
                if (res.error) push(res.error, "err");
                else router.refresh();
              })
            }
            aria-label={`${label} dosya bağını kaldır`}
            title="Dosya bağını kaldır (dosya müşteri belgelerinde kalır)"
            className="focus-ring press grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-danger-500/10 hover:text-danger-600"
          >
            <Unlink className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </span>
    );
  }

  if (!canEdit || !canUpload) return null;
  if (!customerId) {
    return (
      <span className="text-xs text-text-faint" title="Dosya müşteri belgesi olarak saklanır">
        Dosya için müşteri bağlayın
      </span>
    );
  }
  return (
    <>
      <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={onFile} aria-label={`${label} dosyası seç`} />
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        title="Dosya yükle (PDF, görsel, Word, Excel; en fazla 10 MB)"
        aria-label={`${label} için dosya yükle`}
        className="focus-ring press grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-text-faint transition hover:bg-brand-600/10 hover:text-brand-600 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
      </button>
    </>
  );
}
