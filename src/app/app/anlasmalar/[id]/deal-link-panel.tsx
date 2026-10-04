"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Link2, User } from "lucide-react";
import { updateDealLinks } from "@/app/actions/deals";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useToast } from "@/components/app/toast-provider";
import { Combobox } from "@/components/ui/combobox";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";

type Picked = { id: string; label: string } | null;

/**
 * Anlaşmaya portföy / müşteri sonradan bağlama (P0-3). Kazanma ikisini de şart koştuğu için
 * portföysüz açılmış anlaşma buradan tamamlanır. Popup yok: sayfa içi sekme alanı.
 * Kazanılmış anlaşmada gösterilmez (sunucu da reddeder).
 */
export function DealLinkPanel({
  dealId,
  property,
  customer,
  focus,
}: {
  dealId: string;
  property: Picked;
  customer: Picked;
  /** Hangi eksik bağ öne çıksın (tetikleyici etiketi). */
  focus: "property" | "customer";
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await updateDealLinks(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      push("Anlaşma bağlantıları güncellendi", "ok");
      setOpen(false);
      router.refresh();
    });
  }

  const hasProperty = Boolean(property);
  const label =
    focus === "property"
      ? hasProperty ? "Portföyü değiştir" : "Portföy bağla"
      : customer ? "Müşteriyi değiştir" : "Müşteri bağla";

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Portföy ve müşteri bağla"
      description="Kazanmak için anlaşmaya hem portföy hem müşteri bağlı olmalıdır."
      icon={<Link2 />}
      onSubmit={submit}
      pending={pending}
      error={error}
      hiddenFields={<input type="hidden" name="deal_id" value={dealId} />}
      fieldLabels={{ property_id: "Portföy", customer_id: "Müşteri" }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          className="focus-ring press mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 text-xs font-bold text-ink-950 transition hover:border-brand-300"
        >
          <Link2 className="h-3.5 w-3.5 text-brand-600" aria-hidden="true" /> {label}
        </button>
      )}
      tabs={[
        { id: "portfoy", label: "Portföy", icon: Building2, fields: ["property_id"] },
        { id: "musteri", label: "Müşteri", icon: User, fields: ["customer_id"] },
      ]}
      panels={{
        portfoy: (
          <div className="text-xs font-semibold text-text-muted sm:col-span-2">
            Portföy
            <div className="mt-1">
              <Combobox
                name="property_id"
                aria-label="Portföy"
                placeholder="Seçiniz"
                searchPlaceholder="Portföy ara…"
                emptyText="Eşleşen portföy yok"
                onSearch={searchProperties}
                defaultValue={property?.id ?? ""}
                options={property ? [{ value: property.id, label: property.label }] : []}
              />
            </div>
          </div>
        ),
        musteri: (
          <div className="text-xs font-semibold text-text-muted sm:col-span-2">
            Müşteri
            <div className="mt-1">
              <Combobox
                name="customer_id"
                aria-label="Müşteri"
                placeholder="Seçiniz"
                searchPlaceholder="Müşteri ara…"
                emptyText="Eşleşen müşteri yok"
                onSearch={searchCustomers}
                defaultValue={customer?.id ?? ""}
                options={customer ? [{ value: customer.id, label: customer.label }] : []}
              />
            </div>
          </div>
        ),
      }}
    />
  );
}
