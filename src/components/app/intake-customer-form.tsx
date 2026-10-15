"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Check, UserPlus } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { quickCreateCustomer } from "@/app/app/hizli/actions";

/**
 * Paylaşımdan / çevrimdışı nottan müşteri kaydı: hızlı kaydın müşteri eylemini (yetki, telefon doğrulama, mükerrer
 * kapısı createCustomer'da) kullanır. `requestId` aynı paylaşım/not iki kez gönderilse de tek kayıt açılmasını sağlar.
 */
export function IntakeCustomerForm({
  requestId,
  defaultName,
  defaultPhone,
  defaultNote,
  onSaved,
}: {
  requestId: string;
  defaultName?: string | null;
  defaultPhone?: string | null;
  defaultNote?: string | null;
  onSaved?: (customerId: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const idBase = `intake-${requestId.slice(0, 8)}`;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("client_request_id", requestId);
    if (duplicate) fd.set("allow_duplicate", "1");
    startTransition(async () => {
      const res = await quickCreateCustomer(fd);
      if ("duplicate" in res && res.duplicate) {
        setDuplicate(true);
        setError("Bu telefonla kayıtlı bir müşteri var. Yine de yeni kayıt açmak için tekrar kaydedin.");
        return;
      }
      if (res.error || !res.id) {
        setError(res.error ?? "Müşteri kaydedilemedi.");
        return;
      }
      setError(null);
      setSavedId(res.id);
      onSaved?.(res.id);
    });
  }

  if (savedId) {
    return (
      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/8 p-3 sm:flex-row sm:items-center">
        <p className="flex flex-1 items-center gap-2 text-sm font-semibold text-ink-950">
          <Check className="h-4 w-4 text-mint-600" aria-hidden /> Müşteri kaydedildi
        </p>
        <Link href={`/app/musteriler/${savedId}`} className="text-sm font-semibold text-brand-600 hover:underline">
          Kaydı aç
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <FormField label="Ad soyad" htmlFor={`${idBase}-name`} required>
        <FormInput id={`${idBase}-name`} name="full_name" defaultValue={defaultName ?? ""} required maxLength={120} autoComplete="name" />
      </FormField>
      <FormField label="Telefon" htmlFor={`${idBase}-phone`} required>
        <PhoneInput id={`${idBase}-phone`} name="phone" defaultValue={defaultPhone ?? ""} required />
      </FormField>
      <FormField label="Not" htmlFor={`${idBase}-note`}>
        <FormTextarea id={`${idBase}-note`} name="notes" defaultValue={defaultNote ?? ""} rows={3} maxLength={2000} />
      </FormField>
      {error ? (
        <p role="alert" className="text-sm font-medium text-danger-600">
          {error}
        </p>
      ) : null}
      <Button type="submit" icon={UserPlus} loading={pending} className="w-full sm:w-auto">
        {duplicate ? "Yine de kaydet" : "Müşteri olarak kaydet"}
      </Button>
    </form>
  );
}
