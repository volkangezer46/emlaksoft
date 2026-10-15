"use client";

import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import { MessageCircle, Phone, PhoneMissed, PhoneOff, Check, AlarmClock } from "lucide-react";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useToast } from "@/components/app/toast-provider";
import { now } from "@/lib/clock";
import {
  CONTACT_OUTCOME_LABELS,
  CONTACT_OUTCOME_STORAGE_KEY,
  IDLE,
  NOTE_MAX,
  buildContactOutcomeLog,
  channelFromHref,
  reduceContactOutcome,
  serializeContactOutcome,
  type ContactOutcome,
} from "@/lib/contact-outcome";
import { createCall } from "@/app/actions/calls";
import { createCommunication } from "@/app/actions/communications";
import { settleCustomerCallTasks } from "@/app/actions/tasks";

/** Sonuç kaydedilince yayılan pencere olayı (`detail.customerId`); arama listesi bununla sıradakine geçer. */
export const CONTACT_OUTCOME_LOGGED_EVENT = "emlaksoft:contact-outcome-logged";

/** Sayfada birden fazla örnek bağlanırsa (liste + süzgeç) yalnız ilki dinler; aynı temas iki kez sorulmaz. */
let owner: symbol | null = null;

function toFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
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

/**
 * Temas sonrası sonuç kaydı. `data-contact-outcome` taşıyan kapsayıcının içindeki tel:/WhatsApp bağlantısına
 * dokunulunca bekleyen temas saklanır (tıklama ENGELLENMEZ); sayfa arka plandan dönünce kısa sonuç penceresi açılır.
 * Kapsayıcı öznitelikleri: `data-customer-id`, `data-customer-name`, `data-phone`. Kapatmak kayıt atmaz.
 */
export function ContactOutcomePrompt() {
  const [state, dispatch] = useReducer(reduceContactOutcome, IDLE);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const toast = useToast();
  const isOwner = useRef(false);
  /** Depodan geri yükleme bitmeden boş durum yazılmaz (aksi halde bekleyen temas silinirdi). */
  const restored = useRef(false);

  useEffect(() => {
    if (owner) return;
    const me = Symbol("contact-outcome");
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

  const contact = state.phase === "prompt" ? state.contact : null;

  function close() {
    setNote("");
    setError(null);
    dispatch({ type: "dismiss" });
  }

  function save(outcome: ContactOutcome) {
    if (!contact) return;
    setError(null);
    startTransition(async () => {
      const log = buildContactOutcomeLog(contact, outcome, note, now());
      const res = log.call
        ? await createCall(toFormData(log.call))
        : log.communication
          ? await createCommunication({}, toFormData(log.communication))
          : { error: "Kayıt türü belirlenemedi." };
      if (res.error) {
        setError(res.error);
        return;
      }
      // GA-05 tek kuyruk: "Ulaşıldı" müşterinin açık arama görevlerini kapatır; "Geri ara" mevcut görevi taşır
      // (yoksa açar) — görev birikmez.
      const settled = await settleCustomerCallTasks({
        customerId: contact.customerId,
        outcome,
        dueLocal: log.task?.due_at,
        title: log.task?.title,
        notes: log.task?.notes,
      });
      setNote("");
      dispatch({ type: "logged" });
      window.dispatchEvent(new CustomEvent(CONTACT_OUTCOME_LOGGED_EVENT, { detail: { customerId: contact.customerId } }));
      if (settled.error) toast.push(`Görüşme kaydedildi; arama görevi güncellenemedi: ${settled.error}`, "err");
      else if (settled.moved) toast.push("Görüşme kaydedildi, mevcut arama görevi yarın 10:00'a taşındı.", "ok");
      else if (settled.created) toast.push("Görüşme kaydedildi, yarın 10:00 için geri arama görevi açıldı.", "ok");
      else if (settled.closed) toast.push(`Görüşme kaydedildi, ${settled.closed} arama görevi kapatıldı.`, "ok");
      else toast.push("Görüşme sonucu kaydedildi.", "ok");
    });
  }

  const isCall = contact?.channel === "call";
  const who = contact?.name || "Müşteri";

  return (
    <Dialog open={contact != null} onOpenChange={(next) => (next || pending ? undefined : close())}>
      <DialogContent size="sm">
        <DialogHeader
          icon={isCall ? <Phone /> : <MessageCircle />}
          title="Görüşme nasıl geçti?"
          description={`${who} ile ${isCall ? "telefon" : "WhatsApp"} görüşmenizin sonucunu kaydedin.`}
        />
        <DialogBody>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button variant="outline" icon={Check} disabled={pending} onClick={() => save("reached")}>
              {CONTACT_OUTCOME_LABELS.reached}
            </Button>
            <Button variant="outline" icon={isCall ? PhoneOff : PhoneMissed} disabled={pending} onClick={() => save("unreached")}>
              {CONTACT_OUTCOME_LABELS.unreached}
            </Button>
            <Button variant="outline" icon={AlarmClock} disabled={pending} onClick={() => save("callback")} title="Yarın 10:00 için arama görevi açar">
              {CONTACT_OUTCOME_LABELS.callback}
            </Button>
          </div>
          <label className="mt-4 block text-xs font-semibold text-text-muted" htmlFor="contact-outcome-note">
            Not (isteğe bağlı)
          </label>
          <Textarea
            id="contact-outcome-note"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Kısa bir not ekleyebilirsiniz"
            className="mt-1"
          />
          {error ? (
            <p role="alert" className="mt-2 text-xs font-medium text-danger-600">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={pending}>
              Kaydetmeden kapat
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
