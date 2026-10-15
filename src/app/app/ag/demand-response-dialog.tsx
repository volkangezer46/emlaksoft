"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea, FormField } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { respondToNetworkDemand } from "@/app/actions/network/demands";
import type { NetworkResult } from "@/app/actions/network/shared";

const init: NetworkResult = {};

/**
 * "Uygun portföyüm var" paneli (popup yok) — portföy Combobox'tan seçilince özet alanı
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

  const onSubmit = (formData: FormData) => {
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
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Uygun portföyüm var"
      description={`${officeName} ofisinin "${demandSummary}" talebine portföy önerisi gönderilecek. Portföyünüzün kimliği paylaşılmaz; yalnız aşağıdaki maskeli özet gider. İletişim bilgileri karşılıklı kabul sonrası açılır.`}
      icon={<Home />}
      onSubmit={onSubmit}
      pending={pending}
      error={error}
      submitLabel="Öneriyi gönder"
      fieldLabels={{ property_hint: "Maskeli özet", message: "Mesaj" }}
      trigger={({ onClick, ...aria }) => (
        <Button size="sm" variant="secondary" type="button" onClick={onClick} {...aria}>
          <Home className="h-4 w-4" /> Uygun portföyüm var
        </Button>
      )}
      hiddenFields={<input type="hidden" name="network_demand_id" value={networkDemandId} />}
      tabs={[{ id: "oneri", label: "Öneri", icon: Home, fields: ["property_hint", "message"] }]}
      panels={{
        oneri: (
          <>
            <FormField label="Portföyünüz (özeti otomatik doldurur)" htmlFor={`nd-prop-${networkDemandId}`} className="sm:col-span-2">
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
            <FormField label="Maskeli portföy özeti (karşı ofisin göreceği metin)" htmlFor={`nd-hint-${networkDemandId}`} required className="sm:col-span-2">
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
            <FormField label="Mesaj (isteğe bağlı)" htmlFor={`nd-msg-${networkDemandId}`} className="sm:col-span-2">
              <Textarea
                id={`nd-msg-${networkDemandId}`}
                name="message"
                rows={3}
                maxLength={1000}
                placeholder="Örn. Talebinize birebir uyuyor, detayları görüşmek isteriz…"
              />
            </FormField>
          </>
        ),
      }}
    />
  );
}
