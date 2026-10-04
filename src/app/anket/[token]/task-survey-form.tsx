"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { submitSurveyTaskByToken } from "@/app/actions/survey-public";

export type PublicQuestion = {
  id: string;
  kind: "score" | "choice" | "yesno" | "text";
  label: string;
  options: string[];
  required: boolean;
};

function toneClasses(n: number, selected: boolean): string {
  if (n <= 6) return selected ? "border-danger-500 bg-danger-500 text-white" : "border-danger-500/30 bg-danger-500/8 text-danger-500 hover:border-danger-500/60";
  if (n <= 8) return selected ? "border-amber-500 bg-amber-500 text-white" : "border-amber-500/35 bg-amber-500/10 text-amber-600 hover:border-amber-500/70";
  return selected ? "border-mint-600 bg-mint-600 text-white" : "border-mint-500/35 bg-mint-500/10 text-mint-600 hover:border-mint-500/70";
}

/**
 * Anketör görevinin bağlı link formu: telefonla sorulan şablonun AYNISI (soru kimlikleri sunucuda doğrulanır).
 * Müşteri adı ve işlem ayrıntısı bu sayfada gösterilmez; yalnız sorular.
 */
export function TaskSurveyForm({ token, questions }: { token: string; questions: PublicQuestion[] }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState<null | { already: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
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
    const fd = new FormData();
    fd.set("token", token);
    fd.set("answers", JSON.stringify(answers));
    startTransition(async () => {
      const res = await submitSurveyTaskByToken(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone({ already: res.alreadyAnswered === true });
    });
  }

  if (done) {
    return (
      <div className="rounded-[var(--radius-card)] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-500/15 text-mint-600">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="mt-3 text-sm font-bold text-ink-950">{done.already ? "Yanıtınız alınmış." : "Teşekkür ederiz!"}</p>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          {done.already ? "Bu anket daha önce cevaplandı." : "Değerlendirmeniz kaydedildi. Geri bildiriminiz hizmetimizi geliştirmemize yardımcı olur."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 opacity-0" />
      {questions.map((q) => (
        <fieldset key={q.id} className="space-y-2">
          <legend className="text-sm font-bold text-ink-950">
            {q.label}
            {q.required ? <span className="text-danger-500"> *</span> : null}
          </legend>
          {q.kind === "score" ? (
            <>
              <div className="grid grid-cols-5 gap-2 sm:grid-cols-10" role="radiogroup" aria-label={q.label}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={answers[q.id] === String(n)}
                    onClick={() => set(q.id, String(n))}
                    className={`focus-ring press grid h-11 min-w-11 place-items-center rounded-[var(--radius-card)] border text-sm font-extrabold tabular-nums transition ${toneClasses(n, answers[q.id] === String(n))}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-between px-0.5 text-xs text-text-faint">
                <span>Hiç memnun kalmadım</span>
                <span>Çok memnun kaldım</span>
              </div>
            </>
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
                  className={`focus-ring press min-h-11 flex-1 rounded-[var(--radius-card)] border px-4 text-sm font-semibold transition ${
                    answers[q.id] === o.v ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-950 hover:border-brand-400"
                  }`}
                >
                  {o.t}
                </button>
              ))}
            </div>
          ) : null}
          {q.kind === "choice" ? (
            <div className="grid gap-2" role="radiogroup" aria-label={q.label}>
              {q.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={answers[q.id] === o}
                  onClick={() => set(q.id, answers[q.id] === o ? "" : o)}
                  className={`focus-ring press min-h-11 rounded-[var(--radius-card)] border px-3.5 py-2.5 text-left text-sm transition ${
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
              className="w-full resize-none rounded-[var(--radius-card)] border border-line bg-canvas px-3.5 py-3 text-sm text-ink-950 outline-none transition focus:border-brand-400"
            />
          ) : null}
        </fieldset>
      ))}

      {error ? (
        <p className="rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-center text-xs font-semibold text-danger-500" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="btn-shine focus-ring press inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-brand-600 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-55"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Gönder
      </button>

      <p className="text-center text-xs leading-relaxed text-text-faint">
        Yanıtınız yalnızca hizmet kalitesini değerlendirmek amacıyla işlenir.{" "}
        <Link href="/kvkk-aydinlatma" target="_blank" className="font-semibold text-brand-600 underline-offset-2 hover:underline">
          KVKK aydınlatma metni
        </Link>
      </p>
    </div>
  );
}
