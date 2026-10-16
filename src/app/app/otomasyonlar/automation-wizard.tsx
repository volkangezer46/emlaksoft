"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { Bolt, Check, ChevronLeft, ChevronRight, Filter, Loader2, Plus, Trash2, Wand2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createPortal } from "react-dom";
import { INLINE_PANEL_HOST_ID } from "@/components/ui/inline-tabbed-panel";
import { createAutomation, updateAutomation } from "@/app/actions/automations";
import { useToast } from "@/components/app/toast-provider";
import {
  TRIGGER_OPTIONS,
  TRIGGER_CONDITION_FIELDS,
  CONDITION_OP_OPTIONS,
  STATUS_ENTITY_BY_TRIGGER,
  DEMAND_STATUS_OPTIONS,
  DEAL_STAGE_OPTIONS,
  availableActionsForTrigger,
  MAX_AUTOMATION_ACTIONS,
} from "./labels";
import { ActionCard } from "./action-card";
import { draftFromAction, draftToAction, draftValid, emptyDraft, moveDraft, type DraftAction } from "./wizard-actions";

/**
 * Otomasyon Stüdyosu sihirbazı — 3 adım: tetikleyici → koşullar → eylemler (en çok 3, sıralı) + ad.
 * Hem "Yeni otomasyon" (boş) hem "Düzenle" (dolu değerler) bu bileşeni kullanır;
 * `initial` verilirse updateAutomation, yoksa createAutomation çağrılır.
 */

type StaffOption = { id: string; full_name: string };

type Condition = { field: string; op: string; value: string };

export type WizardInitial = {
  id: string;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  conditions: Condition[];
  actions: { type?: string; config?: Record<string, unknown> }[];
};

const fieldClass =
  "w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";
const labelClass = "mb-1.5 block text-sm text-text-muted";

const STEPS = [
  { label: "Tetikleyici", icon: Bolt },
  { label: "Koşullar", icon: Filter },
  { label: "Eylemler", icon: Zap },
] as const;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export function AutomationWizard({
  staff,
  initial,
  trigger,
  mode = "dialog",
  stageNames,
}: {
  staff: StaffOption[];
  /** Ofisin görünen anlaşma aşaması adları (anahtar → ad); verilmezse varsayılan adlar. */
  stageNames?: Record<string, string>;
  initial?: WizardInitial;
  /** Yalnız dialog modunda gerekli (düzenleme düğmesi). */
  trigger?: ReactNode;
  /** "page": tam sayfa form (yeni otomasyon); "dialog": hızlı düzenleme. */
  mode?: "dialog" | "page";
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);


  // Adım 1 — tetikleyici
  const [triggerType, setTriggerType] = useState<string>(initial?.trigger_type ?? "");
  const [days, setDays] = useState<string>(() => {
    const opt = TRIGGER_OPTIONS.find((t) => t.value === initial?.trigger_type);
    const fromCfg = opt?.daysConfig ? str(initial?.trigger_config?.[opt.daysConfig.key]) : "";
    return fromCfg || str(opt?.daysConfig?.defaultValue ?? "");
  });
  const [minScore, setMinScore] = useState<string>(str(initial?.trigger_config?.min_score));

  // Adım 2 — koşullar (en fazla 3)
  const [conds, setConds] = useState<Condition[]>(initial?.conditions ?? []);

  // Adım 3 — eylem listesi (sıra = çalışma sırası) + ad
  const [drafts, setDrafts] = useState<DraftAction[]>(() => {
    const list = (initial?.actions ?? []).slice(0, MAX_AUTOMATION_ACTIONS).map((a, i) => draftFromAction(`i${i}`, a));
    return list.length > 0 ? list : [emptyDraft("i0")];
  });
  const [uidSeq, setUidSeq] = useState(0);
  const [name, setName] = useState<string>(initial?.name ?? "");
  const [description, setDescription] = useState<string>(initial?.description ?? "");
  // Yeni kural: hemen etkin mi, yoksa pasif kaydedilip sonra mı açılacak (SMS/WhatsApp eylemli kuralı önce gözden geçirmek için).
  const [startActive, setStartActive] = useState(true);

  const triggerOpt = TRIGGER_OPTIONS.find((t) => t.value === triggerType);
  const conditionFields = TRIGGER_CONDITION_FIELDS[triggerType] ?? [];
  const actionOptions = useMemo(() => availableActionsForTrigger(triggerType), [triggerType]);
  const statusEntity = STATUS_ENTITY_BY_TRIGGER[triggerType];
  const statusOptions =
    statusEntity === "demand"
      ? DEMAND_STATUS_OPTIONS
      : DEAL_STAGE_OPTIONS.map((o) => ({ value: o.value, label: stageNames?.[o.value] ?? o.label }));

  function selectTrigger(value: string) {
    setTriggerType(value);
    const opt = TRIGGER_OPTIONS.find((t) => t.value === value);
    setDays(str(opt?.daysConfig?.defaultValue ?? ""));
    // Tetikleyici değişince önceki tetikleyiciye özel seçimler geçersizleşir
    setConds((prev) => prev.filter((c) => (TRIGGER_CONDITION_FIELDS[value] ?? []).some((f) => f.value === c.field)));
    const allowed = availableActionsForTrigger(value);
    setDrafts((prev) =>
      prev.map((d) => ({
        ...d,
        type: allowed.some((a) => a.value === d.type) ? d.type : "",
        targetStatus: d.type === "change_status" ? "" : d.targetStatus,
      })),
    );
  }

  function patchDraft(uid: string, patch: Partial<DraftAction>) {
    setDrafts((prev) => prev.map((d) => (d.uid === uid ? { ...d, ...patch } : d)));
  }

  function addDraft() {
    if (drafts.length >= MAX_AUTOMATION_ACTIONS) return;
    const next = uidSeq + 1;
    setUidSeq(next);
    setDrafts((prev) => [...prev, emptyDraft(`n${next}`)]);
  }

  function stepValid(): boolean {
    if (step === 0) {
      if (!triggerType) return false;
      if (triggerOpt?.daysConfig) {
        const n = Number(days);
        return Number.isFinite(n) && n >= 1 && n <= 365;
      }
      return true;
    }
    if (step === 1) return true; // koşullar opsiyonel
    if (!name.trim() || drafts.length === 0) return false;
    return drafts.every(draftValid);
  }

  function save() {
    setError(null);
    const fd = new FormData();
    if (initial) fd.set("id", initial.id);
    fd.set("name", name.trim());
    fd.set("description", description.trim());
    fd.set("trigger_type", triggerType);
    if (triggerOpt?.daysConfig) fd.set("trigger_days", days);
    if (triggerType === "property_matched" && minScore) fd.set("min_score", minScore);
    fd.set("conditions", JSON.stringify(conds.filter((c) => c.field && c.value !== "")));
    fd.set("actions", JSON.stringify(drafts.map(draftToAction)));
    if (!initial) fd.set("start_active", startActive ? "1" : "0");

    startTransition(async () => {
      const res = initial ? await updateAutomation(fd) : await createAutomation(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      toast.push(
        initial
          ? "Kural güncellendi."
          : startActive
            ? "Kural kaydedildi ve etkin."
            : "Kural pasif kaydedildi; listeden istediğiniz an etkinleştirebilirsiniz.",
        "ok",
      );
      if (mode === "page") {
        router.push("/app/otomasyonlar");
        return;
      }
      setOpen(false);
      setStep(0);
      router.refresh();
    });
  }

  const isPage = mode === "page";

  const content = (
    <>
        {/* Adım göstergesi */}
        <div className="flex items-center gap-2 border-b border-line px-6 py-3">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = i < step;
            const current = i === step;
            return (
              <div key={s.label} className="flex items-center gap-2">
                {i > 0 && <span className="h-px w-6 bg-line" />}
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                    current
                      ? "bg-brand-600 text-white"
                      : done
                        ? "bg-mint-500/12 text-mint-700"
                        : "bg-canvas text-text-faint"
                  }`}
                >
                  {done ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                  {i + 1}. {s.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className={isPage ? "p-4 md:p-6" : "max-h-[55vh] overflow-y-auto p-6"}>
          {/* ADIM 1 — Tetikleyici */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {TRIGGER_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => selectTrigger(t.value)}
                    className={`focus-ring press rounded-[var(--radius-card)] border p-3 text-left transition ${
                      triggerType === t.value
                        ? "border-brand-400 bg-brand-600/5 ring-1 ring-brand-400"
                        : "border-line bg-surface hover:border-brand-300"
                    }`}
                  >
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                      <Bolt className={`h-3.5 w-3.5 ${triggerType === t.value ? "text-brand-600" : "text-text-faint"}`} />
                      {t.label}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{t.description}</p>
                  </button>
                ))}
              </div>

              {triggerOpt?.daysConfig && (
                <div className="max-w-xs">
                  <label htmlFor="aw-days" className={labelClass}>{triggerOpt.daysConfig.label} *</label>
                  <input
                    id="aw-days"
                    type="number"
                    min={1}
                    max={365}
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    className={fieldClass}
                  />
                </div>
              )}
              {triggerType === "property_matched" && (
                <div className="max-w-xs">
                  <label htmlFor="aw-min-score" className={labelClass}>Asgari eşleşme puanı (0-100, opsiyonel)</label>
                  <input
                    id="aw-min-score"
                    type="number"
                    min={0}
                    max={100}
                    value={minScore}
                    onChange={(e) => setMinScore(e.target.value)}
                    placeholder="ör. 60"
                    className={fieldClass}
                  />
                </div>
              )}
            </div>
          )}

          {/* ADIM 2 — Koşullar */}
          {step === 1 && (
            <div className="space-y-3">
              <p className="text-sm text-text-muted">
                Koşullar opsiyoneldir — hiç eklemezseniz kural her tetiklendiğinde çalışır. En fazla 3 koşul eklenebilir; tüm koşullar sağlanmalıdır.
              </p>

              {conditionFields.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-canvas p-4 text-sm text-text-muted">
                  Bu tetikleyici için filtrelenebilir alan bulunmuyor — kural, tetiklendiği her kayıtta çalışır.
                </div>
              ) : (
                <>
                  {conds.map((c, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-canvas p-3">
                      <select
                        value={c.field}
                        onChange={(e) => setConds((prev) => prev.map((p, j) => (j === i ? { ...p, field: e.target.value } : p)))}
                        aria-label="Koşul alanı"
                        className={`${fieldClass} w-auto min-w-36 flex-1`}
                      >
                        {conditionFields.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}{f.hint ? ` (${f.hint})` : ""}
                          </option>
                        ))}
                      </select>
                      <select
                        value={c.op}
                        onChange={(e) => setConds((prev) => prev.map((p, j) => (j === i ? { ...p, op: e.target.value } : p)))}
                        aria-label="Operatör"
                        className={`${fieldClass} w-auto`}
                      >
                        {CONDITION_OP_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <input
                        value={c.value}
                        onChange={(e) => setConds((prev) => prev.map((p, j) => (j === i ? { ...p, value: e.target.value } : p)))}
                        placeholder="Değer"
                        aria-label="Koşul değeri"
                        className={`${fieldClass} w-auto min-w-28 flex-1`}
                      />
                      <button
                        type="button"
                        onClick={() => setConds((prev) => prev.filter((_, j) => j !== i))}
                        aria-label="Koşulu kaldır"
                        className="focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line text-text-faint transition hover:border-danger-500/30 hover:text-danger-500 touch:min-h-11 touch:min-w-11"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {conds.length < 3 && (
                    <button
                      type="button"
                      onClick={() =>
                        setConds((prev) => [
                          ...prev,
                          { field: conditionFields[0]?.value ?? "", op: "eq", value: "" },
                        ])
                      }
                      className="focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-dashed border-brand-300/60 px-3 py-2 text-sm font-semibold text-brand-600 transition hover:bg-brand-600/5"
                    >
                      <Plus className="h-3.5 w-3.5" /> Koşul ekle
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ADIM 3 — Eylemler (sıralı) + ad */}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-text-muted">
                Eylemler yukarıdan aşağı sırayla çalışır; en çok {MAX_AUTOMATION_ACTIONS} eylem ekleyebilirsiniz. Ör. önce danışmana ata, sonra görev aç, sonra müşteriye WhatsApp şablonu gönder.
              </p>
              <ol className="space-y-3">
                {drafts.map((d, i) => (
                  <ActionCard
                    key={d.uid}
                    index={i}
                    total={drafts.length}
                    draft={d}
                    options={actionOptions}
                    staff={staff}
                    statusOptions={statusOptions}
                    statusLabel={statusEntity === "demand" ? "Talebin yeni durumu" : "Anlaşmanın yeni aşaması"}
                    onChange={(patch) => patchDraft(d.uid, patch)}
                    onMove={(delta) => setDrafts((prev) => moveDraft(prev, i, delta))}
                    onRemove={() => setDrafts((prev) => (prev.length > 1 ? prev.filter((x) => x.uid !== d.uid) : prev))}
                  />
                ))}
              </ol>
              {drafts.length < MAX_AUTOMATION_ACTIONS ? (
                <Button variant="outline" size="sm" icon={Plus} onClick={addDraft}>
                  Eylem ekle
                </Button>
              ) : (
                <p className="text-xs text-text-faint">En çok {MAX_AUTOMATION_ACTIONS} eylem eklenebilir.</p>
              )}

              <div className="hairline-t grid gap-3 pt-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="aw-name" className={labelClass}>Kural adı *</label>
                  <input id="aw-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Sıcak talepleri müdüre bildir" className={fieldClass} />
                </div>
                <div>
                  <label htmlFor="aw-desc" className={labelClass}>Açıklama (opsiyonel)</label>
                  <input id="aw-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ne işe yaradığını kısaca yazın" className={fieldClass} />
                </div>
                {initial ? null : (
                  <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm text-ink-950 sm:col-span-2">
                    <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 rounded border-line accent-brand-600 touch:h-6 touch:w-6" checked={startActive} onChange={(e) => setStartActive(e.target.checked)} />
                    <span>
                      <span className="font-semibold">Kuralı hemen etkinleştir</span>
                      <span className="block text-xs text-text-muted">
                        İşareti kaldırırsanız kural pasif kaydedilir; listeden gözden geçirip istediğiniz an açarsınız.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm font-medium text-danger-600" role="alert">{error}</p>
          )}
        </div>

        {/* Alt bar */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-6 py-4">
          {isPage ? (
            <Link href="/app/otomasyonlar" className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
              Vazgeç
            </Link>
          ) : (
            <button type="button" onClick={() => setOpen(false)} className="focus-ring press rounded-[var(--radius-control)] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
              Vazgeç
            </button>
          )}
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-canvas"
              >
                <ChevronLeft className="h-4 w-4" /> Geri
              </button>
            )}
            {step < 2 ? (
              <button
                type="button"
                disabled={!stepValid()}
                onClick={() => setStep((s) => s + 1)}
                className="btn-shine focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                İleri <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!stepValid() || pending}
                onClick={save}
                className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {initial ? "Güncelle" : "Kaydet"}
              </button>
            )}
          </div>
        </div>
    </>
  );

  if (isPage) {
    return (
      <div className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]">
        {content}
      </div>
    );
  }

  /* Popup yok: düzenleme sayfa içi panel olarak (inline-panel-host) açılır. */
  const host = open && typeof document !== "undefined" ? document.getElementById(INLINE_PANEL_HOST_ID) : null;
  const panel = open ? (
    <section
      aria-label={initial ? "Otomasyonu düzenle" : "Yeni otomasyon"}
      className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-xs)]"
    >
      <header className="flex items-center gap-3 border-b border-line px-6 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
          <Wand2 className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-display font-bold text-ink-950">{initial ? "Otomasyonu düzenle" : "Yeni otomasyon"}</h2>
          <p className="text-xs text-text-muted">Tetikleyici → koşul → eylemler: kuralınızı 3 adımda oluşturun.</p>
        </div>
      </header>
      {content}
    </section>
  ) : null;

  return (
    <>
      <span
        onClick={() => {
          setOpen((v) => !v);
          setStep(0);
          setError(null);
        }}
      >
        {trigger}
      </span>
      {panel && host ? createPortal(panel, host) : panel}
    </>
  );
}
