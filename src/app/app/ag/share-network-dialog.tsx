"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea, FormField } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { shareToNetwork, type NetworkResult } from "@/app/actions/network";

const init: NetworkResult = {};

export function ShareNetworkDialog({
  properties,
}: {
  properties: { id: string; label: string; hint: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const action = (formData: FormData) => {
    startTransition(async () => {
      const res = await shareToNetwork(init, formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Share2 className="h-4 w-4" /> Portföy paylaş
        </Button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<Share2 />}
          title="Portföyü ağda paylaş"
          description="Portföyünüz diğer ofislere maskeli görünür: malik bilgisi ve açık adres asla paylaşılmaz."
        />
        <form action={action} className="space-y-4 p-6">
          <FormField label="Portföy (yalnız yayında olanlar)" htmlFor="nw-property" required>
            <Combobox
              id="nw-property"
              name="property_id"
              options={properties.map((p) => ({ value: p.id, label: p.label, hint: p.hint }))}
              placeholder="Portföy seçin…"
              searchPlaceholder="Kod veya başlık ara…"
              emptyText="Yayında portföy bulunamadı."
              required
              clearable={false}
            />
          </FormField>

          <FormField label="Komisyon paylaşımı (%)" htmlFor="nw-pct" required>
            <Input
              id="nw-pct"
              name="commission_share_pct"
              type="number"
              min={0}
              max={50}
              step="0.5"
              required
              defaultValue={25}
              placeholder="Örn. 25"
            />
          </FormField>

          <FormField label="Not (isteğe bağlı)" htmlFor="nw-note">
            <Textarea
              id="nw-note"
              name="note"
              rows={3}
              placeholder="Karşı ofislere kısa not — örn. hızlı satış öncelikli…"
            />
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
            <Button type="submit" loading={pending}>
              <Share2 className="h-4 w-4" /> Ağda paylaş
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
