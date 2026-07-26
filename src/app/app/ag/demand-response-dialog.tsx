"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Home } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea, FormField } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { respondToNetworkDemand, type NetworkResult } from "@/app/actions/network";

const init: NetworkResult = {};

/**
 * "Uygun portföyüm var" dialogu — portföy Combobox'tan seçilince özet alanı
 * otomatik MASKELİ özetle ("İlçe · tip · oda · ₺fiyat") doldurulur; kullanıcı
 * düzenleyebilir. Karşı tarafa yalnız bu serbest metin gider, portföy id'si
 * ASLA gönderilmez.
 */
export function DemandResponseDialog({
  networkDemandId,
  demandSummary,
  officeName,
  properties,
}: {
  networkDemandId: string;
  demandSummary: string;
  officeName: string;
  properties: { id: string; label: string; hint: string; maskedSummary: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [pending, startTransition] = useTransition();

  const action = (formData: FormData) => {
    startTransition(async () => {
      const res = await respondToNetworkDemand(init, formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setOpen(false);
      setHint("");
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Home className="h-4 w-4" /> Uygun portföyüm var
        </Button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader
          icon={<Home />}
          title="Uygun portföyüm var"
          description={`${officeName} ofisinin "${demandSummary}" talebine portföy önerisi gönderilecek. Portföyünüzün kimliği paylaşılmaz; yalnız aşağıdaki maskeli özet gider. İletişim bilgileri karşılıklı kabul sonrası açılır.`}
        />
        <form action={action} className="space-y-4 p-6">
          <input type="hidden" name="network_demand_id" value={networkDemandId} />

          <FormField label="Portföyünüz (özeti otomatik doldurur)" htmlFor={`nd-prop-${networkDemandId}`}>
            <Combobox
              id={`nd-prop-${networkDemandId}`}
              options={properties.map((p) => ({ value: p.id, label: p.label, hint: p.hint }))}
              placeholder="Portföy seçin (isteğe bağlı)…"
              searchPlaceholder="Kod veya başlık ara…"
              emptyText="Yayında portföy bulunamadı."
              onValueChange={(v) => {
                const selected = properties.find((p) => p.id === v);
                if (selected?.maskedSummary) setHint(selected.maskedSummary);
              }}
            />
          </FormField>

          <FormField label="Maskeli portföy özeti (karşı ofisin göreceği metin)" htmlFor={`nd-hint-${networkDemandId}`} required>
            <Textarea
              id={`nd-hint-${networkDemandId}`}
              name="property_hint"
              rows={2}
              required
              maxLength={300}
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Örn. Kadıköy · Daire · 3+1 · ₺5.200.000"
            />
          </FormField>

          <FormField label="Mesaj (isteğe bağlı)" htmlFor={`nd-msg-${networkDemandId}`}>
            <Textarea
              id={`nd-msg-${networkDemandId}`}
              name="message"
              rows={3}
              maxLength={1000}
              placeholder="Örn. Talebinize birebir uyuyor, detayları görüşmek isteriz…"
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
              <Home className="h-4 w-4" /> Öneriyi gönder
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
