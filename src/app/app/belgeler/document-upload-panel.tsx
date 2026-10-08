"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField } from "@/components/ui/form-controls";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { searchCustomers } from "@/app/actions/lookup";
import { finalizeCustomerFileUpload, prepareCustomerFileUpload } from "@/app/actions/customer-files";
import { uploadToDirectFileTarget } from "@/lib/direct-file-upload-client";

/**
 * Belge merkezinden müşteri dosyası yükleme (kimlik, sözleşme, PDF...). Dosya özel depoya gider;
 * tür, boyut ve içerik (magic-byte) sunucuda doğrulanır (müşteri dosyası akışı), public yüzeye çıkmaz.
 */
export function DocumentUploadPanel() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(fd: FormData) {
    setError(null);
    const customerId = String(fd.get("customer_id") ?? "").trim();
    const file = fd.get("file");
    if (!customerId) {
      setError("Önce müşteri seçin.");
      return;
    }
    if (!(file instanceof File) || file.size === 0) {
      setError("Yüklenecek dosyayı seçin.");
      return;
    }
    startTransition(async () => {
      try {
        const prepared = await prepareCustomerFileUpload({
          customerId,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
        });
        if (!prepared.ok) return setError(prepared.error);
        const uploaded = await uploadToDirectFileTarget(prepared.upload, file);
        if (!uploaded.ok) return setError(uploaded.error);
        const finalized = await finalizeCustomerFileUpload(customerId, prepared.upload.sessionId);
        if (!finalized.ok) return setError(finalized.error);
        setOpen(false);
        router.refresh();
      } catch {
        setError("Yükleme başarısız — bağlantıyı kontrol edin.");
      }
    });
  }

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Belge yükle"
      description="Müşteri dosyasına belge ekleyin: görsel, PDF, Word veya Excel (en fazla 10 MB)."
      icon={<FileUp />}
      onSubmit={onSubmit}
      pending={pending}
      error={error}
      submitLabel="Yükle"
      pendingLabel="Yükleniyor…"
      fieldLabels={{ customer_id: "Müşteri", file: "Dosya" }}
      trigger={({ onClick, ...aria }) => (
        <Button type="button" onClick={onClick} {...aria}>
          <Upload className="h-4 w-4" /> Belge yükle
        </Button>
      )}
      tabs={[{ id: "belge", label: "Belge", icon: FileUp, fields: ["customer_id", "file"] }]}
      panels={{
        belge: (
          <>
            <FormField label="Müşteri" htmlFor="doc-customer" required className="sm:col-span-2">
              <Combobox
                id="doc-customer"
                name="customer_id"
                aria-label="Müşteri"
                placeholder="Ad veya telefon ile ara…"
                searchPlaceholder="En az 2 karakter yazın…"
                emptyText="Aramak için en az 2 karakter yazın"
                onSearch={searchCustomers}
                options={[] as ComboboxOption[]}
              />
            </FormField>
            <FormField label="Dosya" htmlFor="doc-file" required className="sm:col-span-2">
              <input
                id="doc-file"
                name="file"
                type="file"
                required
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                className="block w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm"
              />
            </FormField>
          </>
        ),
      }}
    />
  );
}
