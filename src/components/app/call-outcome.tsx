"use client";

import { useEffect, useReducer, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, CalendarCheck, Check, MessageCircle, NotebookPen, Phone, PhoneOff, X } from "lucide-react";
import { useToast } from "@/components/app/toast-provider";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { now } from "@/lib/clock";
import {
  CONTACT_OUTCOME_STORAGE_KEY,
  IDLE,
  NOTE_MAX,
  buildContactOutcomeLog,
  channelFromHref,
  reduceContactOutcome,
  serializeContactOutcome,
  type ContactOutcome,
  type PendingContact,
} from "@/lib/contact-outcome";
import { prefillHref } from "@/lib/prefill-params";
import { createCall } from "@/app/actions/calls";
import { createCommunication } from "@/app/actions/communications";
import { settleCustomerCallTasks } from "@/app/actions/tasks";
import { cn } from "@/lib/utils";

/**
 * ARAMA SONUCU ŞERİDİ (sadeleştirme planı C12). Danışman "Ara"ya (ya da WhatsApp'a) dokunduğu anda ekranın altında
 * KALICI bir şerit belirir: "Görüşme nasıl geçti?" · Ulaşıldı / Açmadı / Yarın tekrar / Randevu verildi. Tek dokunuş
 * sonucu kaydeder (çağrı ya da WhatsApp iletişim kaydı → müşteri zaman çizelgesine düşer) ve sonraki adımı kurar:
 *  - Ulaşıldı: müşterinin açık arama görevleri kapanır.
 *  - Açmadı: "Ulaşılamadı" notlu çağrı kaydı.
 *  - Yarın tekrar: yarın 10:00 arama görevi açılır (varsa mevcut görev taşınır; görev birikmez).
 *  - Randevu verildi: "Ulaşıldı" kaydı + randevu formu bu müşteriyle açılır.
 *
 * Kayıt mantığı TEK kaynaktan gelir (`@/lib/contact-outcome` durum makinesi + `buildContactOutcomeLog`); bu dosya yalnız
 * görünümü taşır. Bağlantı tıklaması hiçbir koşulda engellenmez. Şerit, telefona gidip dönünce (sekme arka planda yeniden
 * yüklense bile, sessionStorage) aynen yerinde durur; "Kapat" hiçbir şey kaydetmez.
 *
 * Kullanım: sayfaya bir kez `<CallOutcomeStrip />` koyun; tel:/WhatsApp bağlantılarını `<CallOutcomeTarget>` ile sarın
 * (ya da kapsayıcıya `data-contact-outcome`, `data-customer-id`, `data-customer-name`, `data-phone` verin).
 */

/** Sonuç kaydedilince yayılan pencere olayı (`detail.customerId`, `detail.choice`); arama listesi sıradakine geçer. */
export const CALL_OUTCOME_LOGGED_EVENT = "emlaksoft:contact-outcome-logged";

export type CallOutcomeChoice = ContactOutcome | "appointment";

/** Şeritteki dört düğme (sıra = ekrandaki sıra). Etiketler tek kelimelik, sade Türkçe. */
export const CALL_OUTCOME_CHOICES: readonly { id: CallOutcomeChoice; label: string }[] = [
  { id: "reached", label: "Ulaşıldı" },
  { id: "unreached", label: "Açmadı" },
  { id: "callback", label: "Yarın tekrar" },
  { id: "appointment", label: "Randevu verildi" },
];

const CHOICE_ICON = {
  reached: Check,
  unreached: PhoneOff,
  callback: AlarmClock,
  appointment: CalendarCheck,
} as const;

/** "Randevu verildi" kayıtta "Ulaşıldı" sayılır; nota açıklama düşer (ayrı sonuç kodu yok). */
function baseOutcome(choice: CallOutcomeChoice): ContactOutcome {
  return choice === "appointment" ? "reached" : choice;
}

function choiceNote(choice: CallOutcomeChoice, note: string): string {
  return choice === "appointment" ? ["Randevu verildi.", note.trim()].filter(Boolean).join(" ") : note;
}

function toFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

export type LogCallOutcomeResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Sonucu kaydeder: çağrı/WhatsApp kaydı + arama görevlerinin düzenlenmesi (GA-05 tek kuyruk). Başka ekranlar (görev
 * listesi) da aynı kaydı bu fonksiyonla atar; kayıt kuralı kopyalanmaz.
 */
export async function logCallOutcome(contact: PendingContact, choice: CallOutcomeChoice, note: string): Promise<LogCallOutcomeResult> {
  const outcome = baseOutcome(choice);
  const log = buildContactOutcomeLog(contact, outcome, choiceNote(choice, note), now());
  const res = log.call
    ? await createCall(toFormData(log.call))
    : log.communication
      ? await createCommunication({}, toFormData(log.communication))
      : { error: "Kayıt türü belirlenemedi." };
  if (res.error) return { ok: false, error: res.error };
  const settled = await settleCustomerCallTasks({
    customerId: contact.customerId,
    outcome,
    dueLocal: log.task?.due_at,
    title: log.task?.title,
    notes: log.task?.notes,
  });
  if (settled.error) return { ok: true, message: `Görüşme kaydedildi; arama görevi güncellenemedi: ${settled.error}` };
  if (settled.moved) return { ok: true, message: "Kaydedildi. Arama görevi yarın 10:00'a taşındı." };
  if (settled.created) return { ok: true, message: "Kaydedildi. Yarın 10:00 için arama görevi açıldı." };
  if (settled.closed) return { ok: true, message: `Kaydedildi. ${settled.closed} arama görevi kapandı.` };
  return { ok: true, message: "Görüşme sonucu kaydedildi." };
}

/** tel:/WhatsApp bağlantılarını saran kapsayıcı: içindeki bağlantıya dokunulunca şerit açılır. */
export function CallOutcomeTarget({
  customerId,
  name,
  phone,
  children,
  className = "contents",
}: {
  customerId: string;
  name: string;
  phone: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={className} data-contact-outcome="" data-customer-id={customerId} data-customer-name={name} data-phone={phone ?? ""}>
      {children}
    </span>
  );
}

function readStored(): string | null {
  try {
    return window.sessionStorage.getItem(CONTACT_OUTCOME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(value: string | null): void {
  try {
    if (value == null) window.sessionStorage.removeItem(CONTACT_OUTCOME_STORAGE_KEY);
    else window.sessionStorage.setItem(CONTACT_OUTCOME_STORAGE_KEY, value);
  } catch {
    /* gizli pencere / engellenmiş depolama: yalnız bellek içi durum */
  }
}

/** Sayfada birden fazla şerit bağlanırsa yalnız ilki dinler; aynı temas iki kez sorulmaz. */
let owner: symbol | null = null;

export function CallOutcomeStrip({
  aboveRecordBar = false,
  onLogged,
}: {
  /** Mobil kayıt eylem çubuğu (müşteri detayı) varsa şerit onun üstüne oturur. */
  aboveRecordBar?: boolean;
  /** Kayıttan sonra (ör. görevi kapatma); olay (`CALL_OUTCOME_LOGGED_EVENT`) ayrıca yayılır. */
  onLogged?: (customerId: string, choice: CallOutcomeChoice) => void;
}) {
  const [state, dispatch] = useReducer(reduceContactOutcome, IDLE);
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const isOwner = useRef(false);
  /** Depodan geri yükleme bitmeden boş durum yazılmaz (aksi halde bekleyen temas silinirdi). */
  const restored = useRef(false);

  useEffect(() => {
    if (owner) return;
    const me = Symbol("call-outcome");
    owner = me;
    isOwner.current = true;

    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      const host = anchor?.closest<HTMLElement>("[data-contact-outcome]");
      if (!anchor || !host) return;
      const channel = channelFromHref(anchor.getAttribute("href"));
      const customerId = host.dataset.customerId ?? "";
      const phone = host.dataset.phone ?? "";
      if (!channel || !customerId || !phone) return;
      setError(null);
      dispatch({ type: "launch", contact: { customerId, name: host.dataset.customerName ?? "", phone, channel, startedAt: now() } });
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") dispatch({ type: "hidden" });
      else dispatch({ type: "visible", at: now() });
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    // Sekme arka plandayken yeniden yüklendiyse (mobil) bekleyen temas depodan geri gelir.
    const restore = window.setTimeout(() => {
      restored.current = true;
      dispatch({ type: "restore", raw: readStored(), at: now() });
    }, 0);
    return () => {
      window.clearTimeout(restore);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      if (owner === me) owner = null;
      isOwner.current = false;
    };
  }, []);

  useEffect(() => {
    if (isOwner.current && restored.current) writeStored(serializeContactOutcome(state));
  }, [state]);

  // Şerit temas başlar başlamaz görünür (telefona gidip dönmeyi beklemez): sonuç yeri hep belli.
  const contact = state.phase === "idle" ? null : state.contact;
  if (!contact) return null;

  function close() {
    setNote("");
    setNoteOpen(false);
    setError(null);
    dispatch({ type: "dismiss" });
  }

  function save(choice: CallOutcomeChoice) {
    if (!contact || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await logCallOutcome(contact, choice, note);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNote("");
      setNoteOpen(false);
      dispatch({ type: "logged" });
      window.dispatchEvent(new CustomEvent(CALL_OUTCOME_LOGGED_EVENT, { detail: { customerId: contact.customerId, choice } }));
      onLogged?.(contact.customerId, choice);
      toast.push(res.message, "ok");
      if (choice === "appointment") router.push(prefillHref("/app/randevular/yeni", { customerId: contact.customerId }));
      else router.refresh();
    });
  }

  const isCall = contact.channel === "call";
  const who = contact.name || "Müşteri";

  return (
    <section
      role="region"
      aria-label="Görüşme sonucu"
      data-call-outcome=""
      className={cn(
        "fixed inset-x-0 z-40 border-t border-line bg-surface px-3 pb-3 pt-2.5 shadow-[0_-10px_30px_-12px_rgb(0_0_0/0.4)]",
        aboveRecordBar
          ? "bottom-[calc(3.5rem+1px+4.25rem+env(safe-area-inset-bottom,0px))]"
          : "bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom,0px))]",
        "lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-[30rem] lg:rounded-[var(--radius-panel)] lg:border",
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-600/10 text-brand-700">
          {isCall ? <Phone className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
        </span>
        <p className="min-w-0 flex-1 text-base font-semibold text-ink-950">
          <span className="block truncate">{who}</span>
          <span className="block text-sm font-medium text-text-muted">Görüşme nasıl geçti?</span>
        </p>
        <Button type="button" variant="ghost" icon={X} onClick={close} disabled={pending} className="min-h-11">
          Kapat
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {CALL_OUTCOME_CHOICES.map((c) => {
          return (
            <Button
              key={c.id}
              type="button"
              variant={c.id === "reached" ? "primary" : "outline"}
              icon={CHOICE_ICON[c.id]}
              disabled={pending}
              onClick={() => save(c.id)}
              className="min-h-12 px-2 text-base"
            >
              {c.label}
            </Button>
          );
        })}
      </div>
      {noteOpen ? (
        <div className="mt-2">
          <label className="sr-only" htmlFor="call-outcome-note">
            Not (isteğe bağlı)
          </label>
          <Textarea
            id="call-outcome-note"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Kısa not (isteğe bağlı), sonra sonucu seçin"
          />
        </div>
      ) : (
        <Button type="button" variant="ghost" icon={NotebookPen} onClick={() => setNoteOpen(true)} className="mt-1 min-h-11 text-brand-700">
          Not ekle
        </Button>
      )}
      {error ? (
        <p role="alert" className="mt-1 text-sm font-medium text-danger-600">
          {error}
        </p>
      ) : null}
    </section>
  );
}
