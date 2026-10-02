"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, FormField } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { InlinePanel, InlinePanelTrigger } from "@/components/ui/inline-panel";
import { shareDemandToNetwork, type NetworkResult } from "@/app/actions/network";

const init: NetworkResult = {};

export const SHARE_DEMAND_PANEL_ID = "ag-talep-paylas";

type DemandOption = { id: string; label: string; hint: string };

/** "Taleplerimi paylaş" düğmesi — aynı panele bağlanan birden çok yerde kullanılabilir. */
export function ShareDemandTrigger() {
  return (
    <InlinePanelTrigger panelId={SHARE_DEMAND_PANEL_ID} variant="secondary">
      <Megaphone className="h-4 w-4" /> Taleplerimi paylaş
    </InlinePanelTrigger>
  );
}

export function ShareDemandPanel({ demands }: { demands: DemandOption[] }) {
  return (
    <InlinePanel
      id={SHARE_DEMAND_PANEL_ID}
      title="Talebi ağda paylaş"
      description="Talebiniz diğer ofislere maskeli görünür: müşteri bilgisi asla paylaşılmaz, bütçe yuvarlanmış aralık olarak gösterilir."
      icon={<Megaphone />}
    >
      {(close) => <ShareDemandForm demands={demands} onDone={close} />}
    </InlinePanel>
  );
}

function ShareDemandForm({ demands, onDone }: { demands: DemandOption[]; onDone: () => void }) {
  const router = useRouter();
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
      router.refresh();
      onDone();
    });
  };

  return (
    <form action={action} className="grid gap-4 p-4 sm:grid-cols-2 md:p-6">
      <FormField label="Talep (yalnız açık olanlar)" htmlFor="nd-demand" required className="sm:col-span-2">
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
          <Megaphone className="h-4 w-4" /> Ağda paylaş
        </Button>
      </div>
    </form>
  );
}
