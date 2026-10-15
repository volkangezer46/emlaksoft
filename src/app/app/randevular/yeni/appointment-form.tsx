"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { Check, ChevronsUpDown, MapPin, Sparkles, TriangleAlert } from "lucide-react";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createAppointment } from "@/app/actions/appointments";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useCreateForm } from "@/components/app/use-create-form";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import {
  SubmitConfirmBand,
  SummaryGroup,
  SummaryRow,
  TabbedFormShell,
  type FormTab,
  type TabbedSummaryContext,
} from "@/components/ui/tabbed-form-shell";
import { isPast, parseTrLocalDateTime } from "@/lib/clock";
import { APPOINTMENT_DRAFT_FIELDS, APPOINTMENT_FORM_ID, APPOINTMENT_TABS, appointmentMissing } from "./appointment-tabs";
import { PersonSelect } from "@/components/ui/person-select";
import { DueQuickPicks, setNativeInputValue } from "@/components/ui/due-quick-picks";

type Option = { id: string; label: string };

const TAB_ICONS = {
  zaman: TI.zaman,
  katilimci: TI.katilimci,
} as const;

const FIELD_LABELS = { appointment_type: "Randevu türü", date: "Tarih", time: "Saat" };

/** "YYYY-MM-DD" -> "GG.AA.YYYY" (saat dilimi dönüşümü yok, yalnız biçim). */
function dayLabel(value: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

export function AppointmentForm({
  customers,
  properties,
  typeOptions,
  defaultCustomerId,
  defaultPropertyId,
  defaultDate,
  defaultTime,
  userId,
  advisors,
}: {
  customers: Option[];
  properties: Option[];
  typeOptions: { value: string; label: string }[];
  /** ?customer= — müşteri kartından "Randevu ver" ön seçimi. */
  defaultCustomerId?: string;
  /** ?property= — eşleştirmeden "Randevu ver" ön seçimi. */
  defaultPropertyId?: string;
  /** Sunucudan gelen gün (YYYY-MM-DD; bugün ya da gece yarısı geçtiyse yarın) ya da ?tarih= ön dolgusu. */
  defaultDate: string;
  /** ?saat= (HH:MM); yoksa şimdiden sonraki ilk yarım saat (ileri gün için 10:00). */
  defaultTime: string;
  userId: string;
  /** Yalnız yönetim katmanında dolu: başka danışman adına randevu açma seçici listesi. */
  advisors?: Option[];
}) {
  // Sunucu çakışma bulursa kayıt YAPILMAZ ve conflictWarning döner; form uyarı
  // bandı + gizli confirm_conflict=1 ile ikinci gönderimde kayıt geçer.
  const { state, onSubmit, pending } = useCreateForm((fd) => createAppointment(fd), {
    // Müşteri iletisi sonucu dürüstçe söylenir: SMS gittiyse "gönderildi", kanal yoksa satırdaki WhatsApp bağlantısı.
    successMessage: (r) =>
      r.customerMessage === "sms_sent"
        ? "Randevu planlandı · müşteriye teyit SMS'i gönderildi"
        : r.customerMessage === "no_channel" || r.customerMessage === "sms_failed"
          ? "Randevu planlandı · teyidi satırdaki ⋮ > WhatsApp'ta teyit gönder ile iletin"
          : "Randevu planlandı",
    redirectTo: () => "/app/randevular",
  });
  const conflictWarning = state.conflictWarning ?? null;
  const error = !conflictWarning && state.error ? state.error : null;

  // Geçmiş saat: ilk gönderimde satır içi onay istenir; onaylanan "tarihTsaat" değeri bir sonraki gönderimde geçer.
  const [pastAsk, setPastAsk] = useState<string | null>(null);
  const pastOk = useRef<string | null>(null);
  const quickRef = useRef<HTMLDivElement>(null);
  function guardedSubmit(e: FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const key = `${String(fd.get("date") ?? "")}T${String(fd.get("time") ?? "")}`;
    const at = parseTrLocalDateTime(key);
    if (at && isPast(at) && pastOk.current !== key) {
      e.preventDefault();
      setPastAsk(key);
      return;
    }
    setPastAsk(null);
    onSubmit(e);
  }

  const tabs: FormTab[] = useMemo(
    () =>
      APPOINTMENT_TABS.map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
        icon: TAB_ICONS[t.id],
        fields: [...t.fields],
        required: [...t.required],
      })),
    [],
  );

  const tabPanels = {
    zaman: (
      <>
        {/* Kısa liste: yerel seçici kalır (mobilde OS seçicisi); görünümü Combobox tetikleyicisiyle aynı. */}
        <FormField label="Randevu türü" htmlFor="appointment-type" required inject={false}>
          <div className="relative">
            <FormSelect
              id="appointment-type"
              name="appointment_type"
              required
              aria-required="true"
              defaultValue="showing"
              className="focus-ring cursor-pointer appearance-none pr-9 hover:border-brand-300"
            >
              {typeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </FormSelect>
            <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
          </div>
        </FormField>
        <FormField label="Süre (dk)" htmlFor="appointment-duration">
          <FormInput name="duration_min" inputMode="numeric" placeholder="45" />
        </FormField>
        <FormField label="Tarih" htmlFor="appointment-date" required>
          <FormInput name="date" type="date" required defaultValue={defaultDate} />
        </FormField>
        <FormField label="Saat" htmlFor="appointment-time" required>
          <FormInput name="time" type="time" required defaultValue={defaultTime} />
        </FormField>
        {/* GA-04 hazır zaman çipleri: tarih + saat alanlarını tek dokunuşla doldurur (TR saati). */}
        <div ref={quickRef} className="sm:col-span-2 -mt-2">
          <DueQuickPicks
            label="Hızlı zaman seçimi"
            presets={["today18", "tomorrow10", "monday10", "nextweek"]}
            onPick={(local) => {
              const form = quickRef.current?.closest("form");
              const [d, t] = local.split("T");
              setNativeInputValue(form?.elements.namedItem("date") as HTMLInputElement | null, d ?? "");
              setNativeInputValue(form?.elements.namedItem("time") as HTMLInputElement | null, t ?? "");
            }}
          />
        </div>
      </>
    ),
    katilimci: (
      <>
        {advisors && advisors.length > 0 ? (
          <FormField label="Danışman" htmlFor="appointment-advisor" hint="Boş bırakırsanız randevu sizin adınıza açılır." className="sm:col-span-2">
            <PersonSelect
              id="appointment-advisor"
              name="assigned_to"
              defaultValue={userId}
              required
              people={advisors.map((a) => ({ id: a.id, name: a.id === userId ? `${a.label} (ben)` : a.label }))}
              featuredIds={[userId]}
              emptyLabel="Danışman seçin"
            />
          </FormField>
        ) : null}
        <p className="text-xs text-text-muted sm:col-span-2">
          Yer göstermede müşteri ve portföy zorunludur; diğer türlerde en az birini seçin.
        </p>
        <FormField label="Müşteri" htmlFor="appointment-customer" inject={false}>
          <Combobox
            id="appointment-customer"
            name="customer_id"
            aria-label="Müşteri"
            placeholder="Seçiniz"
            searchPlaceholder="Müşteri ara…"
            emptyText="Eşleşen müşteri yok"
            onSearch={searchCustomers}
            defaultValue={defaultCustomerId}
            options={customers.map((c) => ({ value: c.id, label: c.label }))}
          />
        </FormField>
        <FormField label="Portföy" htmlFor="appointment-property" inject={false}>
          <Combobox
            id="appointment-property"
            name="property_id"
            aria-label="Portföy"
            placeholder="Seçiniz"
            searchPlaceholder="Portföy ara…"
            emptyText="Eşleşen portföy yok"
            onSearch={searchProperties}
            defaultValue={defaultPropertyId}
            options={properties.map((p) => ({ value: p.id, label: p.label }))}
          />
        </FormField>
        <FormField label="Konum" htmlFor="appointment-location" inject={false} className="sm:col-span-2">
          <div className="relative">
            <FormInput id="appointment-location" name="location" className="pr-9" placeholder="Kadıköy, İstanbul" />
            <MapPin className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          </div>
        </FormField>
        <FormField label="Not" htmlFor="appointment-notes" className="sm:col-span-2">
          <FormTextarea name="notes" rows={3} placeholder="Talep, hazırlık, dikkat edilecekler…" />
        </FormField>
      </>
    ),
  };

  function renderSummary({ values, display }: TabbedSummaryContext) {
    const typeLabel = typeOptions.find((o) => o.value === values.appointment_type)?.label;
    const day = dayLabel(values.date);
    const time = (values.time ?? "").trim();
    const duration = (values.duration_min ?? "").trim();
    const customerId = (values.customer_id ?? "").trim();
    const propertyId = (values.property_id ?? "").trim();
    const customer = customerId ? (customers.find((c) => c.id === customerId)?.label ?? display.customer_id ?? null) : null;
    const property = propertyId ? (properties.find((p) => p.id === propertyId)?.label ?? display.property_id ?? null) : null;
    const location = (values.location ?? "").trim();
    const notes = (values.notes ?? "").trim();
    return (
      <>
        {conflictWarning ? (
          <p className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-400/10 p-2.5 text-xs font-medium leading-relaxed text-amber-700">
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>{conflictWarning}</span>
          </p>
        ) : null}
        <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
          <p className="text-xs text-text-muted">{typeLabel ?? "Tür seçilmedi"}</p>
          <p className="numeric mt-0.5 text-sm font-semibold text-ink-950">
            {day && time ? `${day} · ${time}` : "Tarih ve saat girilmedi"}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">{duration ? `${duration} dk` : "Süre belirtilmedi"}</p>
        </div>
        <SummaryGroup title="Randevu bilgisi">
          <SummaryRow label="Tarih" value={day ?? "Zorunlu"} muted={!day} tab="zaman" field="date" />
          <SummaryRow label="Saat" value={time || "Zorunlu"} muted={!time} tab="zaman" field="time" />
          {advisors && advisors.length > 0 ? (
            <SummaryRow
              label="Danışman"
              value={advisors.find((a) => a.id === (values.assigned_to ?? userId))?.label ?? "Ben"}
              tab="katilimci"
              field="assigned_to"
            />
          ) : null}
          <SummaryRow label="Müşteri" value={customer ?? "Seçilmedi"} muted={!customer} tab="katilimci" field="customer_id" />
          <SummaryRow label="Portföy" value={property ?? "Seçilmedi"} muted={!property} tab="katilimci" field="property_id" />
          <SummaryRow label="Konum" value={location || "Girilmedi"} muted={!location} tab="katilimci" field="location" />
          <SummaryRow label="Not" value={notes || "Girilmedi"} muted={!notes} tab="katilimci" field="notes" />
        </SummaryGroup>
      </>
    );
  }

  return (
    <TabbedFormShell
      title="Yeni randevu planla"
      description="Yer gösterme, değerleme veya ofis görüşmesi ekleyin."
      breadcrumbs={[{ label: "Randevular", href: "/app/randevular" }, { label: "Yeni randevu" }]}
      cancelHref="/app/randevular"
      submitLabel={conflictWarning ? "Yine de kaydet" : "Randevuyu planla"}
      pendingLabel="Planlanıyor…"
      submitIcon={Check}
      pending={pending}
      error={error}
      onSubmit={guardedSubmit}
      tabs={tabs}
      rules={appointmentMissing}
      tabPanels={tabPanels}
      summary={renderSummary}
      saveAndNew
      fieldLabels={FIELD_LABELS}
      draft={{ userId, formId: APPOINTMENT_FORM_ID, fields: [...APPOINTMENT_DRAFT_FIELDS] }}
      notice={
        <>
          {pastAsk ? (
            <SubmitConfirmBand
              message={`Seçilen zaman geçmişte (${dayLabel(pastAsk.slice(0, 10)) ?? pastAsk.slice(0, 10)} ${pastAsk.slice(11, 16)}). Geçmiş tarihli randevu olarak kaydedilsin mi?`}
              confirmLabel="Evet, kaydet"
              backLabel="Saati değiştir"
              backTab="zaman"
              backField="time"
              onConfirm={() => {
                pastOk.current = pastAsk;
              }}
              onBack={() => setPastAsk(null)}
            />
          ) : null}
          {conflictWarning ? (
            <div
              className="flex items-start gap-2.5 rounded-[var(--radius-card)] border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-xs font-medium leading-relaxed text-amber-700"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                <strong>{conflictWarning}</strong> Randevu henüz kaydedilmedi — yine de planlamak
                istiyorsanız &quot;Yine de kaydet&quot; ile devam edin.
              </span>
              <input type="hidden" name="confirm_conflict" value="1" />
            </div>
          ) : null}
          <p className="flex items-center gap-2 rounded-[var(--radius-card)] border border-brand-300/40 bg-brand-600/5 px-4 py-3 text-xs font-semibold text-brand-600">
            <Sparkles className="h-4 w-4 shrink-0" /> Randevu “teyit bekliyor” olarak açılır; onaylayıp tamamlandığında komisyon akışına kaynak olur.
          </p>
        </>
      }
    />
  );
}
