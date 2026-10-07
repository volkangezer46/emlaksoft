"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, X } from "lucide-react";
import { scheduleCampaign, unscheduleCampaign } from "@/app/actions/campaigns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/app/toast-provider";

/**
 * Kampanya zamanlama paneli (taslak / zamanlanmış): Türkiye saatiyle tarih-saat seçilir,
 * teslimat cron'u o andan sonraki ilk turda kuyruğa alır. Zamanlama kaldırılınca taslağa döner.
 */
export function CampaignSchedule({
  campaignId,
  status,
  scheduledLocal,
  scheduledLabel,
}: {
  campaignId: string;
  status: string;
  /** Mevcut zamanlamanın TR yerel "YYYY-MM-DDTHH:mm" karşılığı (input değeri). */
  scheduledLocal: string;
  scheduledLabel: string | null;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [value, setValue] = useState(scheduledLocal);
  const [pending, startTransition] = useTransition();

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5">
      <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
        <CalendarClock className="h-4 w-4 text-brand-600" /> Zamanlama
      </h2>
      <p className="mt-1 text-xs text-text-muted">
        {status === "scheduled" && scheduledLabel
          ? `Bu kampanya ${scheduledLabel} (TR saati) sonrasında otomatik kuyruğa alınacak. Teslimat birkaç dakika içinde başlar.`
          : "Gönderimi ileri bir saate kurun; seçilen saatten sonraki ilk turda otomatik kuyruğa alınır (en az 5 dk, en çok 90 gün sonrası)."}
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="text-xs font-semibold text-text-muted">
          Gönderim zamanı
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 block rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-300"
          />
        </label>
        <Button
          size="sm"
          loading={pending}
          disabled={!value}
          onClick={() =>
            startTransition(async () => {
              const res = await scheduleCampaign(campaignId, value);
              if (res.error) return push(res.error, "err");
              push("Kampanya zamanlandı", "ok");
              router.refresh();
            })
          }
        >
          <CalendarClock className="h-3.5 w-3.5" /> {status === "scheduled" ? "Zamanı güncelle" : "Zamanla"}
        </Button>
        {status === "scheduled" ? (
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await unscheduleCampaign(campaignId);
                if (res.error) return push(res.error, "err");
                push("Zamanlama kaldırıldı; kampanya taslağa döndü", "ok");
                router.refresh();
              })
            }
          >
            <X className="h-3.5 w-3.5" /> Zamanlamayı kaldır
          </Button>
        ) : null}
      </div>
    </section>
  );
}
