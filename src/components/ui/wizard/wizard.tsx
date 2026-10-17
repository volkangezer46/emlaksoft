"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronLeft, ChevronRight, CircleAlert, Clock3, Loader2, LogOut, RotateCcw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import Link from "@/components/ui/smart-link";
import { Button, ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { BreadcrumbItem } from "@/components/ui/breadcrumb";
import { useToast } from "@/components/app/toast-provider";
import { now } from "@/lib/clock";
import { draftStorageKey, formatDraftTime } from "@/lib/form-tabs";
import { cn } from "@/lib/utils";
import {
  REVIEW_STEP_ID,
  activeSteps,
  decodeWizardDraft,
  draftDiffers,
  encodeWizardDraft,
  firstInvalidStep,
  issuesByField,
  navigationGuard,
  nextStepId,
  prevStepId,
  resolveStepId,
  runPlan,
  stepIndex,
  stepIssues,
  stepStatuses,
  wizardDraftFormId,
  wizardProgress,
  type PlanContext,
  type PlanTask,
  type StepStatus,
  type WizardDraft,
  type WizardStep,
  type WizardValues,
} from "./engine";

/**
 * Wizard — çok adımlı iş akışlarının ORTAK kabuğu (satış, kapanış, kiralama...). Şartname: docs/design/SIHIRBAZ_2026-10.md.
 *
 *  · Üstte numaralı adım başlığı (tamam / şimdiki / sıradaki / hatalı / atlandı) + altın ilerleme çubuğu; telefonda kompakt
 *    numaralar + şimdiki adımın adı.
 *  · Her adımın doğrulaması (zod, `zodStep`) "İleri"de çalışır; ileri atlama `navigationGuard` ile korunur.
 *  · Son adım "Özet ve onay": her adımın özet satırları + Düzenle bağlantısı; "Onayla" planı (MEVCUT action'lar) sırayla
 *    çalıştırır. Bir görev düşerse tamamlananlar korunur, "Yeniden dene" kalanları çalıştırır; onay bekleyen işlem hata
 *    değil durum olarak gösterilir.
 *  · Taslak: kullanıcı başına yerel kayıt (beyaz liste, hassas alan yok, try/catch), açılışta "Taslağı sürdür" bandı,
 *    "Kaydet ve çık".
 *  · Klavye: Enter = İleri (çok satırlı alan hariç), Alt+←/→ adım, Ctrl/Cmd+Enter = İleri/Onayla. Adım değişince odak
 *    panele (ince imleçte ilk alana), ekran okuyucuya "Adım 2/5: …" duyurusu.
 *  · Masaüstünde sağda canlı özet/hesap paneli (`aside`); dar ekranda katlı "Canlı özet". Telefonda yapışkan alt eylem
 *    çubuğu (`fab-bar`: mobil alt gezinme gizlenir, `--mbar-h` yüksekliği, ekran klavyesinde akışa döner).
 */

export type WizardApi = {
  values: WizardValues;
  set: (name: string, value: string) => void;
  setMany: (patch: WizardValues) => void;
  /** Alanın görünen hatası (adımda İleri denendikten sonra). */
  error: (fieldId: string) => string | undefined;
  stepId: string;
  goTo: (stepId: string, fieldId?: string) => void;
  skipped: ReadonlySet<string>;
  /** Gönderim başladı/kısmen tamamlandı: alanlar kilitli. */
  locked: boolean;
};

const WizardCtx = createContext<WizardApi | null>(null);

/** Adım içeriğinden (alt bileşenler) sihirbaz API'sine erişim. */
export function useWizard(): WizardApi {
  const ctx = useContext(WizardCtx);
  if (!ctx) throw new Error("useWizard yalnız <Wizard> içinde kullanılır");
  return ctx;
}

export type WizardProps = {
  /** Kararlı kimlik ("satis", "kira", "kapanis-<id>"): taslak anahtarı. */
  id: string;
  userId: string;
  title: string;
  description?: string;
  eyebrow?: string;
  breadcrumbs?: BreadcrumbItem[];
  /** "page": kendi sayfası (başlık + yapışkan alt çubuk). "embedded": kayıt sekmesi içinde (başlıksız, satır içi çubuk). */
  variant?: "page" | "embedded";
  steps: WizardStep[];
  initialValues: WizardValues;
  initialStep?: string;
  /** Taslağa yazılabilecek alanlar (beyaz liste). Verilmezse taslak yok. */
  draftFields?: readonly string[];
  renderStep: (stepId: string, api: WizardApi) => ReactNode;
  /** Masaüstü sağ panel: canlı özet ve hesaplar. */
  aside?: (api: WizardApi) => ReactNode;
  /** Özet adımında satırların altında (uyarılar, onay notu). */
  reviewExtra?: (api: WizardApi) => ReactNode;
  /** Üstte uyarı bandı (mükerrer kayıt vb.). */
  notice?: ReactNode;
  /** Onayla: çağrılacak MEVCUT action'lar. */
  plan: (values: WizardValues, info: { skipped: ReadonlySet<string> }) => PlanTask[];
  /** Plan bitince: yönlendirme + bildirim. */
  onComplete: (ctx: PlanContext, notes: string[]) => { href: string; message: string; refresh?: boolean };
  /** Plan kısmen tamamlandıysa "Kayda git" hedefi. */
  partialHref?: (ctx: PlanContext) => string | null;
  submitLabel: string;
  cancelHref: string;
  /** Gönderimi engelleyen durum (yetki yok vb.); özet adımında açıklanır. */
  submitBlocked?: string | null;
  className?: string;
};

type RunState =
  | { status: "idle" }
  | { status: "running"; current: string; done: string[]; ctx: PlanContext }
  | { status: "failed"; failedId: string; error: string; kind: "error" | "approval"; done: string[]; ctx: PlanContext }
  | { status: "done" };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function subscribeKeyboard(cb: () => void) {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", cb);
  return () => vv?.removeEventListener("resize", cb);
}
function getKeyboardOpen() {
  const vv = window.visualViewport;
  if (!vv || window.innerWidth >= 1024) return false;
  return window.innerHeight - vv.height > 150;
}
const getKeyboardServer = () => false;

const FIELD_SELECTOR = "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button[role=combobox]:not([disabled])";

export function Wizard(props: WizardProps) {
  const {
    id,
    userId,
    variant = "page",
    initialValues,
    draftFields,
    renderStep,
    aside,
    reviewExtra,
    plan,
    onComplete,
    partialHref,
    submitLabel,
    cancelHref,
    submitBlocked,
  } = props;
  const router = useRouter();
  const { push } = useToast();
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const keyboardOpen = useSyncExternalStore(subscribeKeyboard, getKeyboardOpen, getKeyboardServer);

  const [values, setValues] = useState<WizardValues>(initialValues);
  const steps = useMemo(() => activeSteps(props.steps, values), [props.steps, values]);
  const firstStep = steps[0]?.id ?? REVIEW_STEP_ID;
  const [stepId, setStepId] = useState(() => resolveStepId(activeSteps(props.steps, initialValues), props.initialStep));
  const [visited, setVisited] = useState<Set<string>>(() => {
    const all = activeSteps(props.steps, initialValues);
    const start = Math.max(0, stepIndex(all, resolveStepId(all, props.initialStep)));
    return new Set(all.slice(0, start + 1).map((s) => s.id));
  });
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set());
  const [attempted, setAttempted] = useState<Set<string>>(() => new Set());
  const [dir, setDir] = useState<"next" | "prev" | "none">("none");
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [announce, setAnnounce] = useState("");
  // Adım değişince odak isteği (durum: efekt uygular; ref değil — render sırasında okunan API'ye ref girmez).
  // n = 0: açılış (yalnız ince imleçte ve odak sayfada değilse ilk alana; kaydırma yok).
  const [focusReq, setFocusReq] = useState<{ mode: "field" | "heading"; field: string | null; n: number } | null>({ mode: "field", field: null, n: 0 });

  // Koşulu düşen adımda kalınmaz (ör. para görünürlüğü değişti).
  const current = steps.some((s) => s.id === stepId) ? stepId : resolveStepId(steps, null);
  const step = steps.find((s) => s.id === current) ?? steps[0];
  const isReview = current === REVIEW_STEP_ID;
  const locked = run.status === "running" || (run.status === "failed" && run.done.length > 0) || run.status === "done";

  // ---- Taslak ------------------------------------------------------------------------------------------------
  const draftKey = draftFields ? draftStorageKey(userId, wizardDraftFormId(id)) : null;
  const [found, setFound] = useState<WizardDraft | null>(null);
  const [draftDecided, setDraftDecided] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const fieldsKey = draftFields ? draftFields.join("|") : "";

  useEffect(() => {
    if (!draftKey || !draftFields) return;
    const frame = requestAnimationFrame(() => {
      try {
        const raw = storage()?.getItem(draftKey);
        const d = decodeWizardDraft(raw, now(), draftFields);
        if (d && draftDiffers(d, initialValues, firstStep)) setFound(d);
        else {
          if (raw) storage()?.removeItem(draftKey);
          setDraftDecided(true);
        }
      } catch {
        setDraftDecided(true);
      }
    });
    return () => cancelAnimationFrame(frame);
    // yalnız bağlanırken
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, fieldsKey]);

  const writeDraft = useCallback(() => {
    if (!draftKey || !draftFields) return;
    try {
      const at = now();
      storage()?.setItem(draftKey, encodeWizardDraft({ values, step: current, skipped }, draftFields, at));
      setSavedAt(at);
    } catch {
      /* depolama kapalı/dolu — sessiz */
    }
  }, [draftKey, draftFields, values, current, skipped]);

  const clearDraft = useCallback(() => {
    if (!draftKey) return;
    try {
      storage()?.removeItem(draftKey);
    } catch {
      /* sessiz */
    }
  }, [draftKey]);

  // Otomatik kayıt: kullanıcı bir şey değiştirdikten sonra, taslak kararı verilmişken, 600 ms gecikmeyle.
  useEffect(() => {
    if (!draftKey || !draftDecided || !touched || run.status === "done") return;
    const t = setTimeout(writeDraft, 600);
    return () => clearTimeout(t);
  }, [draftKey, draftDecided, touched, writeDraft, run.status]);

  function restoreDraft() {
    if (!found) return;
    const nextValues = { ...values, ...found.values };
    const all = activeSteps(props.steps, nextValues);
    const target = resolveStepId(all, found.step);
    setValues(nextValues);
    setSkipped(new Set(found.skipped));
    setVisited(new Set(all.slice(0, Math.max(0, stepIndex(all, target)) + 1).map((s) => s.id)));
    setStepId(target);
    setFound(null);
    setDraftDecided(true);
    setTouched(true);
    setFocusReq((prev) => ({ mode: "heading", field: null, n: (prev?.n ?? 0) + 1 }));
  }
  function discardDraft() {
    clearDraft();
    setFound(null);
    setDraftDecided(true);
  }

  // ---- Değerler ----------------------------------------------------------------------------------------------
  const set = useCallback((name: string, value: string) => {
    setTouched(true);
    setValues((prev) => (prev[name] === value ? prev : { ...prev, [name]: value }));
  }, []);
  const setMany = useCallback((patch: WizardValues) => {
    setTouched(true);
    setValues((prev) => ({ ...prev, ...patch }));
  }, []);

  const currentIssues = useMemo(() => stepIssues(step, values, skipped), [step, values, skipped]);
  const shownErrors = useMemo(
    () => (attempted.has(current) ? issuesByField(currentIssues) : {}),
    [attempted, current, currentIssues],
  );
  const statuses = useMemo(() => stepStatuses(steps, values, current, visited, skipped), [steps, values, current, visited, skipped]);
  const progress = wizardProgress(steps, current);

  // ---- Gezinme -----------------------------------------------------------------------------------------------
  const moveTo = useCallback(
    (target: string, opts?: { field?: string; focus?: "field" | "heading" }) => {
      const from = stepIndex(steps, current);
      const to = stepIndex(steps, target);
      if (to < 0) return;
      setDir(to > from ? "next" : to < from ? "prev" : "none");
      setStepId(target);
      setVisited((prev) => (prev.has(target) ? prev : new Set([...prev, target])));
      setFocusReq((prev) => ({ mode: opts?.focus ?? "field", field: opts?.field ?? null, n: (prev?.n ?? 0) + 1 }));
      const s = steps[to];
      setAnnounce(`Adım ${to + 1} / ${steps.length}: ${s?.label ?? ""}`);
    },
    [steps, current],
  );

  const goTo = useCallback(
    (target: string, fieldId?: string) => {
      if (locked) return;
      const guard = navigationGuard(steps, values, current, target, skipped);
      if (!guard.ok) {
        setAttempted((prev) => new Set([...prev, guard.blockedAt]));
        moveTo(guard.blockedAt, { field: guard.issues[0]?.field, focus: "field" });
        return;
      }
      moveTo(target, { field: fieldId, focus: "field" });
    },
    [locked, steps, values, current, skipped, moveTo],
  );

  function next() {
    if (locked) return;
    if (isReview) {
      void submitAll();
      return;
    }
    setAttempted((prev) => (prev.has(current) ? prev : new Set([...prev, current])));
    // İleri = bu adımı doldurmayı seçti: atlanmışsa atlama kaldırılır ve doğrulanır.
    const nextSkipped = skipped.has(current) ? new Set([...skipped].filter((s) => s !== current)) : skipped;
    if (nextSkipped !== skipped) setSkipped(nextSkipped);
    const issues = stepIssues(step, values, nextSkipped);
    if (issues.length > 0) {
      focusIssue(issues[0].field);
      return;
    }
    const target = nextStepId(steps, current);
    if (target) moveTo(target);
  }

  function back() {
    if (locked) return;
    const target = prevStepId(steps, current);
    if (target) moveTo(target);
  }

  function skip() {
    if (locked || !step?.optional) return;
    setTouched(true);
    setSkipped((prev) => new Set([...prev, current]));
    const target = nextStepId(steps, current);
    if (target) moveTo(target);
  }

  function focusIssue(fieldId: string) {
    requestAnimationFrame(() => {
      const el = document.getElementById(fieldId);
      if (el instanceof HTMLElement) {
        el.focus();
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  }

  // Adım değişince odak: belirli alan > ilk alan (ince imleç) > panel başlığı (dokunmatikte ekran klavyesi açılmasın).
  useEffect(() => {
    if (!focusReq) return;
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const heading = panel.querySelector<HTMLElement>("[data-wz-heading]");
      const fine = window.matchMedia("(pointer: fine)").matches;
      if (focusReq.n === 0) {
        const activeEl = document.activeElement;
        if (!fine || (activeEl && activeEl !== document.body && activeEl !== document.documentElement)) return;
        panel.querySelector<HTMLElement>(FIELD_SELECTOR)?.focus({ preventScroll: true });
        return;
      }
      const top = rootRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 0) rootRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
      if (focusReq.field) {
        const el = document.getElementById(focusReq.field);
        if (el instanceof HTMLElement) {
          el.focus({ preventScroll: false });
          return;
        }
      }
      const field = focusReq.mode === "field" && fine && !isReviewStep(panel) ? panel.querySelector<HTMLElement>(FIELD_SELECTOR) : null;
      (field ?? heading)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusReq]);

  // ---- Gönderim ----------------------------------------------------------------------------------------------
  async function submitAll() {
    if (submitBlocked) return;
    if (run.status === "running") return;
    const invalid = firstInvalidStep(steps, values, skipped);
    if (invalid) {
      setAttempted((prev) => new Set([...prev, invalid.stepId]));
      moveTo(invalid.stepId, { field: invalid.issues[0]?.field });
      return;
    }
    const tasks = plan(values, { skipped });
    const start = run.status === "failed" ? { ctx: run.ctx, done: run.done } : { ctx: {}, done: [] as string[] };
    setRun({ status: "running", current: tasks.find((t) => !start.done.includes(t.id))?.id ?? "", done: start.done, ctx: start.ctx });
    const result = await runPlan(tasks, start, (taskId) =>
      setRun((prev) => (prev.status === "running" ? { ...prev, current: taskId } : prev)),
    );
    if (result.status === "failed") {
      setRun({ status: "failed", failedId: result.failedId, error: result.error, kind: result.kind, done: result.done, ctx: result.ctx });
      // Onay bekleyen işlemde bilgiler taslakta kalsın (onay gelince aynı yerden sürdürülür).
      if (result.kind === "approval") writeDraft();
      return;
    }
    clearDraft();
    setRun({ status: "done" });
    const out = onComplete(result.ctx, result.notes);
    push(out.message, "ok");
    router.push(out.href);
    if (out.refresh !== false) router.refresh();
  }

  function saveAndExit() {
    writeDraft();
    push("Taslak kaydedildi; sihirbazı açınca kaldığınız adımdan sürdürebilirsiniz.", "ok");
    router.push(cancelHref);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.defaultPrevented) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
      e.preventDefault();
      if (e.key === "ArrowRight") next();
      else back();
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      next();
    }
  }

  const api: WizardApi = {
    values,
    set,
    setMany,
    error: (fieldId) => shownErrors[fieldId],
    stepId: current,
    goTo,
    skipped,
    locked,
  };

  const tasksForStatus = run.status === "running" || run.status === "failed" ? plan(values, { skipped }) : [];
  const nextStep = steps[stepIndex(steps, current) + 1];
  const hasAside = Boolean(aside);
  const page = variant === "page";

  return (
    <WizardCtx.Provider value={api}>
      <div ref={rootRef} className={cn("wz mx-auto w-full max-w-[80rem] scroll-mt-20", props.className)} data-dir={dir} onKeyDown={onKeyDown}>
        {page ? (
          <PageHeader
            title={props.title}
            description={props.description}
            eyebrow={props.eyebrow}
            breadcrumbs={props.breadcrumbs}
            actions={
              draftFields ? (
                <Button type="button" variant="outline" icon={LogOut} onClick={saveAndExit} disabled={locked}>
                  Kaydet ve çık
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-base font-bold text-ink-950">{props.title}</h2>
              {props.description ? <p className="mt-0.5 text-sm text-text-muted">{props.description}</p> : null}
            </div>
          </div>
        )}

        <p aria-live="polite" className="sr-only">{announce}</p>

        {found && !draftDecided ? (
          <div role="status" className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] border border-[color-mix(in_srgb,var(--gold-400)_45%,transparent)] bg-[color-mix(in_srgb,var(--gold-300)_10%,var(--surface))] px-4 py-3 text-sm">
            <Clock3 aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--pm-gold-text)]" />
            <p className="min-w-0 flex-1 basis-56 text-ink-950">
              Yarım kalan bir taslak var ({formatDraftTime(found.savedAt, now())}
              {found.step ? `, ${steps.find((s) => s.id === found.step)?.label ?? "son adım"}` : ""}).
              <span className="text-text-muted"> Ad, telefon ve not gibi kişisel bilgiler taslağa yazılmaz.</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="gold" icon={RotateCcw} onClick={restoreDraft}>Taslağı sürdür</Button>
              <Button type="button" size="sm" variant="secondary" icon={Trash2} onClick={discardDraft}>Yeni başla</Button>
            </div>
          </div>
        ) : null}

        {props.notice ? <div className="mb-4 space-y-2">{props.notice}</div> : null}

        <WizardStepper
          steps={steps}
          statuses={statuses}
          current={current}
          progress={progress}
          onSelect={(sid) => goTo(sid)}
          disabled={locked}
          idPrefix={uid}
        />

        <div className={cn("mt-4 grid items-start gap-6", hasAside && "xl:grid-cols-[minmax(0,1fr)_20rem]")}>
          <div className="min-w-0 space-y-4">
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                next();
              }}
              className="space-y-4"
            >
              <section
                key={current}
                ref={panelRef}
                aria-labelledby={`${uid}-h-${current}`}
                data-wz-review={isReview ? "1" : undefined}
                className="wz-panel surface-card rounded-[var(--radius-panel)]"
              >
                <header className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
                  <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--navy-900)] font-display text-sm font-bold text-[var(--gold-300)]">
                    {step?.icon ? <step.icon className="h-4 w-4" /> : progress.index}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--pm-gold-text)]">
                      Adım {progress.index} / {progress.total}
                      {step?.optional ? <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 normal-case tracking-normal text-text-muted">İsteğe bağlı</span> : null}
                    </p>
                    <h2 id={`${uid}-h-${current}`} data-wz-heading tabIndex={-1} className="mt-0.5 font-display text-lg font-bold text-ink-950 outline-none">
                      {step?.label}
                    </h2>
                    {step?.description ? <p className="mt-0.5 text-sm text-text-muted">{step.description}</p> : null}
                  </div>
                </header>
                <fieldset disabled={locked} className="min-w-0 p-5 sm:p-6">
                  <legend className="sr-only">{step?.label}</legend>
                  {isReview ? (
                    <WizardReview steps={steps} values={values} skipped={skipped} onEdit={(sid) => goTo(sid)} locked={locked}>
                      {reviewExtra?.(api)}
                      {submitBlocked ? (
                        <p role="status" className="tone-warning rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium">{submitBlocked}</p>
                      ) : null}
                    </WizardReview>
                  ) : (
                    renderStep(current, api)
                  )}
                </fieldset>
              </section>

              {run.status === "running" || run.status === "failed" ? (
                <RunStatus
                  tasks={tasksForStatus}
                  run={run}
                  partialHref={run.status === "failed" && run.done.length > 0 ? (partialHref?.(run.ctx) ?? null) : null}
                  onRetry={() => void submitAll()}
                />
              ) : null}

              {hasAside ? (
                <details className="group rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm shadow-[var(--shadow-sm)] xl:hidden">
                  <summary className="focus-ring flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[var(--radius-control)] font-semibold text-ink-950">
                    <Sparkles aria-hidden="true" className="h-4 w-4 text-[var(--pm-gold-text)]" /> Canlı özet ve hesap
                    <ChevronRight aria-hidden="true" className="ml-auto h-4 w-4 text-text-faint transition-transform duration-(--motion-fast) group-open:rotate-90 motion-reduce:transition-none" />
                  </summary>
                  <div className="mt-3 space-y-3">{aside?.(api)}</div>
                </details>
              ) : null}

              <div
                data-kb={page && keyboardOpen ? "1" : undefined}
                data-sticky={page ? "1" : undefined}
                className={cn(
                  "fab-bar z-10 rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--elev-2)]",
                  page ? "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-2" : "relative",
                )}
              >
                <div aria-hidden="true" className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-[var(--radius-card)] bg-canvas">
                  <div
                    className="h-full bg-[linear-gradient(90deg,var(--gold-300),var(--gold-500))] transition-[width] duration-(--motion-base) motion-reduce:transition-none"
                    style={{ width: `${progress.pct}%` }}
                  />
                </div>
                <div className="flex min-h-[calc(var(--mbar-h)-1px)] items-center gap-2 px-3 py-2 sm:px-4">
                  {prevStepId(steps, current) ? (
                    <Button type="button" variant="secondary" size="lg" icon={ChevronLeft} onClick={back} disabled={locked} className="shrink-0">
                      Geri
                    </Button>
                  ) : (
                    <ButtonLink href={cancelHref} variant="ghost" size="lg" className="shrink-0">
                      Vazgeç
                    </ButtonLink>
                  )}
                  <p className="hidden min-w-0 flex-1 truncate text-xs text-text-muted md:block" aria-live="off">
                    {savedAt ? <>Taslak kaydedildi · </> : null}
                    <span className="hidden lg:inline">Enter: İleri · Alt+←/→: adımlar</span>
                  </p>
                  <span className="flex-1 md:hidden" />
                  {step?.optional && !isReview ? (
                    <Button type="button" variant="ghost" size="lg" onClick={skip} disabled={locked} className="shrink-0">
                      Atla
                    </Button>
                  ) : null}
                  {isReview ? (
                    <Button
                      type="submit"
                      variant="gold"
                      size="lg"
                      icon={ShieldCheck}
                      loading={run.status === "running"}
                      disabled={run.status === "done" || Boolean(submitBlocked)}
                      className="min-w-0 max-sm:flex-1"
                    >
                      <span className="truncate">
                        {run.status === "running" ? "Kaydediliyor…" : run.status === "failed" ? "Yeniden dene" : submitLabel}
                      </span>
                    </Button>
                  ) : (
                    <Button type="submit" size="lg" iconRight={ChevronRight} disabled={locked} className="min-w-0 max-sm:flex-1">
                      <span className="truncate">
                        İleri<span className="hidden sm:inline">{nextStep ? `: ${nextStep.short ?? nextStep.label}` : ""}</span>
                      </span>
                    </Button>
                  )}
                </div>
              </div>
            </form>
          </div>

          {hasAside ? (
            <aside
              aria-label="Canlı özet ve hesap"
              className="sticky top-20 hidden max-h-[calc(100vh-6rem)] space-y-3 overflow-y-auto rounded-[var(--radius-panel)] border border-line bg-surface p-4 text-sm shadow-[var(--elev-1)] xl:block"
            >
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold text-ink-950">
                <Sparkles aria-hidden="true" className="h-4 w-4 text-[var(--pm-gold-text)]" /> Canlı özet ve hesap
              </h2>
              {aside?.(api)}
            </aside>
          ) : null}
        </div>
      </div>
    </WizardCtx.Provider>
  );
}

function isReviewStep(panel: HTMLElement): boolean {
  return panel.getAttribute("data-wz-review") === "1";
}

// ---- Adım başlığı ----------------------------------------------------------------------------------------------

const DOT: Record<StepStatus, string> = {
  complete: "bg-[var(--gold-400)] text-[var(--gold-ink)] border-transparent",
  current: "bg-[var(--navy-900)] text-[var(--gold-300)] border-transparent ring-2 ring-[var(--gold-400)] ring-offset-2 ring-offset-[var(--surface)]",
  upcoming: "bg-surface text-text-muted border-line",
  error: "bg-[color-mix(in_srgb,var(--danger-500)_12%,var(--surface))] text-danger-600 border-[color-mix(in_srgb,var(--danger-500)_40%,transparent)]",
  skipped: "bg-surface text-text-faint border-dashed border-line",
};

const STATUS_TEXT: Record<StepStatus, string> = {
  complete: "tamamlandı",
  current: "şimdiki adım",
  upcoming: "sıradaki",
  error: "eksik bilgi var",
  skipped: "atlandı",
};

export function WizardStepper({
  steps,
  statuses,
  current,
  progress,
  onSelect,
  disabled,
  idPrefix,
}: {
  steps: WizardStep[];
  statuses: Record<string, StepStatus>;
  current: string;
  progress: { index: number; total: number; pct: number };
  onSelect: (stepId: string) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const currentStep = steps.find((s) => s.id === current);
  return (
    <nav aria-label="Sihirbaz adımları" className="surface-card rounded-[var(--radius-panel)] px-4 py-3 sm:px-5 sm:py-4">
      <div className="mb-2 flex items-baseline justify-between gap-3 sm:hidden">
        <p className="min-w-0 truncate text-sm font-semibold text-ink-950">
          <span className="text-[var(--pm-gold-text)]">Adım {progress.index}/{progress.total}</span> · {currentStep?.short ?? currentStep?.label}
        </p>
      </div>
      <ol className="flex items-start">
        {steps.map((s, i) => {
          const st = statuses[s.id] ?? "upcoming";
          const isLast = i === steps.length - 1;
          return (
            <li key={s.id} className={cn("flex min-w-0 items-start", !isLast && "flex-1")}>
              <button
                type="button"
                id={`${idPrefix}-step-${s.id}`}
                onClick={() => onSelect(s.id)}
                disabled={disabled || st === "current"}
                aria-current={st === "current" ? "step" : undefined}
                aria-label={`${i + 1}. ${s.label}: ${STATUS_TEXT[st]}`}
                className="focus-ring group flex min-h-11 min-w-11 flex-col items-center gap-1.5 rounded-[var(--radius-control)] px-1 disabled:cursor-default sm:min-w-16"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold transition-colors duration-(--motion-fast) motion-reduce:transition-none sm:h-8 sm:w-8",
                    DOT[st],
                    st !== "current" && !disabled && "group-hover:border-[var(--gold-400)]",
                  )}
                >
                  {st === "complete" ? <Check className="h-4 w-4" /> : st === "error" ? <CircleAlert className="h-4 w-4" /> : st === "skipped" ? "–" : i + 1}
                </span>
                <span
                  className={cn(
                    "hidden max-w-[8.5rem] truncate text-xs sm:block",
                    st === "current" ? "font-bold text-ink-950" : st === "error" ? "font-semibold text-danger-600" : "font-medium text-text-muted",
                  )}
                >
                  {s.short ?? s.label}
                </span>
              </button>
              {!isLast ? (
                <span aria-hidden="true" className="mt-[1.375rem] h-0.5 min-w-2 flex-1 overflow-hidden rounded-full bg-line sm:mt-[1.5rem]">
                  <span
                    className={cn(
                      "block h-full bg-[var(--gold-400)] transition-[width] duration-(--motion-base) motion-reduce:transition-none",
                      st === "complete" || st === "skipped" ? "w-full" : "w-0",
                    )}
                  />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <div
        role="progressbar"
        aria-label="Sihirbaz ilerlemesi"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.pct}
        aria-valuetext={`Adım ${progress.index} / ${progress.total}`}
        className="mt-2 h-1 overflow-hidden rounded-full bg-canvas"
      >
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--gold-300),var(--gold-500))] transition-[width] duration-(--motion-base) motion-reduce:transition-none"
          style={{ width: `${progress.pct}%` }}
        />
      </div>
    </nav>
  );
}

// ---- Özet ve onay ----------------------------------------------------------------------------------------------

function WizardReview({
  steps,
  values,
  skipped,
  onEdit,
  locked,
  children,
}: {
  steps: WizardStep[];
  values: WizardValues;
  skipped: ReadonlySet<string>;
  onEdit: (stepId: string) => void;
  locked: boolean;
  children?: ReactNode;
}) {
  const list = steps.filter((s) => s.id !== REVIEW_STEP_ID);
  return (
    <div className="space-y-3">
      <ul className="grid gap-3 md:grid-cols-2">
        {list.map((s, i) => {
          const isSkipped = Boolean(s.optional && skipped.has(s.id));
          const rows = isSkipped ? [] : (s.summary?.(values) ?? []);
          return (
            <li key={s.id} className="min-w-0 rounded-[var(--radius-card)] border border-line bg-canvas/50 p-3">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--gold-400)] text-xs font-bold text-[var(--gold-ink)]">
                  {i + 1}
                </span>
                <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-950">{s.label}</h3>
                <button
                  type="button"
                  onClick={() => onEdit(s.id)}
                  disabled={locked}
                  className="focus-ring inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-control)] px-2 text-xs font-semibold text-brand-700 underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
                >
                  {isSkipped ? "Doldur" : "Düzenle"}<span className="sr-only">: {s.label}</span>
                </button>
              </div>
              {isSkipped ? (
                <p className="mt-1 px-1 text-xs text-text-faint">Atlandı (isteğe bağlı).</p>
              ) : rows.length > 0 ? (
                <dl className="mt-1 space-y-0.5">
                  {rows.map((r) => (
                    <div key={r.label} className="flex min-h-7 items-baseline gap-3 px-1 text-xs">
                      <dt className="shrink-0 text-text-muted">{r.label}</dt>
                      <dd title={r.value} className={cn("line-clamp-2 min-w-0 flex-1 break-words text-right font-medium", r.muted ? "text-text-faint" : "text-ink-950")}>
                        {r.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>
      {children}
    </div>
  );
}

// ---- Gönderim durumu -------------------------------------------------------------------------------------------

function RunStatus({
  tasks,
  run,
  partialHref,
  onRetry,
}: {
  tasks: PlanTask[];
  run: Extract<RunState, { status: "running" | "failed" }>;
  partialHref: string | null;
  onRetry: () => void;
}) {
  const approval = run.status === "failed" && run.kind === "approval";
  return (
    <section
      role={run.status === "failed" && !approval ? "alert" : "status"}
      aria-label="Kayıt adımları"
      className={cn(
        "rounded-[var(--radius-card)] border p-4 text-sm",
        run.status === "failed" ? (approval ? "tone-warning" : "tone-danger") : "border-line bg-surface",
      )}
    >
      <ol className="space-y-1.5">
        {tasks.map((t) => {
          const done = run.done.includes(t.id);
          const active = run.status === "running" ? run.current === t.id : run.failedId === t.id;
          return (
            <li key={t.id} className="flex items-center gap-2">
              <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center">
                {done ? (
                  <Check className="h-4 w-4 text-[var(--pm-success-text)]" />
                ) : active && run.status === "running" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-text-muted" />
                ) : active ? (
                  <CircleAlert className="h-4 w-4" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-text-faint" />
                )}
              </span>
              <span className={cn("min-w-0 flex-1", done ? "text-ink-950" : "text-text-muted", active && "font-semibold text-ink-950")}>
                {t.label}
                <span className="sr-only">{done ? ": tamamlandı" : active ? (run.status === "running" ? ": sürüyor" : ": tamamlanamadı") : ": bekliyor"}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {run.status === "failed" ? (
        <div className="mt-3 space-y-2">
          <p className="font-medium">{approval ? "Yönetici onayı bekleniyor." : run.error}</p>
          {approval ? (
            <p className="text-xs">
              Talebiniz iletildi; bilgiler taslakta saklandı. Onay gelince bu sihirbazı açıp Onayla&apos;ya yeniden basın.{" "}
              <Link href="/app/onaylar" className="font-semibold underline underline-offset-2">Onay durumunu aç</Link>
            </p>
          ) : run.done.length > 0 ? (
            <p className="text-xs">Tamamlanan adımlar kaydedildi ve tekrarlanmaz; Yeniden dene yalnız kalanları çalıştırır.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" icon={RotateCcw} onClick={onRetry}>
              Yeniden dene
            </Button>
            {partialHref ? (
              <ButtonLink href={partialHref} size="sm" variant="ghost" iconRight={ArrowRight}>
                Kalanı atla, kayda git
              </ButtonLink>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ---- Adım içi küçük yapı taşları -------------------------------------------------------------------------------

/** Yan panel / özet: başlıklı küçük blok. */
export function WizardPanelGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-2.5">
      <p className="px-1 pb-1 text-xs font-semibold text-ink-950">{title}</p>
      {children}
    </div>
  );
}

/** Yan panel satırı: etiket + tam ₺/metin değer (kısaltma yok, en çok 2 satır). */
export function WizardStat({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex min-h-7 items-baseline gap-3 px-1 text-xs">
      <span className="shrink-0 text-text-muted">{label}</span>
      <span
        title={value}
        className={cn(
          "numeric line-clamp-2 min-w-0 flex-1 break-words text-right",
          strong ? "text-sm font-bold text-ink-950" : "font-medium",
          muted ? "text-text-faint" : !strong && "text-ink-950",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Seçim kartı (radyo gibi): büyük dokunma hedefi, seçiliyken altın kenar. */
export function WizardChoice({
  name,
  value,
  checked,
  onChange,
  title,
  text,
  id,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: string;
  text?: string;
  id?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border bg-surface p-3 transition-colors duration-(--motion-fast) motion-reduce:transition-none",
        checked ? "border-[var(--gold-400)] bg-[color-mix(in_srgb,var(--gold-300)_10%,var(--surface))]" : "border-line hover:border-[color-mix(in_srgb,var(--gold-400)_60%,transparent)]",
      )}
    >
      <input id={id} type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="mt-1 accent-[var(--gold-500)]" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-950">{title}</span>
        {text ? <span className="mt-0.5 block text-xs text-text-muted">{text}</span> : null}
      </span>
    </label>
  );
}

/** Onay kutusu satırı: 44px hedef, başlık + açıklama + satır içi hata (adım içi tek tip). */
export function WizardCheckbox({
  id,
  checked,
  onChange,
  title,
  text,
  error,
  tone = "neutral",
  className,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: ReactNode;
  text?: ReactNode;
  error?: string;
  /** "mint": yetki/onay gibi olumlu kanıt kutusu. */
  tone?: "neutral" | "mint";
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2.5 text-sm",
        tone === "mint" ? "border-mint-500/25 bg-mint-500/5" : "border-line",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-invalid={error ? true : undefined}
        className={cn("mt-0.5 touch:h-5 touch:w-5", tone === "mint" ? "accent-mint-600" : "accent-[var(--gold-500)]")}
      />
      <span className="min-w-0">
        <span className={cn("block font-semibold", tone === "mint" ? "text-mint-700" : "text-ink-950")}>{title}</span>
        {text ? <span className="mt-0.5 block text-xs text-text-muted">{text}</span> : null}
        {error ? <span className="mt-0.5 block text-xs font-medium text-danger-600">{error}</span> : null}
      </span>
    </label>
  );
}
