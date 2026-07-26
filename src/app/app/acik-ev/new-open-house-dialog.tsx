"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DoorOpen, Plus } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea, FormField } from "@/components/ui/input";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { searchProperties } from "@/app/actions/lookup";
import { createOpenHouse, type OpenHouseResult } from "@/app/actions/targets-openhouse-sources";

const init: OpenHouseResult = {};

export function NewOpenHouseDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Sonucu effect'te değil eylem içinde işle (react-hooks/set-state-in-effect)
  const action = (formData: FormData) => {
    startTransition(async () => {
      const res = await createOpenHouse(init, formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setOpen(false);
      setPropertyId("");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> Yeni açık ev
        </Button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<DoorOpen />}
          title="Yeni açık ev günü"
          description="Portföy seçin, tarih ve kapasiteyi belirleyin — ziyaretçileri kapıda bu ekrandan kaydedersiniz."
        />
        <form action={action} className="space-y-4 p-6">
          <div>
            <span className="mb-1.5 block text-xs font-semibold text-ink-950">
              Portföy <span className="text-danger-500">*</span>
            </span>
            <Combobox
              name="property_id"
              required
              aria-label="Portföy"
              value={propertyId}
              onValueChange={setPropertyId}
              options={[] as ComboboxOption[]}
              onSearch={searchProperties}
              placeholder="Portföy ara ve seçin"
              searchPlaceholder="Başlık, kod ya da adres…"
              emptyText="Eşleşen portföy yok"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Tarih ve saat" htmlFor="oh-scheduled" required>
              <Input id="oh-scheduled" name="scheduled_at" type="datetime-local" required />
            </FormField>
            <FormField label="Süre (dk)" htmlFor="oh-duration">
              <Input id="oh-duration" name="duration_min" type="number" min={15} step={15} defaultValue={120} />
            </FormField>
            <FormField label="Konum / buluşma noktası" htmlFor="oh-location" className="sm:col-span-2">
              <Input id="oh-location" name="location" placeholder="Örn. site satış ofisi önü" />
            </FormField>
            <FormField label="Maks. ziyaretçi" htmlFor="oh-max" hint="Boş bırakılırsa sınırsız.">
              <Input id="oh-max" name="max_visitors" type="number" min={1} placeholder="Sınırsız" />
            </FormField>
          </div>

          <FormField label="Not" htmlFor="oh-notes">
            <Textarea id="oh-notes" name="notes" rows={3} placeholder="Hazırlık listesi, broşür, ikram…" />
          </FormField>

          {error ? (
            <p className="rounded-[8px] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="hairline-t flex justify-end gap-2 pt-4">
            <DialogClose asChild>
              <Button type="button" variant="secondary">Vazgeç</Button>
            </DialogClose>
            <Button type="submit" loading={pending} disabled={!propertyId}>
              <Plus className="h-4 w-4" /> Açık ev oluştur
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
