"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { Check, Clock, Link2, MapPin, TriangleAlert } from "lucide-react";
import { HelperText } from "@/components/ui/simple-kit";
import { Button } from "@/components/ui/button";
import { TAB_ICONS as TI } from "@/lib/icons";
import { createAppointment, type AppointmentResult } from "@/app/actions/appointments";
import { appointmentPropertyContext, suggestAppointmentSlots, type AppointmentSlotSuggestion } from "@/app/actions/appointment-quick";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { useToast } from "@/components/app/toast-provider";
import { clearActiveFormDrafts } from "@/components/app/use-form-draft";
import { InlineCustomerQuickAdd } from "@/components/app/inline-customer-quick-add";
import { Combobox } from "@/components/ui/combobox";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { SubmitConfirmBand, TabbedFormShell, type FormTab } from "@/components/ui/tabbed-form-shell";
import { PersonSelect } from "@/components/ui/person-select";
import { FilterChip, filterChipClass } from "@/components/ui/filter-chip";
import { isPast, parseTrLocalDateTime, trDayKey } from "@/lib/clock";
import { takeSubmitIntent } from "@/lib/form-submit-intent";
import { officeSlotMs } from "@/lib/appointment-slots";
import { APPOINTMENT_DRAFT_FIELDS, APPOINTMENT_FORM_ID, APPOINTMENT_TABS, appointmentMissing } from "./appointment-tabs";
import { AppointmentSavedPanel } from "./appointment-saved-panel";

type Option = { id: string; label: string };

const TAB_ICONS = {
  randevu: TI.zaman,
  ayrinti: TI.konum,
} as const;

const FIELD_LABELS = { appointment_type: "Randevu türü", date: "Tarih", time: "Saat" };

/** Portföy adresinin konuma kendiliğinden yazıldığı türler (buluşma yeri portföyün kendisi). */
const AT_PROPERTY_TYPES = new Set(["showing", "valuation"]);


/** "YYYY-MM-DD" -> "GG.AA.YYYY" (saat dilimi dönüşümü yok, yalnız biçim). */
function dayLabel(value: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value ?? "").trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

function addDaysKey(day: string, days: number): string {
  const noon = officeSlotMs(day, "12:00");
  return noon == null ? day : trDayKey(noon + days * 86_400_000);
}

function successMessage(r: AppointmentResult): string {
  return r.customerMessage === "sms_sent" ? "Randevu planlandı · müşteriye teyit SMS'i gönderildi" : "Randevu planlandı";
}

/**
 * Kolay randevu (tek sayfa): Müşteri · Portföy · Tür çipleri · Tarih/saat (Bugün/Yarın + danışmanın boş saatleri) ·
 * Danışman · Not açık; süre ve konum kapalı "Ayrıntılar"da. Bağlamdan (müşteri 360, portföy, talep, anlaşma, takvim
 * boş saati) gelen her şey ön seçili; Ctrl+Enter kaydeder. Kayıttan sonra formdan çıkmadan teyit/takvim paneli açılır.
 */
export function AppointmentForm(props: {
  customers: Option[];
  properties: Option[];
  typeOptions: { value: string; label: string }[];
  /** ?customer= (ya da anlaşma/talep bağlamının müşterisi) ön seçimi. */
  defaultCustomerId?: string;
  /** ?property= (ya da anlaşmanın portföyü) ön seçimi. */
  defaultPropertyId?: string;
  /** Sunucudan gelen gün (YYYY-MM-DD) ya da ?tarih= ön dolgusu. */
  defaultDate: string;
  /** ?saat= (HH:MM); yoksa şimdiden sonraki ilk yarım saat (ileri gün için 10:00). */
  defaultTime: string;
  /** ?tur= ya da yer gösterme. */
  defaultType?: string;
  /** Ön seçili portföyün adresi (konum). */
  defaultLocation?: string;
  /** Danışman varsayılanı: portföyün sorumlusu (yönetim katmanında) ya da ben. */
  defaultAdvisorId?: string;
  /** Ofis günü (YYYY-MM-DD) — "Bugün/Yarın" çipleri. */
  todayKey: string;
  userId: string;
  /** Yalnız yönetim katmanında dolu: başka danışman adına randevu açma seçici listesi. */
  advisors?: Option[];
}) {
  // Kayıttan sonra "Yeni randevu": form temiz yeniden kurulur (anahtar değişir; ön dolgu bağlamı korunur).
  const [round, setRound] = useState(0);
  const [saved, setSaved] = useState<{ id: string | null; message: AppointmentResult["customerMessage"] } | null>(null);
  if (saved) {
    return (
      <AppointmentSavedPanel
        appointmentId={saved.id}
        autoMessage={saved.message}
        onNew={() => {
          setSaved(null);
          setRound((r) => r + 1);
        }}
      />
    );
  }
  return <AppointmentFormBody key={round} {...props} onSaved={(id, message) => setSaved({ id, message })} />;
}

function AppointmentFormBody({
  customers,
  properties,
  typeOptions,
  defaultCustomerId,
  defaultPropertyId,
  defaultDate,
  defaultTime,
  defaultType,
  defaultLocation = "",
  defaultAdvisorId,
  todayKey,
  userId,
  advisors,
  onSaved,
}: Parameters<typeof AppointmentForm>[0] & { onSaved: (id: string | null, message: AppointmentResult["customerMessage"]) => void }) {
  const { push } = useToast();
  const [state, setState] = useState<AppointmentResult>({});
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const conflictWarning = state.conflictWarning ?? null;
  const error = !conflictWarning && state.error ? state.error : null;

  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [extraCustomers, setExtraCustomers] = useState<Option[]>([]);
  const [propertyId, setPropertyId] = useState(defaultPropertyId ?? "");
  const [type, setType] = useState(defaultType ?? typeOptions[0]?.value ?? "showing");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const [advisorId, setAdvisorId] = useState(defaultAdvisorId ?? userId);
  const advisorTouched = useRef(false);
  const [location, setLocation] = useState(defaultLocation);
  // Konum portföyden kendiliğinden yazıldıysa, portföy değişince yenisiyle güncellenir; elle yazılanı ezmeyiz.
  const autoLocation = useRef(defaultLocation);
  const [slots, setSlots] = useState<AppointmentSlotSuggestion | null>(null);
  // Çakışma onayı yalnız uyarının verildiği zamana aittir: tarih/saat/danışman değişince düşer (yeni saat yeniden denetlenir).
  const resetConflict = () => {
    if (state.conflictWarning) setState({});
  };

  // Danışmanın o günkü boş saatleri + izin bilgisi (tarih/danışman değişince).
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    let alive = true;
    suggestAppointmentSlots({ date, advisorId }).then((s) => {
      if (alive) setSlots(s);
    });
    return () => {
      alive = false;
    };
  }, [date, advisorId]);

  function onPropertyChange(id: string) {
    setPropertyId(id);
    if (!id) return;
    appointmentPropertyContext(id).then((ctx) => {
      if (!ctx) return;
      if (ctx.location && AT_PROPERTY_TYPES.has(type)) {
        setLocation((cur) => (cur.trim() === "" || cur === autoLocation.current ? ctx.location! : cur));
        autoLocation.current = ctx.location;
      }
      if (advisors && ctx.advisorId && !advisorTouched.current && advisors.some((a) => a.id === ctx.advisorId)) {
        setAdvisorId(ctx.advisorId);
      }
    });
  }

  // Geçmiş saat: ilk gönderimde satır içi onay istenir; onaylanan "tarihTsaat" değeri bir sonraki gönderimde geçer.
  const [pastAsk, setPastAsk] = useState<string | null>(null);
  const pastOk = useRef<string | null>(null);
  function guardedSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const key = `${String(fd.get("date") ?? "")}T${String(fd.get("time") ?? "")}`;
    const at = parseTrLocalDateTime(key);
    if (at && isPast(at) && pastOk.current !== key) {
      setPastAsk(key);
      return;
    }
    setPastAsk(null);
    if (inFlight.current) return;
    inFlight.current = true;
    const intent = takeSubmitIntent();
    startTransition(async () => {
      let res: AppointmentResult;
      try {
        res = await createAppointment(fd);
      } finally {
        inFlight.current = false;
      }
      setState(res);
      if (!res.ok) return;
      clearActiveFormDrafts();
      push(successMessage(res), "ok");
      if (intent === "new") {
        // "Kaydet ve yenisini ekle": aynı sayfa temiz açılsın (alan durumu sıfırlansın) — tam yükleme.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- bilinçli tam yükleme: form durumu sıfırlanır
        window.location.assign(`${window.location.pathname}?kaydedildi=1`);
        return;
      }
      onSaved(res.id ?? null, res.customerMessage);
    });
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
        collapsible: t.id === "ayrinti",
      })),
    [],
  );

  const tomorrowKey = addDaysKey(todayKey, 1);
  const customerOptions = [...extraCustomers, ...customers].map((c) => ({ value: c.id, label: c.label }));
  const isShowing = type === "showing";
  // Portföy alanı (C17): yalnız portföyün kendisinde buluşulan türlerde (yer gösterme, değerleme) ya da portföy zaten
  // seçiliyse görünür. Diğer türlerde tek dokunuşluk "Portföy bağla" ile açılır (özellik kaybolmaz).
  const [propertyAsked, setPropertyAsked] = useState(false);
  const showProperty = AT_PROPERTY_TYPES.has(type) || Boolean(propertyId) || propertyAsked;

  const tabPanels = {
    randevu: (
      <>
        <FormField label="Müşteri" htmlFor="appointment-customer" inject={false} required={isShowing}>
          <Combobox
            id="appointment-customer"
            name="customer_id"
            aria-label="Müşteri"
            placeholder="Müşteri seçin"
            searchPlaceholder="Ad ya da telefon ara…"
            emptyText="Eşleşen müşteri yok"
            onSearch={searchCustomers}
            value={customerId}
            onValueChange={setCustomerId}
            options={customerOptions}
          />
          <InlineCustomerQuickAdd
            onCreated={(c) => {
              setExtraCustomers((prev) => [c, ...prev.filter((p) => p.id !== c.id)]);
              setCustomerId(c.id);
              // Kabuğun canlı değerleri (eksik listesi) olay dinler: eşzamansız seçimden sonra bir kez tazelensin.
              requestAnimationFrame(() =>
                document.getElementById("appointment-customer")?.closest("form")?.dispatchEvent(new Event("change", { bubbles: true })),
              );
            }}
          />
        </FormField>
        {showProperty ? (
        <FormField label="Portföy" htmlFor="appointment-property" inject={false} required={isShowing}>
          <Combobox
            id="appointment-property"
            name="property_id"
            aria-label="Portföy"
            placeholder={isShowing ? "Gösterilecek portföy" : "İsteğe bağlı"}
            searchPlaceholder="Kod, başlık ya da adres ara…"
            emptyText="Eşleşen portföy yok"
            onSearch={searchProperties}
            value={propertyId}
            onValueChange={onPropertyChange}
            options={properties.map((p) => ({ value: p.id, label: p.label }))}
          />
          {propertyId && location && AT_PROPERTY_TYPES.has(type) ? (
            <p className="mt-1 flex items-start gap-1 text-xs text-text-muted">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="min-w-0 break-words">{location}</span>
            </p>
          ) : null}
        </FormField>
        ) : (
          <div className="flex items-end">
            <Button variant="ghost" size="lg" icon={Link2} onClick={() => setPropertyAsked(true)} className="h-11 px-2 text-brand-700">
              Portföy bağla
            </Button>
          </div>
        )}

        <fieldset className="sm:col-span-2">
          <legend className="mb-1.5 text-sm font-semibold text-ink-950">
            Tür <span aria-hidden className="text-danger-600">*</span>
          </legend>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Randevu türü">
            {typeOptions.map((o) => (
              <label
                key={o.value}
                className={filterChipClass({ active: type === o.value, className: "cursor-pointer text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-500" })}
              >
                <input
                  type="radio"
                  name="appointment_type"
                  value={o.value}
                  checked={type === o.value}
                  onChange={() => setType(o.value)}
                  required
                  className="sr-only"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        <FormField label="Tarih" htmlFor="appointment-date" required>
          <FormInput name="date" type="date" required value={date} onChange={(e) => { resetConflict(); setDate(e.target.value); }} />
        </FormField>
        <FormField label="Saat" htmlFor="appointment-time" required>
          <FormInput name="time" type="time" required value={time} onChange={(e) => { resetConflict(); setTime(e.target.value); }} />
        </FormField>
        <div className="-mt-2 space-y-2 sm:col-span-2">
          <div className="flex flex-wrap gap-2" aria-label="Gün seçimi">
            {[
              { key: todayKey, label: "Bugün" },
              { key: tomorrowKey, label: "Yarın" },
            ].map((d) => (
              <FilterChip key={d.label} active={date === d.key} onClick={() => { resetConflict(); setDate(d.key); }} className="text-sm">
                {d.label}
              </FilterChip>
            ))}
            {slots?.slots.map((t) => (
              <FilterChip
                key={t}
                active={time === t}
                onClick={() => { resetConflict(); setTime(t); }}
                className="numeric text-sm"
                title="Danışmanın bu saati boş"
              >
                <Clock className="h-3.5 w-3.5" aria-hidden /> {t}
              </FilterChip>
            ))}
          </div>
          <HelperText>
            {slots == null
              ? "Boş saatler hesaplanıyor…"
              : slots.slots.length > 0
                ? `Saat çipleri danışmanın ${dayLabel(date) ?? "o gün"} boş saatleridir${slots.busyCount ? ` (${slots.busyCount} randevusu var)` : ""}.`
                : "Bu gün için uygun boş saat kalmadı; başka gün seçin ya da saati elle girin."}
          </HelperText>
          {slots?.onLeave ? (
            <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-700">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden /> Danışman bu gün izinde (onaylı izin). Başka gün ya da danışman seçin.
            </p>
          ) : null}
          {conflictWarning ? (
            <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-700">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden /> {conflictWarning}
            </p>
          ) : null}
        </div>

        {advisors && advisors.length > 0 ? (
          <FormField label="Danışman" htmlFor="appointment-advisor" className="sm:col-span-2">
            <PersonSelect
              id="appointment-advisor"
              name="assigned_to"
              value={advisorId}
              onValueChange={(id) => {
                advisorTouched.current = true;
                resetConflict();
                setAdvisorId(id || userId);
              }}
              required
              people={advisors.map((a) => ({ id: a.id, name: a.id === userId ? `${a.label} (ben)` : a.label }))}
              featuredIds={[userId]}
              emptyLabel="Danışman seçin"
            />
          </FormField>
        ) : null}
        <FormField label="Not" htmlFor="appointment-notes" className="sm:col-span-2">
          <FormTextarea name="notes" rows={2} placeholder="Hazırlık, anahtar, dikkat edilecekler… (isteğe bağlı)" />
        </FormField>
      </>
    ),
    ayrinti: (
      <>
        <FormField label="Süre (dk)" htmlFor="appointment-duration" hint="Boşsa 60 dk sayılır (çakışma kontrolü).">
          <FormInput name="duration_min" inputMode="numeric" placeholder="60" />
        </FormField>
        <FormField label="Konum" htmlFor="appointment-location" inject={false}>
          <div className="relative">
            <FormInput
              id="appointment-location"
              name="location"
              className="pr-9"
              placeholder="Kadıköy, İstanbul"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
            <MapPin className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          </div>
        </FormField>
      </>
    ),
  };

  return (
    <TabbedFormShell
      title="Yeni randevu"
      description="Müşteri, tür ve saat yeterli; gerisi isteğe bağlı."
      breadcrumbs={[{ label: "Randevular", href: "/app/randevular" }, { label: "Yeni randevu" }]}
      cancelHref="/app/randevular"
      submitLabel={conflictWarning ? "Yine de kaydet" : "Kaydet"}
      pendingLabel="Kaydediliyor…"
      submitIcon={Check}
      pending={pending}
      error={error}
      onSubmit={guardedSubmit}
      tabs={tabs}
      layout="single"
      rules={appointmentMissing}
      tabPanels={tabPanels}
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
              backTab="randevu"
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
              role="status"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                Randevu henüz kaydedilmedi — saati değiştirin ya da yine de planlamak için &quot;Yine de kaydet&quot; ile devam edin.
              </span>
              <input type="hidden" name="confirm_conflict" value="1" />
            </div>
          ) : null}
        </>
      }
    />
  );
}
