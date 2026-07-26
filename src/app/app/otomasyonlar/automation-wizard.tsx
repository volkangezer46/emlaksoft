"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Bolt, Check, ChevronLeft, ChevronRight, Filter, Loader2, Plus, Trash2, Wand2, Zap } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createAutomation, updateAutomation } from "@/app/actions/automations";
import {
  TRIGGER_OPTIONS,
  TRIGGER_CONDITION_FIELDS,
  CONDITION_OP_OPTIONS,
  STATUS_ENTITY_BY_TRIGGER,
  DEMAND_STATUS_OPTIONS,
  DEAL_STAGE_OPTIONS,
  availableActionsForTrigger,
} from "./labels";

/**
 * Otomasyon Stüdyosu sihirbazı — 3 adım: tetikleyici → koşullar → aksiyon + ad.
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
  "w-full rounded-[10px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400";
const labelClass = "mb-1.5 block text-sm text-text-muted";

const STEPS = [
  { label: "Tetikleyici", icon: Bolt },
  { label: "Koşullar", icon: Filter },
  { label: "Aksiyon", icon: Zap },
] as const;

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

export function AutomationWizard({
  staff,
  initial,
  trigger,
}: {
  staff: StaffOption[];
  initial?: WizardInitial;
  trigger: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  const initialAction = initial?.actions?.[0];
  const initialCfg = (initialAction?.config ?? {}) as Record<string, unknown>;

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

  // Adım 3 — aksiyon + parametreler + ad
  const [actionType, setActionType] = useState<string>(str(initialAction?.type));
  const [taskTitle, setTaskTitle] = useState<string>(str(initialCfg.title));
  const [taskPriority, setTaskPriority] = useState<string>(str(initialCfg.priority) || "normal");
  const [taskDueDays, setTaskDueDays] = useState<string>(str(initialCfg.due_days));
  const [messageText, setMessageText] = useState<string>(
    str(initialCfg.template) || str(initialCfg.message),
  );
  const [assigneeId, setAssigneeId] = useState<string>(str(initialCfg.assignee_id));
  const [tag, setTag] = useState<string>(str(initialCfg.tag));
  const [targetStatus, setTargetStatus] = useState<string>(str(initialCfg.target_status));
  const [name, setName] = useState<string>(initial?.name ?? "");
  const [description, setDescription] = useState<string>(initial?.description ?? "");

  const triggerOpt = TRIGGER_OPTIONS.find((t) => t.value === triggerType);
  const conditionFields = TRIGGER_CONDITION_FIELDS[triggerType] ?? [];
  const actionOptions = useMemo(() => availableActionsForTrigger(triggerType), [triggerType]);
  const statusEntity = STATUS_ENTITY_BY_TRIGGER[triggerType];
  const statusOptions = statusEntity === "demand" ? DEMAND_STATUS_OPTIONS : DEAL_STAGE_OPTIONS;

  function selectTrigger(value: string) {
    setTriggerType(value);
    const opt = TRIGGER_OPTIONS.find((t) => t.value === value);
    setDays(str(opt?.daysConfig?.defaultValue ?? ""));
    // Tetikleyici değişince önceki tetikleyiciye özel seçimler geçersizleşir
    setConds((prev) => prev.filter((c) => (TRIGGER_CONDITION_FIELDS[value] ?? []).some((f) => f.value === c.field)));
    if (!availableActionsForTrigger(value).some((a) => a.value === actionType)) setActionType("");
    setTargetStatus("");
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
    if (!actionType || !name.trim()) return false;
    switch (actionType) {
      case "create_task": return taskTitle.trim().length > 0;
      case "send_sms":
      case "send_whatsapp":
      case "notify_manager":
      case "send_notification": return messageText.trim().length > 0;
      case "assign_to_staff": return assigneeId.length > 0;
      case "add_tag": return tag.trim().length > 0;
      case "change_status": return targetStatus.length > 0;
      default: return false;
    }
  }

  function buildActionConfig(): Record<string, unknown> {
    switch (actionType) {
      case "create_task": {
        const cfg: Record<string, unknown> = { title: taskTitle.trim(), priority: taskPriority };
        const due = Number(taskDueDays);
        if (Number.isFinite(due) && due >= 1) cfg.due_days = Math.round(due);
        return cfg;
      }
      case "send_sms":
      case "send_whatsapp": return { template: messageText.trim() };
      case "notify_manager":
      case "send_notification": return { message: messageText.trim() };
      case "assign_to_staff": return { assignee_id: assigneeId };
      case "add_tag": return { tag: tag.trim() };
      case "change_status": return { target_status: targetStatus };
      default: return {};
    }
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
    fd.set("actions", JSON.stringify([{ type: actionType, config: buildActionConfig() }]));

    startTransition(async () => {
      const res = initial ? await updateAutomation(fd) : await createAutomation(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      setStep(0);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setStep(0);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader
          icon={<Wand2 />}
          title={initial ? "Otomasyonu düzenle" : "Yeni otomasyon"}
          description="Tetikleyici → koşul → aksiyon: kuralınızı 3 adımda oluşturun."
        />

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
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
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

        <div className="max-h-[55vh] overflow-y-auto p-6">
          {/* ADIM 1 — Tetikleyici */}
          {step === 0 && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {TRIGGER_OPTIONS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => selectTrigger(t.value)}
                    className={`focus-ring press rounded-[12px] border p-3 text-left transition ${
                      triggerType === t.value
                        ? "border-brand-400 bg-brand-600/5 ring-1 ring-brand-400"
                        : "border-line bg-surface hover:border-brand-300"
                    }`}
                  >
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                      <Bolt className={`h-3.5 w-3.5 ${triggerType === t.value ? "text-brand-600" : "text-text-faint"}`} />
                      {t.label}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{t.description}</p>
                  </button>
                ))}
              </div>

              {triggerOpt?.daysConfig && (
                <div className="max-w-xs">
                  <label className={labelClass}>{triggerOpt.daysConfig.label} *</label>
                  <input
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
                  <label className={labelClass}>Asgari eşleşme puanı (0-100, opsiyonel)</label>
                  <input
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
                <div className="rounded-[12px] border border-dashed border-line bg-canvas p-4 text-sm text-text-muted">
                  Bu tetikleyici için filtrelenebilir alan bulunmuyor — kural, tetiklendiği her kayıtta çalışır.
                </div>
              ) : (
                <>
                  {conds.map((c, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 rounded-[12px] border border-line bg-canvas p-3">
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
                        className="focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[8px] border border-line text-text-faint transition hover:border-danger-500/30 hover:text-danger-500"
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
                      className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-dashed border-brand-300/60 px-3 py-2 text-sm font-semibold text-brand-600 transition hover:bg-brand-600/5"
                    >
                      <Plus className="h-3.5 w-3.5" /> Koşul ekle
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ADIM 3 — Aksiyon + ad */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {actionOptions.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => setActionType(a.value)}
                    className={`focus-ring press rounded-[12px] border p-3 text-left transition ${
                      actionType === a.value
                        ? "border-mint-500 bg-mint-500/5 ring-1 ring-mint-500"
                        : "border-line bg-surface hover:border-mint-500/50"
                    }`}
                  >
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
                      <Zap className={`h-3.5 w-3.5 ${actionType === a.value ? "text-mint-600" : "text-text-faint"}`} />
                      {a.label}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{a.description}</p>
                  </button>
                ))}
              </div>

              {/* Aksiyon parametreleri */}
              {actionType === "create_task" && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-3">
                    <label className={labelClass}>Görev başlığı *</label>
                    <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="ör. Müşteriyi ara" className={fieldClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Öncelik</label>
                    <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)} className={fieldClass}>
                      <option value="low">Düşük</option>
                      <option value="normal">Normal</option>
                      <option value="high">Yüksek</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Termin (gün, opsiyonel)</label>
                    <input type="number" min={1} max={365} value={taskDueDays} onChange={(e) => setTaskDueDays(e.target.value)} placeholder="ör. 2" className={fieldClass} />
                  </div>
                </div>
              )}

              {(actionType === "send_sms" || actionType === "send_whatsapp") && (
                <div>
                  <label className={labelClass}>{actionType === "send_sms" ? "SMS metni" : "WhatsApp metni"} *</label>
                  <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={3} placeholder="Sayın {{name}}, …" className={fieldClass} />
                  <p className="mt-1 text-[11px] text-text-faint">{"{{name}}"} yer tutucusu müşteri adıyla değiştirilir.</p>
                </div>
              )}

              {(actionType === "notify_manager" || actionType === "send_notification") && (
                <div>
                  <label className={labelClass}>Bildirim metni *</label>
                  <textarea value={messageText} onChange={(e) => setMessageText(e.target.value)} rows={2} placeholder="ör. İlgilenilmesi gereken bir kayıt var." className={fieldClass} />
                </div>
              )}

              {actionType === "assign_to_staff" && (
                <div className="max-w-sm">
                  <label className={labelClass}>Atanacak danışman *</label>
                  <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={fieldClass}>
                    <option value="">Seçin…</option>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.full_name}</option>
                    ))}
                  </select>
                </div>
              )}

              {actionType === "add_tag" && (
                <div className="max-w-sm">
                  <label className={labelClass}>Eklenecek etiket *</label>
                  <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="ör. sıcak-müşteri" className={fieldClass} />
                </div>
              )}

              {actionType === "change_status" && (
                <div className="max-w-sm">
                  <label className={labelClass}>{statusEntity === "demand" ? "Talebin yeni durumu" : "Anlaşmanın yeni aşaması"} *</label>
                  <select value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)} className={fieldClass}>
                    <option value="">Seçin…</option>
                    {statusOptions.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="hairline-t grid gap-3 pt-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>Kural adı *</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ör. Sıcak talepleri müdüre bildir" className={fieldClass} />
                </div>
                <div>
                  <label className={labelClass}>Açıklama (opsiyonel)</label>
                  <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ne işe yaradığını kısaca yazın" className={fieldClass} />
                </div>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-4 text-sm font-medium text-danger-600" role="alert">{error}</p>
          )}
        </div>

        {/* Alt bar */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-6 py-4">
          <DialogClose asChild>
            <button type="button" className="focus-ring press rounded-[10px] border border-hairline px-4 py-2.5 text-sm font-medium text-ink-950 transition hover:bg-canvas">
              Vazgeç
            </button>
          </DialogClose>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="focus-ring press inline-flex items-center gap-1 rounded-[10px] border border-line px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-canvas"
              >
                <ChevronLeft className="h-4 w-4" /> Geri
              </button>
            )}
            {step < 2 ? (
              <button
                type="button"
                disabled={!stepValid()}
                onClick={() => setStep((s) => s + 1)}
                className="btn-shine focus-ring press inline-flex items-center gap-1 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                İleri <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={!stepValid() || pending}
                onClick={save}
                className="btn-shine focus-ring press inline-flex items-center gap-1.5 rounded-[10px] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {initial ? "Güncelle" : "Kaydet"}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
