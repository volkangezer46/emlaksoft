"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ClipboardList, Link2, Phone, PhoneOff, UserRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  assignSurveyTask,
  cancelSurveyTask,
  completeSurveyByPhone,
  getSurveyTaskLink,
  logSurveyAttempt,
  updateSurveyTaskContact,
} from "@/app/actions/surveys";

export type QueueQuestionVM = {
  id: string;
  kind: "score" | "choice" | "yesno" | "text";
  label: string;
  options: string[];
  required: boolean;
};

export type QueueTaskVM = {
  id: string;
  name: string;
  phoneDisplay: string;
  telHref: string | null;
  hasCustomer: boolean;
  href: string | null;
  eventLabel: string;
  summary: string;
  advisor: string | null;
  templateName: string | null;
  attempts: number;
  maxAttempts: number;
  dueLabel: string;
  overdue: boolean;
  scheduled: boolean;
  status: string;
  statusLabel: string;
  assignedTo: string | null;
  assigneeName: string | null;
  lastOutcomeLabel: string | null;
  /** Bağlantı otomatik gönderildiyse kanal etiketi ("SMS ile gönderildi" ...). */
  sentLabel?: string | null;
  questions: QueueQuestionVM[];
};

export type AssigneeOption = { id: string; name: string };

const FIELD =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400";

function scoreTone(n: number, selected: boolean): string {
  if (n <= 6) return selected ? "border-danger-500 bg-danger-500 text-white" : "border-danger-500/30 bg-danger-500/8 text-danger-500";
  if (n <= 8) return selected ? "border-amber-500 bg-amber-500 text-white" : "border-amber-500/35 bg-amber-500/10 text-amber-600";
  return selected ? "border-mint-600 bg-mint-600 text-white" : "border-mint-500/35 bg-mint-500/10 text-mint-600";
}

/**
 * Anketör kuyruğu satırı. "Ara" tel: bağlantısıdır; soru-cevap formu satırın İÇİNDE açılır (popup değil).
 * Sonuçlar: kaydet (tamamlandı), açmadı/meşgul (otomatik yeniden planlama), yanlış numara, reddetti.
 * Müşteri isterse aynı şablonu bağlı linkle de cevaplayabilir; link kopyalanır (otomatik gönderim ayrı: dispatch.ts).
 */
export function QueueTaskCard({
  task,
  canManage,
  assignees,
}: {
  task: QueueTaskVM;
  canManage: boolean;
  assignees: AssigneeOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [contactName, setContactName] = useState(task.name === "Kişi bilgisi yok" ? "" : task.name);
  const [contactPhone, setContactPhone] = useState("");
  const [pending, startTransition] = useTransition();

  const closed = task.status !== "pending";

  function run(fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>, after?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setMessage({ tone: "err", text: res.error });
        return;
      }
      if (res.message) setMessage({ tone: "ok", text: res.message });
      after?.();
      router.refresh();
    });
  }

  function setAnswer(id: string, value: string) {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }

  async function copyLink() {
    setMessage(null);
    const res = await getSurveyTaskLink(task.id);
    if (res.error || !res.url) {
      setMessage({ tone: "err", text: res.error ?? "Bağlantı alınamadı." });
      return;
    }
    try {
      await navigator.clipboard.writeText(res.url);
      setCopied(true);
      setMessage({ tone: "ok", text: "Bağlantı kopyalandı; müşteriye iletebilirsiniz. (Otomatik gönderim açıksa ve İYS izni varsa sistem kendisi gönderir.)" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ tone: "ok", text: `Bağlantı: ${res.url}` });
    }
  }

  return (
    <li className="rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {task.href ? (
              <Link href={task.href} className="focus-ring rounded-[var(--radius-control)] text-sm font-bold text-ink-950 underline-offset-2 hover:underline">
                {task.name}
              </Link>
            ) : (
              <span className="text-sm font-bold text-ink-950">{task.name}</span>
            )}
            <Badge variant="info" size="sm">
              {task.eventLabel}
            </Badge>
            {task.overdue ? (
              <Badge variant="danger" size="sm">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Gecikti
              </Badge>
            ) : null}
            {task.scheduled ? (
              <Badge variant="neutral" size="sm">
                Zamanlanmış
              </Badge>
            ) : null}
            {task.sentLabel ? (
              <Badge variant="success" size="sm">
                {task.sentLabel}
              </Badge>
            ) : null}
            {closed ? (
              <Badge variant={task.status === "completed" ? "success" : "outline"} size="sm">
                {task.statusLabel}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-text">{task.summary || "Olay özeti yok"}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-muted">
            <span className="inline-flex items-center gap-1">
              <Phone className="h-3 w-3" aria-hidden="true" />
              {task.phoneDisplay || "Telefon yok"}
            </span>
            {task.advisor ? (
              <span className="inline-flex items-center gap-1">
                <UserRound className="h-3 w-3" aria-hidden="true" />
                Danışman: {task.advisor}
              </span>
            ) : null}
            {task.templateName ? <span>Şablon: {task.templateName}</span> : null}
            <span>
              Deneme {task.attempts}/{task.maxAttempts}
            </span>
            <span>{task.dueLabel}</span>
            {task.lastOutcomeLabel ? <span>Son sonuç: {task.lastOutcomeLabel}</span> : null}
            {canManage ? <span>Anketör: {task.assigneeName ?? "atanmamış"}</span> : null}
          </p>
        </div>

        {!closed ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {task.telHref ? (
              <a
                href={task.telHref}
                className="focus-ring press inline-flex h-8 touch:h-11 items-center gap-1.5 rounded-[var(--radius-control)] bg-mint-600 px-3 text-xs font-semibold text-white transition hover:bg-mint-700"
              >
                <Phone className="h-3.5 w-3.5" aria-hidden="true" /> Ara
              </a>
            ) : null}
            <Button size="sm" variant="secondary" icon={ClipboardList} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              {open ? "Formu kapat" : "Anketi doldur"}
            </Button>
            <Button size="sm" variant="ghost" icon={copied ? Check : Link2} onClick={copyLink}>
              {copied ? "Kopyalandı" : "Bağlantı"}
            </Button>
          </div>
        ) : null}
      </div>

      {!closed && !task.hasCustomer && !task.telHref ? (
        <div className="mt-3 rounded-[var(--radius-control)] border border-dashed border-line p-3">
          <p className="text-xs font-semibold text-text-muted">Bu muhatabın telefonu kayıtlı değil. Öğrendiğiniz numarayı ekleyin.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Ad soyad" aria-label="Muhatap adı" className={FIELD} maxLength={120} />
            <PhoneInput aria-label="Ulaşılan telefon" value={contactPhone} onValueChange={setContactPhone} />
            <Button size="md" loading={pending} onClick={() => run(() => updateSurveyTaskContact(task.id, contactName, contactPhone))}>
              Kaydet
            </Button>
          </div>
        </div>
      ) : null}

      {open && !closed ? (
        <div className="mt-4 space-y-4 rounded-[var(--radius-control)] border border-line bg-canvas/60 p-4">
          {task.questions.length === 0 ? (
            <p className="text-sm text-text-muted">Bu görevin şablonunda soru yok. Şablonları Tetikleyiciler ve şablonlar sekmesinden düzenleyin.</p>
          ) : (
            task.questions.map((q) => (
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
                        onClick={() => setAnswer(q.id, String(n))}
                        className={`focus-ring press grid h-10 place-items-center rounded-[var(--radius-control)] border text-sm font-extrabold tabular-nums transition ${scoreTone(n, answers[q.id] === String(n))}`}
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
                        onClick={() => setAnswer(q.id, o.v)}
                        className={`focus-ring press min-h-10 rounded-[var(--radius-control)] border px-4 text-sm font-semibold transition ${
                          answers[q.id] === o.v ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-ink-950 hover:border-brand-400"
                        }`}
                      >
                        {o.t}
                      </button>
                    ))}
                  </div>
                ) : null}
                {q.kind === "choice" ? (
                  <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label={q.label}>
                    {q.options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        role="radio"
                        aria-checked={answers[q.id] === o}
                        onClick={() => setAnswer(q.id, answers[q.id] === o ? "" : o)}
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
                    rows={2}
                    maxLength={2000}
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    aria-label={q.label}
                    className={`${FIELD} resize-none`}
                  />
                ) : null}
              </fieldset>
            ))
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button size="md" icon={Check} loading={pending} disabled={task.questions.length === 0} onClick={() => run(() => completeSurveyByPhone(task.id, answers), () => setOpen(false))}>
              Kaydet ve tamamla
            </Button>
            <Button size="md" variant="ghost" icon={X} onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
          </div>
        </div>
      ) : null}

      {!closed ? (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-text-muted">
              <PhoneOff className="h-3.5 w-3.5" aria-hidden="true" /> Arama sonucu:
            </span>
            {(
              [
                { o: "no_answer", t: "Açmadı" },
                { o: "busy", t: "Meşgul" },
                { o: "wrong_number", t: "Yanlış numara" },
                { o: "refused", t: "Reddetti" },
              ] as const
            ).map((b) => (
              <Button key={b.o} size="xs" variant="secondary" disabled={pending} onClick={() => run(() => logSurveyAttempt(task.id, b.o, note), () => setNote(""))}>
                {b.t}
              </Button>
            ))}
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Not (isteğe bağlı)"
              aria-label="Arama notu"
              maxLength={500}
              className="min-w-40 flex-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
            />
          </div>
          {canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold text-text-muted" htmlFor={`as-${task.id}`}>
                Anketör
              </label>
              <select
                id={`as-${task.id}`}
                value={task.assignedTo ?? ""}
                disabled={pending}
                onChange={(e) => run(() => assignSurveyTask(task.id, e.target.value || null))}
                className="min-h-8 rounded-[var(--radius-control)] border border-line bg-canvas px-2 text-xs"
              >
                <option value="">Atanmamış</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => cancelSurveyTask(task.id))}>
                Görevi iptal et
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p
          role={message.tone === "err" ? "alert" : "status"}
          className={`mt-3 rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold ${
            message.tone === "err" ? "border border-danger-500/25 bg-danger-500/5 text-danger-500" : "border border-mint-500/25 bg-mint-500/8 text-mint-700"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </li>
  );
}
