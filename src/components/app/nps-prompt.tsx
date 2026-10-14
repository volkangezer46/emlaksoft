"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareHeart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormTextarea } from "@/components/ui/form-controls";
import { dismissNpsPrompt, recordNpsShown, submitNpsAnswer } from "@/app/actions/product-feedback";
import { cn } from "@/lib/utils";

const SCORES = Array.from({ length: 11 }, (_, i) => i);

/**
 * Ürün içi NPS kartı (DG8): sağ altta, sayfayı kapatmayan küçük kart. Ekrana gelince gösterim yazılır
 * (`recordNpsShown`; sıklık sınırı DB'de de uygulanır, sınır içindeyse kart kendiliğinden gizlenir). 0-10 puan,
 * ardından isteğe bağlı yorum. "Şimdi değil" kapatır; ayardaki süre dolmadan tekrar sorulmaz.
 */
export function NpsPrompt({ surveyId, question }: { surveyId: string; question: string }) {
  const [responseId, setResponseId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void recordNpsShown(surveyId)
      .then((r) => (r.responseId ? setResponseId(r.responseId) : setHidden(true)))
      .catch(() => setHidden(true));
  }, [surveyId]);

  useEffect(() => {
    if (!thanks) return;
    const t = setTimeout(() => setHidden(true), 4000);
    return () => clearTimeout(t);
  }, [thanks]);

  if (hidden || !responseId) return null;

  const close = () => {
    setHidden(true);
    if (!thanks) void dismissNpsPrompt(responseId).catch(() => undefined);
  };

  const send = async () => {
    if (score === null) return;
    setSending(true);
    setError(null);
    const r = await submitNpsAnswer({ responseId, score, comment }).catch(() => ({ error: "Yanıt gönderilemedi; bağlantınızı kontrol edin." }));
    setSending(false);
    if ("error" in r && r.error) {
      setError(r.error);
      return;
    }
    setThanks(true);
  };

  return (
    <aside
      aria-label="Kısa memnuniyet anketi"
      className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 mx-auto max-w-md rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-xl sm:inset-x-auto sm:right-6 sm:w-[26rem] lg:bottom-6"
    >
      <div className="flex items-start gap-2">
        <MessageSquareHeart className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-semibold text-ink-950">{thanks ? "Teşekkürler! Yanıtınız ekibimize ulaştı." : question}</p>
        <Button type="button" variant="ghost" size="icon" aria-label="Şimdi değil" onClick={close} className="-mr-1 -mt-1 shrink-0">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      {thanks ? null : (
        <div className="mt-3 space-y-3">
          <div role="radiogroup" aria-label="0 (hiç olası değil) ile 10 (çok olası) arası puan" className="grid grid-cols-6 gap-1 sm:grid-cols-11">
            {SCORES.map((n) => (
              <Button
                key={n}
                role="radio"
                aria-checked={score === n}
                variant={score === n ? "primary" : "secondary"}
                size="md"
                onClick={() => setScore(n)}
                className={cn("numeric px-0", score === n ? "" : "bg-canvas")}
              >
                {n}
              </Button>
            ))}
          </div>
          <div className="flex justify-between text-xs text-text-faint">
            <span>Hiç olası değil</span>
            <span>Çok olası</span>
          </div>
          {score !== null ? (
            <>
              <label className="block text-xs font-medium text-ink-950" htmlFor="nps-yorum">
                {score >= 9 ? "En çok neyi seviyorsunuz? (isteğe bağlı)" : "Neyi daha iyi yapabiliriz? (isteğe bağlı)"}
              </label>
              <FormTextarea id="nps-yorum" rows={2} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="primary" size="sm" disabled={sending} onClick={() => void send()}>
                  {sending ? "Gönderiliyor…" : "Gönder"}
                </Button>
                {error ? <span role="alert" className="text-xs font-semibold text-danger-600">{error}</span> : null}
              </div>
            </>
          ) : null}
        </div>
      )}
    </aside>
  );
}
