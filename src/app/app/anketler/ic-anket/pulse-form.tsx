"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitAdvisorPulse } from "@/app/actions/surveys";

export type PulseQuestionVM = {
  id: string;
  kind: "score" | "choice" | "yesno" | "text";
  label: string;
  options: string[];
  required: boolean;
};

function tone(n: number, selected: boolean): string {
  if (n <= 6) return selected ? "border-danger-500 bg-danger-500 text-white" : "border-danger-500/30 bg-danger-500/8 text-danger-500";
  if (n <= 8) return selected ? "border-amber-500 bg-amber-500 text-white" : "border-amber-500/35 bg-amber-500/10 text-amber-600";
  return selected ? "border-mint-600 bg-mint-600 text-white" : "border-mint-500/35 bg-mint-500/10 text-mint-600";
}

/** Ekip nabzı formu (uygulama içi, satır içi; popup değil). Cevap anonim kaydedilir (RPC kişiye bağlamaz). */
export function PulseForm({ questions }: { questions: PulseQuestionVM[] }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function set(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
    setError(null);
  }

  function submit() {
    const missing = questions.find((q) => q.required && !(answers[q.id] ?? "").trim());
    if (missing) {
      setError(`"${missing.label}" sorusunu cevaplayın.`);
      return;
    }
    startTransition(async () => {
      const res = await submitAdvisorPulse(answers);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone(res.message ?? "Teşekkürler!");
      router.refresh();
    });
  }

  if (done) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/8 px-4 py-4 text-sm font-semibold text-mint-700">
        <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> {done}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="flex items-start gap-2 text-xs text-text-muted">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Cevabınız kimliğinizle eşleştirilmeden kaydedilir. Yönetim yalnız en az 3 cevap toplandığında toplu sonucu görür.
      </p>
      {questions.map((q) => (
        <fieldset key={q.id} className="space-y-2">
          <legend className="text-sm font-semibold text-ink-950">
            {q.label}
            {q.required ? <span className="text-danger-500"> *</span> : null}
          </legend>
          {q.kind === "score" ? (
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-11" role="radiogroup" aria-label={q.label}>
              {Array.from({ length: 11 }, (_, i) => i).map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={answers[q.id] === String(n)}
                  onClick={() => set(q.id, String(n))}
                  className={`focus-ring press grid h-10 place-items-center rounded-[var(--radius-control)] border text-sm font-extrabold tabular-nums transition ${tone(n, answers[q.id] === String(n))}`}
                >
                  {n}
                </button>
              ))}
            </div>
          ) : null}
          {q.kind === "yesno" ? (
            <div className="flex gap-2" role="radiogroup" aria-label={q.label}>
              {[
                { v: "yes", t: "Evet" },
                { v: "no", t: "Hayır" },
              ].map((o) => (
                <button
                  key={o.v}
                  type="button"
                  role="radio"
                  aria-checked={answers[q.id] === o.v}
                  onClick={() => set(q.id, o.v)}
                  className={`focus-ring press min-h-10 flex-1 rounded-[var(--radius-control)] border px-4 text-sm font-semibold transition ${
                    answers[q.id] === o.v ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-950 hover:border-brand-400"
                  }`}
                >
                  {o.t}
                </button>
              ))}
            </div>
          ) : null}
          {q.kind === "choice" ? (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={q.label}>
              {q.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={answers[q.id] === o}
                  onClick={() => set(q.id, answers[q.id] === o ? "" : o)}
                  className={`focus-ring press min-h-10 rounded-[var(--radius-control)] border px-3 py-2 text-left text-sm transition ${
                    answers[q.id] === o ? "border-brand-600 bg-brand-600/10 font-semibold text-brand-700" : "border-line bg-surface text-ink-950 hover:border-brand-400"
                  }`}
                >
                  {o}
                </button>
              ))}
            </div>
          ) : null}
          {q.kind === "text" ? (
            <textarea
              rows={3}
              maxLength={2000}
              value={answers[q.id] ?? ""}
              onChange={(e) => set(q.id, e.target.value)}
              aria-label={q.label}
              className="w-full resize-none rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm text-ink-950 outline-none focus:border-brand-400"
            />
          ) : null}
        </fieldset>
      ))}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-danger-500">
          {error}
        </p>
      ) : null}
      <Button size="md" icon={Send} loading={pending} onClick={submit}>
        Anonim gönder
      </Button>
    </div>
  );
}
