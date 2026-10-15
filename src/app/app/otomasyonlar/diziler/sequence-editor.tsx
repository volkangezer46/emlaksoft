"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CalendarClock, Check, ListOrdered, Plus, Trash2 } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Button, buttonClass } from "@/components/ui/button";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import { Switch } from "@/components/ui/switch";
import { saveSequence } from "@/app/actions/sequences";
import { WhatsAppTemplateFields } from "../action-card";
import { moveDraft } from "../wizard-actions";
import {
  cumulativeDays,
  MAX_SEQUENCE_STEPS,
  SEQUENCE_STEP_LABELS,
  SEQUENCE_STEP_TYPES,
  parseSequenceSteps,
  type SequenceStepType,
} from "@/lib/automation/sequence-rules";

/**
 * Takip dizisi düzenleyicisi (COM-05). Adımlar yukarıdan aşağı çalışır; her adımın gecikmesi bir ÖNCEKİ adımdan
 * (ilkinde kayıttan) sonraki gün sayısıdır. Kartın üstündeki "Gün N" rozeti toplam zamanı gösterir, böylece dizinin
 * akışı bir bakışta okunur. Doğrulama sunucudakiyle aynı SAF fonksiyondur (parseSequenceSteps).
 */

type StepDraft = {
  uid: string;
  step_type: SequenceStepType;
  delay_days: string;
  text: string;
  templateName: string;
  language: string;
  bodyParam: string;
  subject: string;
  body: string;
  title: string;
  priority: string;
};

export type SequenceEditorInitial = {
  id?: string;
  name: string;
  description: string | null;
  is_active: boolean;
  stop_on_reply: boolean;
  daily_cap: number;
  steps: { step_type: string; delay_days: number; config: Record<string, unknown> }[];
};

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function toDraft(uid: string, s: SequenceEditorInitial["steps"][number]): StepDraft {
  const c = s.config ?? {};
  const type = (SEQUENCE_STEP_TYPES as readonly string[]).includes(s.step_type) ? (s.step_type as SequenceStepType) : "task";
  return {
    uid,
    step_type: type,
    delay_days: String(s.delay_days ?? 0),
    text: str(c.text),
    templateName: str(c.template_name),
    language: str(c.language) || "tr",
    bodyParam: str(c.body_param),
    subject: str(c.subject),
    body: str(c.body),
    title: str(c.title),
    priority: str(c.priority) || "normal",
  };
}

function fromDraft(d: StepDraft) {
  const config: Record<string, unknown> =
    d.step_type === "sms"
      ? { text: d.text }
      : d.step_type === "whatsapp_template"
        ? { template_name: d.templateName, language: d.language, body_param: d.bodyParam }
        : d.step_type === "email"
          ? { subject: d.subject, body: d.body }
          : { title: d.title, priority: d.priority };
  return { step_type: d.step_type, delay_days: Number(d.delay_days), config };
}

export function SequenceEditor({ initial }: { initial: SequenceEditorInitial }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [active, setActive] = useState(initial.is_active);
  const [stopOnReply, setStopOnReply] = useState(initial.stop_on_reply);
  const [cap, setCap] = useState(String(initial.daily_cap));
  const [steps, setSteps] = useState<StepDraft[]>(() =>
    initial.steps.length > 0 ? initial.steps.map((s, i) => toDraft(`s${i}`, s)) : [toDraft("s0", { step_type: "task", delay_days: 0, config: {} })],
  );
  const [seq, setSeq] = useState(0);

  const patch = (uid: string, p: Partial<StepDraft>) => setSteps((prev) => prev.map((s) => (s.uid === uid ? { ...s, ...p } : s)));
  const addStep = () => {
    if (steps.length >= MAX_SEQUENCE_STEPS) return;
    const n = seq + 1;
    setSeq(n);
    setSteps((prev) => [...prev, toDraft(`n${n}`, { step_type: "task", delay_days: 1, config: {} })]);
  };

  // Toplam gün (rozet): önceki adımların gecikmeleri birikir.
  const dayOf = cumulativeDays(steps.map((s) => s.delay_days));

  function save() {
    setError(null);
    const payload = steps.map(fromDraft);
    const check = parseSequenceSteps(payload);
    if (!check.ok) {
      setError(check.error);
      return;
    }
    if (!name.trim()) {
      setError("Dizi adı zorunlu.");
      return;
    }
    const fd = new FormData();
    if (initial.id) fd.set("id", initial.id);
    fd.set("name", name.trim());
    fd.set("description", description.trim());
    fd.set("is_active", String(active));
    fd.set("stop_on_reply", String(stopOnReply));
    fd.set("daily_cap", cap);
    fd.set("steps", JSON.stringify(payload));
    startTransition(async () => {
      const res = await saveSequence(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(`/app/otomasyonlar/diziler/${res.id}`);
    });
  }

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Dizi adı" htmlFor="seq-name" required>
            <FormInput value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="ör. Yeni talep: ilk 2 hafta" />
          </FormField>
          <FormField label="Açıklama" htmlFor="seq-desc">
            <FormInput value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Ne zaman kullanılır?" />
          </FormField>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label htmlFor="seq-active" className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2 text-sm text-ink-950">
            <span>
              <span className="block font-semibold">Dizi açık</span>
              <span className="block text-xs text-text-muted">Kapalıyken adımlar bekler.</span>
            </span>
            <Switch id="seq-active" checked={active} onCheckedChange={setActive} aria-label="Dizi açık" />
          </label>
          <label htmlFor="seq-stop" className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2 text-sm text-ink-950">
            <span>
              <span className="block font-semibold">Yanıt gelince dur</span>
              <span className="block text-xs text-text-muted">WhatsApp/SMS ile yazan müşteri diziden çıkar.</span>
            </span>
            <Switch id="seq-stop" checked={stopOnReply} onCheckedChange={setStopOnReply} aria-label="Yanıt gelince dur" />
          </label>
          <FormField label="Günlük üst sınır" htmlFor="seq-cap" hint="Bu diziden bir günde en çok kaç adım çalışsın.">
            <FormInput type="number" inputMode="numeric" min={1} max={2000} value={cap} onChange={(e) => setCap(e.target.value)} />
          </FormField>
        </div>
      </section>

      <section aria-labelledby="seq-steps-title" className="space-y-3">
        <h2 id="seq-steps-title" className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
          <ListOrdered className="h-4 w-4 text-brand-600" aria-hidden="true" /> Adımlar
        </h2>
        <p className="text-sm text-text-muted">
          Mesajlar yalnız İYS izni olan müşteriye ve TR saatiyle 09:00-20:00 arasında gider. Görev adımı sorumlu danışmana açılır.
        </p>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s.uid} className="rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]">
              <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5 sm:px-4">
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-700">
                  <CalendarClock className="h-3 w-3" aria-hidden="true" /> Gün {dayOf[i]}
                </span>
                <div className="min-w-0 flex-1">
                  <FormSelect
                    aria-label={`${i + 1}. adımın türü`}
                    value={s.step_type}
                    onChange={(e) => patch(s.uid, { step_type: e.target.value as SequenceStepType })}
                    className="font-semibold"
                  >
                    {SEQUENCE_STEP_TYPES.map((t) => (
                      <option key={t} value={t}>{SEQUENCE_STEP_LABELS[t]}</option>
                    ))}
                  </FormSelect>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="icon" icon={ArrowUp} aria-label="Adımı yukarı taşı" disabled={i === 0} onClick={() => setSteps((prev) => moveDraft(prev, i, -1))} />
                  <Button variant="ghost" size="icon" icon={ArrowDown} aria-label="Adımı aşağı taşı" disabled={i === steps.length - 1} onClick={() => setSteps((prev) => moveDraft(prev, i, 1))} />
                  <Button variant="ghost" size="icon" icon={Trash2} aria-label="Adımı kaldır" disabled={steps.length <= 1} onClick={() => setSteps((prev) => prev.filter((x) => x.uid !== s.uid))} />
                </div>
              </div>
              <div className="space-y-3 px-3 py-3 sm:px-4">
                <FormField
                  label={i === 0 ? "Kayıttan kaç gün sonra" : "Önceki adımdan kaç gün sonra"}
                  htmlFor={`seq-${s.uid}-delay`}
                  hint="0 = hemen (bir sonraki uygun saatte)."
                  className="max-w-[14rem]"
                >
                  <FormInput type="number" inputMode="numeric" min={0} max={365} value={s.delay_days} onChange={(e) => patch(s.uid, { delay_days: e.target.value })} />
                </FormField>
                {s.step_type === "sms" && (
                  <FormField label="SMS metni" htmlFor={`seq-${s.uid}-text`} required hint="{{name}} müşteri adıyla değişir.">
                    <FormTextarea value={s.text} onChange={(e) => patch(s.uid, { text: e.target.value })} rows={3} maxLength={500} placeholder="Merhaba {{name}}, …" />
                  </FormField>
                )}
                {s.step_type === "whatsapp_template" && (
                  <WhatsAppTemplateFields
                    value={{ templateName: s.templateName, language: s.language, bodyParam: s.bodyParam }}
                    idPrefix={`seq-${s.uid}`}
                    onChange={(p) => patch(s.uid, p)}
                  />
                )}
                {s.step_type === "email" && (
                  <>
                    <FormField label="Konu" htmlFor={`seq-${s.uid}-subject`} required>
                      <FormInput value={s.subject} onChange={(e) => patch(s.uid, { subject: e.target.value })} maxLength={200} />
                    </FormField>
                    <FormField label="E-posta metni" htmlFor={`seq-${s.uid}-body`} required hint="{{name}} müşteri adıyla değişir.">
                      <FormTextarea value={s.body} onChange={(e) => patch(s.uid, { body: e.target.value })} rows={5} maxLength={4000} />
                    </FormField>
                  </>
                )}
                {s.step_type === "task" && (
                  <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
                    <FormField label="Görev başlığı" htmlFor={`seq-${s.uid}-title`} required>
                      <FormInput value={s.title} onChange={(e) => patch(s.uid, { title: e.target.value })} maxLength={200} placeholder="ör. Müşteriyi ara" />
                    </FormField>
                    <FormField label="Öncelik" htmlFor={`seq-${s.uid}-priority`}>
                      <FormSelect value={s.priority} onChange={(e) => patch(s.uid, { priority: e.target.value })}>
                        <option value="low">Düşük</option>
                        <option value="normal">Normal</option>
                        <option value="high">Yüksek</option>
                      </FormSelect>
                    </FormField>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        {steps.length < MAX_SEQUENCE_STEPS ? (
          <Button variant="outline" size="sm" icon={Plus} onClick={addStep}>Adım ekle</Button>
        ) : (
          <p className="text-xs text-text-faint">Bir dizide en çok {MAX_SEQUENCE_STEPS} adım olabilir.</p>
        )}
      </section>

      {error ? (
        <p className="rounded-[var(--radius-control)] border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-sm font-medium text-danger-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-end gap-2 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:backdrop-blur-none">
        <Link href={initial.id ? `/app/otomasyonlar/diziler/${initial.id}` : "/app/otomasyonlar/diziler"} className={buttonClass({ variant: "outline" })}>
          Vazgeç
        </Link>
        <Button icon={Check} loading={pending} onClick={save}>
          {initial.id ? "Değişiklikleri kaydet" : "Diziyi kaydet"}
        </Button>
      </div>
    </div>
  );
}
