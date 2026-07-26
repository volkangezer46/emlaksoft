"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";
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
import { shareDemandToNetwork, type NetworkResult } from "@/app/actions/network";

const init: NetworkResult = {};

export function ShareDemandDialog({
  demands,
}: {
  demands: { id: string; label: string; hint: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const action = (formData: FormData) => {
    startTransition(async () => {
      const res = await shareDemandToNetwork(init, formData);
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
        <Button variant="secondary">
          <Megaphone className="h-4 w-4" /> Taleplerimi paylaş
        </Button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<Megaphone />}
          title="Talebi ağda paylaş"
          description="Talebiniz diğer ofislere maskeli görünür: müşteri bilgisi asla paylaşılmaz, bütçe yuvarlanmış aralık olarak gösterilir."
        />
        <form action={action} className="space-y-4 p-6">
          <FormField label="Talep (yalnız açık olanlar)" htmlFor="nd-demand" required>
            <Combobox
              id="nd-demand"
              name="demand_id"
              options={demands.map((d) => ({ value: d.id, label: d.label, hint: d.hint }))}
              placeholder="Talep seçin…"
              searchPlaceholder="Tip veya bölge ara…"
              emptyText="Açık talep bulunamadı."
              required
              clearable={false}
            />
          </FormField>

          <FormField label="Komisyon paylaşımı (%)" htmlFor="nd-pct" required>
            <Input
              id="nd-pct"
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

          <FormField label="Not (isteğe bağlı)" htmlFor="nd-note">
            <Textarea
              id="nd-note"
              name="note"
              rows={3}
              placeholder="Karşı ofislere kısa not — örn. hazır alıcı, hızlı karar…"
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
              <Megaphone className="h-4 w-4" /> Ağda paylaş
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
