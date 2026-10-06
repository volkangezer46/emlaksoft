"use client";

import { useState, useTransition } from "react";
import { BellOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setCustomerRentReminderOptOut } from "@/app/actions/rent-reminders";
import { useToast } from "@/components/app/toast-provider";

/**
 * Kira hatırlatması tercihi (customers.rent_reminder_opt_out + _at). Açıkken bu kişiye hiçbir kanalda
 * kira hatırlatması üretilmez (rent-reminders cron'u kaydı "atlandı" düşer). KVKK: tarih kayda geçer.
 */
export function RentReminderPref({
  customerId,
  optOut,
  optOutAtLabel,
  canEdit,
}: {
  customerId: string;
  optOut: boolean;
  optOutAtLabel: string | null;
  canEdit: boolean;
}) {
  const { push } = useToast();
  const [value, setValue] = useState(optOut);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setValue(next);
    startTransition(async () => {
      const res = await setCustomerRentReminderOptOut(customerId, next);
      if (res.error) {
        setValue(!next);
        push(res.error, "err");
        return;
      }
      push(next ? "Kira hatırlatmaları bu kişi için durduruldu" : "Kira hatırlatmaları yeniden açıldı", "ok");
    });
  }

  return (
    <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <BellOff className="h-4 w-4 text-brand-600" /> Kira hatırlatması almak istemiyor
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Açıkken bu kişiye kira ödeme hatırlatması (SMS / WhatsApp görevi) üretilmez.
            {value && optOutAtLabel ? ` Kayıt tarihi: ${optOutAtLabel}.` : ""}
          </p>
        </div>
        <Switch
          checked={value}
          disabled={!canEdit || pending}
          onCheckedChange={toggle}
          aria-label="Kira hatırlatması almak istemiyor"
        />
      </div>
    </section>
  );
}
