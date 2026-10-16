"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, ClipboardCheck, HelpCircle, ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react";
import { updateAppointmentStatus } from "@/app/actions/appointments";
import {
  APPOINTMENT_OUTCOMES,
  APPOINTMENT_OUTCOME_META,
  type AppointmentOutcome,
} from "@/lib/appointment-outcome";
import { appointmentNextSteps, UNDECIDED_FOLLOW_UP_BUSINESS_DAYS } from "@/lib/appointment-follow-up";
import { InlineTabbedPanel } from "@/components/ui/inline-tabbed-panel";
import { useToast } from "@/components/app/toast-provider";

/** Seçilen sonuca göre kaydettikten sonra ne olacağı (takip zinciri). */
const NEXT_STEP_HINT: Record<AppointmentOutcome, string> = {
  olumlu: "Kaydettikten sonra “Teklif gir” ile müşteri ve portföy hazır gelen teklif formunu açabilirsiniz.",
  kararsiz: `Randevunun danışmanına ${UNDECIDED_FOLLOW_UP_BUSINESS_DAYS} iş günü sonrasına takip görevi açılır; “2. gösterim planla” kısayolu da sunulur.`,
  olumsuz: "Kaydettikten sonra “Talebi güncelle” ile müşterinin arama kriterlerini gözden geçirebilirsiniz.",
  gelmedi: "Yarın 10:00 için “yeniden planla” arama görevi açılır (açık arama görevi varsa o taşınır); müşteriye nazik bir WhatsApp mesajı da hazırlanır.",
};

/**
 * "Tamamlandı" artık düz bir damga değil: randevunun NASIL geçtiği sorulur
 * (olumlu / kararsız / olumsuz + kısa not). Sonuç `appointments.outcome` /
 * `outcome_note` kolonlarına yazılır (migration 126).
 *
 * Popup yok: sayfa içi panel. Bu değerlendirme, müşteri portalındaki eşleştirme
 * geri bildirimiyle KARIŞTIRILMAMALIDIR. Sonuç seçmek zorunlu değildir.
 *
 * Takip zinciri: kayıttan sonra sonuca göre sonraki adım bildirimle sunulur (olumlu → Teklif gir, kararsız →
 * 2. gösterim planla + sunucuda takip görevi, olumsuz → Talebi güncelle). Aynı kısayol tamamlanan satırda da kalır.
 */

/** Sonuç ikonları (emoji yerine tek ikon ailesi). */
const OUTCOME_ICON: Record<AppointmentOutcome, LucideIcon> = { olumlu: ThumbsUp, kararsiz: HelpCircle, olumsuz: ThumbsDown, gelmedi: Ban };
export function CompleteAppointmentDialog({
  appointmentId,
  customerName,
  customerId = null,
  propertyId = null,
  defaultOpen = false,
}: {
  appointmentId: string;
  customerName: string;
  customerId?: string | null;
  propertyId?: string | null;
  /** `?randevu=<id>&tamamla=1` (mobil ajandada sağa kaydırma): panel açık gelir. */
  defaultOpen?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(defaultOpen);
  const [outcome, setOutcome] = useState<AppointmentOutcome | "">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (fd: FormData) => {
    setError(null);
    startTransition(async () => {
      const note = String(fd.get("outcome_note") ?? "").trim();
      const out = new FormData();
      out.set("id", appointmentId);
      out.set("status", "completed");
      if (outcome) out.set("outcome", outcome);
      if (note) out.set("outcome_note", note);
      const res = await updateAppointmentStatus(out);
      if (res.error) {
        setError(res.error);
        return;
      }
      const [next] = appointmentNextSteps(outcome || null, { customerId, propertyId });
      const noShow = outcome === "gelmedi";
      const taskNote =
        res.followUpTask === "created"
          ? noShow ? " Yarın 10:00 için arama görevi açıldı." : " Takip görevi açıldı."
          : res.followUpTask === "exists"
            ? noShow ? " Müşterinin açık arama görevi yarın 10:00'a taşındı." : " Bu randevunun takip görevi zaten var."
            : "";
      const waHref = res.noShowWaHref;
      push(
        noShow ? `Gelmedi olarak kaydedildi.${taskNote}` : `Randevu tamamlandı.${taskNote}`,
        "ok",
        // Gelmeyen müşteri: birincil eylem nazik "yeniden planlayalım mı" mesajı (wa.me; danışman gönderir).
        waHref
          ? { action: { label: "WhatsApp'tan yazın", onClick: () => window.open(waHref, "_blank", "noopener,noreferrer") } }
          : next
            ? { action: { label: next.label, onClick: () => router.push(next.href) } }
            : undefined,
      );
      setOpen(false);
      setOutcome("");
      router.refresh();
    });
  };

  return (
    <InlineTabbedPanel
      open={open}
      onOpenChange={setOpen}
      title="Randevuyu tamamla"
      description={`${customerName} — randevu nasıl geçti? (isteğe bağlı)`}
      icon={<ClipboardCheck />}
      onSubmit={submit}
      pending={pending}
      error={error}
      submitLabel="Tamamla"
      pendingLabel="Kaydediliyor…"
      fieldLabels={{ outcome_note: "Kısa not" }}
      trigger={({ onClick, ...aria }) => (
        <button
          type="button"
          onClick={onClick}
          {...aria}
          className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition hover:border-brand-300 touch:min-h-11"
        >
          <CheckCircle2 className="h-3 w-3" /> Tamamlandı
        </button>
      )}
      tabs={[{ id: "sonuc", label: "Sonuç", icon: ClipboardCheck, fields: ["outcome_note"] }]}
      panels={{
        sonuc: (
          <div className="space-y-4 sm:col-span-2">
            <div>
              <span className="text-xs font-semibold text-text-muted">Sonuç</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {APPOINTMENT_OUTCOMES.map((key) => {
                  const meta = APPOINTMENT_OUTCOME_META[key];
                  const active = outcome === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setOutcome(active ? "" : key)}
                      className={`focus-ring press flex flex-col items-center gap-1 rounded-[var(--radius-card)] border px-3 py-3 text-xs font-semibold transition touch:min-h-11 ${
                        active
                          ? "border-brand-400/60 bg-brand-600/8 text-brand-700"
                          : "border-line bg-canvas text-text-muted hover:border-brand-300 hover:text-ink-950"
                      }`}
                    >
                      <OutcomeIcon outcome={key} />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              {outcome ? (
                <p className="mt-1.5 text-xs font-medium text-brand-700" aria-live="polite">
                  {NEXT_STEP_HINT[outcome]}
                </p>
              ) : null}
              <p className="mt-1.5 text-xs text-text-faint">
                Seçmeden de tamamlayabilirsiniz. Bu değerlendirme danışman notudur; müşteri portalındaki
                eşleştirme beğenisinden bağımsızdır.
              </p>
            </div>
            <label className="block">
              <span className="text-xs font-semibold text-text-muted">Kısa not</span>
              <textarea
                name="outcome_note"
                rows={3}
                maxLength={500}
                placeholder="Örn. Müşteri konumu beğendi, fiyatta indirim bekliyor."
                className="mt-1 w-full resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
              />
            </label>
          </div>
        ),
      }}
    />
  );
}

function OutcomeIcon({ outcome }: { outcome: AppointmentOutcome }) {
  const Icon = OUTCOME_ICON[outcome];
  return <Icon className="h-5 w-5" aria-hidden="true" />;
}
