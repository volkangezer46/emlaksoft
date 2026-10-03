"use client";

import { useState, useTransition } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { Check, ChevronsUpDown, Loader2, TriangleAlert } from "lucide-react";
import { ICONS } from "@/lib/icons";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { MorphTabs, type MorphTabItem } from "@/components/ui/morph-tabs";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { CALL_DISPOSITIONS } from "@/app/app/arama/call-console";
import { quickCreateAppointment, quickCreateCustomer, quickLogCall } from "./actions";
import { QUICK_INTENTS } from "./quick-intents";

export type QuickTabId = "musteri" | "gorusme" | "randevu";

const TAB_META: Record<QuickTabId, { label: string; icon: MorphTabItem["icon"] }> = {
  musteri: { label: "Müşteri", icon: ICONS.musteri },
  gorusme: { label: "Görüşme notu", icon: ICONS.telefon },
  randevu: { label: "Randevu", icon: ICONS.randevu },
};

const SUBMIT =
  "focus-ring press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60 sm:w-auto";
const GHOST =
  "focus-ring press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-line px-4 text-sm font-semibold text-ink-950 transition hover:border-brand-300";
const BIG = "min-h-11";

type Result = { error?: string; ok?: boolean; id?: string; conflictWarning?: string };

/** Ortak gönderim akışı: pending + hata + başarı; Ctrl/Cmd+Enter formu gönderir. */
function useQuick(action: (fd: FormData) => Promise<Result>) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>({});
  const [done, setDone] = useState<Result | null>(null);
  const [round, setRound] = useState(0);

  function onSubmit(event: FormEvent<HTMLFormElement>, extra?: Record<string, string>) {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    startTransition(async () => {
      const res = await action(fd);
      setResult(res);
      if (res.ok) setDone(res);
    });
  }
  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.currentTarget.requestSubmit();
    }
  }
  function again() {
    setDone(null);
    setResult({});
    setRound((r) => r + 1);
  }
  return { pending, result, done, round, onSubmit, onKeyDown, again };
}

function ErrorBand({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="rounded-[var(--radius-control)] border border-danger-400/40 bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">
      {error}
    </p>
  ) : null;
}

function Success({ title, openHref, openLabel, onAgain }: { title: string; openHref: string; openLabel: string; onAgain: () => void }) {
  return (
    <div className="flex flex-col gap-4" role="status">
      <p className="flex items-center gap-2 text-base font-bold text-mint-600">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-mint-500/15"><Check className="h-4 w-4" aria-hidden /></span>
        {title}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={onAgain} className={SUBMIT} autoFocus>Bir tane daha</button>
        <Link href={openHref} className={GHOST}>{openLabel}</Link>
      </div>
    </div>
  );
}

function SubmitRow({ pending, label }: { pending: boolean; label: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {pending ? "Kaydediliyor…" : label}
      </button>
      <p className="hidden text-xs text-text-faint md:block">Ctrl/Cmd + Enter ile de kaydedebilirsiniz.</p>
    </div>
  );
}

/* ------------------------------- Müşteri ------------------------------- */

function CustomerTab() {
  const q = useQuick(quickCreateCustomer);
  const [intent, setIntent] = useState<string>("al");
  if (q.done) {
    return (
      <Success
        title="Müşteri kaydedildi"
        openHref={q.done.id ? `/app/musteriler/${q.done.id}` : "/app/musteriler"}
        openLabel="Tam forma devam et (kaydı aç)"
        onAgain={q.again}
      />
    );
  }
  return (
    <form key={q.round} onSubmit={q.onSubmit} onKeyDown={q.onKeyDown} className="flex flex-col gap-4">
      <FormField label="Ad soyad" htmlFor="hq-full-name" required>
        <FormInput id="hq-full-name" name="full_name" required autoComplete="name" autoFocus placeholder="Örn. Ali Kaya" className={BIG} />
      </FormField>
      <FormField label="Telefon" htmlFor="hq-phone" required inject={false}>
        <PhoneInput id="hq-phone" name="phone" required />
      </FormField>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-950">Ne arıyor?</legend>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_INTENTS.map((i) => (
            <label
              key={i.id}
              className={`flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border px-2 text-center text-sm font-semibold transition ${
                intent === i.id ? "border-brand-400 bg-brand-600/8 text-brand-600" : "border-line text-text-muted hover:border-brand-300"
              }`}
            >
              <input type="radio" name="intent" value={i.id} checked={intent === i.id} onChange={() => setIntent(i.id)} className="sr-only" />
              {i.label}
            </label>
          ))}
        </div>
      </fieldset>
      <FormField label="Not (isteğe bağlı)" htmlFor="hq-cust-notes">
        <FormTextarea id="hq-cust-notes" name="notes" rows={2} placeholder="Bütçe, semt, oda sayısı…" />
      </FormField>
      <ErrorBand error={q.result.error} />
      <SubmitRow pending={q.pending} label="Müşteriyi kaydet" />
    </form>
  );
}

/* ------------------------------ Görüşme notu ------------------------------ */

function CallTab({ customers }: { customers: ComboboxOption[] }) {
  const q = useQuick(quickLogCall);
  const [direction, setDirection] = useState("outbound");
  const [disposition, setDisposition] = useState<string>("Ulaşıldı");
  if (q.done) {
    return <Success title="Görüşme kaydedildi" openHref="/app/arama" openLabel="Kaydı aç (görüşmeler)" onAgain={q.again} />;
  }
  return (
    <form key={q.round} onSubmit={q.onSubmit} onKeyDown={q.onKeyDown} className="flex flex-col gap-4">
      <FormField label="Müşteri" htmlFor="hq-call-customer" inject={false}>
        <Combobox
          id="hq-call-customer"
          name="customer_id"
          aria-label="Müşteri"
          placeholder="Müşteri ara ve seç"
          searchPlaceholder="Ad ya da telefon ara…"
          emptyText="Eşleşen müşteri yok"
          onSearch={searchCustomers}
          options={customers}
          className="[&_button]:min-h-11"
        />
      </FormField>
      <FormField label="ya da telefonla" htmlFor="hq-call-phone" inject={false} hint="Müşteri seçtiyseniz boş bırakabilirsiniz.">
        <PhoneInput id="hq-call-phone" name="phone" />
      </FormField>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-950">Kim aradı?</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "outbound", label: "Ben aradım" },
            { value: "inbound", label: "O aradı" },
          ].map((d) => (
            <label key={d.value} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border text-sm font-semibold transition ${direction === d.value ? "border-brand-400 bg-brand-600/8 text-brand-600" : "border-line text-text-muted hover:border-brand-300"}`}>
              <input type="radio" name="direction" value={d.value} checked={direction === d.value} onChange={() => setDirection(d.value)} className="sr-only" />
              {d.label}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-950">Sonuç *</legend>
        <div className="grid grid-cols-2 gap-2">
          {CALL_DISPOSITIONS.map((code) => (
            <label key={code} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border px-2 text-center text-sm font-medium transition ${disposition === code ? "border-mint-500/50 bg-mint-500/8 text-mint-600" : "border-line text-text-muted hover:border-brand-300"}`}>
              <input type="radio" name="disposition" value={code} checked={disposition === code} onChange={() => setDisposition(code)} className="sr-only" />
              {code}
            </label>
          ))}
        </div>
      </fieldset>
      <FormField label="Not" htmlFor="hq-call-notes">
        <FormTextarea id="hq-call-notes" name="notes" rows={3} placeholder="Ne konuşuldu, sonraki adım…" />
      </FormField>
      <ErrorBand error={q.result.error} />
      <SubmitRow pending={q.pending} label="Görüşmeyi kaydet" />
    </form>
  );
}

/* -------------------------------- Randevu -------------------------------- */

function AppointmentTab({
  customers,
  properties,
  typeOptions,
  defaultWhen,
}: {
  customers: ComboboxOption[];
  properties: ComboboxOption[];
  typeOptions: { value: string; label: string }[];
  defaultWhen: string;
}) {
  const q = useQuick(quickCreateAppointment);
  const conflict = q.result.conflictWarning ?? null;
  if (q.done) {
    return <Success title="Randevu planlandı" openHref="/app/randevular" openLabel="Kaydı aç (randevular)" onAgain={q.again} />;
  }
  return (
    <form
      key={q.round}
      onSubmit={(e) => q.onSubmit(e, conflict ? { confirm_conflict: "1" } : undefined)}
      onKeyDown={q.onKeyDown}
      className="flex flex-col gap-4"
    >
      <FormField label="Müşteri" htmlFor="hq-appt-customer" inject={false}>
        <Combobox
          id="hq-appt-customer"
          name="customer_id"
          aria-label="Müşteri"
          placeholder="Müşteri ara ve seç"
          searchPlaceholder="Ad ya da telefon ara…"
          emptyText="Eşleşen müşteri yok"
          onSearch={searchCustomers}
          options={customers}
          className="[&_button]:min-h-11"
        />
      </FormField>
      <FormField label="Portföy (isteğe bağlı)" htmlFor="hq-appt-property" inject={false}>
        <Combobox
          id="hq-appt-property"
          name="property_id"
          aria-label="Portföy"
          placeholder="Portföy ara ve seç"
          searchPlaceholder="Başlık ya da kod ara…"
          emptyText="Eşleşen portföy yok"
          onSearch={searchProperties}
          options={properties}
          className="[&_button]:min-h-11"
        />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Tarih ve saat" htmlFor="hq-appt-when" required>
          <FormInput id="hq-appt-when" name="when" type="datetime-local" required defaultValue={defaultWhen} className={BIG} />
        </FormField>
        <FormField label="Tür" htmlFor="hq-appt-type" required inject={false}>
          <div className="relative">
            <FormSelect id="hq-appt-type" name="appointment_type" required defaultValue={typeOptions[0]?.value ?? "showing"} className={`${BIG} cursor-pointer appearance-none pr-9`}>
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </FormSelect>
            <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
          </div>
        </FormField>
      </div>
      {conflict ? (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {conflict}
        </p>
      ) : null}
      <ErrorBand error={q.result.error} />
      <SubmitRow pending={q.pending} label={conflict ? "Yine de kaydet" : "Randevuyu kaydet"} />
    </form>
  );
}

/* --------------------------------- Kabuk --------------------------------- */

export function QuickCapture({
  tabs,
  initial,
  customers,
  properties,
  typeOptions,
  defaultWhen,
}: {
  tabs: QuickTabId[];
  initial: QuickTabId;
  customers: ComboboxOption[];
  properties: ComboboxOption[];
  typeOptions: { value: string; label: string }[];
  defaultWhen: string;
}) {
  const [active, setActive] = useState<QuickTabId>(initial);
  const items: MorphTabItem[] = tabs.map((t) => ({ id: t, label: TAB_META[t].label, icon: TAB_META[t].icon }));

  function select(id: string) {
    const next = id as QuickTabId;
    setActive(next);
    try {
      window.history.replaceState(null, "", `?sekme=${next}`);
    } catch {
      // adres çubuğu güncellenemese de sekme çalışır
    }
  }

  const panels: Record<QuickTabId, ReactNode> = {
    musteri: <CustomerTab />,
    gorusme: <CallTab customers={customers} />,
    randevu: <AppointmentTab customers={customers} properties={properties} typeOptions={typeOptions} defaultWhen={defaultWhen} />,
  };

  return (
    <div className="flex flex-col gap-4">
      <MorphTabs items={items} activeId={active} onSelect={select} orientation="horizontal" label="Hızlı kayıt türü" idPrefix="hq" />
      {tabs.map((t) => (
        <section
          key={t}
          id={`hq-panel-${t}`}
          role="tabpanel"
          aria-labelledby={`hq-tab-${t}`}
          hidden={active !== t}
          className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 sm:p-5"
        >
          {panels[t]}
        </section>
      ))}
    </div>
  );
}
