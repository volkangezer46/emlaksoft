"use client";

import { useCallback, useMemo, useRef } from "react";
import { createCustomer } from "@/app/actions/customers";
import { createRental, createRentCharge, setRentalProcessStep } from "@/app/actions/rentals";
import { saveInspection } from "@/app/actions/rental-inspections";
import { updatePropertyCommissionRate } from "@/app/actions/property-commission-rate";
import { searchCustomers, searchProperties, type PropertySearchOption } from "@/app/actions/lookup";
import { Combobox } from "@/components/ui/combobox";
import { EmailInput } from "@/components/ui/email-input";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { MoneyInput } from "@/components/ui/money-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Wizard, WizardCheckbox, WizardChoice, WizardPanelGroup, WizardStat, type WizardApi } from "@/components/ui/wizard/wizard";
import type { WizardValues } from "@/components/ui/wizard/engine";
import { formatTry } from "@/lib/format";
import { formatMoneyValue } from "@/lib/money-typing";
import { DEFAULT_WORKPLACE_WITHHOLDING_RATE, RENTAL_USAGES, WITHHOLDING_TENANT_NOTE, parseWithholdingRate, splitGrossRent } from "@/lib/rent-withholding";
import { DEFAULT_KEYS, METER_KEYS, METER_LABELS, METER_UNITS } from "@/lib/rentals/inspection";
import { INCREASE_RULES, oneYearTermEnd, parseMoney } from "@/lib/sihirbaz/hesap";
import { RENT_DRAFT_FIELDS, RENT_WIZARD_ID, rentInitialStep, rentPlan, rentRate, rentSteps, rentTotals, type RentStepOptions } from "./kira-adimlar";

export type RentProperty = { id: string; property_code: string; title: string | null; list_price: number | null; commission_rate: number | null };
export type RentCustomer = { id: string; full_name: string | null; phone: string | null };
export type RentApplication = { id: string; customerId: string; customerName: string; propertyId: string; propertyLabel: string; rent: number | null };

/**
 * Kiralama sihirbazı: Mülk → Kiracı (mevcut / hızlı kayıt / onaylı başvuru) → Kira koşulları (TÜFE artışı, aidat,
 * depozito, stopaj) → Teslim (isteğe bağlı) → Özet ve onay. Onay: kira kaydı (atomik) + ilk tahakkuk + teslim kayıtları.
 */
export function KiraSihirbazi({
  userId,
  properties,
  customers,
  applications,
  defaultPropertyId,
  defaultCustomerId,
  defaultMonthlyRent,
  defaultStartDate,
  applicationId,
  sourceNote,
  options,
  submitBlocked,
}: {
  userId: string;
  properties: RentProperty[];
  customers: RentCustomer[];
  /** Onaylı, henüz kiraya bağlanmamış başvurular (müşteri kaydı açılmış). */
  applications: RentApplication[];
  defaultPropertyId: string | null;
  defaultCustomerId: string | null;
  defaultMonthlyRent: number | null;
  /** Sunucudan gelen bugün (YYYY-MM-DD). */
  defaultStartDate: string;
  /** ?basvuru= — onaylı kiracı başvurusu (SP5). */
  applicationId: string | null;
  sourceNote: string | null;
  options: RentStepOptions;
  submitBlocked: string | null;
}) {
  const initialValues = useMemo<WizardValues>(() => {
    const p = defaultPropertyId ? properties.find((x) => x.id === defaultPropertyId) : undefined;
    const c = defaultCustomerId ? customers.find((x) => x.id === defaultCustomerId) : undefined;
    return {
      ...propertyPatch(p),
      renter_mode: applicationId ? "basvuru" : "mevcut",
      renter_customer_id: c?.id ?? "",
      renter_label: c?.full_name ?? "",
      application_id: applicationId ?? "",
      renter_name: "",
      renter_phone: "",
      renter_email: "",
      renter_allow_dup: "",
      monthly_rent: defaultMonthlyRent ? formatMoneyValue(defaultMonthlyRent) : "",
      due_day: "1",
      deposit: "",
      dues: "",
      start_date: defaultStartDate,
      end_date: oneYearTermEnd(defaultStartDate),
      usage: "konut",
      withholding_rate: "0",
      increase_rule: "tufe",
      increase_fixed: "",
      commission_rate: "",
      tenant_pays_fee: "1",
      first_charge: "1",
      notes: "",
      inspection_on: "1",
      inspected_on: defaultStartDate,
      meter_electricity: "",
      meter_water: "",
      meter_gas: "",
      key_0: String(DEFAULT_KEYS[0]?.count ?? 2),
      key_1: String(DEFAULT_KEYS[1]?.count ?? 1),
      key_2: String(DEFAULT_KEYS[2]?.count ?? 1),
      keys_handed: "",
      utilities_done: "",
    };
  }, [defaultPropertyId, defaultCustomerId, defaultMonthlyRent, defaultStartDate, applicationId, properties, customers]);
  const steps = useMemo(() => rentSteps(options), [options]);

  return (
    <Wizard
      id={RENT_WIZARD_ID}
      userId={userId}
      title="Kiralama sihirbazı"
      description={sourceNote ?? "Mülkü kiracıyla eşleştirin, koşulları belirleyin; kira kaydı, ilk tahakkuk ve teslim tek onayla açılır."}
      breadcrumbs={[{ label: "Mülk yönetimi", href: "/app/kiralama" }, { label: "Yeni kira kaydı" }]}
      steps={steps}
      initialValues={initialValues}
      initialStep={rentInitialStep(initialValues)}
      draftFields={RENT_DRAFT_FIELDS}
      cancelHref="/app/kiralama"
      submitLabel="Onayla ve kira kaydını aç"
      submitBlocked={submitBlocked}
      renderStep={(id, api) => <RentStep id={id} api={api} properties={properties} customers={customers} applications={applications} options={options} />}
      aside={(api) => <RentAside v={api.values} />}
      plan={(v, { skipped }) =>
        rentPlan(v, skipped, options, {
          createCustomer: (fd) => createCustomer({}, fd),
          setRate: async (pid, rate) => {
            const r = await updatePropertyCommissionRate(pid, rate);
            return r.ok ? { ok: true } : { ok: false, error: r.error };
          },
          createRental: (fd) => createRental({}, fd),
          createCharge: createRentCharge,
          saveInspection,
          markStep: setRentalProcessStep,
        })
      }
      onComplete={(ctx, notes) => ({
        href: ctx.rentalId ? `/app/kiralama/${ctx.rentalId}` : "/app/kiralama",
        message: ["Kira kaydı oluşturuldu.", ...notes].join(" "),
      })}
      partialHref={(ctx) => (ctx.rentalId ? `/app/kiralama/${ctx.rentalId}` : null)}
    />
  );
}

function propertyPatch(p: { id: string; title: string | null; property_code: string; list_price: number | null; commission_rate: number | null } | undefined): WizardValues {
  return {
    property_id: p?.id ?? "",
    property_label: p ? (p.title ?? p.property_code) : "",
    list_price: p?.list_price != null && p.list_price > 0 ? String(p.list_price) : "",
    property_rate: p?.commission_rate != null && p.commission_rate > 0 ? String(p.commission_rate) : "",
  };
}

function RentStep({
  id,
  api,
  properties,
  customers,
  applications,
  options,
}: {
  id: string;
  api: WizardApi;
  properties: RentProperty[];
  customers: RentCustomer[];
  applications: RentApplication[];
  options: RentStepOptions;
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

  if (id === "mulk") {
    const list = parseMoney(v.list_price);
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Portföy" htmlFor="wz-rent-property" required inject={false} className="sm:col-span-2" error={api.error("wz-rent-property")} hint="Kod, başlık ya da adresle arayın.">
          <Combobox
            id="wz-rent-property"
            aria-label="Portföy"
            clearable={false}
            placeholder="Portföy seçin"
            searchPlaceholder="Kod ya da başlık ara…"
            emptyText="Eşleşen portföy yok"
            onSearch={searchWithMeta}
            value={v.property_id}
            selectedLabel={v.property_label || undefined}
            onValueChange={(pid) => {
              const local = properties.find((p) => p.id === pid);
              const remote = found.current.get(pid);
              const meta = local ?? (remote ? { id: remote.value, title: remote.label, property_code: remote.hint ?? "", list_price: remote.list_price, commission_rate: remote.commission_rate } : undefined);
              api.setMany({ ...propertyPatch(meta), monthly_rent: v.monthly_rent || (meta?.list_price ? formatMoneyValue(meta.list_price) : "") });
            }}
            options={properties.map((p) => ({ value: p.id, label: p.title ?? p.property_code, hint: p.title ? p.property_code : undefined }))}
          />
        </FormField>
        {list ? <p className="text-xs text-text-muted sm:col-span-2">İlan kira bedeli {formatTry(list)} / ay; koşullar adımında değiştirebilirsiniz.</p> : null}
        {v.property_id && !v.property_rate ? (
          options.canSetRate ? (
            <FormField
              label="Komisyon oranı (%)"
              htmlFor="wz-rent-rate"
              required
              error={api.error("wz-rent-rate")}
              hint="Kira hizmet bedeli = aylık kira × oran (%100 = bir aylık kira). Onayla birlikte portföye yazılır."
            >
              <FormInput id="wz-rent-rate" inputMode="decimal" autoComplete="off" placeholder="ör. 100" value={v.commission_rate} onChange={(e) => api.set("commission_rate", e.target.value)} />
            </FormField>
          ) : (
            <p id="wz-rent-rate" tabIndex={-1} className="tone-warning rounded-[var(--radius-control)] px-3 py-2 text-xs sm:col-span-2">
              Portföyde komisyon oranı tanımlı değil; kira kaydı için portföy sorumlusunun oranı girmesi gerekir.
            </p>
          )
        ) : v.property_rate ? (
          <p className="text-xs text-text-muted sm:col-span-2">Portföy komisyon oranı %{v.property_rate.replace(".", ",")} (aylık kira üzerinden).</p>
        ) : null}
      </div>
    );
  }

  if (id === "kiraci") {
    const mode = v.renter_mode || "mevcut";
    return (
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Kiracı kaynağı">
          <WizardChoice name="renter_mode" value="mevcut" checked={mode === "mevcut"} onChange={(m) => api.setMany({ renter_mode: m, application_id: "" })} title="Mevcut müşteri" text="Kayıtlı müşteriyi seçin." />
          {options.canCreateCustomer ? (
            <WizardChoice name="renter_mode" value="yeni" checked={mode === "yeni"} onChange={(m) => api.setMany({ renter_mode: m, application_id: "", renter_customer_id: "", renter_label: "" })} title="Hızlı yeni kayıt" text="Ad ve telefonla müşteri açılır." />
          ) : null}
          {applications.length > 0 || v.application_id ? (
            <WizardChoice name="renter_mode" value="basvuru" checked={mode === "basvuru"} onChange={(m) => api.set("renter_mode", m)} title="Onaylı başvurudan" text="Kefil bilgisi kira kaydına taşınır." />
          ) : null}
        </div>

        {mode === "mevcut" ? (
          <FormField label="Kiracı (müşteri)" htmlFor="wz-renter" required inject={false} error={api.error("wz-renter")} hint="'Kiracı' tip etiketi kayıtta kendiliğinden eklenir.">
            <Combobox
              id="wz-renter"
              aria-label="Kiracı (müşteri)"
              clearable={false}
              placeholder="Müşteri seçin"
              searchPlaceholder="Ad ya da telefon ara…"
              emptyText="Eşleşen müşteri yok"
              onSearch={searchCustomers}
              value={v.renter_customer_id}
              selectedLabel={v.renter_label || (v.renter_customer_id ? "Seçili müşteri" : undefined)}
              onValueChange={(cid) => api.setMany({ renter_customer_id: cid, renter_label: customers.find((c) => c.id === cid)?.full_name ?? "" })}
              options={customers.map((c) => ({ value: c.id, label: c.full_name ?? "İsimsiz", hint: c.phone ?? undefined }))}
            />
          </FormField>
        ) : null}

        {mode === "yeni" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Ad soyad" htmlFor="wz-renter-name" required error={api.error("wz-renter-name")}>
              <FormInput id="wz-renter-name" autoComplete="name" value={v.renter_name} onChange={(e) => api.set("renter_name", e.target.value)} />
            </FormField>
            <FormField label="Telefon" htmlFor="wz-renter-phone" required inject={false} error={api.error("wz-renter-phone")}>
              <PhoneInput id="wz-renter-phone" value={v.renter_phone ?? ""} onValueChange={(stored) => api.set("renter_phone", stored)} />
            </FormField>
            <FormField label="E-posta (isteğe bağlı)" htmlFor="wz-renter-email">
              <EmailInput id="wz-renter-email" value={v.renter_email} onChange={(e) => api.set("renter_email", e.target.value)} />
            </FormField>
            <WizardCheckbox
              className="self-end"
              checked={v.renter_allow_dup === "1"}
              onChange={(c) => api.set("renter_allow_dup", c ? "1" : "")}
              title="Yine de yeni kayıt aç"
              text="Aynı telefon ya da e-postayla kayıtlı müşteri olsa bile."
            />
          </div>
        ) : null}

        {mode === "basvuru" ? (
          <fieldset className="space-y-2">
            <legend id="wz-renter-app" tabIndex={-1} className="mb-1 text-sm font-medium text-ink-950 outline-none">Onaylı başvuru</legend>
            {applications.map((a) => (
              <WizardChoice
                key={a.id}
                name="application_id"
                value={a.id}
                checked={v.application_id === a.id}
                onChange={() => {
                  const p = properties.find((x) => x.id === a.propertyId);
                  api.setMany({
                    application_id: a.id,
                    renter_customer_id: a.customerId,
                    renter_label: a.customerName,
                    ...(a.propertyId !== v.property_id ? { ...propertyPatch(p ?? { id: a.propertyId, title: a.propertyLabel, property_code: "", list_price: null, commission_rate: null }) } : {}),
                    monthly_rent: a.rent ? formatMoneyValue(a.rent) : v.monthly_rent,
                  });
                }}
                title={a.customerName}
                text={`${a.propertyLabel}${a.rent ? ` · ${formatTry(a.rent)} / ay` : ""}`}
              />
            ))}
            {v.application_id && !applications.some((a) => a.id === v.application_id) ? (
              <p className="text-xs text-text-muted">Başvurudan gelindi; kiracı ve portföy başvurudan dolduruldu.</p>
            ) : null}
            {api.error("wz-renter-app") ? <p className="text-xs font-medium text-danger-600">{api.error("wz-renter-app")}</p> : null}
          </fieldset>
        ) : null}
      </div>
    );
  }

  if (id === "kosullar") {
    const rate = parseWithholdingRate(v.withholding_rate) ?? 0;
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Aylık kira (₺)" htmlFor="wz-rent-amount" required error={api.error("wz-rent-amount")}>
          <MoneyInput id="wz-rent-amount" value={v.monthly_rent} onValueChange={(t) => api.set("monthly_rent", t)} placeholder="ör. 25.000" />
        </FormField>
        <FormField label="Vade günü" htmlFor="wz-rent-due" required error={api.error("wz-rent-due")} hint="Ayın kaçında ödenir (1-28).">
          <FormInput id="wz-rent-due" type="number" inputMode="numeric" min="1" max="28" step="1" value={v.due_day} onChange={(e) => api.set("due_day", e.target.value)} />
        </FormField>
        <FormField label="Depozito (₺)" htmlFor="wz-rent-deposit" error={api.error("wz-rent-deposit")} hint="Konutta en çok üç aylık kira (TBK 342).">
          <MoneyInput id="wz-rent-deposit" value={v.deposit} onValueChange={(t) => api.set("deposit", t)} placeholder="ör. 50.000" />
        </FormField>
        <FormField label="Aylık aidat (₺)" htmlFor="wz-rent-dues" hint="Kiracı öder; kira notuna yazılır.">
          <MoneyInput id="wz-rent-dues" value={v.dues} onValueChange={(t) => api.set("dues", t)} placeholder="Yoksa boş" />
        </FormField>
        <FormField label="Başlangıç" htmlFor="wz-rent-start" required error={api.error("wz-rent-start")}>
          <FormInput
            id="wz-rent-start"
            type="date"
            value={v.start_date}
            onChange={(e) => {
              const start = e.target.value;
              // Bitiş elle değiştirilmediyse bir yıllık süreye kayar.
              const auto = !v.end_date || v.end_date === oneYearTermEnd(v.start_date);
              api.setMany({ start_date: start, ...(auto ? { end_date: oneYearTermEnd(start) } : {}), ...(v.inspected_on === v.start_date ? { inspected_on: start } : {}) });
            }}
          />
        </FormField>
        <FormField label="Bitiş" htmlFor="wz-rent-end" error={api.error("wz-rent-end")} hint="Önerilen bir yıl; boş bırakılırsa süresiz.">
          <FormInput id="wz-rent-end" type="date" value={v.end_date} onChange={(e) => api.set("end_date", e.target.value)} />
        </FormField>
        <FormField label="Kira artışı" htmlFor="wz-rent-inc" className={v.increase_rule === "sabit" ? undefined : "sm:col-span-2"}>
          <FormSelect id="wz-rent-inc" value={v.increase_rule} onChange={(e) => api.set("increase_rule", e.target.value)}>
            {INCREASE_RULES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </FormSelect>
        </FormField>
        {v.increase_rule === "sabit" ? (
          <FormField label="Yıllık artış (%)" htmlFor="wz-rent-inc-fixed" required error={api.error("wz-rent-inc-fixed")} hint="Konutta TÜFE tavanını aşamaz.">
            <FormInput id="wz-rent-inc-fixed" inputMode="decimal" value={v.increase_fixed} onChange={(e) => api.set("increase_fixed", e.target.value)} placeholder="ör. 25" />
          </FormField>
        ) : null}
        <FormField label="Kullanım" htmlFor="wz-rent-usage">
          <FormSelect
            id="wz-rent-usage"
            value={v.usage}
            onChange={(e) => {
              const usage = e.target.value === "isyeri" ? "isyeri" : "konut";
              // SP9: işyeri seçilince stopaj (elle değiştirilmediyse) %20 önerisiyle dolar; konuta dönünce 0.
              const untouched = v.withholding_rate === "0" || v.withholding_rate === String(DEFAULT_WORKPLACE_WITHHOLDING_RATE);
              api.setMany({ usage, ...(untouched ? { withholding_rate: usage === "isyeri" ? String(DEFAULT_WORKPLACE_WITHHOLDING_RATE) : "0" } : {}) });
            }}
          >
            {RENTAL_USAGES.map((u) => (
              <option key={u.value} value={u.value}>{u.label}</option>
            ))}
          </FormSelect>
        </FormField>
        <FormField label="Kiracının kestiği stopaj (%)" htmlFor="wz-rent-wh" error={api.error("wz-rent-wh")} hint={v.usage === "isyeri" ? "Kiracı şirket/kurumsa genellikle %20; şahıs kiracıda 0." : "Konut kiracısı şahıssa 0."}>
          <FormInput id="wz-rent-wh" inputMode="decimal" autoComplete="off" value={v.withholding_rate} onChange={(e) => api.set("withholding_rate", e.target.value)} />
        </FormField>
        {rate > 0 ? <p className="rounded-[var(--radius-control)] bg-amber-400/[0.08] px-3 py-2 text-xs leading-relaxed text-text-muted sm:col-span-2">{WITHHOLDING_TENANT_NOTE}</p> : null}
        <div className="grid gap-2 sm:col-span-2">
          <WizardCheckbox
            checked={v.tenant_pays_fee === "1"}
            onChange={(c) => api.set("tenant_pays_fee", c ? "1" : "")}
            title="Hizmet bedelini kiracı öder"
            text="Taşınma maliyetine KDV dahil eklenir (komisyon kaydı her durumda açılır)."
          />
          <WizardCheckbox
            checked={v.first_charge === "1"}
            onChange={(c) => api.set("first_charge", c ? "1" : "")}
            title="İlk ayın kira tahakkukunu şimdi aç"
            text="Sonraki aylar vade gününe göre kendiliğinden oluşur."
          />
        </div>
        <FormField label="Notlar" htmlFor="wz-rent-notes" className="sm:col-span-2" error={api.error("wz-rent-notes")} hint="Artış kuralı ve aidat satırı nota kendiliğinden eklenir.">
          <FormTextarea id="wz-rent-notes" rows={3} value={v.notes} onChange={(e) => api.set("notes", e.target.value)} placeholder="Sözleşme koşulları, özel notlar…" />
        </FormField>
        <div className="sm:col-span-2 xl:hidden">
          <MoveInBlock v={v} />
        </div>
      </div>
    );
  }

  if (id === "teslim") {
    const on = v.inspection_on === "1";
    return (
      <div className="space-y-4">
        <WizardCheckbox
          checked={on}
          onChange={(c) => api.set("inspection_on", c ? "1" : "")}
          title="Teslim tutanağı taslağı aç"
          text="Odalar standart şablonla gelir; durumları ve fotoğrafları tutanak ekranında işaretleyip imzaya gönderirsiniz."
        />
        {on ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Tutanak tarihi" htmlFor="wz-hand-date" required error={api.error("wz-hand-date")} className="sm:col-span-3 sm:max-w-xs">
              <FormInput id="wz-hand-date" type="date" value={v.inspected_on} onChange={(e) => api.set("inspected_on", e.target.value)} />
            </FormField>
            {METER_KEYS.map((k) => (
              <FormField key={k} label={`${METER_LABELS[k]} (${METER_UNITS[k]})`} htmlFor={`wz-meter-${k}`}>
                <FormInput id={`wz-meter-${k}`} inputMode="decimal" value={v[`meter_${k}`] ?? ""} onChange={(e) => api.set(`meter_${k}`, e.target.value)} placeholder="Sayaç değeri" />
              </FormField>
            ))}
            {DEFAULT_KEYS.map((key, i) => (
              <FormField key={key.label} label={key.label} htmlFor={`wz-key-${i}`}>
                <FormInput id={`wz-key-${i}`} type="number" inputMode="numeric" min="0" max="50" value={v[`key_${i}`] ?? ""} onChange={(e) => api.set(`key_${i}`, e.target.value)} />
              </FormField>
            ))}
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <WizardCheckbox checked={v.keys_handed === "1"} onChange={(c) => api.set("keys_handed", c ? "1" : "")} title="Anahtarlar teslim edildi" />
          <WizardCheckbox checked={v.utilities_done === "1"} onChange={(c) => api.set("utilities_done", c ? "1" : "")} title="Abonelikler kiracıya devredildi" />
        </div>
      </div>
    );
  }
  return null;
}

function MoveInBlock({ v }: { v: WizardValues }) {
  const t = rentTotals(v);
  if (!t) {
    return (
      <WizardPanelGroup title="Taşınma maliyeti">
        <p className="px-1 text-xs text-text-muted">Aylık kirayı girince kiracının ilk ödemesi burada hesaplanır.</p>
      </WizardPanelGroup>
    );
  }
  const rate = rentRate(v);
  return (
    <WizardPanelGroup title="Taşınma maliyeti (kiracı)">
      <WizardStat label="İlk ay kira" value={formatTry(t.firstRent)} />
      <WizardStat label="Depozito" value={t.deposit > 0 ? formatTry(t.deposit) : "Yok"} muted={t.deposit === 0} />
      {t.dues > 0 ? <WizardStat label="İlk ay aidat" value={formatTry(t.dues)} /> : null}
      <WizardStat
        label="Hizmet bedeli (KDV dahil)"
        value={t.commissionPaidByTenant > 0 ? formatTry(t.commissionPaidByTenant) : rate == null ? "Oran yok" : "Kiracı ödemiyor"}
        muted={t.commissionPaidByTenant === 0}
      />
      <div className="my-1 border-t border-line" />
      <WizardStat label="Toplam" value={formatTry(t.total)} strong />
    </WizardPanelGroup>
  );
}

function RentAside({ v }: { v: WizardValues }) {
  const t = rentTotals(v);
  const rent = parseMoney(v.monthly_rent);
  const wh = parseWithholdingRate(v.withholding_rate) ?? 0;
  const split = rent ? splitGrossRent(rent, wh) : null;
  return (
    <>
      <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
        <p className="line-clamp-2 text-sm font-semibold text-ink-950">{v.property_label || "Portföy seçilmedi"}</p>
        <p className="mt-0.5 truncate text-xs text-text-muted">
          {v.renter_mode === "yeni" ? (v.renter_name ? `Kiracı: ${v.renter_name}` : "Yeni kiracı") : v.renter_label ? `Kiracı: ${v.renter_label}` : "Kiracı seçilmedi"}
        </p>
        <p className="numeric mt-2 text-lg font-bold text-ink-950">{rent ? `${formatTry(rent)} / ay` : "Kira girilmedi"}</p>
        {t ? <p className="numeric text-xs text-text-muted">Yıllık {formatTry(t.annualRent)}</p> : null}
      </div>
      <MoveInBlock v={v} />
      {t && (t.commissionNet > 0 || (split && split.withholding > 0)) ? (
        <WizardPanelGroup title="Ofis ve malik">
          {t.commissionNet > 0 ? <WizardStat label="Hizmet bedeli (KDV hariç)" value={formatTry(t.commissionNet)} /> : null}
          {split && split.withholding > 0 ? (
            <>
              <WizardStat label={`Stopaj (%${String(wh).replace(".", ",")})`} value={formatTry(split.withholding)} />
              <WizardStat label="Malike net / ay" value={formatTry(split.net)} />
            </>
          ) : null}
        </WizardPanelGroup>
      ) : null}
    </>
  );
}
