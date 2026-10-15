"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormField, FormInput, FormTextarea } from "@/components/ui/form-controls";
import { counterOfferByToken } from "@/app/actions/owner-portal-offers";

/**
 * Malik portalı "Karşı teklif ver" (SP2). Teklif durumu değişmez ve alıcıya otomatik iletilmez: danışman bildirim alır
 * ve karşı teklifi pazarlık turu olarak iletmeye karar verir. Form kapalı başlar (tek dokunuşla açılır; ≥44 px hedefler).
 */
export function OwnerCounterOfferForm({
  token,
  offerId,
  currentCounter,
}: {
  token: string;
  offerId: string;
  /** Daha önce gönderilmiş karşı teklif (etiketlenmiş tutar). */
  currentCounter: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setMsg(null);
    start(async () => {
      const res = await counterOfferByToken(fd);
      if (res.ok) {
        setMsg({ ok: true, text: "Karşı teklifiniz danışmanınıza iletildi. Alıcıya danışmanınız aracılığıyla sunulur." });
        setOpen(false);
        router.refresh();
      } else {
        setMsg({ ok: false, text: res.error ?? "Karşı teklif kaydedilemedi." });
      }
    });
  };

  return (
    <div className="mt-2">
      {!open ? (
        <Button variant="secondary" className="min-h-11 w-full sm:w-auto" icon={ArrowLeftRight} onClick={() => setOpen(true)}>
          {currentCounter ? "Karşı teklifi güncelle" : "Karşı teklif ver"}
        </Button>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="offer_id" value={offerId} />
          <FormField label="Karşı teklif tutarı (₺)" htmlFor={`counter-amount-${offerId}`} required>
            <FormInput
              id={`counter-amount-${offerId}`}
              name="amount"
              inputMode="numeric"
              autoComplete="off"
              required
              placeholder="ör. 5.250.000"
              className="min-h-11"
            />
          </FormField>
          <FormField label="Danışmanınıza not (isteğe bağlı)" htmlFor={`counter-note-${offerId}`}>
            <FormTextarea
              id={`counter-note-${offerId}`}
              name="note"
              rows={2}
              maxLength={1000}
              placeholder="Örn. Tapu tarihi en geç Kasım sonu olursa bu tutara razıyım."
            />
          </FormField>
          <p className="text-xs leading-relaxed text-text-muted">
            Karşı teklifiniz önce danışmanınıza gider; alıcıya danışmanınız sunar. Teklifin durumu siz karar verene kadar değişmez.
          </p>
          <div className="grid gap-2 sm:flex sm:justify-end">
            <Button type="button" variant="secondary" className="min-h-11" onClick={() => setOpen(false)} disabled={pending}>
              Vazgeç
            </Button>
            <Button type="submit" className="min-h-11" icon={Send} loading={pending}>
              Danışmana gönder
            </Button>
          </div>
        </form>
      )}
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
