"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarCheck2, CalendarPlus, Check, MessageCircle, MessageSquareText, Plus } from "lucide-react";
import { Button, ButtonLink, buttonClass } from "@/components/ui/button";
import { AddToCalendarButton } from "@/components/app/add-to-calendar-button";
import { appointmentConfirmKit, sendAppointmentConfirmSms, type AppointmentConfirmKit } from "@/app/actions/appointment-quick";
import type { ConfirmSendOutcome } from "@/lib/appointment-customer-messages";

const SMS_NOTE: Record<ConfirmSendOutcome, string> = {
  sms_sent: "Teyit SMS'i müşteriye gönderildi.",
  sms_failed: "SMS gönderilemedi; WhatsApp ile iletebilirsiniz.",
  no_channel: "Ofisin SMS hesabı tanımlı değil; teyidi WhatsApp ile iletin.",
  no_phone: "Müşterinin kayıtlı geçerli cep numarası yok.",
  off: "SMS gönderilemedi.",
};

/**
 * Kayıttan sonra (formdan çıkmadan) tek dokunuşla sonraki adımlar: müşteriye teyit (WhatsApp taslağı ya da işlem amaçlı
 * SMS — `sendAppointmentConfirmSms`, İYS kapılı kanal), takvime ekle, randevuyu aç, yeni randevu.
 */
export function AppointmentSavedPanel({
  appointmentId,
  autoMessage,
  onNew,
}: {
  /** "Yeni randevu": formu temiz açar (aynı sayfa). */
  onNew: () => void;
  appointmentId: string | null;
  /** createAppointment'ın otomatik teyit sonucu (ofis ayarı açıksa SMS gitmiş olabilir). */
  autoMessage: ConfirmSendOutcome | undefined;
}) {
  const [kit, setKit] = useState<AppointmentConfirmKit | null>(null);
  const [sms, setSms] = useState<ConfirmSendOutcome | null>(autoMessage === "sms_sent" ? "sms_sent" : null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!appointmentId) return;
    let alive = true;
    appointmentConfirmKit(appointmentId).then((k) => {
      if (alive) setKit(k);
    });
    return () => {
      alive = false;
    };
  }, [appointmentId]);

  const openHref = appointmentId ? `/app/randevular?randevu=${appointmentId}` : "/app/randevular";

  return (
    <section
      aria-labelledby="randevu-kaydedildi"
      className="mx-auto w-full max-w-2xl rounded-[var(--radius-panel)] border border-mint-500/30 bg-surface p-5 shadow-[var(--shadow-sm)] sm:p-6"
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-mint-500/15 text-mint-700">
          <CalendarCheck2 className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 id="randevu-kaydedildi" className="font-display text-lg font-bold text-ink-950">Randevu planlandı</h1>
          <p className="mt-0.5 text-sm text-text-muted">{kit ? kit.calendar.title : "Randevu takvime eklendi; teyit bekliyor."}</p>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-muted">Müşteriye teyit gönder</p>
        {sms === "sms_sent" ? (
          <p role="status" className="flex items-center gap-2 rounded-[var(--radius-control)] bg-mint-500/10 px-3 py-2 text-sm font-semibold text-mint-700">
            <Check className="h-4 w-4" aria-hidden /> {SMS_NOTE.sms_sent}
          </p>
        ) : kit && !kit.customerName ? (
          <p className="text-sm text-text-muted">Randevuda müşteri yok; teyit gönderilecek kimse yok.</p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {kit?.waHref ? (
              <a
                href={kit.waHref}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: "primary", className: "min-h-11" })}
                aria-label="WhatsApp ile teyit gönder (yeni sekmede açılır)"
              >
                <MessageCircle className="h-4 w-4" aria-hidden /> WhatsApp ile teyit
              </a>
            ) : null}
            {kit?.hasPhone ? (
              <Button
                type="button"
                variant="secondary"
                icon={MessageSquareText}
                loading={pending}
                className="min-h-11"
                onClick={() =>
                  startTransition(async () => {
                    const res = await sendAppointmentConfirmSms(kit.id);
                    setSms(res.outcome);
                  })
                }
              >
                SMS ile teyit
              </Button>
            ) : null}
            {kit && !kit.hasPhone ? <p className="text-sm text-text-muted">{SMS_NOTE.no_phone}</p> : null}
            {!kit && appointmentId ? <p className="text-sm text-text-muted">Teyit seçenekleri hazırlanıyor…</p> : null}
          </div>
        )}
        {sms && sms !== "sms_sent" ? (
          <p role="status" className="text-xs font-medium text-amber-700">{SMS_NOTE[sms]}</p>
        ) : null}
      </div>

      <div className="mt-5 flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:flex-wrap sm:items-center">
        {kit ? (
          <AddToCalendarButton
            event={{
              uid: kit.calendar.uid,
              title: kit.calendar.title,
              description: kit.calendar.description ?? undefined,
              location: kit.calendar.location ?? undefined,
              startAt: new Date(kit.calendar.startIso),
              endAt: new Date(kit.calendar.endIso),
            }}
          />
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-faint">
            <CalendarPlus className="h-3.5 w-3.5" aria-hidden /> Takvime ekle
          </span>
        )}
        <ButtonLink href={openHref} variant="secondary" className="min-h-11">Randevuyu aç</ButtonLink>
        <Button type="button" variant="ghost" icon={Plus} onClick={onNew} className="min-h-11">
          Yeni randevu
        </Button>
      </div>
    </section>
  );
}
