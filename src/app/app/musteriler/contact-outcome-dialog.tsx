"use client";

import { MessageCircle, Phone, PhoneMissed, PhoneOff, Check, AlarmClock } from "lucide-react";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { CONTACT_OUTCOME_LABELS, NOTE_MAX, type ContactOutcome } from "@/lib/contact-outcome";

type PendingContact = { name: string; channel: string };

/**
 * "Görüşme nasıl geçti?" penceresi (Radix Dialog). ContactOutcomePrompt bunu ilk temasta `next/dynamic` ile yükler;
 * müşteri listesinin ilk yük JS'ine Dialog girmez. Durum ve kayıt mantığı çağıran bileşende kalır.
 */
export function ContactOutcomeDialog({
  contact,
  pending,
  note,
  error,
  onNoteChange,
  onSave,
  onClose,
}: {
  contact: PendingContact | null;
  pending: boolean;
  note: string;
  error: string | null;
  onNoteChange: (value: string) => void;
  onSave: (outcome: ContactOutcome) => void;
  onClose: () => void;
}) {
  const save = onSave;
  const isCall = contact?.channel === "call";
  const who = contact?.name || "Müşteri";

  return (
    <Dialog open={contact != null} onOpenChange={(next) => (next || pending ? undefined : onClose())}>
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
            onChange={(e) => onNoteChange(e.target.value)}
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
