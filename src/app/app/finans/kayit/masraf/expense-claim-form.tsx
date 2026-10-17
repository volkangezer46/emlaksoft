"use client";

import { useRef, useState } from "react";
import { Camera, FileCheck2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { MoneyInput } from "@/components/ui/money-input";
import { Combobox } from "@/components/ui/combobox";
import { useCreateForm } from "@/components/app/use-create-form";
import { prepareExpenseClaimReceipt, submitExpenseClaim } from "@/app/actions/expense-claim";
import { EXPENSE_CLAIM_CATEGORIES, EXPENSE_CLAIM_HREF, expenseClaimPath, validateReceiptFile } from "@/lib/finance/expense-claim";

type Option = { id: string; label: string };

/**
 * Masraf bildir formu: tutar, gün, tür, açıklama ve fiş fotoğrafı (zorunlu). Fiş seçilince tek nesnelik imzalı jetonla
 * doğrudan özel kovaya yüklenir (bayt sunucudan geçmez); gönderimde sunucu bayt imzasını doğrular. Mobilde kamera açılır.
 */
export function ExpenseClaimForm({
  today,
  minDay,
  properties,
  deals,
}: {
  today: string;
  minDay: string;
  properties: Option[];
  deals: Option[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [receipt, setReceipt] = useState<{ path: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { onSubmit, pending, error } = useCreateForm((fd) => submitExpenseClaim({}, fd), {
    successMessage: "Masraf bildirildi; yönetici onayından sonra deftere işlenir.",
    redirectTo: (r) => (r.id ? expenseClaimPath(r.id) : EXPENSE_CLAIM_HREF),
  });

  async function onFile(file: File | undefined) {
    setUploadError(null);
    setReceipt(null);
    if (!file) return;
    const check = validateReceiptFile(file);
    if (!check.ok) {
      setUploadError(check.error);
      return;
    }
    setUploading(true);
    try {
      const target = await prepareExpenseClaimReceipt({ fileSize: file.size, fileType: check.mime });
      if (!target.ok) {
        setUploadError(target.error);
        return;
      }
      // supabase-js yalnız yükleme anında indirilir (ilk yük bütçesi).
      const { createClient } = await import("@/lib/supabase/client");
      const { error: upError } = await createClient()
        .storage.from(target.bucket)
        .uploadToSignedUrl(target.path, target.token, file, { contentType: target.contentType, cacheControl: "3600" });
      if (upError) {
        setUploadError("Fiş yüklenemedi; bağlantınızı kontrol edip yeniden deneyin.");
        return;
      }
      setReceipt({ path: target.path, name: file.name || "fiş" });
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <Card className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
        <FormField label="Tutar (₺, KDV dahil)" htmlFor="ec-amount" required>
          <MoneyInput id="ec-amount" name="amount" required placeholder="ör. 350" />
        </FormField>
        <FormField label="Harcama günü" htmlFor="ec-day" required>
          <FormInput id="ec-day" name="spent_on" type="date" required defaultValue={today} max={today} min={minDay} />
        </FormField>
        <FormField label="Masraf türü" htmlFor="ec-cat" required>
          <FormSelect id="ec-cat" name="category" required defaultValue="ulasim">
            {EXPENSE_CLAIM_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Ne için?" htmlFor="ec-desc" required className="sm:col-span-2">
          <FormTextarea id="ec-desc" name="description" required minLength={3} maxLength={300} rows={2} placeholder="ör. Kadıköy dairesi gösterimi, taksi" />
        </FormField>
        {properties.length > 0 ? (
          <FormField label="İlgili portföy (isteğe bağlı)" htmlFor="ec-prop" inject={false}>
            <Combobox id="ec-prop" name="property_id" aria-label="İlgili portföy" placeholder="Seçilmedi" searchPlaceholder="Portföy ara…" emptyText="Eşleşen portföy yok" options={properties.map((p) => ({ value: p.id, label: p.label }))} />
          </FormField>
        ) : null}
        {deals.length > 0 ? (
          <FormField label="İlgili anlaşma (isteğe bağlı)" htmlFor="ec-deal" inject={false}>
            <Combobox id="ec-deal" name="deal_id" aria-label="İlgili anlaşma" placeholder="Seçilmedi" searchPlaceholder="Anlaşma ara…" emptyText="Eşleşen anlaşma yok" options={deals.map((d) => ({ value: d.id, label: d.label }))} />
          </FormField>
        ) : null}
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium text-ink-950">
            Fiş fotoğrafı<span aria-hidden="true" className="ml-0.5 text-danger-500">*</span>
          </p>
          <input
            ref={fileRef}
            id="ec-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
            capture="environment"
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <input type="hidden" name="receipt_path" value={receipt?.path ?? ""} />
          <label
            htmlFor="ec-file"
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border border-dashed border-border-interactive bg-canvas/60 px-4 py-3 text-sm font-semibold text-ink-950 hover:border-border-strong"
          >
            {receipt ? <FileCheck2 className="h-5 w-5 text-mint-700" aria-hidden /> : <Camera className="h-5 w-5 text-brand-600" aria-hidden />}
            <span className="min-w-0 flex-1 truncate">
              {uploading ? "Fiş yükleniyor…" : receipt ? `Yüklendi: ${receipt.name} (değiştirmek için dokunun)` : "Fişin fotoğrafını çekin ya da dosya seçin"}
            </span>
          </label>
          {uploadError ? <p role="alert" className="mt-1.5 text-sm text-danger-600">{uploadError}</p> : null}
          <p className="mt-1.5 text-xs text-text-muted">JPG, PNG, WEBP, HEIC ya da PDF · en fazla 5 MB. Fiş yalnız size, muhasebeye ve onay veren yöneticiye görünür.</p>
        </div>
      </Card>
      {error ? <p role="alert" className="text-sm font-semibold text-danger-600">{error}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="submit" icon={Send} loading={pending} disabled={pending || uploading || !receipt}>
          Onaya gönder
        </Button>
      </div>
    </form>
  );
}
