"use client";

import { useState, useTransition } from "react";
import { Check, MessageSquareText, ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { submitPresentationFeedback } from "@/app/actions/presentation-feedback";
import {
  PRESENTATION_FEEDBACK_LABEL,
  PRESENTATION_FEEDBACK_NOTE_MAX,
  type PresentationFeedbackVerdict,
} from "@/lib/presentation-feedback";

/**
 * /sunum/[token] ilan slaytı altındaki geri bildirim satırı (YD2): "İlgileniyorum / İlgilenmiyorum" tek dokunuşla
 * gider; "Not ekle" ile danışmana kısa not iletilir (aynı seçimle yeniden gönderilir). Önceki seçim sunucudan gelir
 * (müşteri sayfayı yeniden açınca seçimini görür, fikrini değiştirebilir). Yazdırmada görünmez (no-print).
 * Paylaşım linkindeki ShareFeedback'in sunum eşi; kayıt + danışman bildirimi action'dadır.
 */
export function PresentationFeedback({
  token,
  propertyId,
  initialVerdict,
  initialNote,
}: {
  token: string;
  propertyId: string;
  initialVerdict: PresentationFeedbackVerdict | null;
  initialNote: string | null;
}) {
  const [verdict, setVerdict] = useState<PresentationFeedbackVerdict | null>(initialVerdict);
  const [note, setNote] = useState(initialNote ?? "");
  const [sentNote, setSentNote] = useState(initialNote ?? "");
  const [noteOpen, setNoteOpen] = useState(Boolean(initialNote));
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(next: PresentationFeedbackVerdict, nextNote: string) {
    setError(null);
    setDone(null);
    const previous = verdict;
    setVerdict(next); // anında görsel tepki; hata olursa geri alınır
    startTransition(async () => {
      const res = await submitPresentationFeedback({ token, propertyId, verdict: next, note: nextNote, website }).catch(() => null);
      if (!res || !res.ok) {
        setVerdict(previous);
        setError(res && !res.ok ? res.error : "Bağlantı kurulamadı. Lütfen tekrar deneyin.");
        return;
      }
      setSentNote(res.note ?? "");
      setDone(
        res.verdict === "interested"
          ? "Teşekkürler, danışmanınıza iletildi. Sizi en kısa sürede arayacak."
          : "Teşekkürler, danışmanınıza iletildi.",
      );
    });
  }

  const tooLong = note.length > PRESENTATION_FEEDBACK_NOTE_MAX;
  const noteDirty = note.trim() !== sentNote.trim();

  return (
    <div className="no-print mt-6 rounded-[var(--radius-card)] border border-line bg-canvas p-4">
      <p className="text-sm font-semibold text-ink-950">Bu portföy hakkında ne düşünüyorsunuz?</p>
      {/* Honeypot: ekran okuyucu ve klavyeden gizli */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />
      <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label="Portföy geri bildirimi">
        {(["interested", "not_interested"] as const).map((v) => {
          const active = verdict === v;
          const Icon = v === "interested" ? ThumbsUp : ThumbsDown;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={active}
              disabled={pending}
              onClick={() => send(v, note)}
              className={`focus-ring press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border px-3 text-sm font-bold transition disabled:opacity-70 ${
                active
                  ? v === "interested"
                    ? "border-mint-500 bg-mint-500/12 text-mint-700"
                    : "border-line-strong bg-ink-950/[0.06] text-ink-950"
                  : "border-line bg-surface text-text-muted hover:border-line-strong hover:text-ink-950"
              }`}
            >
              {active ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              {PRESENTATION_FEEDBACK_LABEL[v]}
            </button>
          );
        })}
      </div>

      {noteOpen ? (
        <div className="mt-3 space-y-2">
          <label htmlFor={`pf-note-${propertyId}`} className="text-xs font-semibold text-text-muted">
            Danışmanınıza not (isteğe bağlı)
          </label>
          <Textarea
            id={`pf-note-${propertyId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={PRESENTATION_FEEDBACK_NOTE_MAX + 50}
            aria-invalid={tooLong}
            placeholder="Örn. Hafta sonu görmek isterim, fiyatta pazarlık payı var mı?"
          />
          <div className="flex items-center justify-between gap-3">
            <span className={`text-xs ${tooLong ? "text-danger-600" : "text-text-faint"}`}>
              {note.length}/{PRESENTATION_FEEDBACK_NOTE_MAX}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending || tooLong || !noteDirty}
              onClick={() => send(verdict ?? "interested", note)}
            >
              {verdict ? "Notu gönder" : "İlgileniyorum + notu gönder"}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNoteOpen(true)}
          className="focus-ring mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs font-semibold text-text-muted underline-offset-2 transition hover:text-ink-950 hover:underline"
        >
          <MessageSquareText className="h-3.5 w-3.5" /> Not ekle
        </button>
      )}

      <p aria-live="polite" className="text-xs">
        {error ? <span className="mt-2 block text-danger-600">{error}</span> : null}
        {done ? <span className="mt-2 block font-semibold text-mint-700">{done}</span> : null}
      </p>
    </div>
  );
}
