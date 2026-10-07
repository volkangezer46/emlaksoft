"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PauseCircle, PlayCircle } from "lucide-react";
import { pauseSubscription, resumeSubscription } from "@/app/actions/subscription-pause";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FormField, FormInput } from "@/components/ui/form-controls";

export type PausePanelProps = {
  /** Abonelik şu an duraklatılmış. */
  paused: boolean;
  /** Planlı otomatik devam tarihi (okunabilir). */
  endsAtLabel: string | null;
  /** Mevcut dönem bitişi (okunabilir). */
  periodEndLabel: string | null;
  /** Ofis sahibi: duraklatabilir. Devam ettirmeyi sahip veya genel müdür yapar. */
  canPause: boolean;
  canResume: boolean;
  maxDays: number;
  /** Duraklatılamıyorsa kullanıcıya gösterilecek gerekçe (sunucu evaluatePause ile hesaplar); uygunsa null. */
  blockedReason: string | null;
};

/** Abonelik duraklatma / devam ettirme. Tutar yok; süre sınırları ve yıllık 1 kez kuralı sunucuda zorlanır. */
export function PausePanel({ paused, endsAtLabel, periodEndLabel, canPause, canResume, maxDays, blockedReason }: PausePanelProps) {
  const router = useRouter();
  const [days, setDays] = useState(String(Math.min(30, maxDays)));
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function pause() {
    setPending(true);
    setError(null);
    const fd = new FormData();
    fd.set("days", days);
    const result = await pauseSubscription(fd);
    setPending(false);
    setConfirming(false);
    if (result.ok) {
      setMessage(result.message ?? "Duraklatıldı.");
      router.refresh();
      return;
    }
    setError(result.error ?? "Abonelik duraklatılamadı.");
  }

  async function resume() {
    setPending(true);
    setError(null);
    const result = await resumeSubscription();
    setPending(false);
    if (result.ok) {
      setMessage(result.message ?? "Devam ediyor.");
      router.refresh();
      return;
    }
    setError(result.error ?? "Abonelik devam ettirilemedi.");
  }

  const dayNumber = Number(days);
  const daysValid = Number.isInteger(dayNumber) && dayNumber >= 1 && dayNumber <= maxDays;

  if (paused) {
    return (
      <section id="duraklatma" className="scroll-mt-24 space-y-3 rounded-[var(--radius-panel)] border border-amber-400/40 bg-amber-400/10 p-5">
        <p className="flex items-center gap-2 text-xs font-semibold text-warning-strong">
          <PauseCircle className="h-4 w-4" /> Abonelik duraklatıldı
        </p>
        <p className="text-sm text-text">
          Verileriniz salt-okunurdur: görüntüleyebilir, dışa aktarabilirsiniz; yeni kayıt ekleme ve düzenleme kapalıdır.
          {endsAtLabel ? ` ${endsAtLabel} tarihinde otomatik devam eder.` : ""} Dönem bitişiniz duraklatma süresi kadar uzar
          {periodEndLabel ? ` (şu an ${periodEndLabel})` : ""}.
        </p>
        {canResume ? (
          <Button icon={PlayCircle} loading={pending} onClick={resume}>Aboneliği devam ettir</Button>
        ) : (
          <p className="text-xs text-text-muted">Aboneliği yalnızca ofis sahibi veya genel müdür devam ettirebilir.</p>
        )}
        {message ? <Alert tone="success">{message}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </section>
    );
  }

  return (
    <section id="duraklatma" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <p className="flex items-center gap-2 text-xs font-semibold text-accent-text">
        <PauseCircle className="h-4 w-4" /> Aboneliği duraklat
      </p>
      <h2 className="mt-1 font-display font-bold text-text">Sezon arası ya da kısa mola</h2>
      <p className="mt-2 text-sm text-text-muted">
        En fazla {maxDays} gün duraklatabilirsiniz (yılda 1 kez). Duraklatma süresince verileriniz salt-okunur olur ve yeni
        faturalama yapılmaz; devam ettirdiğinizde dönem bitişiniz duraklatma süresi kadar uzar. Verileriniz silinmez.
      </p>
      {blockedReason ? (
        <p className="mt-3 text-sm text-text-muted">{blockedReason}</p>
      ) : !canPause ? (
        <p className="mt-3 text-sm text-text-muted">Aboneliği yalnızca ofis sahibi duraklatabilir.</p>
      ) : confirming ? (
        <div className="mt-3 space-y-3 rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/5 p-3">
          <p className="text-sm font-semibold text-ink-950">{dayNumber} gün duraklatılsın mı?</p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-text-muted">
            <li>Duraklatma süresince yeni kayıt ekleyemez ve düzenleyemezsiniz (verileri görebilirsiniz).</li>
            <li>Süre dolunca abonelik otomatik devam eder; dilerseniz daha önce siz devam ettirebilirsiniz.</li>
            <li>Yılda yalnızca 1 kez duraklatılabilir.</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button loading={pending} onClick={pause}>Evet, duraklat</Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>Vazgeç</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <FormField label={`Süre (gün, en fazla ${maxDays})`} htmlFor="pause-days" className="w-44">
            <FormInput
              id="pause-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxDays}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </FormField>
          <Button variant="secondary" icon={PauseCircle} disabled={!daysValid} onClick={() => setConfirming(true)}>
            Duraklat
          </Button>
        </div>
      )}
      {message ? <div className="mt-3"><Alert tone="success">{message}</Alert></div> : null}
      {error ? <div className="mt-3"><Alert tone="danger">{error}</Alert></div> : null}
    </section>
  );
}
