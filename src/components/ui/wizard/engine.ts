/**
 * Sihirbaz motoru — SAF (IO yok, React yok). Adım gezinmesi, adım doğrulaması, ilerleme, taslak kodlama ve
 * gönderim planı burada; görünüm `wizard.tsx`. Akışlar (satış, kapanış, kiralama) yalnız adım tanımı + plan verir;
 * iş kuralı MEVCUT server action'larda kalır (sihirbaz kopya mantık taşımaz).
 *
 * Değerler düz `Record<string, string>` (FormData'ya birebir çevrilir; taslak da aynı biçimi saklar).
 */
import type { LucideIcon } from "lucide-react";
import { encodeDraft, parseDraft, pickDraftFields } from "@/lib/form-tabs";

export type WizardValues = Record<string, string>;

/** Adım doğrulama sorunu. `field`: alanın DOM kimliği (odak buraya gider). */
export type WizardIssue = { field: string; message: string };

export type WizardSummaryRow = { label: string; value: string; muted?: boolean };

export type WizardStep = {
  /** Kararlı kimlik (taslak ve `?adim=` için). "ozet" ayrılmıştır. */
  id: string;
  label: string;
  /** Telefonda dar başlık (yoksa label). */
  short?: string;
  description?: string;
  icon?: LucideIcon;
  /** İsteğe bağlı adım: "Atla" ile geçilebilir; atlanınca doğrulaması ve planı yok sayılır. */
  optional?: boolean;
  /** Koşullu adım (ör. para görünmeyen rolde komisyon adımı yok). */
  when?: (v: WizardValues) => boolean;
  validate?: (v: WizardValues) => WizardIssue[];
  /** Özet ve onay adımındaki satırlar. */
  summary?: (v: WizardValues) => WizardSummaryRow[];
};

/** Her sihirbazın sonunda kendiliğinden eklenen inceleme adımı. */
export const REVIEW_STEP_ID = "ozet";
export const REVIEW_STEP: WizardStep = {
  id: REVIEW_STEP_ID,
  label: "Özet ve onay",
  short: "Özet",
  description: "Bilgileri kontrol edin; düzeltmek için ilgili adımın Düzenle bağlantısını kullanın.",
};

export type StepStatus = "complete" | "current" | "upcoming" | "error" | "skipped";

/** Görünen adımlar (koşulu tutanlar) + sondaki inceleme adımı. */
export function activeSteps(steps: readonly WizardStep[], v: WizardValues): WizardStep[] {
  const list = steps.filter((s) => s.id !== REVIEW_STEP_ID && (!s.when || s.when(v)));
  return [...list, REVIEW_STEP];
}

export function stepIssues(step: WizardStep | undefined, v: WizardValues, skipped: ReadonlySet<string> = new Set()): WizardIssue[] {
  if (!step || !step.validate) return [];
  if (step.optional && skipped.has(step.id)) return [];
  return step.validate(v);
}

export function stepIndex(steps: readonly WizardStep[], id: string): number {
  return steps.findIndex((s) => s.id === id);
}

/** Bilinmeyen/koşulu düşmüş adım kimliği ilk adıma çözülür. */
export function resolveStepId(steps: readonly WizardStep[], wanted: string | null | undefined): string {
  if (wanted && steps.some((s) => s.id === wanted)) return wanted;
  return steps[0]?.id ?? REVIEW_STEP_ID;
}

export function nextStepId(steps: readonly WizardStep[], current: string): string | null {
  const i = stepIndex(steps, current);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1].id : null;
}

export function prevStepId(steps: readonly WizardStep[], current: string): string | null {
  const i = stepIndex(steps, current);
  return i > 0 ? steps[i - 1].id : null;
}

/**
 * Gezinme koruması: geri gitmek her zaman serbest; İLERİ bir adıma (atlayarak da olsa) gitmek için aradaki ve
 * bulunulan TÜM adımlar geçerli olmalı. Engelleyen ilk adım döner (kullanıcı oraya götürülür).
 */
export function navigationGuard(
  steps: readonly WizardStep[],
  v: WizardValues,
  from: string,
  to: string,
  skipped: ReadonlySet<string> = new Set(),
): { ok: true } | { ok: false; blockedAt: string; issues: WizardIssue[] } {
  const a = stepIndex(steps, from);
  const b = stepIndex(steps, to);
  if (b < 0) return { ok: false, blockedAt: from, issues: [] };
  if (a < 0 || b <= a) return { ok: true };
  for (let i = a; i < b; i += 1) {
    const issues = stepIssues(steps[i], v, skipped);
    if (issues.length > 0) return { ok: false, blockedAt: steps[i].id, issues };
  }
  return { ok: true };
}

/** Göndermeden önce: ilk geçersiz (atlanmamış) adım; yoksa null. */
export function firstInvalidStep(
  steps: readonly WizardStep[],
  v: WizardValues,
  skipped: ReadonlySet<string> = new Set(),
): { stepId: string; issues: WizardIssue[] } | null {
  for (const s of steps) {
    const issues = stepIssues(s, v, skipped);
    if (issues.length > 0) return { stepId: s.id, issues };
  }
  return null;
}

/** Adım başlığındaki durum: tamam (ziyaret edilmiş ve geçerli), şimdiki, sıradaki, hatalı, atlanmış. */
export function stepStatuses(
  steps: readonly WizardStep[],
  v: WizardValues,
  current: string,
  visited: ReadonlySet<string>,
  skipped: ReadonlySet<string> = new Set(),
): Record<string, StepStatus> {
  const out: Record<string, StepStatus> = {};
  for (const s of steps) {
    if (s.id === current) out[s.id] = "current";
    else if (s.optional && skipped.has(s.id)) out[s.id] = "skipped";
    else if (!visited.has(s.id)) out[s.id] = "upcoming";
    else out[s.id] = stepIssues(s, v, skipped).length > 0 ? "error" : "complete";
  }
  return out;
}

/** İlerleme: bulunulan adımın sırası (1 tabanlı) ve yüzde (son adım %100). */
export function wizardProgress(steps: readonly WizardStep[], current: string): { index: number; total: number; pct: number } {
  const total = steps.length;
  const i = Math.max(0, stepIndex(steps, current));
  const pct = total <= 1 ? 100 : Math.round((i / (total - 1)) * 100);
  return { index: i + 1, total, pct };
}

/** Sorunları alan kimliğine göre (ilk ileti) — FormField `error` için. */
export function issuesByField(issues: readonly WizardIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) if (!(i.field in out)) out[i.field] = i.message;
  return out;
}

// ---- Taslak --------------------------------------------------------------------------------------------------

/** Taslak meta alanları (değerlerle aynı nesnede, hassas ad süzgecinden geçen adlar). */
const STEP_KEY = "__adim";
const SKIP_KEY = "__atla";

export type WizardDraft = { savedAt: number; step: string; skipped: string[]; values: WizardValues };

/** Taslak anahtarı formlarla aynı ad alanında (`emlaksoft:draft:v1:{kullanıcı}:sihirbaz-{id}`): çıkışta toplu silinir. */
export function wizardDraftFormId(wizardId: string): string {
  return `sihirbaz-${wizardId}`;
}

/**
 * Yalnız beyaz liste + hassas olmayan alanlar (telefon, e-posta, not, adres YAZILMAZ — `pickDraftFields`).
 * Boş değerler yazılmaz.
 */
export function encodeWizardDraft(
  input: { values: WizardValues; step: string; skipped: Iterable<string> },
  whitelist: readonly string[],
  nowMs: number,
): string {
  const values = pickDraftFields(input.values, whitelist);
  values[STEP_KEY] = input.step;
  const skipped = [...input.skipped];
  if (skipped.length > 0) values[SKIP_KEY] = skipped.join(",");
  return encodeDraft(values, nowMs);
}

export function decodeWizardDraft(raw: string | null | undefined, nowMs: number, whitelist: readonly string[]): WizardDraft | null {
  const parsed = parseDraft(raw, nowMs);
  if (!parsed) return null;
  const step = parsed.values[STEP_KEY] ?? "";
  const skipped = (parsed.values[SKIP_KEY] ?? "").split(",").filter(Boolean);
  // Okurken de beyaz liste: eski sürümün yazdığı ya da elle eklenen alan geri yüklenmez.
  const values = pickDraftFields(parsed.values, whitelist);
  return { savedAt: parsed.savedAt, step, skipped, values };
}

/** Taslak gerçekten bir şey taşıyor mu (başlangıç değerlerinden farklı en az bir alan ya da ilk adımdan ileride)? */
export function draftDiffers(draft: WizardDraft, initial: WizardValues, firstStep: string): boolean {
  if (draft.step && draft.step !== firstStep) return true;
  return Object.entries(draft.values).some(([k, v]) => (initial[k] ?? "") !== v);
}

// ---- Gönderim planı ------------------------------------------------------------------------------------------

/**
 * Tek "Onayla" ile MEVCUT action'ları sırayla çağıran plan. Her görev bir action çağrısıdır; başarı `patch` ile
 * bağlamı (oluşan kayıt kimlikleri) günceller. Bir görev düşerse plan DURUR: tamamlananlar işaretli kalır, "Yeniden dene"
 * yalnız kalanları çalıştırır (aynı kayıt iki kez açılmaz). `kind: "approval"`: hata değil, yönetici onayı bekleniyor.
 */
export type PlanContext = Record<string, string | undefined>;

export type TaskOutcome =
  | { ok: true; patch?: PlanContext; note?: string }
  | { ok: false; error: string; kind?: "error" | "approval" };

export type PlanTask = {
  id: string;
  label: string;
  run: (ctx: PlanContext) => Promise<TaskOutcome>;
};

export type PlanRun =
  | { status: "done"; ctx: PlanContext; done: string[]; notes: string[] }
  | { status: "failed"; ctx: PlanContext; done: string[]; notes: string[]; failedId: string; error: string; kind: "error" | "approval" };

export async function runPlan(
  tasks: readonly PlanTask[],
  start: { ctx: PlanContext; done: readonly string[] },
  onStep?: (taskId: string) => void,
): Promise<PlanRun> {
  let ctx: PlanContext = { ...start.ctx };
  const done = [...start.done];
  const notes: string[] = [];
  for (const t of tasks) {
    if (done.includes(t.id)) continue;
    onStep?.(t.id);
    let out: TaskOutcome;
    try {
      out = await t.run(ctx);
    } catch (e) {
      console.error("sihirbaz plan", t.id, e instanceof Error ? e.message : e);
      out = { ok: false, error: "Bağlantı kurulamadı; Yeniden dene ile kalan adımları tamamlayın." };
    }
    if (!out.ok) return { status: "failed", ctx, done, notes, failedId: t.id, error: out.error, kind: out.kind ?? "error" };
    ctx = { ...ctx, ...(out.patch ?? {}) };
    if (out.note) notes.push(out.note);
    done.push(t.id);
  }
  return { status: "done", ctx, done, notes };
}

/** Değerleri action'ın beklediği FormData'ya çevirir (yalnız verilen adlar; boşlar "" olarak). */
export function toFormData(v: WizardValues, names: readonly string[], extra?: Record<string, string | null | undefined>): FormData {
  const fd = new FormData();
  for (const n of names) fd.set(n, v[n] ?? "");
  for (const [k, val] of Object.entries(extra ?? {})) if (val != null) fd.set(k, val);
  return fd;
}
