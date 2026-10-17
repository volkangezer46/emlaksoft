"use client";

import { useCallback, useMemo, useRef } from "react";
import Link from "@/components/ui/smart-link";
import { TriangleAlert } from "lucide-react";
import { createPipelineDeal } from "@/app/actions/deals";
import { createOffer } from "@/app/actions/offers";
import { updatePropertyCommissionRate } from "@/app/actions/property-commission-rate";
import { searchCustomers, searchProperties, type PropertySearchOption } from "@/app/actions/lookup";
import { CustomFieldInputs, type CustomFieldInputDef } from "@/components/app/custom-field-inputs";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect } from "@/components/ui/form-controls";
import { MoneyInput } from "@/components/ui/money-input";
import { Wizard, WizardCheckbox, WizardPanelGroup, WizardStat, type WizardApi } from "@/components/ui/wizard/wizard";
import { dealTypeLabel } from "@/lib/deal-type-label";
import type { WizardValues } from "@/components/ui/wizard/engine";
import { formatTry } from "@/lib/format";
import { formatMoneyValue } from "@/lib/money-typing";
import { parseMoney, salePreview, type SplitInput } from "@/lib/sihirbaz/hesap";
import {
  OPEN_STAGES,
  SALE_DRAFT_FIELDS,
  SALE_WIZARD_ID,
  dealTypeForProperty,
  effectiveRate,
  saleInitialStep,
  salePlan,
  saleSteps,
} from "./satis-adimlar";

export type SaleProperty = {
  id: string;
  property_code: string;
  title: string | null;
  list_price: number | null;
  transaction_type: string;
  commission_rate: number | null;
  hint?: string;
};
type OpenDeal = { id: string; stageLabel: string; value: number | null; propertyLabel: string | null };

const STAGE_HELP: Record<string, string> = {
  new: "Ön görüşme; portföy, müşteri ve yetki belgesi şart değil.",
  qualified: "Müşteri ciddi ve bütçesi uygun; yetki belgesi henüz şart değil.",
  negotiation: "Fiyat pazarlığı başladı; portföy, müşteri ve yazılı yetki belgesi zorunlu.",
};

const addLink = "mt-1 inline-flex min-h-11 items-center text-xs font-semibold text-brand-600 underline underline-offset-2";

/**
 * Satış sihirbazı: Müşteri → Portföy (Önerilen + mükerrer uyarısı) → Fiyat ve komisyon (canlı hesap) →
 * Belgeler ve teklif (isteğe bağlı) → Özet ve onay. Kayıt TEK onayla mevcut action'larla (`satis-adimlar.ts`).
 */
export function SatisSihirbazi({
  userId,
  properties,
  customers,
  defaultPropertyId,
  defaultCustomerId,
  stageNames,
  customFields,
  openDeals,
  splits,
  canOffer,
  canSetRate,
  today,
}: {
  userId: string;
  properties: SaleProperty[];
  customers: { id: string; full_name: string }[];
  defaultPropertyId?: string;
  defaultCustomerId?: string;
  stageNames: Record<string, string>;
  customFields: CustomFieldInputDef[];
  /** Ön seçili müşterinin açık anlaşmaları (mükerrer uyarısı, WP2). */
  openDeals: OpenDeal[];
  /** Ofis paylaşım kuralı (danışman/ofis). */
  splits: SplitInput[];
  canOffer: boolean;
  canSetRate: boolean;
  today: string;
}) {
  const nameOf = useCallback((k: string) => stageNames[k] ?? k, [stageNames]);
  const initialValues = useMemo<WizardValues>(() => {
    const p = defaultPropertyId ? properties.find((x) => x.id === defaultPropertyId) : undefined;
    const c = defaultCustomerId ? customers.find((x) => x.id === defaultCustomerId) : undefined;
    return {
      customer_id: c?.id ?? "",
      customer_label: c?.full_name ?? "",
      ...propertyPatch(p),
      deal_type: dealTypeForProperty(p?.transaction_type),
      stage: "new",
      deal_value: "",
      has_authority: "",
      commission_rate: "",
      teklif: "",
      offer_amount: "",
      offer_valid_until: "",
    };
  }, [defaultCustomerId, defaultPropertyId, customers, properties]);

  const steps = useMemo(
    () =>
      saleSteps({
        canOffer,
        canSetRate,
        splits,
        stageName: nameOf,
        today,
        requiredCustomFields: customFields.filter((f) => f.required).map((f) => ({ name: `cf_${f.id}`, fieldId: `yeni-cf-${f.id}`, label: f.label })),
      }),
    [canOffer, canSetRate, splits, nameOf, today, customFields],
  );
  const cfNames = useMemo(() => customFields.map((f) => `cf_${f.id}`), [customFields]);

  const duplicate = (v: WizardValues) => (v.customer_id && v.customer_id === defaultCustomerId ? openDeals[0] : undefined);

  return (
    <Wizard
      id={SALE_WIZARD_ID}
      userId={userId}
      title="Satış sihirbazı"
      description="Müşteri ve portföyü eşleştirin, tutarı ve komisyonu görün, tek onayla anlaşmayı açın."
      breadcrumbs={[{ label: "Anlaşmalar", href: "/app/anlasmalar" }, { label: "Yeni anlaşma" }]}
      steps={steps}
      initialValues={initialValues}
      initialStep={saleInitialStep(initialValues)}
      draftFields={SALE_DRAFT_FIELDS}
      cancelHref="/app/anlasmalar"
      submitLabel="Onayla ve anlaşmayı aç"
      renderStep={(id, api) => (
        <StepBody
          id={id}
          api={api}
          properties={properties}
          customers={customers}
          nameOf={nameOf}
          customFields={customFields}
          canSetRate={canSetRate}
          splits={splits}
          today={today}
          duplicate={duplicate(api.values)}
          openDealCount={openDeals.length}
        />
      )}
      aside={(api) => <SaleAside v={api.values} splits={splits} nameOf={nameOf} />}
      reviewExtra={(api) =>
        api.values.stage === "negotiation" ? (
          <p className="text-xs text-text-muted">
            {nameOf("negotiation")} aşamasında anlaşma açılır; kazanıldı kapanışı anlaşma detayındaki Kapanış sihirbazından yapılır.
          </p>
        ) : null
      }
      plan={(v, { skipped }) =>
        salePlan(
          v,
          skipped,
          {
            createDeal: createPipelineDeal,
            setRate: async (pid, rate) => {
              const r = await updatePropertyCommissionRate(pid, rate);
              return r.ok ? { ok: true } : { ok: false, error: r.error };
            },
            createOffer: (fd) => createOffer({}, fd),
          },
          cfNames,
        )
      }
      onComplete={(ctx, notes) => ({
        href: ctx.dealId ? `/app/anlasmalar/${ctx.dealId}` : "/app/anlasmalar",
        message: ["Anlaşma satış sürecine eklendi.", ...notes].join(" "),
      })}
      partialHref={(ctx) => (ctx.dealId ? `/app/anlasmalar/${ctx.dealId}` : null)}
    />
  );
}

function propertyPatch(p: { id: string; title: string | null; property_code: string; list_price: number | null; transaction_type: string | null; commission_rate: number | null } | undefined): WizardValues {
  return {
    property_id: p?.id ?? "",
    property_label: p ? (p.title ?? "Başlıksız portföy") : "",
    property_code: p?.property_code ?? "",
    list_price: p?.list_price != null && p.list_price > 0 ? String(p.list_price) : "",
    transaction_type: p?.transaction_type ?? "",
    property_rate: p?.commission_rate != null && p.commission_rate > 0 ? String(p.commission_rate) : "",
  };
}

function StepBody({
  id,
  api,
  properties,
  customers,
  nameOf,
  customFields,
  canSetRate,
  splits,
  today,
  duplicate,
  openDealCount,
}: {
  id: string;
  api: WizardApi;
  properties: SaleProperty[];
  customers: { id: string; full_name: string }[];
  nameOf: (k: string) => string;
  customFields: CustomFieldInputDef[];
  canSetRate: boolean;
  splits: SplitInput[];
  today: string;
  duplicate?: OpenDeal;
  openDealCount: number;
}) {
  const v = api.values;
  const found = useRef(new Map<string, PropertySearchOption>());
  const searchWithMeta = useCallback(
    async (q: string) => {
      const res = await searchProperties(q);
      for (const r of res) found.current.set(r.value, r);
      return res;
    },
    [],
  );

  if (id === "musteri") {
    return (
      <div className="grid gap-4">
        <FormField label="Müşteri" htmlFor="wz-deal-customer" inject={false} error={api.error("wz-deal-customer")} hint="Ad ya da telefonla arayın; ilk liste son eklenenlerdir.">
          <Combobox
            id="wz-deal-customer"
            aria-label="Müşteri"
            placeholder="Seçilmedi"
            searchPlaceholder="Müşteri ara…"
            emptyText="Eşleşen müşteri yok"
            onSearch={searchCustomers}
            value={v.customer_id}
            selectedLabel={v.customer_label || (v.customer_id ? "Seçili müşteri" : undefined)}
            onValueChange={(cid) => {
              const c = customers.find((x) => x.id === cid);
              api.setMany({ customer_id: cid, customer_label: c?.full_name ?? "" });
            }}
            options={customers.map((c) => ({ value: c.id, label: c.full_name }))}
          />
          <Link href="/app/musteriler/yeni" className={addLink}>Yeni müşteri ekle</Link>
        </FormField>
        {duplicate ? (
          <p role="status" className="tone-warning flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              Bu müşterinin açık anlaşması var: {[duplicate.stageLabel, duplicate.value ? formatTry(duplicate.value) : null, duplicate.propertyLabel].filter(Boolean).join(" · ")}
              {openDealCount > 1 ? ` (+${openDealCount - 1} açık anlaşma daha)` : ""}
            </span>
            <Link href={`/app/anlasmalar/${duplicate.id}`} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2">Aç</Link>
          </p>
        ) : null}
      </div>
    );
  }

  if (id === "portfoy") {
    const suggested = properties.filter((p) => p.hint?.startsWith("Önerilen"));
    return (
      <div className="grid gap-4">
        <FormField label="Portföy" htmlFor="wz-deal-property" inject={false} error={api.error("wz-deal-property")} hint="Kod, başlık ya da adresle arayın.">
          <Combobox
            id="wz-deal-property"
            aria-label="Portföy"
            placeholder="Seçilmedi"
            searchPlaceholder="Kod ya da başlık ara…"
            emptyText="Eşleşen portföy yok"
            onSearch={searchWithMeta}
            value={v.property_id}
            selectedLabel={v.property_label || undefined}
            onValueChange={(pid) => {
              const local = properties.find((p) => p.id === pid);
              const remote = found.current.get(pid);
              const meta = local ?? (remote
                ? { id: remote.value, title: remote.label, property_code: remote.hint ?? "", list_price: remote.list_price, transaction_type: remote.transaction_type ?? "", commission_rate: remote.commission_rate }
                : undefined);
              const patch = propertyPatch(meta);
              // Tür, portföyün işlem türünden önerilir (Kiralık → Kiralama); fiyat adımında değiştirilebilir.
              api.setMany({ ...patch, deal_type: meta ? dealTypeForProperty(meta.transaction_type) : v.deal_type });
            }}
            options={properties.map((p) => ({ value: p.id, label: p.title ?? "Başlıksız", hint: p.hint ?? p.property_code }))}
          />
          {properties.length === 0 ? <Link href="/app/portfoyler/yeni" className={addLink}>Yeni portföy ekle</Link> : null}
        </FormField>
        {suggested.length > 0 ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-ink-950">Önerilen portföyler</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {suggested.slice(0, 4).map((p) => {
                const active = v.property_id === p.id;
                return (
                  <li key={p.id}>
                    <Button
                      variant="secondary"
                      onClick={() => api.setMany({ ...propertyPatch(p), deal_type: dealTypeForProperty(p.transaction_type) })}
                      aria-pressed={active}
                      className={
                        "h-auto min-h-11 w-full flex-col items-start justify-start gap-0 rounded-[var(--radius-card)] px-3 py-2 text-left font-normal " +
                        (active ? "border-[var(--gold-400)] bg-[color-mix(in_srgb,var(--gold-300)_10%,var(--surface))]" : "")
                      }
                    >
                      <span className="line-clamp-1 text-sm font-semibold text-ink-950">{p.title ?? "Başlıksız"}</span>
                      <span className="line-clamp-1 text-xs text-text-muted">{p.hint}</span>
                      {p.list_price ? <span className="numeric mt-0.5 text-xs font-semibold text-ink-950">{formatTry(p.list_price)}</span> : null}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  if (id === "fiyat") {
    const list = parseMoney(v.list_price);
    const needsRate = Boolean(v.property_id) && !v.property_rate;
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Tür" htmlFor="wz-deal-type">
          <FormSelect id="wz-deal-type" value={v.deal_type} onChange={(e) => api.set("deal_type", e.target.value)}>
            <option value="sale">Satış</option>
            <option value="rent">Kiralama</option>
          </FormSelect>
        </FormField>
        <FormField label="Aşama" htmlFor="wz-deal-stage" hint={STAGE_HELP[v.stage] ?? STAGE_HELP.new} error={api.error("wz-deal-stage")}>
          <FormSelect id="wz-deal-stage" value={v.stage} onChange={(e) => api.set("stage", e.target.value)}>
            {OPEN_STAGES.map((s) => (
              <option key={s} value={s}>{nameOf(s)}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField
          label="Tutar (₺)"
          htmlFor="wz-deal-value"
          required
          className="sm:col-span-2"
          error={api.error("wz-deal-value")}
          hint={
            list ? (
              <>
                Liste fiyatı {formatTry(list)}.{" "}
                <Button type="button" variant="ghost" size="xs" className="font-semibold text-brand-600" onClick={() => api.set("deal_value", formatMoneyValue(list))}>
                  Liste fiyatını yaz
                </Button>
              </>
            ) : (
              "Pazarlıkta konuşulan tutar; kapanışta güncelleyebilirsiniz."
            )
          }
        >
          <MoneyInput id="wz-deal-value" value={v.deal_value} onValueChange={(text) => api.set("deal_value", text)} placeholder={list ? formatMoneyValue(list) : "ör. 4.500.000"} />
        </FormField>
        {needsRate ? (
          canSetRate ? (
            <FormField
              label="Komisyon oranı (%)"
              htmlFor="wz-deal-rate"
              error={api.error("wz-deal-rate")}
              hint="Portföyde oran tanımlı değil. Girerseniz onayla birlikte portföye yazılır (kapanış için gerekli)."
            >
              <FormInput id="wz-deal-rate" inputMode="decimal" autoComplete="off" placeholder="ör. 2" value={v.commission_rate} onChange={(e) => api.set("commission_rate", e.target.value)} />
            </FormField>
          ) : (
            <p className="tone-warning rounded-[var(--radius-control)] px-3 py-2 text-xs sm:col-span-2">
              Portföyde komisyon oranı tanımlı değil; kapanıştan önce portföy sorumlusu oranı girmeli.
            </p>
          )
        ) : null}
        <WizardCheckbox
          id="wz-deal-authority"
          tone="mint"
          className="sm:col-span-2"
          checked={v.has_authority === "1"}
          onChange={(on) => api.set("has_authority", on ? "1" : "")}
          title="Yazılı yetki belgesi onaylı"
          text={`${nameOf("negotiation")} ve ${nameOf("won")} aşamaları için gerekli.`}
          error={api.error("wz-deal-authority")}
        />
        <div className="sm:col-span-2 xl:hidden">
          <CommissionBlock v={v} splits={splits} />
        </div>
        <CustomFieldInputs defs={customFields} values={v} onFieldChange={(name, value) => api.set(name, value)} />
      </div>
    );
  }

  if (id === "teklif") {
    const on = v.teklif === "1";
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <WizardCheckbox
          id="wz-offer-toggle"
          className="sm:col-span-2"
          checked={on}
          onChange={(checked) => api.setMany({ teklif: checked ? "1" : "", offer_amount: v.offer_amount || v.deal_value })}
          title="Alıcının teklifini şimdi kaydet"
          text="Teklif portföyün pazarlık geçmişine düşer; satıcıya gösterim teklifler ekranından yapılır."
          error={api.error("wz-offer-toggle")}
        />
        {on ? (
          <>
            <FormField label="Teklif tutarı (₺)" htmlFor="wz-offer-amount" required error={api.error("wz-offer-amount")}>
              <MoneyInput id="wz-offer-amount" value={v.offer_amount} onValueChange={(text) => api.set("offer_amount", text)} />
            </FormField>
            <FormField label="Teklif son tarihi" htmlFor="wz-offer-until" error={api.error("wz-offer-until")} hint="Boş bırakılabilir.">
              <FormInput id="wz-offer-until" type="date" min={today} value={v.offer_valid_until} onChange={(e) => api.set("offer_valid_until", e.target.value)} />
            </FormField>
          </>
        ) : null}
        <p className="text-xs text-text-muted sm:col-span-2">
          Tapu, kimlik ve yetki belgesi gibi evraklar anlaşma açılınca <strong className="text-ink-950">Belgeler</strong> sekmesindeki evrak dosyasında
          toplanır; sözleşme taslağı Sözleşmeler ekranından anlaşmaya bağlanır.
        </p>
      </div>
    );
  }
  return null;
}

function CommissionBlock({ v, splits }: { v: WizardValues; splits: SplitInput[] }) {
  const value = parseMoney(v.deal_value);
  const rate = effectiveRate(v);
  const p = salePreview(value, rate, splits);
  if (!p) {
    return (
      <WizardPanelGroup title="Komisyon">
        <p className="px-1 text-xs text-text-muted">
          {value == null ? "Tutarı girince komisyon ve paylar burada hesaplanır." : "Komisyon oranı olmadan hesap gösterilmez."}
        </p>
      </WizardPanelGroup>
    );
  }
  return (
    <WizardPanelGroup title={`Komisyon (%${String(rate).replace(".", ",")})`}>
      <WizardStat label="KDV hariç" value={formatTry(p.net)} />
      <WizardStat label="KDV" value={formatTry(p.vat)} />
      <WizardStat label="Tahsil edilecek" value={formatTry(p.gross)} strong />
      <div className="my-1 border-t border-line" />
      {p.rows.map((r) => (
        <WizardStat key={r.label} label={`${r.label} (%${String(r.rate).replace(".", ",")})`} value={formatTry(r.amount)} />
      ))}
      {p.remainderRate > 0 ? <WizardStat label={`Paylaştırılmayan (%${String(p.remainderRate).replace(".", ",")})`} value={formatTry(p.remainderAmount)} muted /> : null}
      <p className="px-1 pt-1 text-xs leading-snug text-text-faint">Ofis paylaşım kuralı. Paylar kapanışta kesinleşir; danışman rolünde değişiklik yönetici onayına gider.</p>
    </WizardPanelGroup>
  );
}

function SaleAside({ v, splits, nameOf }: { v: WizardValues; splits: SplitInput[]; nameOf: (k: string) => string }) {
  const value = parseMoney(v.deal_value);
  const list = parseMoney(v.list_price);
  return (
    <>
      <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
        <p className="line-clamp-2 text-sm font-semibold text-ink-950">{v.property_label || "Portföy seçilmedi"}</p>
        <p className="mt-0.5 truncate text-xs text-text-muted">{v.customer_label || (v.customer_id ? "Seçili müşteri" : "Müşteri seçilmedi")}</p>
        <p className="numeric mt-2 text-lg font-bold text-ink-950">{value != null ? formatTry(value) : "Tutar girilmedi"}</p>
        {value != null && list ? (
          <p className="numeric text-xs text-text-muted">
            Liste fiyatı {formatTry(list)} · %{new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 1 }).format((value / list) * 100)}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-text-muted">{dealTypeLabel(v.deal_type)} · {nameOf(v.stage || "new")}</p>
      </div>
      <CommissionBlock v={v} splits={splits} />
    </>
  );
}
