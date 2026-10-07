"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { BellRing, Check, MessageCircle } from "lucide-react";
import { markReminderSent, setRenterReminderOptOut } from "@/app/actions/rent-reminders";
import { useToast } from "@/components/app/toast-provider";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { KIND_LABELS, type ReminderKind } from "@/lib/rent-reminders/logic";

export type ReminderLogRow = {
  id: string;
  period: string;
  kind: ReminderKind;
  channel: "office" | "sms";
  status: "queued" | "sent" | "failed" | "skipped";
  reason: string | null;
  sentAt: string | null;
  /** Yalnız ofis kanalı için: hazır wa.me bağlantısı (kiracı telefonu geçerliyse). */
  waHref: string | null;
};

const STATUS: Record<ReminderLogRow["status"], { label: string; variant: "warning" | "success" | "danger" | "outline" }> = {
  queued: { label: "Gönderilmeyi bekliyor", variant: "warning" },
  sent: { label: "Gönderildi", variant: "success" },
  failed: { label: "Gönderilemedi", variant: "danger" },
  skipped: { label: "Atlandı", variant: "outline" },
};

function periodLabel(period: string) {
  return new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}T00:00:00Z`));
}

/**
 * Kiracı hatırlatma sekmesi: manuel wa.me hatırlatması (ayardan bağımsız, ofis tek tıkla gönderir), cron'un hazırladığı
 * kuyruk ve gönderim kayıtları, kiracı opt-out anahtarı. Mesajı ofis kendi WhatsApp'ından gönderir; sistem göndermez.
 */
export function RemindersPanel({
  rentalId,
  renterName,
  phoneDisplay,
  optOut,
  automationEnabled,
  suggestion,
  logs,
  canEdit,
}: {
  rentalId: string;
  renterName: string | null;
  phoneDisplay: string | null;
  optOut: boolean;
  /** true/false = ofis ayarı açık/kapalı; null = ayar okunamadı (migration uygulanmamış). */
  automationEnabled: boolean | null;
  suggestion: { kind: ReminderKind; label: string; waHref: string | null; message: string } | null;
  logs: ReminderLogRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [optOutState, setOptOutState] = useState(optOut);

  function toggleOptOut(next: boolean) {
    setOptOutState(next);
    start(async () => {
      const res = await setRenterReminderOptOut(rentalId, next);
      if (res.error) {
        setOptOutState(!next);
        push(res.error, "err");
      } else {
        push(next ? "Kiracı hatırlatma almayacak" : "Kiracı hatırlatma alabilir", "ok");
        router.refresh();
      }
    });
  }

  function markSent(id: string) {
    setBusy(id);
    start(async () => {
      const res = await markReminderSent(id, rentalId);
      setBusy(null);
      if (res.error) push(res.error, "err");
      else router.refresh();
    });
  }

  return (
    <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <BellRing className="h-4 w-4 text-brand-600" /> Kiracı hatırlatması
        </h2>
        <Badge variant={automationEnabled ? "success" : "outline"}>
          {automationEnabled === null ? "Ayar okunamadı" : automationEnabled ? "Otomatik hatırlatma açık" : "Otomatik hatırlatma kapalı"}
        </Badge>
      </div>

      <p className="text-xs text-text-muted">
        Otomatik hatırlatma varsayılan olarak KAPALIDIR; ofis ayarı{" "}
        <Link href="/app/kiralama#hatirlatma-ayarlari" className="font-semibold text-brand-600 hover:underline">Kiralama sayfasından</Link> açılır.
        Aşağıdaki WhatsApp bağlantısı ayardan bağımsızdır: mesajı siz kendi WhatsApp’ınızdan gönderirsiniz.
      </p>

      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5">
        <div>
          <p className="text-sm font-semibold text-ink-950">Hatırlatma istemiyor</p>
          <p className="text-xs text-text-muted">
            {renterName ?? "Kiracı"} bu seçenekle işaretlenirse hiçbir kanalda (WhatsApp görevi, SMS) hatırlatma üretilmez.
          </p>
        </div>
        <Switch
          checked={optOutState}
          onCheckedChange={toggleOptOut}
          disabled={!canEdit || pending}
          aria-label="Kiracı hatırlatma istemiyor"
        />
      </div>

      {suggestion ? (
        <div className="rounded-[var(--radius-card)] border border-line p-3">
          <p className="text-sm font-semibold text-ink-950">Şimdi hatırlat: {suggestion.label}</p>
          <p className="mt-1 whitespace-pre-wrap rounded-[var(--radius-control)] bg-canvas/70 p-2.5 text-xs text-text-muted">{suggestion.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {optOutState ? (
              <span className="text-xs font-semibold text-amber-700">Kiracı hatırlatma istemiyor; gönderim kapalı.</span>
            ) : suggestion.waHref ? (
              <a
                href={suggestion.waHref}
                target="_blank"
                rel="noopener noreferrer"
                className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-mint-500/15 px-3 py-1.5 text-xs font-bold text-mint-700 transition hover:bg-mint-500/25"
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp ile gönder
              </a>
            ) : (
              <span className="text-xs text-text-muted">
                Kiracının geçerli telefonu yok{phoneDisplay ? ` (${phoneDisplay})` : ""}; müşteri kaydından ekleyin.
              </span>
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong p-4 text-center text-sm text-text-muted">
          Bekleyen (tahsil edilmemiş) tahakkuk yok; şu an hatırlatılacak bir ödeme görünmüyor.
        </p>
      )}

      <div>
        <h3 className="text-xs font-bold uppercase tracking-[0.08em] text-text-muted">Hatırlatma kayıtları</h3>
        {logs.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">Henüz kayıt yok. Otomatik hatırlatma açıkken cron vade günlerinde kayıt üretir.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-[var(--radius-card)] border border-line">
            {logs.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-ink-950">{periodLabel(l.period)}</span>{" "}
                  <span className="text-text-muted">· {KIND_LABELS[l.kind]} · {l.channel === "sms" ? "SMS" : "WhatsApp (ofis)"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={STATUS[l.status].variant} size="sm">{STATUS[l.status].label}</Badge>
                  {l.channel === "office" && l.status === "queued" && !optOutState ? (
                    <>
                      {l.waHref ? (
                        <a href={l.waHref} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-brand-600 hover:underline">
                          WhatsApp’ı aç
                        </a>
                      ) : null}
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => markSent(l.id)}
                          disabled={busy === l.id}
                          className="focus-ring inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-2 py-1 text-xs font-semibold text-ink-950 hover:bg-canvas disabled:opacity-50"
                        >
                          <Check className="h-3 w-3" /> Gönderdim
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
