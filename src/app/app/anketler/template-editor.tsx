"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { saveSurveyTemplate } from "@/app/actions/surveys";
import { KIND_LABELS, SURVEY_QUESTION_KINDS, type SurveyQuestionKind } from "@/lib/surveys/types";

type Draft = {
  key: string;
  id?: string;
  kind: SurveyQuestionKind;
  label: string;
  optionsText: string;
  required: boolean;
  tag: "primary" | "reason" | null;
};

export type TemplateQuestionVM = {
  id: string;
  kind: SurveyQuestionKind;
  label: string;
  options: string[];
  required: boolean;
  tag: "primary" | "reason" | null;
};

const FIELD =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-brand-400 disabled:opacity-60";

/**
 * Şablon düzenleyici (satır içi panel). Soru tipleri: puan (1-10), çoktan seçmeli, evet/hayır, metin.
 * Telefonla doldurma ve bağlı link AYNI şablonu kullanır. Soru kimlikleri korunur; kaldırılan sorunun
 * eski cevapları soru metniyle birlikte saklanmaya devam eder.
 */
export function TemplateEditor({
  templateId,
  initialName,
  initialActive,
  initialQuestions,
  readOnly,
}: {
  templateId: string;
  initialName: string;
  initialActive: boolean;
  initialQuestions: TemplateQuestionVM[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [active, setActive] = useState(initialActive);
  const keySeq = useRef(initialQuestions.length);
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initialQuestions.map((q, i) => ({ key: `init-${i}`, id: q.id, kind: q.kind, label: q.label, optionsText: q.options.join("\n"), required: q.required, tag: q.tag })),
  );
  const [feedback, setFeedback] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function patch(key: string, change: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...change } : d)));
  }
  function move(index: number, delta: number) {
    setDrafts((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      [copy[index], copy[target]] = [copy[target]!, copy[index]!];
      return copy;
    });
  }

  function save() {
    setFeedback(null);
    startTransition(async () => {
      const res = await saveSurveyTemplate({
        templateId,
        name,
        active,
        questions: drafts.map((d) => ({
          id: d.id,
          kind: d.kind,
          label: d.label,
          options: d.kind === "choice" ? d.optionsText.split("\n") : [],
          required: d.required,
          tag: d.tag,
        })),
      });
      if (res.error) {
        setFeedback({ tone: "err", text: res.error });
        return;
      }
      setFeedback({ tone: "ok", text: "Şablon kaydedildi." });
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid min-w-56 flex-1 gap-1 text-xs font-semibold text-text-muted">
          Şablon adı
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={readOnly} className={FIELD} />
        </label>
        <div className="flex items-center gap-2 pb-2">
          <span className="text-xs font-semibold text-text-muted">{active ? "Aktif" : "Pasif (anket üretilmez)"}</span>
          <Switch checked={active} onCheckedChange={setActive} disabled={readOnly} aria-label="Şablon aktif" />
        </div>
      </div>

      <ol className="space-y-3">
        {drafts.map((d, i) => (
          <li key={d.key} className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-3">
            <div className="flex flex-wrap items-start gap-2">
              <span className="mt-2 text-xs font-bold tabular-nums text-text-faint">{i + 1}.</span>
              <div className="grid min-w-56 flex-1 gap-2">
                <input
                  value={d.label}
                  onChange={(e) => patch(d.key, { label: e.target.value })}
                  maxLength={300}
                  disabled={readOnly}
                  aria-label={`Soru ${i + 1} metni`}
                  placeholder="Soru metni"
                  className={FIELD}
                />
                {d.kind === "choice" ? (
                  <textarea
                    rows={3}
                    value={d.optionsText}
                    onChange={(e) => patch(d.key, { optionsText: e.target.value })}
                    disabled={readOnly}
                    aria-label={`Soru ${i + 1} seçenekleri`}
                    placeholder="Her satıra bir seçenek yazın"
                    className={`${FIELD} resize-y`}
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <select
                    value={d.kind}
                    onChange={(e) => {
                      const kind = e.target.value as SurveyQuestionKind;
                      patch(d.key, { kind, tag: kind === "score" ? d.tag : kind === "choice" ? d.tag : null });
                    }}
                    disabled={readOnly}
                    aria-label={`Soru ${i + 1} türü`}
                    className="min-h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2"
                  >
                    {SURVEY_QUESTION_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-1.5 font-semibold text-text-muted">
                    <input type="checkbox" checked={d.required} onChange={(e) => patch(d.key, { required: e.target.checked })} disabled={readOnly} />
                    Zorunlu
                  </label>
                  {d.kind === "score" ? (
                    <label className="inline-flex items-center gap-1.5 font-semibold text-text-muted">
                      <input
                        type="checkbox"
                        checked={d.tag === "primary"}
                        onChange={(e) =>
                          setDrafts((prev) => prev.map((x) => (x.key === d.key ? { ...x, tag: e.target.checked ? "primary" : null } : x.tag === "primary" && e.target.checked ? { ...x, tag: null } : x)))
                        }
                        disabled={readOnly}
                      />
                      Ana puan
                    </label>
                  ) : null}
                  {d.kind === "choice" ? (
                    <label className="inline-flex items-center gap-1.5 font-semibold text-text-muted">
                      <input type="checkbox" checked={d.tag === "reason"} onChange={(e) => patch(d.key, { tag: e.target.checked ? "reason" : null })} disabled={readOnly} />
                      Neden dağılımına say
                    </label>
                  ) : null}
                </div>
              </div>
              {!readOnly ? (
                <div className="flex shrink-0 gap-1">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Yukarı taşı" className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line bg-surface disabled:opacity-40">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === drafts.length - 1} aria-label="Aşağı taşı" className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-line bg-surface disabled:opacity-40">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))} aria-label="Soruyu sil" className="focus-ring press grid h-8 w-8 place-items-center rounded-[var(--radius-control)] border border-danger-500/30 bg-surface text-danger-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="md"
            variant="secondary"
            icon={Plus}
            onClick={() => {
              keySeq.current += 1;
              const key = `new-${keySeq.current}`;
              setDrafts((prev) => [...prev, { key, kind: "text", label: "", optionsText: "", required: false, tag: null }]);
            }}
          >
            Soru ekle
          </Button>
          <Button size="md" loading={pending} onClick={save}>
            Şablonu kaydet
          </Button>
          {feedback ? (
            <p role={feedback.tone === "err" ? "alert" : "status"} className={`text-xs font-semibold ${feedback.tone === "err" ? "text-danger-500" : "text-mint-700"}`}>
              {feedback.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
