"use client";

import { startTransition, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TAB_ICONS as TI } from "@/lib/icons";
import { sendBroadcast, searchTenantsBroadcast, type BroadcastTarget } from "@/app/actions/platform-notifications";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { SummaryGroup, SummaryRow, TabbedFormShell, type FormTab, type TabbedSummaryContext } from "@/components/ui/tabbed-form-shell";
import { KIND_OPTIONS } from "./broadcast-options";
import { BROADCAST_TABS } from "./broadcast-tabs";

const TARGET_OPTIONS: { value: BroadcastTarget; label: string; hint: string }[] = [
  { value: "all", label: "Tüm ofisler", hint: "İptal edilmemiş her ofise gönderir" },
  { value: "active", label: "Aktif ofisler", hint: "Yalnızca aktif aboneliği olanlar" },
  { value: "trial", label: "Deneme ofisleri", hint: "14 günlük deneme süreci" },
  { value: "specific", label: "Belirli ofis", hint: "Ada göre arayıp tekil hedef seçin" },
];

const TAB_ICONS = { icerik: TI.icerik, hedef: TI.kanal } as const;
const FIELD_LABELS = { title: "Başlık", tenant_id: "Ofis" };

export type AudienceCounts = { all: number; active: number; trial: number };

/**
 * Duyuru formu (sekmeli kabuk). Hedef kitle sayıları sunucu sayfasında ÖNCEDEN hesaplanıp
 * props ile gelir — hedef değişince ek istek atılmaz, sayı özet panelinde anında görünür.
 */
export function BroadcastForm({
  audienceCounts,
  tenantOptions,
}: {
  audienceCounts: AudienceCounts;
  tenantOptions: ComboboxOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<BroadcastTarget>("all");
  const [tenantId, setTenantId] = useState("");

  const tabs: FormTab[] = useMemo(
    () =>
      BROADCAST_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
      })),
    [],
  );

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setPending(true);
    startTransition(async () => {
      const res = await sendBroadcast(fd);
      setPending(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push("/admin/duyuru");
      router.refresh();
    });
  }

  const tabPanels = {
    icerik: (
      <>
        <FormField label="Başlık" htmlFor="title" required className="sm:col-span-2">
          <FormInput name="title" required maxLength={120} placeholder="Örn: Yeni özellik yayında — portallar güncellendi" />
        </FormField>
        <FormField label="Mesaj (isteğe bağlı)" htmlFor="body" className="sm:col-span-2">
          <FormTextarea name="body" rows={5} placeholder="Detay, link veya açıklama ekleyebilirsiniz…" />
        </FormField>
        <FormField label="Bağlantı (isteğe bağlı)" htmlFor="href" hint="https:// veya /app/... ile başlayan adres" className="sm:col-span-2">
          <FormInput name="href" placeholder="/app/ayarlar" />
        </FormField>
      </>
    ),
    hedef: (
      <>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-sm font-medium text-ink-950">Bildirim türü</legend>
          <div className="flex flex-wrap gap-2">
            {KIND_OPTIONS.map((k) => (
              <label key={k.value} className="cursor-pointer">
                <input type="radio" name="kind" value={k.value} defaultChecked={k.value === "info"} className="peer sr-only" />
                <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold ring-2 ring-transparent transition peer-checked:ring-current peer-focus-visible:ring-brand-500 ${k.cls}`}>
                  {k.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <FormField label="Hedef kitle" htmlFor="target" className="sm:col-span-2">
          <FormSelect name="target" value={target} onChange={(e) => setTarget(e.target.value as BroadcastTarget)}>
            {TARGET_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} — {t.hint}
              </option>
            ))}
          </FormSelect>
        </FormField>
        {target === "specific" ? (
          <FormField label="Ofis" htmlFor="bc-tenant" required inject={false} className="sm:col-span-2">
            <Combobox
              id="bc-tenant"
              name="tenant_id"
              required
              clearable={false}
              options={tenantOptions}
              onValueChange={setTenantId}
              onSearch={searchTenantsBroadcast}
              placeholder="Ofis ara ve seçin"
              searchPlaceholder="Ofis adı yazın…"
              emptyText="Eşleşen ofis yok"
            />
          </FormField>
        ) : null}
      </>
    ),
  };

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const title = (values.title ?? "").trim();
    const body = (values.body ?? "").trim();
    const href = (values.href ?? "").trim();
    const kind = KIND_OPTIONS.find((k) => k.value === (values.kind ?? "info")) ?? KIND_OPTIONS[0];
    const tgt = TARGET_OPTIONS.find((t) => t.value === target);
    const count = target === "specific" ? (tenantId ? 1 : null) : audienceCounts[target];
    const tenantLabel = tenantOptions.find((o) => o.value === tenantId)?.label ?? (tenantId ? (display.tenant_id ?? null) : null);
    return (
      <>
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${kind.cls}`}>{kind.label}</span>
          <p className="mt-2 text-sm font-semibold text-ink-950">{title || "Başlık girilmedi"}</p>
          {body ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-text-muted">{body}</p> : null}
          {href ? <p className="mt-1 truncate text-xs font-medium text-brand-600">{href}</p> : null}
        </div>
        <SummaryGroup title="Gönderim özeti">
          <SummaryRow label="Başlık" value={title || "Zorunlu"} muted={!title} tab="icerik" field="title" />
          <SummaryRow label="Mesaj" value={body || "Girilmedi"} muted={!body} tab="icerik" field="body" />
          <SummaryRow label="Bağlantı" value={href || "Girilmedi"} muted={!href} tab="icerik" field="href" />
          <SummaryRow label="Tür" value={kind.label} tab="hedef" field="kind" />
          <SummaryRow label="Hedef" value={tgt?.label ?? "—"} tab="hedef" field="target" />
          {target === "specific" ? (
            <SummaryRow label="Ofis" value={tenantLabel ?? "Seçilmedi"} muted={!tenantLabel} tab="hedef" field="tenant_id" />
          ) : null}
          <SummaryRow
            label="Ulaşacağı ofis"
            value={count === null ? "—" : `${count} ofis`}
            muted={count === null}
            tab="hedef"
            field="target"
          />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni duyuru"
      description="Seçilen ofislerin bildirim kutusuna anlık mesaj iletir. Gönderim geri alınamaz."
      eyebrow="Toplu duyuru"
      breadcrumbs={[{ label: "Duyurular", href: "/admin/duyuru" }, { label: "Yeni duyuru" }]}
      cancelHref="/admin/duyuru"
      submitLabel="Duyuruyu gönder"
      pendingLabel="Gönderiliyor…"
      pending={pending}
      error={error}
      onSubmit={onSubmit}
      tabs={tabs}
      tabPanels={tabPanels}
      summary={renderSummary}
      fieldLabels={FIELD_LABELS}
    />
  );
}
