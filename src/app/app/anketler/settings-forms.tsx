"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { distributeSurveyTasks, saveSurveySettings, saveSurveyTrigger, setSurveyAssignee, setSurveyAudienceEnabled } from "@/app/actions/surveys";

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

/**
 * Kitle anahtarı (kitle × tetik matrisinin hücresi): bu olayda bu kitleye anket yapılsın mı? Şablonun `active`
 * bayrağıdır; kapalı kitleye görev üretilmez, şablon ve geçmiş cevaplar korunur.
 */
export function AudienceToggle({
  event,
  audience,
  label,
  enabled: initial,
  readOnly,
}: {
  event: string;
  audience: string;
  label: string;
  enabled: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function toggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await setSurveyAudienceEnabled({ event, audience, enabled: next });
      if (res.error) {
        setError(res.error);
        return;
      }
      setOn(next);
      router.refresh();
    });
  }
  return (
    <span className="inline-flex flex-col">
      <label className="inline-flex items-center gap-2 rounded-full border border-line bg-canvas/60 px-2.5 py-1 text-xs font-semibold text-ink-950">
        <Switch checked={on} disabled={readOnly || pending} onCheckedChange={toggle} aria-label={`${label} kitlesi`} />
        {label}
      </label>
      {error ? (
        <span role="alert" className="mt-1 text-xs font-semibold text-danger-500">
          {error}
        </span>
      ) : null}
    </span>
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
  delayLabel = "Bekleme (gün)",
  showAttempts = true,
  children,
}: {
  event: string;
  label: string;
  description: string;
  enabled: boolean;
  delayDays: number;
  maxAttempts: number;
  readOnly: boolean;
  delayLabel?: string;
  showAttempts?: boolean;
  /** Kitle anahtarları (matris satırı). */
  children?: ReactNode;
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
      {children ? <div className="mt-3 flex flex-wrap items-start gap-2">{children}</div> : null}
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs font-semibold text-text-muted">
          {delayLabel}
          <input type="number" min={0} max={60} inputMode="numeric" value={delay} onChange={(e) => setDelay(e.target.value)} disabled={readOnly} className={`${FIELD} w-24`} />
        </label>
        {showAttempts ? (
          <label className="grid gap-1 text-xs font-semibold text-text-muted">
            En çok deneme
            <input type="number" min={1} max={10} inputMode="numeric" value={attempts} onChange={(e) => setAttempts(e.target.value)} disabled={readOnly} className={`${FIELD} w-24`} />
          </label>
        ) : null}
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
  channels,
}: {
  initial: {
    assignment_mode: string;
    fixed_assignee: string | null;
    overdue_hours: number;
    retry_hours: number;
    low_score_max: number;
    auto_send: boolean;
    whatsapp_template: string | null;
    whatsapp_language: string;
    promoter_invite: boolean;
  };
  assignees: { id: string; name: string }[];
  readOnly: boolean;
  /** Ofisin mesaj kanalları hazır mı (sunucuda çözülür). */
  channels: { sms: boolean; whatsapp: boolean };
}) {
  const router = useRouter();
  const [mode, setMode] = useState(initial.assignment_mode);
  const [fixed, setFixed] = useState(initial.fixed_assignee ?? "");
  const [overdue, setOverdue] = useState(String(initial.overdue_hours));
  const [retry, setRetry] = useState(String(initial.retry_hours));
  const [low, setLow] = useState(String(initial.low_score_max));
  const [autoSend, setAutoSend] = useState(initial.auto_send);
  const [waTemplate, setWaTemplate] = useState(initial.whatsapp_template ?? "");
  const [waLanguage, setWaLanguage] = useState(initial.whatsapp_language || "tr");
  const [promoter, setPromoter] = useState(initial.promoter_invite);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTransition] = useTransition();
  const noChannel = !channels.sms && !channels.whatsapp;

  function submit() {
    setFeedback(null);
    startTransition(async () => {
      const res = await saveSurveySettings({
        assignmentMode: mode,
        fixedAssignee: fixed || null,
        overdueHours: Number(overdue),
        retryHours: Number(retry),
        lowScoreMax: Number(low),
        autoSend,
        whatsappTemplate: waTemplate.trim() || null,
        whatsappLanguage: waLanguage.trim() || "tr",
        promoterInvite: promoter,
      });
      if (res.error) {
        setFeedback({ tone: "err", text: res.error });
        return;
      }
      setFeedback({ tone: "ok", text: res.message ?? "Ayarlar kaydedildi." });
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
        Düşük puan sınırı (0-10; ve altı geri arama görevi açılır)
        <input type="number" min={1} max={9} value={low} onChange={(e) => setLow(e.target.value)} disabled={readOnly} className={FIELD} />
      </label>
      <label className="flex items-start gap-2 text-xs font-semibold text-text-muted">
        <Switch checked={promoter} onCheckedChange={setPromoter} disabled={readOnly} aria-label="Destekleyene tavsiye daveti" />
        <span>
          Destekleyene (9-10) tavsiye daveti
          <span className="block font-normal">Bağlantıyla cevaplayan müşteriye teşekkür ekranında tavsiye sayfası sunulur, danışmana bildirim gider.</span>
        </span>
      </label>

      <div className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/40 p-3 sm:col-span-2 sm:grid-cols-2">
        <label className="flex items-start gap-2 text-xs font-semibold text-text-muted sm:col-span-2">
          <Switch checked={autoSend} onCheckedChange={setAutoSend} disabled={readOnly || noChannel} aria-label="Anket bağlantısını otomatik gönder" />
          <span>
            Anket bağlantısını otomatik gönder (SMS / WhatsApp)
            <span className="block font-normal">
              Vadesi gelen görevin bağlantısı ofisinizin kendi sağlayıcısıyla gönderilir. Yalnız İYS izni kayıtlı müşterilere, kişi başı 30 günde
              en çok bir anket mesajı; yanıt gelmezse 48 saat sonra anketör kuyruğuna düşer.
            </span>
          </span>
        </label>
        <p className={`text-xs sm:col-span-2 ${noChannel ? "font-semibold text-amber-700" : "text-text-muted"}`}>
          Kanal durumu: SMS {channels.sms ? "hazır" : "kapalı"} · WhatsApp {channels.whatsapp ? "hazır" : "kapalı"}
          {noChannel ? " — Ayarlar > Entegrasyonlar'dan Netgsm veya WhatsApp bağlayın; o zamana kadar bağlantı anketör kuyruğundan kopyalanır." : ""}
        </p>
        <label className="grid gap-1 text-xs font-semibold text-text-muted">
          WhatsApp şablon adı (Meta onaylı, tek değişken = bağlantı)
          <input value={waTemplate} onChange={(e) => setWaTemplate(e.target.value)} disabled={readOnly || !channels.whatsapp} placeholder="ör. anket_daveti" maxLength={512} className={FIELD} />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-text-muted">
          Şablon dili
          <input value={waLanguage} onChange={(e) => setWaLanguage(e.target.value)} disabled={readOnly || !channels.whatsapp} placeholder="tr" maxLength={5} className={FIELD} />
        </label>
      </div>
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
