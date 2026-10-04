"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { distributeSurveyTasks, saveSurveySettings, saveSurveyTrigger, setSurveyAssignee } from "@/app/actions/surveys";

const FIELD =
  "min-h-9 rounded-[var(--radius-control)] border border-line bg-canvas px-3 text-sm outline-none focus:border-brand-400 disabled:opacity-60";

type Feedback = { tone: "ok" | "err"; text: string } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;
  return (
    <p role={feedback.tone === "err" ? "alert" : "status"} className={`text-xs font-semibold ${feedback.tone === "err" ? "text-danger-500" : "text-mint-700"}`}>
      {feedback.text}
    </p>
  );
}

/** Tek olay türü: aç/kapa, bekleme günü, en çok deneme. Ofis sahibi tek tek açıp kapatır. */
export function TriggerForm({
  event,
  label,
  description,
  enabled: initialEnabled,
  delayDays: initialDelay,
  maxAttempts: initialAttempts,
  readOnly,
}: {
  event: string;
  label: string;
  description: string;
  enabled: boolean;
  delayDays: number;
  maxAttempts: number;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [delay, setDelay] = useState(String(initialDelay));
  const [attempts, setAttempts] = useState(String(initialAttempts));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();

  function save(nextEnabled: boolean) {
    setFeedback(null);
    startTransition(async () => {
      const res = await saveSurveyTrigger({ event, enabled: nextEnabled, delayDays: Number(delay), maxAttempts: Number(attempts) });
      if (res.error) {
        setFeedback({ tone: "err", text: res.error });
        setEnabled(initialEnabled);
        return;
      }
      setEnabled(nextEnabled);
      setFeedback({ tone: "ok", text: "Kaydedildi." });
      router.refresh();
    });
  }

  return (
    <li className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink-950">{label}</p>
          <p className="mt-0.5 text-xs text-text-muted">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-muted">{enabled ? "Açık" : "Kapalı"}</span>
          <Switch checked={enabled} disabled={readOnly || pending} onCheckedChange={(v) => save(v)} aria-label={`${label} tetikleyicisi`} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold text-text-muted">
          Bekleme (gün)
          <input type="number" min={0} max={60} inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value)} disabled={readOnly} className={`${FIELD} w-24`} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-text-muted">
          En çok deneme
          <input type="number" min={1} max={10} inputMode="numeric" value={attempts} onChange={(e) => setAttempts(e.target.value)} disabled={readOnly} className={`${FIELD} w-24`} />
        </label>
        {!readOnly ? (
          <Button size="md" variant="secondary" loading={pending} onClick={() => save(enabled)}>
            Süreleri kaydet
          </Button>
        ) : null}
        <FeedbackLine feedback={feedback} />
      </div>
    </li>
  );
}

/** Kullanıcıyı anketör yap / görevden al (rol değişmez). */
export function AssigneeToggle({ userId, name, role, isAssignee, openTasks, readOnly }: { userId: string; name: string; role: string; isAssignee: boolean; openTasks: number; readOnly: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(isAssignee);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setSurveyAssignee(userId, next);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOn(next);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-ink-950">{name}</p>
        <p className="text-xs text-text-muted">
          {role}
          {on ? ` · ${openTasks} açık görev` : ""}
        </p>
        {error ? (
          <p role="alert" className="text-xs font-semibold text-danger-500">
            {error}
          </p>
        ) : null}
      </div>
      <span className="text-xs font-semibold text-text-muted">{on ? "Anketör" : "—"}</span>
      <Switch checked={on} disabled={readOnly || pending} onCheckedChange={toggle} aria-label={`${name} anketör olsun`} />
    </li>
  );
}

/** Atama modu (dengeli / seçili anketör / elle) ve süre eşikleri. */
export function AssignmentForm({
  initial,
  assignees,
  readOnly,
}: {
  initial: { assignment_mode: string; fixed_assignee: string | null; overdue_hours: number; retry_hours: number; low_score_max: number };
  assignees: { id: string; name: string }[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState(initial.assignment_mode);
  const [fixed, setFixed] = useState(initial.fixed_assignee ?? "");
  const [overdue, setOverdue] = useState(String(initial.overdue_hours));
  const [retry, setRetry] = useState(String(initial.retry_hours));
  const [low, setLow] = useState(String(initial.low_score_max));
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setFeedback(null);
    startTransition(async () => {
      const res = await saveSurveySettings({
        assignmentMode: mode,
        fixedAssignee: fixed || null,
        overdueHours: Number(overdue),
        retryHours: Number(retry),
        lowScoreMax: Number(low),
      });
      if (res.error) {
        setFeedback({ tone: "err", text: res.error });
        return;
      }
      setFeedback({ tone: "ok", text: "Ayarlar kaydedildi." });
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-xs font-semibold text-text-muted">
        Yeni görev dağıtımı
        <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={readOnly} className={FIELD}>
          <option value="balanced">Dengeli dağıt (en az işi olana)</option>
          <option value="selected">Seçili anketöre ver</option>
          <option value="manual">Atanmamış bırak (elle ata)</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-text-muted">
        Seçili anketör
        <select value={fixed} onChange={(e) => setFixed(e.target.value)} disabled={readOnly || mode !== "selected"} className={FIELD}>
          <option value="">Seçin</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-xs font-semibold text-text-muted">
        Gecikme uyarısı (saat)
        <input type="number" min={1} max={720} value={overdue} onChange={(e) => setOverdue(e.target.value)} disabled={readOnly} className={FIELD} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-text-muted">
        Ulaşılamazsa yeniden arama (saat sonra)
        <input type="number" min={1} max={336} value={retry} onChange={(e) => setRetry(e.target.value)} disabled={readOnly} className={FIELD} />
      </label>
      <label className="grid gap-1 text-xs font-semibold text-text-muted">
        Düşük puan sınırı (ve altı geri arama önerilir)
        <input type="number" min={1} max={9} value={low} onChange={(e) => setLow(e.target.value)} disabled={readOnly} className={FIELD} />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        {!readOnly ? (
          <Button size="md" loading={pending} onClick={submit}>
            Ayarları kaydet
          </Button>
        ) : null}
        <FeedbackLine feedback={feedback} />
      </div>
    </div>
  );
}

/** Atanmamış bekleyen görevleri dengeli dağıtır. */
export function DistributeButton() {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        size="md"
        variant="secondary"
        loading={pending}
        onClick={() => {
          setFeedback(null);
          startTransition(async () => {
            const res = await distributeSurveyTasks();
            setFeedback(res.error ? { tone: "err", text: res.error } : { tone: "ok", text: res.message ?? "Dağıtıldı." });
            router.refresh();
          });
        }}
      >
        Atanmamış görevleri dengeli dağıt
      </Button>
      <FeedbackLine feedback={feedback} />
    </div>
  );
}
