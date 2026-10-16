"use client";

import { useId, useState, useTransition } from "react";
import { Check, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormInput } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { quickCreateCustomer } from "@/app/app/hizli/actions";
import { lookupCustomerByPhone } from "@/app/actions/lookup";

/**
 * Formdan çıkmadan "+ Yeni müşteri": ad + telefon ile müşteri açar ve çağırana seçili olarak verir.
 *
 * Dış formun içinde durur ama KENDİ alanları `name` taşımaz (dış form gönderimine karışmaz; iç içe `<form>` yok).
 * Kayıt hızlı kaydın müşteri eylemiyle yapılır (yetki, `parsePhoneStrict`, mükerrer kapısı `createCustomer`'da).
 * Aynı telefon ofiste kayıtlıysa yeni kayıt açılmadan mevcut müşteri önerilir ("Bu kaydı seç"); yine de yeni kayıt
 * isteyen "Yine de yeni kayıt" ile onaylar.
 */
export function InlineCustomerQuickAdd({
  onCreated,
  className,
}: {
  onCreated: (customer: { id: string; label: string }) => void;
  className?: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; label: string } | null>(null);
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [pending, startTransition] = useTransition();

  function reset() {
    setOpen(false);
    setName("");
    setPhone("");
    setError(null);
    setExisting(null);
    setAllowDuplicate(false);
  }

  function save() {
    const fullName = name.trim();
    if (!fullName) return setError("Ad soyad girin.");
    if (!phone.trim()) return setError("Telefon girin.");
    const fd = new FormData();
    fd.set("full_name", fullName);
    fd.set("phone", phone);
    if (allowDuplicate) fd.set("allow_duplicate", "1");
    startTransition(async () => {
      const res = await quickCreateCustomer(fd);
      if ("duplicate" in res && res.duplicate) {
        const found = await lookupCustomerByPhone(phone);
        setExisting(found.match ? { id: found.match.value, label: found.match.label } : null);
        setAllowDuplicate(true);
        setError("Bu telefonla kayıtlı bir müşteri var.");
        return;
      }
      if (res.error || !res.id) {
        setError(res.error ?? "Müşteri kaydedilemedi.");
        return;
      }
      onCreated({ id: res.id, label: fullName });
      reset();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" icon={UserPlus} onClick={() => setOpen(true)} className={`mt-1 text-brand-600 touch:min-h-11 ${className ?? ""}`}>
        Yeni müşteri ekle
      </Button>
    );
  }

  return (
    <div
      role="group"
      aria-label="Yeni müşteri"
      className={`mt-2 space-y-2 rounded-[var(--radius-control)] border border-brand-300/50 bg-brand-600/5 p-3 ${className ?? ""}`}
      onKeyDown={(e) => {
        // Enter dış formu göndermesin; bu panelde "Kaydet ve seç" demektir.
        if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          save();
        }
        if (e.key === "Escape") reset();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs font-semibold text-ink-950" htmlFor={`${uid}-name`}>
          Ad soyad
          <FormInput
            id={`${uid}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
            maxLength={120}
            autoFocus
            className="mt-1"
          />
        </label>
        <div className="block text-xs font-semibold text-ink-950">
          <label htmlFor={`${uid}-phone`}>Telefon</label>
          <div className="mt-1">
            <PhoneInput id={`${uid}-phone`} value={phone} onValueChange={setPhone} />
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger-600">
          {error}{" "}
          {existing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-brand-600 underline underline-offset-2 touch:min-h-11"
              onClick={() => {
                onCreated(existing);
                reset();
              }}
            >
              {existing.label} kaydını seç
            </Button>
          ) : null}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" icon={Check} loading={pending} onClick={save} className="touch:min-h-11">
          {allowDuplicate ? "Yine de yeni kayıt" : "Kaydet ve seç"}
        </Button>
        <Button type="button" size="sm" variant="secondary" icon={X} onClick={reset} className="touch:min-h-11">
          Vazgeç
        </Button>
      </div>
    </div>
  );
}
