"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, FormField } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { shareToNetwork, type NetworkResult } from "@/app/actions/network";

const init: NetworkResult = {};

export const SHARE_NETWORK_PANEL_ID = "ag-portfoy-paylas";

/** "Portföy paylaş" düğmesi — aynı panele bağlanan birden çok yerde kullanılabilir. */
export function ShareNetworkTrigger() {
  return (
    <InlinePanelTrigger panelId={SHARE_NETWORK_PANEL_ID}>
      <Share2 className="h-4 w-4" /> Portföy paylaş
    </InlinePanelTrigger>
  );
}

export function ShareNetworkPanel({
  properties,
}: {
  properties: { id: string; label: string; hint: string }[];
}) {
  return (
    <InlinePanel
      id={SHARE_NETWORK_PANEL_ID}
      title="Portföyü ağda paylaş"
      description="Portföyünüz diğer ofislere maskeli görünür: malik bilgisi ve açık adres asla paylaşılmaz."
      icon={<Share2 />}
    >
      {(close) => <ShareNetworkForm properties={properties} onDone={close} />}
    </InlinePanel>
  );
}

function ShareNetworkForm({
  properties,
  onDone,
}: {
  properties: { id: string; label: string; hint: string }[];
  onDone: () => void;
}) {
  const router = useRouter();
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
      router.refresh();
      onDone();
    });
  };

  return (
    <form action={action} className="grid gap-4 p-4 sm:grid-cols-2 md:p-6">
      <FormField label="Portföy (yalnız yayında olanlar)" htmlFor="nw-property" required className="sm:col-span-2">
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
        <p
          className="rounded-[var(--radius-control)] bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600 sm:col-span-2"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="hairline-t flex justify-end gap-2 pt-4 sm:col-span-2">
        <Button type="button" variant="secondary" onClick={onDone}>Vazgeç</Button>
        <Button type="submit" loading={pending}>
          <Share2 className="h-4 w-4" /> Ağda paylaş
        </Button>
      </div>
    </form>
  );
}
