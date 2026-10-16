"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { CalendarClock, Check, ChevronsUpDown, CloudOff, History, Loader2, LocateFixed, TriangleAlert } from "lucide-react";
import { ICONS } from "@/lib/icons";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { MorphTabs, type MorphTabItem } from "@/components/ui/morph-tabs";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { PhoneInput } from "@/components/ui/phone-input";
import { Button } from "@/components/ui/button";
import { searchCustomers, searchProperties } from "@/app/actions/lookup";
import { CALL_DISPOSITIONS } from "@/app/app/gelen-kutusu/call-console";
import { quickCreateAppointment, quickCreateCustomer, quickCreateProperty, quickLogCall } from "./actions";
import { QUICK_INTENTS, QUICK_INTENT_TRANSACTION, QUICK_ROOM_OPTIONS, type QuickIntent } from "./quick-intents";
import { appointmentMissing } from "@/app/app/randevular/yeni/appointment-tabs";
import { missingFieldsError } from "@/lib/form-rules";
import { MissingCountBadge } from "@/components/ui/form-action-bar";
import { now } from "@/lib/clock";
import {
  browserStore,
  enqueueOutbox,
  isNetworkFailure,
  outcomeFromResult,
  pickerLabelKey,
  removeOutboxItem,
  SCOPE_TENANT_FIELD,
  SCOPE_USER_FIELD,
  type CaptureScope,
  type DraftValues,
  type OutboxItem,
  type OutboxKind,
} from "@/lib/field-capture/outbox";
import {
  CaptureScopeProvider,
  LocationSuggestionRow,
  NoteAssist,
  OutboxPanel,
  outboxChanged,
  restoreDraft,
  useFormDraft,
  useLocationSuggestion,
  useOutboxItems,
} from "./field-assist";
import { FieldPhotoPicker, outboxPhotoBatch, PhotoUploadStatus } from "./field-photos";
import { createFieldPhotoUploader } from "./photo-upload";
import { attachPhotoBatch, configurePhotoSync, discardPhotoBatch, photoSyncSnapshot } from "@/lib/field-capture/photo-sync";
import { batchPhotos, PHOTO_BATCH_FIELD, PHOTO_COUNT_FIELD } from "@/lib/field-capture/photo-queue";
import dynamic from "next/dynamic";
import type { WatermarkSettings } from "@/lib/watermark";

export type QuickTabId = "musteri" | "gorusme" | "randevu" | "portfoy";

const TAB_META: Record<QuickTabId, { label: string; icon: MorphTabItem["icon"] }> = {
  musteri: { label: "Müşteri", icon: ICONS.musteri },
  gorusme: { label: "Görüşme notu", icon: ICONS.telefon },
  randevu: { label: "Randevu", icon: ICONS.randevu },
  portfoy: { label: "Portföy", icon: ICONS.portfoy },
};

const KIND_TAB: Record<OutboxKind, QuickTabId> = { customer: "musteri", call: "gorusme", appointment: "randevu", property: "portfoy" };

// Medya yükleyicisi (filigran tuvali dahil) yalnız kayıttan sonra ve istenince yüklenir: /app/hizli ilk yükü büyümez.
const PropertyMediaManager = dynamic(() => import("@/app/app/portfoyler/[id]/property-media-manager").then((m) => m.PropertyMediaManager), {
  loading: () => <p className="text-sm text-text-muted">Fotoğraf yükleyici açılıyor…</p>,
});

const SUBMIT =
  "focus-ring press inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-4 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-60 sm:w-auto";
const GHOST =
  "focus-ring press inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-line px-4 text-sm font-semibold text-ink-950 transition hover:border-brand-300";
const BIG = "min-h-11";

type Result = {
  error?: string;
  ok?: boolean;
  id?: string;
  conflictWarning?: string;
  duplicate?: boolean;
  applied?: string[];
  skipped?: string[];
};

/** Sunucuya gidecek eylemler (çevrimdışı kuyruk aynı eylemi istek kimliğiyle yeniden çağırır). */
const ACTIONS: Record<OutboxKind, (fd: FormData) => Promise<Result>> = {
  customer: quickCreateCustomer,
  call: quickLogCall,
  appointment: quickCreateAppointment,
  property: quickCreateProperty,
};

/** Kuyruğa yazılmayan istemci alanları (istek kimliği ve kapsam öğenin kendisinde durur). */
const CLIENT_FIELDS = new Set(["client_request_id", SCOPE_TENANT_FIELD, SCOPE_USER_FIELD]);

/** Seçici (Combobox) tetikleyicisindeki görünen etiket: kuyruktan forma geri yüklemede seçim etiketiyle gelsin. */
function pickerLabel(triggerId: string): string {
  return document.getElementById(triggerId)?.querySelector("span")?.textContent?.trim() ?? "";
}

/** Geri yüklenen seçimin etiketi (etiket saklanmadıysa genel ad; değer yine seçili gelir). */
function restoredLabel(v: DraftValues | null, field: string, fallback: string): string | undefined {
  if (!v?.[field]) return undefined;
  return v[pickerLabelKey(field)] || fallback;
}

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // Eski tarayıcı: kimliksiz gönderim (sunucu freni atlanır, mevcut mükerrer frenleri geçerli)
    return "";
  }
}

/**
 * Ortak gönderim akışı: pending + hata + başarı; Ctrl/Cmd+Enter formu gönderir. Saha: her form turu tek istek kimliği
 * taşır; bağlantı yoksa ya da istek ağ hatasıyla düşerse form bu cihazda sıraya girer (bağlantı gelince bir kez gönderilir).
 * Başarıda (ya da sıraya alınınca) yerel taslak silinir.
 */
function useQuick(
  kind: OutboxKind,
  draft: ReturnType<typeof useFormDraft>,
  labelOf: (fd: FormData) => string,
  /** Seçici alan → tetikleyici kimliği (ör. customer_id → hq-call-customer). */
  pickers: Record<string, string> = {},
  /** Kayıt sunucuda açıldı (ör. sahada çekilen fotoğrafları portföye bağla). */
  onSaved?: (res: Result, fd: FormData) => void,
) {
  const action = ACTIONS[kind];
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result>({});
  const [done, setDone] = useState<(Result & { fields: DraftValues }) | null>(null);
  const [queued, setQueued] = useState(false);
  const [round, setRound] = useState(0);
  const requestId = useRef<string | null>(null);

  function queue(fd: FormData, id: string) {
    const fields: [string, string][] = [];
    for (const [k, v] of fd.entries()) if (typeof v === "string" && !CLIENT_FIELDS.has(k)) fields.push([k, v]);
    const labels: Record<string, string> = {};
    for (const [field, triggerId] of Object.entries(pickers)) {
      const label = fd.get(field) ? pickerLabel(triggerId) : "";
      if (label) labels[field] = label;
    }
    // Kapsamsız (oturum bilinmiyor) sıraya alma yok: kayıt başka oturumun kuyruğuna düşmesin.
    const scope = draft.scope;
    const ok = id && scope ? enqueueOutbox(browserStore(), scope, { id, kind, fields, label: labelOf(fd), labels, nowMs: now() }) : false;
    if (ok) {
      outboxChanged();
      draft.clear();
      // Sıradaki öğe kendi kimliğini taşır; bu formdan sonraki gönderim (ör. kuyruktan geri yüklenen) yeni istektir.
      requestId.current = null;
      setQueued(true);
    } else {
      setResult({ error: "Bağlantı yok ve kayıt bu cihazda sıraya alınamadı (tarayıcı deposu kapalı). Bağlantı gelince tekrar kaydedin." });
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>, extra?: Record<string, string>) {
    event.preventDefault();
    setQueued(false);
    const fd = new FormData(event.currentTarget);
    for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
    requestId.current ??= newRequestId();
    const id = requestId.current;
    if (id) fd.set("client_request_id", id);
    // Sunucu oturumla karşılaştırır: form başka oturumda açık kaldıysa kayıt yanlış ofise/kullanıcıya açılmaz.
    if (draft.scope) {
      fd.set(SCOPE_TENANT_FIELD, draft.scope.tenantId);
      fd.set(SCOPE_USER_FIELD, draft.scope.userId);
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      queue(fd, id);
      return;
    }
    startTransition(async () => {
      let res: Result;
      try {
        res = await action(fd);
      } catch (e) {
        if (isNetworkFailure(e)) queue(fd, id);
        else setResult({ error: "Kayıt şu an gönderilemedi. Tekrar deneyin." });
        return;
      }
      setResult(res);
      if (res.ok) {
        const fields: DraftValues = {};
        for (const [k, v] of fd.entries()) if (typeof v === "string") fields[k] = v;
        draft.clear();
        onSaved?.(res, fd);
        setDone({ ...res, fields });
      } else if (!res.conflictWarning && !res.duplicate) {
        // Reddedildi (eksik/yanlış alan): düzeltilen form yeni istek olarak gider.
        requestId.current = null;
      }
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
    setQueued(false);
    setResult({});
    requestId.current = null;
    setRound((r) => r + 1);
  }
  return { pending, result, done, queued, round, onSubmit, onKeyDown, again };
}

function ErrorBand({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="rounded-[var(--radius-control)] border border-danger-400/40 bg-danger-500/8 px-3 py-2 text-sm font-medium text-danger-600">
      {error}
    </p>
  ) : null;
}

function ExtrasNote({ result }: { result: Result }) {
  if (!result.applied?.length && !result.skipped?.length) return null;
  return (
    <ul className="space-y-0.5 text-sm">
      {(result.applied ?? []).map((a) => (
        <li key={a} className="flex items-center gap-1.5 text-mint-700"><Check className="h-3.5 w-3.5" aria-hidden /> {a}</li>
      ))}
      {(result.skipped ?? []).map((s) => (
        <li key={s} className="flex items-center gap-1.5 text-amber-700"><TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {s}</li>
      ))}
    </ul>
  );
}

function Success({ title, openHref, openLabel, onAgain, children }: { title: string; openHref: string; openLabel: string; onAgain: () => void; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4" role="status">
      <p className="flex items-center gap-2 text-base font-bold text-mint-600">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-mint-500/15"><Check className="h-4 w-4" aria-hidden /></span>
        {title}
      </p>
      {children}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={onAgain} className={SUBMIT} autoFocus>Bir tane daha</button>
        <Link href={openHref} className={GHOST}>{openLabel}</Link>
      </div>
    </div>
  );
}

function Queued({ onAgain }: { onAgain: () => void }) {
  return (
    <div className="flex flex-col gap-4" role="status">
      <p className="flex items-center gap-2 text-base font-bold text-amber-700">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-400/20"><CloudOff className="h-4 w-4" aria-hidden /></span>
        Bağlantı yok — kayıt bu cihazda sıraya alındı
      </p>
      <p className="text-sm text-text-muted">Bağlantı gelince otomatik ve bir kez gönderilir. Sayfayı kapatsanız da sırada kalır.</p>
      <Button onClick={onAgain} className="w-full sm:w-auto" autoFocus>Bir tane daha</Button>
    </div>
  );
}

function SubmitRow({ pending, label, missingCount = 0 }: { pending: boolean; label: string; missingCount?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <button type="submit" disabled={pending} className={SUBMIT}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {pending ? "Kaydediliyor…" : label}
        {!pending ? <MissingCountBadge count={missingCount} /> : null}
      </button>
      <p className="hidden text-xs text-text-faint md:block">Ctrl/Cmd + Enter ile de kaydedebilirsiniz.</p>
    </div>
  );
}

function DraftBadge({ show, onDiscard }: { show: boolean; onDiscard: () => void }) {
  if (!show) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      <History className="h-3.5 w-3.5" aria-hidden /> Yarım kalan taslak geri yüklendi.
      <Button variant="ghost" size="xs" onClick={onDiscard}>Taslağı sil</Button>
    </p>
  );
}

/** Randevu sekmesini ön doldurma (nottan onaylanan randevu saati + kaydedilen müşteri). */
export type AppointmentPrefill = { customerId: string; customerLabel: string; when: string; seq: number };

function PlanAppointmentButton({ when, onPlan }: { when: string | undefined; onPlan?: (when: string) => void }) {
  if (!when || !onPlan) return null;
  return (
    <Button variant="outline" size="lg" icon={CalendarClock} onClick={() => onPlan(when)} className="w-full sm:w-auto">
      Randevuyu planla ({when.replace("T", " ")})
    </Button>
  );
}

/* ------------------------------- Müşteri ------------------------------- */

function CustomerTab({ onPlanAppointment }: { onPlanAppointment?: (p: Omit<AppointmentPrefill, "seq">) => void }) {
  const draft = useFormDraft("musteri");
  const q = useQuick("customer", draft, (fd) => `Müşteri: ${String(fd.get("full_name") ?? "").trim() || "isimsiz"}`);
  if (q.queued && !draft.restored) return <Queued onAgain={q.again} />;
  if (q.done && !draft.restored) {
    const d = q.done;
    return (
      <Success
        title="Müşteri kaydedildi"
        openHref={d.id ? `/app/musteriler/${d.id}` : "/app/musteriler"}
        openLabel="Tam forma devam et (kaydı aç)"
        onAgain={q.again}
      >
        <ExtrasNote result={d} />
        {d.id ? (
          <PlanAppointmentButton
            when={d.fields.fx_appt_at}
            onPlan={onPlanAppointment ? (when) => onPlanAppointment({ customerId: d.id as string, customerLabel: d.fields.full_name ?? "", when }) : undefined}
          />
        ) : null}
      </Success>
    );
  }
  return <CustomerForm key={`${q.round}-${draft.formKey}`} q={q} draft={draft} />;
}

function CustomerForm({ q, draft }: { q: ReturnType<typeof useQuick>; draft: ReturnType<typeof useFormDraft> }) {
  const v = draft.values;
  const [intent, setIntent] = useState<string>(v?.intent && v.intent in QUICK_INTENT_TRANSACTION ? v.intent : "al");
  // Mükerrer kapısı (B092): sunucu aynı telefonla kayıt bulursa ikinci gönderim "Yine de kaydet" onayıyla gider.
  // Onay YALNIZ uyarının verildiği numara için geçerlidir: numara düzeltildiyse kapı yeni numarayı yeniden denetler.
  const submittedPhone = useRef<string | null>(null);
  // Numara uyarıdan sonra değiştiyse düğme "Yine de kaydet" demez (onay o numaraya aitti). Gizli `phone` alanı
  // PhoneInput'un durum güncellemesiyle bir tur sonra yazıldığı için karşılaştırma bir sonraki görev döngüsünde yapılır.
  const [phoneChanged, setPhoneChanged] = useState(false);
  const recheckPhone = (form: HTMLFormElement) => {
    window.setTimeout(() => {
      const now = String(new FormData(form).get("phone") ?? "");
      setPhoneChanged(submittedPhone.current !== null && now !== submittedPhone.current);
    }, 0);
  };
  const confirmPending = Boolean(q.result.duplicate) && !phoneChanged;
  return (
    <form
      onSubmit={(e) => {
        const phoneNow = String(new FormData(e.currentTarget).get("phone") ?? "");
        const confirmed = Boolean(q.result.duplicate) && submittedPhone.current === phoneNow;
        submittedPhone.current = phoneNow;
        setPhoneChanged(false);
        q.onSubmit(e, confirmed ? { allow_duplicate: "1" } : undefined);
      }}
      onKeyDown={q.onKeyDown}
      onInput={(e) => {
        draft.track(e.currentTarget);
        recheckPhone(e.currentTarget);
      }}
      onChange={(e) => {
        draft.track(e.currentTarget);
        recheckPhone(e.currentTarget);
      }}
      className="flex flex-col gap-4"
    >
      <DraftBadge show={draft.restored} onDiscard={draft.clear} />
      <FormField label="Ad soyad" htmlFor="hq-full-name" required>
        <FormInput id="hq-full-name" name="full_name" required autoComplete="name" autoFocus placeholder="Örn. Ali Kaya" defaultValue={v?.full_name} className={BIG} />
      </FormField>
      <FormField label="Telefon" htmlFor="hq-phone" required inject={false}>
        <PhoneInput id="hq-phone" name="phone" required defaultValue={v?.phone} />
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
        <FormTextarea id="hq-cust-notes" name="notes" rows={3} placeholder="Bütçe, semt, oda sayısı… (ör. iki artı bir, 3 milyon bütçe, Kadıköy)" defaultValue={v?.notes} />
      </FormField>
      <NoteAssist textareaId="hq-cust-notes" demand={Boolean(QUICK_INTENT_TRANSACTION[intent as QuickIntent])} />
      <ErrorBand error={q.result.error} />
      <SubmitRow pending={q.pending} label={confirmPending ? "Yine de kaydet" : "Müşteriyi kaydet"} />
    </form>
  );
}

/* ------------------------------ Görüşme notu ------------------------------ */

const CALL_PICKERS = { customer_id: "hq-call-customer" };

function CallTab({ customers, onPlanAppointment }: { customers: ComboboxOption[]; onPlanAppointment?: (p: Omit<AppointmentPrefill, "seq">) => void }) {
  const draft = useFormDraft("gorusme", ["customer_id"]);
  const q = useQuick("call", draft, () => "Görüşme notu", CALL_PICKERS);
  if (q.queued && !draft.restored) return <Queued onAgain={q.again} />;
  if (q.done && !draft.restored) {
    const d = q.done;
    const customerId = d.fields.customer_id ?? "";
    return (
      <Success title="Görüşme kaydedildi" openHref="/app/gelen-kutusu?sekme=cagri" openLabel="Kaydı aç (görüşmeler)" onAgain={q.again}>
        <ExtrasNote result={d} />
        {customerId ? (
          <PlanAppointmentButton
            when={d.fields.fx_appt_at}
            onPlan={
              onPlanAppointment
                ? (when) => onPlanAppointment({ customerId, customerLabel: customers.find((c) => c.value === customerId)?.label ?? "", when })
                : undefined
            }
          />
        ) : null}
      </Success>
    );
  }
  return <CallForm key={`${q.round}-${draft.formKey}`} q={q} draft={draft} customers={customers} />;
}

function CallForm({ q, draft, customers }: { q: ReturnType<typeof useQuick>; draft: ReturnType<typeof useFormDraft>; customers: ComboboxOption[] }) {
  const v = draft.values;
  const [direction, setDirection] = useState(v?.direction === "inbound" ? "inbound" : "outbound");
  const [disposition, setDisposition] = useState<string>(v?.disposition && (CALL_DISPOSITIONS as readonly string[]).includes(v.disposition) ? v.disposition : "Ulaşıldı");
  return (
    <form onSubmit={q.onSubmit} onKeyDown={q.onKeyDown} onInput={(e) => draft.track(e.currentTarget)} onChange={(e) => draft.track(e.currentTarget)} className="flex flex-col gap-4">
      <DraftBadge show={draft.restored} onDiscard={draft.clear} />
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
          defaultValue={v?.customer_id}
          selectedLabel={restoredLabel(v, "customer_id", "Seçili müşteri")}
          className="[&_button]:min-h-11"
        />
      </FormField>
      <FormField label="ya da telefonla" htmlFor="hq-call-phone" inject={false} hint="Müşteri seçtiyseniz boş bırakabilirsiniz.">
        <PhoneInput id="hq-call-phone" name="phone" defaultValue={v?.phone} />
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
        <FormTextarea id="hq-call-notes" name="notes" rows={3} placeholder="Ne konuşuldu, sonraki adım… (ör. cuma saat 3'te yer gösterme, yarın tekrar ara)" defaultValue={v?.notes} />
      </FormField>
      <NoteAssist textareaId="hq-call-notes" demand={false} />
      <ErrorBand error={q.result.error} />
      <SubmitRow pending={q.pending} label="Görüşmeyi kaydet" />
    </form>
  );
}

/* -------------------------------- Randevu -------------------------------- */

const APPOINTMENT_PICKERS = { customer_id: "hq-appt-customer", property_id: "hq-appt-property" };

function AppointmentTab({
  customers,
  properties,
  typeOptions,
  defaultWhen,
  prefill,
}: {
  customers: ComboboxOption[];
  properties: ComboboxOption[];
  typeOptions: { value: string; label: string }[];
  defaultWhen: string;
  prefill: AppointmentPrefill | null;
}) {
  const draft = useFormDraft("randevu", ["customer_id", "property_id", "confirm_conflict"]);
  const q = useQuick("appointment", draft, () => "Randevu", APPOINTMENT_PICKERS);
  if (q.queued && !draft.restored) return <Queued onAgain={q.again} />;
  if (q.done && !draft.restored) {
    return <Success title="Randevu planlandı" openHref="/app/randevular" openLabel="Kaydı aç (randevular)" onAgain={q.again} />;
  }
  return (
    <AppointmentForm
      key={`${q.round}-${draft.formKey}-${prefill?.seq ?? 0}`}
      q={q}
      draft={draft}
      customers={customers}
      properties={properties}
      typeOptions={typeOptions}
      defaultWhen={prefill?.when ?? draft.values?.when ?? defaultWhen}
      prefill={prefill}
    />
  );
}

function AppointmentForm({
  q,
  draft,
  customers,
  properties,
  typeOptions,
  defaultWhen,
  prefill,
}: {
  q: ReturnType<typeof useQuick>;
  draft: ReturnType<typeof useFormDraft>;
  customers: ComboboxOption[];
  properties: ComboboxOption[];
  typeOptions: { value: string; label: string }[];
  defaultWhen: string;
  prefill: AppointmentPrefill | null;
}) {
  const conflict = q.result.conflictWarning ?? null;
  const v = draft.values;
  const [apptType, setApptType] = useState(
    v?.appointment_type && typeOptions.some((o) => o.value === v.appointment_type) ? v.appointment_type : (typeOptions[0]?.value ?? "showing"),
  );
  // Ön dolgu (nottan randevu) önce; yoksa kuyruktan geri yüklenen seçim.
  const initialCustomer = prefill?.customerId ?? v?.customer_id ?? "";
  const initialCustomerLabel = prefill?.customerLabel || restoredLabel(v, "customer_id", "Seçili müşteri");
  const [customerId, setCustomerId] = useState(initialCustomer);
  const [propertyId, setPropertyId] = useState(v?.property_id ?? "");
  const [localError, setLocalError] = useState<string | null>(null);
  // Sunucu (createAppointment) ile AYNI kural: yer göstermede müşteri + portföy, diğer türlerde en az biri.
  const missing = appointmentMissing({ appointment_type: apptType, customer_id: customerId, property_id: propertyId });
  const isShowing = apptType === "showing";
  function submit(event: FormEvent<HTMLFormElement>) {
    if (missing.length > 0) {
      event.preventDefault();
      setLocalError(missingFieldsError(missing));
      const first = missing[0];
      document.getElementById(first.key === "property" ? "hq-appt-property" : "hq-appt-customer")?.focus();
      return;
    }
    setLocalError(null);
    q.onSubmit(event, conflict ? { confirm_conflict: "1" } : undefined);
  }
  return (
    <form onSubmit={submit} onKeyDown={q.onKeyDown} onInput={(e) => draft.track(e.currentTarget)} onChange={(e) => draft.track(e.currentTarget)} className="flex flex-col gap-4">
      <DraftBadge show={draft.restored} onDiscard={draft.clear} />
      {prefill ? (
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Nottan önerilen saat ve müşteri dolduruldu; kontrol edip kaydedin.
        </p>
      ) : null}
      <FormField
        label="Tür"
        htmlFor="hq-appt-type"
        required
        inject={false}
        hint={isShowing ? "Yer göstermede müşteri ve portföy birlikte gerekir." : "Müşteri ya da portföyden en az biri gerekir."}
      >
        <div className="relative">
          <FormSelect
            id="hq-appt-type"
            name="appointment_type"
            required
            value={apptType}
            onChange={(e) => setApptType(e.target.value)}
            className={`${BIG} cursor-pointer appearance-none pr-9`}
          >
            {typeOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </FormSelect>
          <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
        </div>
      </FormField>
      <FormField label={isShowing ? "Müşteri" : "Müşteri (ya da portföy)"} htmlFor="hq-appt-customer" required={isShowing} inject={false}>
        <Combobox
          id="hq-appt-customer"
          name="customer_id"
          aria-label="Müşteri"
          placeholder="Müşteri ara ve seç"
          searchPlaceholder="Ad ya da telefon ara…"
          emptyText="Eşleşen müşteri yok"
          onSearch={searchCustomers}
          options={customers}
          defaultValue={initialCustomer || undefined}
          selectedLabel={initialCustomerLabel || undefined}
          onValueChange={setCustomerId}
          className="[&_button]:min-h-11"
        />
      </FormField>
      <FormField label={isShowing ? "Portföy" : "Portföy (ya da müşteri)"} htmlFor="hq-appt-property" required={isShowing} inject={false}>
        <Combobox
          id="hq-appt-property"
          name="property_id"
          aria-label="Portföy"
          placeholder="Portföy ara ve seç"
          searchPlaceholder="Başlık ya da kod ara…"
          emptyText="Eşleşen portföy yok"
          onSearch={searchProperties}
          options={properties}
          defaultValue={v?.property_id}
          selectedLabel={restoredLabel(v, "property_id", "Seçili portföy")}
          onValueChange={setPropertyId}
          className="[&_button]:min-h-11"
        />
      </FormField>
      <FormField label="Tarih ve saat" htmlFor="hq-appt-when" required>
        <FormInput id="hq-appt-when" name="when" type="datetime-local" required defaultValue={defaultWhen} className={BIG} />
      </FormField>
      {conflict ? (
        <p role="alert" className="flex items-start gap-2 rounded-[var(--radius-control)] border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {conflict}
        </p>
      ) : null}
      <ErrorBand error={localError ?? q.result.error} />
      <SubmitRow pending={q.pending} label={conflict ? "Yine de kaydet" : "Randevuyu kaydet"} missingCount={missing.length} />
    </form>
  );
}


/* -------------------------------- Portföy -------------------------------- */

export type QuickPropertyBrand = { watermark: WatermarkSettings; officeName: string; logoUrl: string | null };

/** Kuyruk etiketi: "Portföy: 3+1 Satılık Daire · 5 fotoğraf". */
function propertyLabel(fd: FormData): string {
  const base = `Portföy: ${[fd.get("rooms"), fd.get("transaction_type"), fd.get("property_type")].filter(Boolean).join(" ")}`;
  const photos = Number(fd.get(PHOTO_COUNT_FIELD) ?? 0);
  return photos > 0 ? `${base} · ${photos} fotoğraf` : base;
}

/** Yükleme panelindeki kısa ad ("3+1 Satılık Daire"). */
function shortPropertyLabel(label: string): string {
  return label.replace(/^Portföy: /, "").replace(/ · \d+ fotoğraf$/, "");
}

/** Kayıt açıldı: formda çekilen fotoğraflar dönen portföye bağlanır ve sırayla yüklenmeye başlar. */
function attachSavedPhotos(res: Result, fd: FormData) {
  const batch = String(fd.get(PHOTO_BATCH_FIELD) ?? "");
  if (batch && res.id) void attachPhotoBatch(batch, res.id, shortPropertyLabel(propertyLabel(fd)));
}

/**
 * Sahadan hızlı portföy (mal sahibinin evinde): tür, işlem, fiyat, oda, m², "konumumu kullan" + FOTOĞRAF ÇEK → TASLAK
 * kaydedilir. Fotoğraflar çekildiği anda cihazda küçültülüp saklanır; kayıt açılınca sırayla yüklenir (ilki kapak).
 * Bağlantı yoksa kayıt ve fotoğraflar birlikte bu cihazda bekler, bağlantı gelince gönderilir (GA-13).
 * Başlık ve komisyon oranı sunucuda üretilir/ofis varsayılanından gelir; kalan alanlar "Sonra tamamla" ile tam formda.
 * Konum alınınca il/ilçe/mahalle ÖNERİSİ gelir; kullanıcı "Uygula" derse portföye yazılır.
 */
function PropertyTab({ typeOptions, txOptions, brand }: { typeOptions: { value: string; label: string }[]; txOptions: { value: string; label: string }[]; brand: QuickPropertyBrand }) {
  const draft = useFormDraft("portfoy", ["lat", "lng", "province_id", "district_id", "neighborhood_id", "allow_duplicate", PHOTO_COUNT_FIELD]);
  const q = useQuick("property", draft, propertyLabel, {}, attachSavedPhotos);
  const [moreMedia, setMoreMedia] = useState(false);
  if (q.queued && !draft.restored) return <Queued onAgain={q.again} />;
  if (q.done?.id && !draft.restored) {
    const photoCount = Number(q.done.fields[PHOTO_COUNT_FIELD] ?? 0);
    const again = () => {
      setMoreMedia(false);
      q.again();
    };
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="flex items-center gap-2 text-base font-bold text-mint-600">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-mint-500/15"><Check className="h-4 w-4" aria-hidden /></span>
          {photoCount > 0 ? "Taslak portföy kaydedildi" : "Taslak portföy kaydedildi — şimdi fotoğrafları ekleyin"}
        </p>
        {photoCount > 0 ? (
          <>
            <PhotoUploadStatus propertyId={q.done.id} />
            <p className="text-xs text-text-muted">Yükleme arka planda sürer; sayfadan ayrılırsanız bu ekrana dönünce kaldığı yerden devam eder.</p>
            {moreMedia ? (
              <PropertyMediaManager propertyId={q.done.id} media={[]} canEdit watermark={brand.watermark} officeName={brand.officeName} logoUrl={brand.logoUrl} />
            ) : (
              <Button variant="ghost" size="md" onClick={() => setMoreMedia(true)} className="self-start">
                Başka fotoğraf ya da belge ekle
              </Button>
            )}
          </>
        ) : (
          <PropertyMediaManager propertyId={q.done.id} media={[]} canEdit watermark={brand.watermark} officeName={brand.officeName} logoUrl={brand.logoUrl} />
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Link href={`/app/portfoyler/${q.done.id}`} className={SUBMIT}>Sonra tamamla (kaydı aç)</Link>
          <button type="button" onClick={again} className={GHOST}>Bir portföy daha</button>
        </div>
      </div>
    );
  }
  return <PropertyForm key={`${q.round}-${draft.formKey}`} q={q} draft={draft} typeOptions={typeOptions} txOptions={txOptions} />;
}

function newBatchId(): string {
  return newRequestId() || `b${now().toString(36)}`;
}

function PropertyForm({
  q,
  draft,
  typeOptions,
  txOptions,
}: {
  q: ReturnType<typeof useQuick>;
  draft: ReturnType<typeof useFormDraft>;
  typeOptions: { value: string; label: string }[];
  txOptions: { value: string; label: string }[];
}) {
  const v = draft.values;
  const [tx, setTx] = useState(v?.transaction_type && txOptions.some((o) => o.value === v.transaction_type) ? v.transaction_type : (txOptions[0]?.value ?? "Satılık"));
  const [rooms, setRooms] = useState(v?.rooms ?? "");
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [geoState, setGeoState] = useState<"idle" | "busy" | "error">("idle");
  const loc = useLocationSuggestion();
  // Fotoğraf partisi: taslaktan/kuyruktan geri yüklenen form kendi partisini sürdürür; yeni form ilk fotoğrafta üretir.
  const [photoBatch, setPhotoBatch] = useState(v?.[PHOTO_BATCH_FIELD] ?? "");
  const batchRef = useRef(photoBatch);
  const formRef = useRef<HTMLFormElement>(null);
  const outboxItems = useOutboxItems(draft.scope);
  function ensureBatch() {
    if (!batchRef.current) {
      batchRef.current = newBatchId();
      setPhotoBatch(batchRef.current);
    }
    return batchRef.current;
  }
  function trackPhotos() {
    // Gizli alanlar bir tur sonra yazılır: taslak kaydı bir sonraki görevde okunur.
    window.setTimeout(() => {
      if (formRef.current) draft.track(formRef.current);
    }, 0);
  }
  function discardDraft() {
    if (batchRef.current) void discardPhotoBatch(batchRef.current);
    draft.clear();
  }

  function locate() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoState("error");
      return;
    }
    setGeoState("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lng: Math.round(pos.coords.longitude * 1e6) / 1e6 };
        setGeo(point);
        setGeoState("idle");
        loc.request(point.lat, point.lng);
      },
      () => setGeoState("error"),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        // Fotoğraf sayısı kuyruk etiketi ve kayıt sonrası ekran için (sunucu yok sayar).
        const photoCount = batchRef.current ? batchPhotos(photoSyncSnapshot().photos, batchRef.current).length : 0;
        q.onSubmit(e, {
          ...(q.result.duplicate ? { allow_duplicate: "1" } : {}),
          ...(photoCount > 0 ? { [PHOTO_COUNT_FIELD]: String(photoCount) } : {}),
        });
      }}
      onKeyDown={q.onKeyDown}
      onInput={(e) => draft.track(e.currentTarget)}
      onChange={(e) => draft.track(e.currentTarget)}
      className="flex flex-col gap-4"
    >
      <DraftBadge show={draft.restored} onDiscard={discardDraft} />
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-950">İşlem *</legend>
        <div className="grid grid-cols-2 gap-2">
          {txOptions.map((o) => (
            <label key={o.value} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border text-sm font-semibold transition ${tx === o.value ? "border-brand-400 bg-brand-600/8 text-brand-600" : "border-line text-text-muted hover:border-brand-300"}`}>
              <input type="radio" name="transaction_type" value={o.value} checked={tx === o.value} onChange={() => setTx(o.value)} className="sr-only" />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Portföy türü" htmlFor="hq-prop-type" required inject={false}>
          <div className="relative">
            <FormSelect id="hq-prop-type" name="property_type" required defaultValue={v?.property_type ?? typeOptions[0]?.value ?? "Daire"} className={`${BIG} cursor-pointer appearance-none pr-9`}>
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </FormSelect>
            <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" aria-hidden />
          </div>
        </FormField>
        <FormField label={tx === "Kiralık" ? "Aylık kira (₺)" : "Fiyat (₺)"} htmlFor="hq-prop-price" required>
          <FormInput id="hq-prop-price" name="list_price" inputMode="numeric" required placeholder="Örn. 4.500.000" defaultValue={v?.list_price} className={BIG} />
        </FormField>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-ink-950">Oda</legend>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {QUICK_ROOM_OPTIONS.map((r) => (
            <label key={r} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-control)] border text-sm font-semibold transition ${rooms === r ? "border-brand-400 bg-brand-600/8 text-brand-600" : "border-line text-text-muted hover:border-brand-300"}`}>
              <input type="radio" name="rooms" value={r} checked={rooms === r} onChange={() => setRooms(r)} className="sr-only" />
              {r}
            </label>
          ))}
        </div>
      </fieldset>
      <FormField label="m² (brüt)" htmlFor="hq-prop-sqm">
        <FormInput id="hq-prop-sqm" name="sqm" inputMode="decimal" placeholder="Örn. 120" defaultValue={v?.sqm} className={BIG} />
      </FormField>
      <FormField label="Adres / semt (isteğe bağlı)" htmlFor="hq-prop-address">
        <FormInput id="hq-prop-address" name="address_line" maxLength={200} placeholder="Mahalle, sokak…" defaultValue={v?.address_line} className={BIG} />
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={locate} disabled={geoState === "busy"} className={GHOST}>
          {geoState === "busy" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="mr-1.5 h-4 w-4" aria-hidden />}
          {geo ? "Konum alındı — yenile" : "Konumumu kullan"}
        </button>
        {geo ? <span className="text-xs text-text-muted tabular-nums">{geo.lat}, {geo.lng}</span> : null}
        {geoState === "error" ? <span className="text-xs text-danger-600">Konum alınamadı (izin verin ya da adres yazın).</span> : null}
        <input type="hidden" name="lat" value={geo ? String(geo.lat) : ""} />
        <input type="hidden" name="lng" value={geo ? String(geo.lng) : ""} />
      </div>
      {geo ? <LocationSuggestionRow loc={loc} addressInputId="hq-prop-address" /> : null}
      <FieldPhotoPicker scope={draft.scope} batchId={photoBatch} ensureBatch={ensureBatch} outboxItems={outboxItems} onChange={trackPhotos} />
      <p className="text-xs text-text-faint">Başlık otomatik oluşur, komisyon oranı ofis varsayılanıdır; kalan ayrıntıları kayıttan sonra tam formda tamamlarsınız.</p>
      <ErrorBand error={q.result.error} />
      <SubmitRow pending={q.pending} label={q.result.duplicate ? "Yine de yeni taslak aç" : "Taslak olarak kaydet"} />
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
  propertyTypeOptions = [],
  transactionOptions = [],
  brand,
  scope: scopeProp,
}: {
  tabs: QuickTabId[];
  initial: QuickTabId;
  customers: ComboboxOption[];
  properties: ComboboxOption[];
  typeOptions: { value: string; label: string }[];
  defaultWhen: string;
  propertyTypeOptions?: { value: string; label: string }[];
  transactionOptions?: { value: string; label: string }[];
  brand?: QuickPropertyBrand;
  /** Aktif oturum (kiracı + kullanıcı): taslak ve kuyruk yalnız bu oturuma aittir. */
  scope: CaptureScope;
}) {
  const scope = useMemo(() => ({ tenantId: scopeProp.tenantId, userId: scopeProp.userId }), [scopeProp.tenantId, scopeProp.userId]);
  const [active, setActive] = useState<QuickTabId>(initial);
  const [prefill, setPrefill] = useState<AppointmentPrefill | null>(null);
  // Sahada çekilen fotoğrafların yükleme motoru (kuyruk boşalınca / bağlantı gelince yükler).
  useEffect(() => {
    if (brand && scope.tenantId && scope.userId) configurePhotoSync(scope, createFieldPhotoUploader(brand));
  }, [brand, scope]);
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

  const planAppointment = tabs.includes("randevu")
    ? (p: Omit<AppointmentPrefill, "seq">) => {
        setPrefill((prev) => ({ ...p, seq: (prev?.seq ?? 0) + 1 }));
        select("randevu");
      }
    : undefined;

  /** Kuyruktaki öğeyi gönderir (aynı action, aynı istek kimliği → sunucuda en çok bir kayıt). */
  async function sendQueued(item: OutboxItem) {
    const fd = new FormData();
    for (const [k, v] of item.fields) if (!CLIENT_FIELDS.has(k)) fd.append(k, v);
    fd.set("client_request_id", item.id);
    // Öğenin sahibi: sunucu oturumla uyuşmazsa reddeder (başka oturumun kaydı bu ofiste açılmaz).
    fd.set(SCOPE_TENANT_FIELD, item.tenantId);
    fd.set(SCOPE_USER_FIELD, item.userId);
    try {
      const outcome = outcomeFromResult(await ACTIONS[item.kind](fd));
      // Kayıt açıldı: bu kayıtla sıraya alınan fotoğraflar portföye bağlanıp yüklenir.
      if (outcome.kind === "ok" && outcome.id && item.kind === "property") {
        const batch = outboxPhotoBatch(item);
        if (batch) await attachPhotoBatch(batch, outcome.id, shortPropertyLabel(item.label));
      }
      return outcome;
    } catch (e) {
      return isNetworkFailure(e) ? ({ kind: "retry" } as const) : ({ kind: "retry", error: "Sunucu yanıt vermedi." } as const);
    }
  }

  function restoreQueued(item: OutboxItem) {
    const tab = KIND_TAB[item.kind];
    const values: DraftValues = {};
    for (const [k, v] of item.fields) if (!CLIENT_FIELDS.has(k)) values[k] = v;
    for (const [field, label] of Object.entries(item.labels ?? {})) values[pickerLabelKey(field)] = label;
    restoreDraft(scope, tab, values);
    removeOutboxItem(browserStore(), scope, item.id);
    outboxChanged();
    if (tabs.includes(tab)) select(tab);
  }

  const panels: Record<QuickTabId, ReactNode> = {
    musteri: <CustomerTab onPlanAppointment={planAppointment} />,
    gorusme: <CallTab customers={customers} onPlanAppointment={planAppointment} />,
    randevu: <AppointmentTab customers={customers} properties={properties} typeOptions={typeOptions} defaultWhen={defaultWhen} prefill={prefill} />,
    portfoy: brand ? <PropertyTab typeOptions={propertyTypeOptions} txOptions={transactionOptions} brand={brand} /> : null,
  };

  return (
    <CaptureScopeProvider value={scope}>
      <div className="flex flex-col gap-4">
        <OutboxPanel
          send={sendQueued}
          onRestore={restoreQueued}
          onDiscard={(item) => {
            const batch = outboxPhotoBatch(item);
            if (batch) void discardPhotoBatch(batch);
          }}
          hrefFor={(item, id) =>
            item.kind === "customer" && id
              ? `/app/musteriler/${id}`
              : item.kind === "property" && id
                ? `/app/portfoyler/${id}`
                : item.kind === "appointment"
                  ? "/app/randevular"
                  : item.kind === "call"
                    ? "/app/gelen-kutusu?sekme=cagri"
                    : null
          }
        />
        {brand ? <PhotoUploadStatus /> : null}
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
    </CaptureScopeProvider>
  );
}
