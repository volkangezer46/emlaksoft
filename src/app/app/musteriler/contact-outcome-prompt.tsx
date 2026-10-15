"use client";

import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { useToast } from "@/components/app/toast-provider";
import { now } from "@/lib/clock";
import {
  CONTACT_OUTCOME_STORAGE_KEY,
  IDLE,
  buildContactOutcomeLog,
  channelFromHref,
  reduceContactOutcome,
  serializeContactOutcome,
  type ContactOutcome,
} from "@/lib/contact-outcome";
import { createCall } from "@/app/actions/calls";
import { createCommunication } from "@/app/actions/communications";
import { settleCustomerCallTasks } from "@/app/actions/tasks";

/** Pencere (Radix Dialog) ilk temasta iner; dokunuşta önceden ısıtılır, dönüşte hazırdır. */
const loadDialog = () => import("./contact-outcome-dialog").then((m) => m.ContactOutcomeDialog);
const ContactOutcomeDialog = dynamic(loadDialog, { ssr: false });

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
      void loadDialog().catch(() => undefined);
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
  // Pencere bir kez açılınca bağlı kalır (kapanış animasyonu korunur); açılmadıysa Dialog parçası hiç inmez.
  const [dialogLoaded, setDialogLoaded] = useState(false);
  if (contact && !dialogLoaded) setDialogLoaded(true);

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

  return dialogLoaded ? (
    <ContactOutcomeDialog
      contact={contact}
      pending={pending}
      note={note}
      error={error}
      onNoteChange={setNote}
      onSave={save}
      onClose={close}
    />
  ) : null;
}
