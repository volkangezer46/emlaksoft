"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { FormEventHandler, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-controls";
import { FormActions } from "@/components/ui/form-page";
import { PageHeader } from "@/components/ui/page-header";
import type { BreadcrumbItem } from "@/components/ui/breadcrumb";
import type { NextStep } from "@/lib/form-logic";
import { useFormDraft, type FormDraftConfig } from "@/components/app/use-form-draft";
import { useFormValues } from "@/components/app/use-form-values";
import { now } from "@/lib/clock";
import {
  computeTabState,
  formatClock,
  formatDraftTime,
  isTabNavKey,
  neighborTabId,
  nextTabId,
  progressSummary,
  resolveInitialTab,
  type FormValues,
  type TabState,
} from "@/lib/form-tabs";
import { cn } from "@/lib/utils";

/**
 * TabbedFormShell — "Yeni X" formlarının sekmeli masaüstü deneyimi
 * (şartname: docs/design/FORMS_SPEC.md, kullanım: docs/DESIGN_SYSTEM.md "Sekmeli formlar").
 *
 * Masaüstü (>=1024px): solda dikey sekme rayı, ortada aktif panel (+ Önceki/Sonraki),
 * >=1280px sağda yapışkan "Özet ve önizleme". Altta yapışkan eylem çubuğu.
 * Dar ekranda: yatay kaydırılan sekme şeridi, tek sütun, özet `<details>` içinde.
 *
 * Form bütünlüğü: TEK `<form>`; tüm paneller DOM'da kalır (pasifler `hidden`) ve gönderilir.
 * Gizli sekmedeki geçersiz/zorunlu alan: `invalid` olayı yakalanır, ilk bozuk sekme açılıp alana odaklanılır.
 * Sunucu action'ı, doğrulama ve yetki değişmez: yalnız yerleşimdir.
 */

export type FormTab = {
  /** Kararlı kimlik; `?sekme=` derin bağlantısı ve DOM id'leri için ("temel"). */
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Panel başlığının altındaki açıklama. */
  description?: string;
  /** Bu sekmedeki TÜM alan name'leri (sözleşme testi form kaynağıyla eşler). */
  fields: string[];
  /** Zorunlu alan name'leri (fields alt kümesi) -> tamamlanma + eksik listesi. */
  required?: string[];
  /** Sunucu hatasından eşlenen ek hata sayısı (isteğe bağlı). */
  errorCount?: number;
};

export type TabbedSummaryContext = {
  /** Tüm sekme alanlarının canlı değerleri (yalnız tabs[].fields içindekiler). */
  values: FormValues;
  tabStates: Record<string, TabState>;
  activeTab: string;
  /** Sekmeye geç; `field` verilirse o alana odaklan. */
  goToTab: (tabId: string, field?: string) => void;
};

type ShellContextValue = Pick<TabbedSummaryContext, "goToTab">;
const ShellContext = createContext<ShellContextValue | null>(null);

export type TabbedFormShellProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  breadcrumbs?: BreadcrumbItem[];
  headerActions?: ReactNode;
  cancelHref: string;
  submitLabel: string;
  pendingLabel?: string;
  submitIcon?: LucideIcon;
  submitDisabled?: boolean;
  pending: boolean;
  error?: string | null;
  errorNextStep?: NextStep | null;
  /** Hata dışı uyarı bandı (hatanın altı, eylem çubuğunun üstü). */
  notice?: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;

  /** 2–5 sekme. Sıra = ray sırası. */
  tabs: FormTab[];
  /** Sekme id -> panel içeriği. İçerik `FormField`'lar; ızgara (2 sütun) kabuktan gelir. */
  tabPanels: Record<string, ReactNode>;
  /**
   * Sağ "Özet ve önizleme" içeriği. Fonksiyon verilirse canlı değerlerle çağrılır.
   * İçine FORM KONTROLÜ koyma (iki yerde render edilir: sağ panel + dar ekran `<details>`).
   * Telefon/e-posta gibi kişisel veri gösterme.
   */
  summary?: ReactNode | ((ctx: TabbedSummaryContext) => ReactNode);
  /** Eksik zorunlu alan listesinde gösterilecek etiketler (name -> "Ad soyad"). */
  fieldLabels?: Record<string, string>;
  /** Verilirse taslak açılır: { userId, formId, fields: beyaz liste }. */
  draft?: FormDraftConfig;
  initialTab?: string;
  /** "single": sekmesiz eski görünüm (paneller alt alta). Varsayılan "auto". */
  layout?: "auto" | "single";
  className?: string;
};

const DESKTOP_QUERY = "(min-width: 1024px)";
function subscribeDesktop(cb: () => void) {
  const m = window.matchMedia(DESKTOP_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const getDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const getDesktopServer = () => false;

const FIELD_SELECTOR =
  "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])";

export function TabbedFormShell({
  title,
  description,
  eyebrow,
  breadcrumbs,
  headerActions,
  cancelHref,
  submitLabel,
  pendingLabel,
  submitIcon,
  submitDisabled,
  pending,
  error,
  errorNextStep,
  notice,
  onSubmit,
  tabs,
  tabPanels,
  summary,
  fieldLabels,
  draft,
  initialTab,
  layout = "auto",
  className,
}: TabbedFormShellProps) {
  const uid = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabsRef = useRef(tabs);
  const ids = useMemo(() => tabs.map((t) => t.id), [tabs]);
  const tabbed = layout !== "single";
  const isDesktop = useSyncExternalStore(subscribeDesktop, getDesktop, getDesktopServer);

  const [active, setActive] = useState(() => resolveInitialTab(ids, initialTab));
  const [errorCounts, setErrorCounts] = useState<Record<string, number>>({});
  const attemptedRef = useRef(false);
  const mountedRef = useRef(false);
  const selectRef = useRef<(id: string, o?: { focus?: "tab" | "field" | "none" }) => void>(() => {});
  const activeRef = useRef(active);

  useEffect(() => {
    tabsRef.current = tabs;
    activeRef.current = active;
  });

  const fieldNames = useMemo(() => Array.from(new Set(tabs.flatMap((t) => t.fields))), [tabs]);
  const values = useFormValues(formRef, fieldNames);
  const tabStates = useMemo(() => {
    const out: Record<string, TabState> = {};
    for (const t of tabs) out[t.id] = computeTabState(t, values);
    return out;
  }, [tabs, values]);
  const progress = useMemo(() => progressSummary(tabs, values), [tabs, values]);

  const draftApi = useFormDraft(formRef, draft);
  const wasPending = useRef(false);
  const { clear: clearDraft } = draftApi;
  useEffect(() => {
    // Gönderim bitti ve hata yok -> başarılı kayıt: taslağı sil.
    if (wasPending.current && !pending && !error) clearDraft();
    wasPending.current = pending;
  }, [pending, error, clearDraft]);

  const focusFirstField = useCallback((id: string) => {
    requestAnimationFrame(() => {
      const panel = formRef.current?.querySelector<HTMLElement>(`[data-tfs-panel="${id}"]`);
      panel?.querySelector<HTMLElement>(FIELD_SELECTOR)?.focus();
    });
  }, []);

  const select = useCallback(
    (id: string, opts?: { focus?: "tab" | "field" | "none" }) => {
      if (!ids.includes(id)) return;
      setActive(id);
      try {
        const url = new URL(window.location.href);
        if (id === ids[0]) url.searchParams.delete("sekme");
        else url.searchParams.set("sekme", id);
        window.history.replaceState(window.history.state, "", url);
      } catch {
        /* derin bağlantı yazılamadı — sessiz */
      }
      if (opts?.focus === "tab") requestAnimationFrame(() => tabRefs.current[id]?.focus());
      else if (opts?.focus === "field") focusFirstField(id);
    },
    [ids, focusFirstField],
  );
  useEffect(() => {
    selectRef.current = select;
  }, [select]);

  const goToTab = useCallback(
    (tabId: string, field?: string) => {
      select(tabId, { focus: field ? "none" : "field" });
      if (!field) return;
      requestAnimationFrame(() => {
        const el = formRef.current?.elements.namedItem(field);
        if (el instanceof HTMLElement && !el.closest("[hidden]")) el.focus();
        else if (el instanceof HTMLElement) requestAnimationFrame(() => el.focus());
      });
    },
    [select],
  );

  // Derin bağlantı: ?sekme= (hidratasyon uyuşmazlığı olmasın diye mount sonrası).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const wanted = new URLSearchParams(window.location.search).get("sekme");
        if (wanted && ids.includes(wanted)) setActive(wanted);
      } catch {
        /* sessiz */
      }
    });
    return () => cancelAnimationFrame(frame);
    // yalnız bağlanırken
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dar ekranda aktif sekmeyi şeritte ortala.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!isDesktop) tabRefs.current[active]?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active, isDesktop]);

  // Hata sayıları: yalnız ilk gönderim denemesinden sonra, DOM'daki :invalid alanlardan.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    let frame = 0;
    let handled = false;
    let reporting = false;
    const measure = () => {
      frame = 0;
      if (!attemptedRef.current) return;
      const next: Record<string, number> = {};
      for (const t of tabsRef.current) {
        const panel = form.querySelector(`[data-tfs-panel="${t.id}"]`);
        next[t.id] = panel ? panel.querySelectorAll(":invalid").length : 0;
      }
      setErrorCounts((prev) => {
        const keys = Object.keys(next);
        return keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k]) ? prev : next;
      });
    };
    const scheduleMeasure = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const focusWhenVisible = (el: HTMLElement, tries = 0) => {
      requestAnimationFrame(() => {
        if (el.closest("[hidden]") && tries < 5) {
          focusWhenVisible(el, tries + 1);
          return;
        }
        el.focus();
        reporting = true;
        try {
          (el as HTMLInputElement).reportValidity?.();
        } finally {
          reporting = false;
        }
      });
    };
    const onInvalid = (e: Event) => {
      if (reporting) return; // kendi reportValidity çağrımız: tarayıcı balonu çıksın
      e.preventDefault(); // gizli alanda "not focusable" hatasını ve çift balonu önle
      attemptedRef.current = true;
      scheduleMeasure();
      if (handled) return;
      handled = true;
      setTimeout(() => {
        handled = false;
      }, 0);
      const el = e.target as HTMLElement;
      const tabId = el.closest("[data-tfs-panel]")?.getAttribute("data-tfs-panel");
      if (tabId && tabbed) selectRef.current(tabId, { focus: "none" });
      focusWhenVisible(el);
    };
    form.addEventListener("invalid", onInvalid, true);
    form.addEventListener("input", scheduleMeasure);
    form.addEventListener("change", scheduleMeasure);
    return () => {
      form.removeEventListener("invalid", onInvalid, true);
      form.removeEventListener("input", scheduleMeasure);
      form.removeEventListener("change", scheduleMeasure);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [tabbed]);

  function onFormKeyDown(e: ReactKeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      if (!pending && !submitDisabled) formRef.current?.requestSubmit();
      return;
    }
    if (tabbed && e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      select(nextTabId(ids, activeRef.current, e.key), { focus: "field" });
    }
  }

  function onTabKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || !isTabNavKey(e.key)) return;
    e.preventDefault();
    select(nextTabId(ids, activeRef.current, e.key), { focus: "tab" });
  }

  // Özet fonksiyonu ayrı bileşende çağrılır (goToTab bağlamdan gelir): React Compiler "ref render'da okunuyor" uyarısını önler.
  const summaryNode =
    typeof summary === "function" ? (
      <SummarySlot render={summary} values={values} tabStates={tabStates} activeTab={active} />
    ) : (
      summary
    );
  const missingList = tabs.flatMap((t) =>
    (tabStates[t.id]?.missing ?? []).map((name) => ({ tab: t, name, label: fieldLabels?.[name] ?? name })),
  );
  const hasSide = Boolean(summaryNode) || missingList.length > 0 || progress.total > 0;

  const summaryBody = (
    <div className="space-y-4">
      {progress.total > 0 ? (
        <div>
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold text-ink-950">İlerleme</span>
            <span className="numeric text-text-muted">{progress.done}/{progress.total} bölüm tamam</span>
          </div>
          <div
            role="progressbar"
            aria-label="Form ilerlemesi"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-canvas"
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-150 motion-reduce:transition-none"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : null}
      {summaryNode ? <div className="space-y-3">{summaryNode}</div> : null}
      {missingList.length > 0 ? (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink-950">Eksik zorunlu alanlar</p>
          <ul className="space-y-1">
            {missingList.map((m) => (
              <li key={`${m.tab.id}:${m.name}`}>
                <button
                  type="button"
                  onClick={() => goToTab(m.tab.id, m.name)}
                  className="focus-ring flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-xs text-text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink-950"
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning-strong" />
                  <span className="min-w-0 flex-1 truncate">{m.label}</span>
                  <span className="shrink-0 text-text-faint">{m.tab.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  const statusText = draftApi.savedAt ? `Taslak kaydedildi ${formatClock(draftApi.savedAt)}` : null;
  const prevId = neighborTabId(ids, active, -1);
  const nextId = neighborTabId(ids, active, 1);
  const prevTab = tabs.find((t) => t.id === prevId);
  const nextTab = tabs.find((t) => t.id === nextId);

  return (
    <ShellContext.Provider value={{ goToTab }}>
      <form ref={formRef} onSubmit={onSubmit} onKeyDown={onFormKeyDown} className="tfs-form">
        <div className={cn("mx-auto w-full max-w-[80rem]", className)}>
          <PageHeader title={title} description={description} eyebrow={eyebrow} breadcrumbs={breadcrumbs} actions={headerActions} />

          {draftApi.restorable && draftApi.restorableAt ? (
            <div
              role="status"
              className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-card)] border border-brand-300/40 bg-brand-600/5 px-4 py-3 text-sm"
            >
              <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-brand-600" />
              <p className="min-w-0 flex-1 text-ink-950">
                Bu formda {formatDraftTime(draftApi.restorableAt, now())} tarihli bir taslak var.
                <span className="text-text-muted"> Yalnız hassas olmayan alanlar saklanır (ad, telefon, not gibi veriler değil).</span>
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" icon={RotateCcw} onClick={draftApi.restore}>Taslağı geri yükle</Button>
                <Button type="button" size="sm" variant="secondary" icon={Trash2} onClick={draftApi.discard}>Sil</Button>
              </div>
            </div>
          ) : null}

          <div
            className={cn(
              tabbed && "lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-6",
              tabbed && hasSide && "xl:grid-cols-[14rem_minmax(0,1fr)_20rem]",
            )}
          >
            {tabbed ? (
              <div className="mb-4 lg:sticky lg:top-20 lg:mb-0 lg:self-start">
                <div className="relative rounded-[var(--radius-card)] border border-line bg-surface p-2 shadow-[var(--elev-1)]">
                  <p className="hidden px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-text-faint lg:block">Bölümler</p>
                  <div
                    role="tablist"
                    aria-label="Form bölümleri"
                    aria-orientation={isDesktop ? "vertical" : "horizontal"}
                    onKeyDown={onTabKeyDown}
                    className="flex snap-x gap-1 overflow-x-auto [scrollbar-width:none] lg:flex-col lg:overflow-visible [&::-webkit-scrollbar]:hidden"
                  >
                    {tabs.map((t) => {
                      const selected = t.id === active;
                      const st = tabStates[t.id];
                      const errors = (errorCounts[t.id] ?? 0) + (t.errorCount ?? 0);
                      const Icon = t.icon;
                      const hint =
                        errors > 0
                          ? `${errors} hatalı alan`
                          : st?.status === "missing"
                            ? `${st.missing.length} zorunlu alan eksik`
                            : st?.status === "complete"
                              ? "Tamamlandı"
                              : "";
                      return (
                        <button
                          key={t.id}
                          ref={(el) => {
                            tabRefs.current[t.id] = el;
                          }}
                          type="button"
                          role="tab"
                          id={`${uid}-tab-${t.id}`}
                          aria-selected={selected}
                          aria-controls={`${uid}-panel-${t.id}`}
                          aria-describedby={hint ? `${uid}-hint-${t.id}` : undefined}
                          tabIndex={selected ? 0 : -1}
                          onClick={() => select(t.id)}
                          className="focus-ring relative flex min-h-11 shrink-0 snap-start items-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] px-3 py-2 text-left text-sm font-medium text-text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink-950 aria-selected:bg-brand-600/10 aria-selected:font-semibold aria-selected:text-brand-700 lg:w-full lg:whitespace-normal"
                        >
                          {selected ? (
                            <span aria-hidden="true" className="absolute inset-y-2 left-0 hidden w-0.5 rounded-full bg-brand-600 lg:block" />
                          ) : null}
                          {Icon ? <Icon aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
                          <span className="min-w-0 flex-1">{t.label}</span>
                          {errors > 0 ? (
                            <span aria-hidden="true" className="numeric min-w-5 rounded-full bg-danger-soft px-1.5 text-center text-xs font-semibold text-danger-strong">
                              {errors}
                            </span>
                          ) : st?.status === "complete" ? (
                            <span aria-hidden="true" className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success-soft text-success-strong">
                              <Check className="h-3 w-3" strokeWidth={3} />
                            </span>
                          ) : st?.status === "missing" ? (
                            <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-warning-strong" />
                          ) : null}
                          {hint ? <span id={`${uid}-hint-${t.id}`} className="sr-only">{hint}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                  {progress.total > 0 ? (
                    <p className="numeric px-2 pb-1 pt-2 text-xs text-text-muted" aria-live="polite">
                      {progress.done}/{progress.total} bölüm tamam
                    </p>
                  ) : null}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-2 right-2 w-6 rounded-r-[var(--radius-control)] bg-gradient-to-l from-surface to-transparent lg:hidden"
                  />
                </div>
              </div>
            ) : null}

            <div className="min-w-0 space-y-4">
              {tabs.map((t) => {
                const selected = !tabbed || t.id === active;
                const Icon = t.icon;
                return (
                  <section
                    key={t.id}
                    role={tabbed ? "tabpanel" : undefined}
                    id={`${uid}-panel-${t.id}`}
                    aria-labelledby={tabbed ? `${uid}-tab-${t.id}` : undefined}
                    aria-label={tabbed ? undefined : t.label}
                    tabIndex={tabbed ? 0 : undefined}
                    hidden={!selected}
                    data-tfs-panel={t.id}
                    className={cn(
                      "focus-ring rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-sm)]",
                      tabbed && "tfs-panel",
                    )}
                  >
                    <div className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
                      {Icon ? (
                        <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-700">
                          <Icon className="h-4 w-4" />
                        </span>
                      ) : null}
                      <div className="min-w-0">
                        <h2 className="font-display text-base font-semibold text-ink-950">{t.label}</h2>
                        {t.description ? <p className="mt-0.5 text-sm text-text-muted">{t.description}</p> : null}
                      </div>
                    </div>
                    <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">{tabPanels[t.id]}</div>
                  </section>
                );
              })}

              {tabbed && (prevTab || nextTab) ? (
                <div className="flex items-center justify-between gap-2">
                  {prevTab ? (
                    <Button type="button" variant="secondary" icon={ChevronLeft} onClick={() => select(prevTab.id, { focus: "field" })}>
                      Önceki<span className="sr-only">: {prevTab.label}</span>
                    </Button>
                  ) : <span />}
                  {nextTab ? (
                    <Button type="button" variant="secondary" iconRight={ChevronRight} onClick={() => select(nextTab.id, { focus: "field" })}>
                      Sonraki: {nextTab.label}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {hasSide ? (
                <details className="group rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm shadow-[var(--shadow-sm)] xl:hidden">
                  <summary className="focus-ring flex cursor-pointer list-none items-center gap-2 rounded-[var(--radius-control)] font-semibold text-ink-950">
                    <Sparkles aria-hidden="true" className="h-4 w-4 text-brand-600" /> Özet ve önizleme
                    <ChevronRight aria-hidden="true" className="ml-auto h-4 w-4 text-text-faint transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
                  </summary>
                  <div className="mt-3">{summaryBody}</div>
                </details>
              ) : null}

              <FormError error={error} nextStep={errorNextStep} />
              {notice}
            </div>

            {tabbed && hasSide ? (
              <aside
                aria-label="Özet ve önizleme"
                className="hidden rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm shadow-[var(--elev-1)] xl:sticky xl:top-20 xl:block xl:self-start"
              >
                <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-ink-950">
                  <Sparkles aria-hidden="true" className="h-4 w-4 text-brand-600" /> Özet ve önizleme
                </h2>
                {summaryBody}
              </aside>
            ) : null}
          </div>

          {!tabbed ? (
            <div className="mt-4 space-y-4">
              <FormError error={error} nextStep={errorNextStep} />
              {notice}
            </div>
          ) : null}

          <FormActions className="mt-4">
            <p aria-live="polite" className="mr-auto hidden min-w-0 truncate text-xs text-text-faint sm:block">
              {statusText ?? (
                <>
                  <kbd className="rounded border border-line bg-canvas px-1 font-sans">Ctrl</kbd>
                  {" + "}
                  <kbd className="rounded border border-line bg-canvas px-1 font-sans">Enter</kbd> ile kaydet
                  {tabbed ? (
                    <>
                      {" · "}
                      <kbd className="rounded border border-line bg-canvas px-1 font-sans">Alt</kbd>
                      {" + "}
                      <kbd className="rounded border border-line bg-canvas px-1 font-sans">↑↓</kbd> sekme
                    </>
                  ) : null}
                </>
              )}
            </p>
            <ButtonLink href={cancelHref} variant="secondary">İptal</ButtonLink>
            <Button type="submit" loading={pending} disabled={submitDisabled} icon={submitIcon}>
              {pending && pendingLabel ? pendingLabel : submitLabel}
            </Button>
          </FormActions>
        </div>
      </form>
    </ShellContext.Provider>
  );
}

function SummarySlot({
  render,
  values,
  tabStates,
  activeTab,
}: {
  render: (ctx: TabbedSummaryContext) => ReactNode;
  values: FormValues;
  tabStates: Record<string, TabState>;
  activeTab: string;
}) {
  const shell = useContext(ShellContext);
  const goToTab = shell?.goToTab ?? (() => {});
  return <>{render({ values, tabStates, activeTab, goToTab })}</>;
}

/** Özet satırı: etiket + gerçek değer; `tab` verilirse tıklanınca o sekmeye (ve `field`'a) götürür. */
export function SummaryRow({
  label,
  value,
  tab,
  field,
  muted,
}: {
  label: string;
  value: ReactNode;
  tab?: string;
  field?: string;
  /** Değer yoksa soluk "—" gösterimi. */
  muted?: boolean;
}) {
  const shell = useContext(ShellContext);
  const inner = (
    <>
      <span className="shrink-0 text-text-muted">{label}</span>
      <span className={cn("min-w-0 flex-1 truncate text-right font-medium", muted ? "text-text-faint" : "text-ink-950")}>{value}</span>
    </>
  );
  if (tab && shell) {
    return (
      <button
        type="button"
        onClick={() => shell.goToTab(tab, field)}
        className="focus-ring flex min-h-8 w-full items-baseline gap-3 rounded-[var(--radius-control)] px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-canvas"
      >
        {inner}
      </button>
    );
  }
  return <div className="flex min-h-8 items-baseline gap-3 px-2 py-1 text-xs">{inner}</div>;
}

/** Özet içinde başlıklı küçük grup (önizleme kartı, hesap bloğu...). */
export function SummaryGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-line bg-canvas/60 p-2">
      {title ? <p className="px-2 pb-1 text-xs font-semibold text-ink-950">{title}</p> : null}
      {children}
    </div>
  );
}
