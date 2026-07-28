"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Plus } from "lucide-react";
import { createRental, type RentalResult } from "@/app/actions/rentals";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTrigger } from "@/components/ui/dialog";
import { FormField, Input, Textarea } from "@/components/ui/input";

type Property = { id: string; property_code: string; title: string | null };
type Customer = { id: string; full_name: string | null; phone: string | null };

const init: RentalResult = {};

/**
 * "Yeni kira kaydı" dialogu — portföy + kiracı müşteri Combobox'la seçilir
 * (ilk liste son eklenenler, yazınca sunucu taraflı arama devreye girer).
 * Kiracı için yeni kişi tablosu yok: mevcut müşteri kaydı seçilir, action
 * tarafında 'Kiracı' tip etiketi eklenir.
 */
export function NewRentalDialog({
  properties,
  customers,
  defaultPropertyId = null,
  defaultCustomerId = null,
  defaultMonthlyRent = null,
  autoOpen = false,
}: {
  properties: Property[];
  customers: Customer[];
  /** ?portfoy= — kazanılan kira anlaşmasından gelen portföy ön dolgusu. */
  defaultPropertyId?: string | null;
  /** ?musteri= — anlaşmanın müşterisi kiracı olarak ön seçilir. */
  defaultCustomerId?: string | null;
  /** ?tutar= — anlaşma değeri aylık kira alanına ön dolgu düşer. */
  defaultMonthlyRent?: number | null;
  /** Ön dolgu geçerliyse diyalog doğrudan açık gelir. */
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(autoOpen);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Sonucu effect'te değil eylem içinde işle (react-hooks/set-state-in-effect)
  const action = (formData: FormData) => {
    startTransition(async () => {
      const res = await createRental(init, formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      push("Kira kaydı oluşturuldu", "ok");
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="md" className="gap-1.5">
          <Plus className="h-4 w-4" /> Yeni kira kaydı
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader
          icon={<KeyRound />}
          title="Yeni kira kaydı"
          description="Portföyü kiracısıyla eşleştirin — aylık tahakkuklar vade gününe göre otomatik oluşturulur."
        />
        <form action={action}>
          <DialogBody className="grid gap-4 sm:grid-cols-2">
            <FormField label="Portföy" required className="sm:col-span-2">
              <Combobox
                name="property_id"
                required
                clearable={false}
                aria-label="Portföy"
                placeholder="Portföy seçin"
                searchPlaceholder="Kod ya da başlık ara…"
                emptyText="Eşleşen portföy yok"
                onSearch={searchProperties}
                defaultValue={defaultPropertyId ?? undefined}
                options={properties.map((p) => ({
                  value: p.id,
                  label: p.title ?? p.property_code,
                  hint: p.title ? p.property_code : undefined,
                }))}
              />
            </FormField>
            <FormField label="Kiracı (müşteri)" required hint="Mevcut müşteri kaydı seçilir; 'Kiracı' tip etiketi otomatik eklenir." className="sm:col-span-2">
              <Combobox
                name="renter_customer_id"
                required
                clearable={false}
                aria-label="Kiracı (müşteri)"
                placeholder="Müşteri seçin"
                searchPlaceholder="Ad ya da telefon ara…"
                emptyText="Eşleşen müşteri yok"
                onSearch={searchCustomers}
                defaultValue={defaultCustomerId ?? undefined}
                options={customers.map((c) => ({
                  value: c.id,
                  label: c.full_name ?? "İsimsiz",
                  hint: c.phone ?? undefined,
                }))}
              />
            </FormField>
            <FormField label="Aylık kira (₺)" required htmlFor="rental-monthly-rent">
              <Input id="rental-monthly-rent" name="monthly_rent" type="number" min="1" step="0.01" required defaultValue={defaultMonthlyRent ?? undefined} placeholder="ör. 25.000" />
            </FormField>
            <FormField label="Vade günü" required htmlFor="rental-due-day" hint="Ayın kaçında ödenir (1-28).">
              <Input id="rental-due-day" name="due_day" type="number" min="1" max="28" step="1" required defaultValue={1} />
            </FormField>
            <FormField label="Başlangıç tarihi" required htmlFor="rental-start-date">
              <Input id="rental-start-date" name="start_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </FormField>
            <FormField label="Bitiş tarihi" htmlFor="rental-end-date" hint="Boş bırakılabilir — süresiz sözleşme.">
              <Input id="rental-end-date" name="end_date" type="date" />
            </FormField>
            <FormField label="Depozito (₺)" htmlFor="rental-deposit">
              <Input id="rental-deposit" name="deposit" type="number" min="0" step="0.01" placeholder="Opsiyonel" />
            </FormField>
            <FormField label="Notlar" htmlFor="rental-notes" className="sm:col-span-2">
              <Textarea id="rental-notes" name="notes" rows={2} placeholder="Sözleşme koşulları, özel notlar…" />
            </FormField>
            {error ? (
              <p className="text-sm font-medium text-danger-600 sm:col-span-2" role="alert">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Vazgeç</Button>
            </DialogClose>
            <Button type="submit" loading={pending}>
              Kaydet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
