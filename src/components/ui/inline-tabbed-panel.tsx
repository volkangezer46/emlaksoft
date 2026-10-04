"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { TriangleAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormActionBar } from "@/components/ui/form-action-bar";
import { MorphTabs, type MorphTabItem } from "@/components/ui/morph-tabs";
import { useFormFields } from "@/components/app/use-form-fields";
import { useFormDraft, type FormDraftConfig } from "@/components/app/use-form-draft";
import { isDirty, serializeEntries } from "@/lib/form-dirty";
import { cn } from "@/lib/utils";

/**
 * InlineTabbedPanel — kayıt EKLE/DÜZENLE akışları için sayfa içi gelişmiş sekme alanı (popup YOK).
 *
 * Modal/diyalog gibi ekranın üstüne binmez, arka planı kapatmaz: sayfanın en üstündeki
 * `#inline-panel-host` yuvasına (app layout'unda) normal akışta yerleşir, görünüme kaydırılır;
 * yuva yoksa tetikleyicinin yanında satır içi açılır. Aynı anda sayfa kullanılmaya devam eder.
 *
 * Davranış: MorphTabs sekmeleri (tüm paneller DOM'da kalır, pasifler `hidden`; tek `<form>`), >=5 alanlı
 * formda yazdıkça güncellenen "Canlı özet" (useFormFields; satıra tıklayınca ilgili sekme/alan), kaydedilmemiş
 * değişiklik koruması (kapatırken satır içi onay + sekmeyi terk uyarısı), Ctrl/⌘+Enter ile kaydet (kısayol ipucu FormActionBar’da), Esc ile kapat,
 * gizli sekmedeki geçersiz alanda sekmeyi açıp odaklanma, hata bandına odak, isteğe bağlı taslak (useFormDraft:
 * yalnız beyaz liste; telefon/e-posta/not saklanmaz). Mobilde tam genişlik tek sütun, özet altta.
 *
 * Sunucu action'ı/doğrulama/yetki DEĞİŞMEZ: bu bileşen yalnız kabuktur. Gönderim iki biçimde bağlanır:
 *  - `action`: `<form action>` (React 19 başarı/başarısızlıkta formu sıfırlar; mevcut action akışları için),
 *  - `onSubmit`: preventDefault + FormData (hatada alanlar korunur; tercih edilir).
 */

export type InlineTab = {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Bu sekmedeki özet için izlenecek alan name'leri (sıra = özet sırası). */
  fields: string[];
};

export const INLINE_PANEL_HOST_ID = "inline-panel-host";

type TriggerRender = (p: {
  open: boolean;
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
  "aria-expanded": boolean;
  "aria-controls": string;
}) => ReactNode;

export type InlineTabbedPanelProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  /** Tetikleyici düğme (render prop). Kontrollü modda (satır tıklaması vb.) verilmeyebilir. */
  trigger?: TriggerRender;
  /** Kontrollü mod. Verilmezse panel kendi açık/kapalı durumunu tutar. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tabs: InlineTab[];
  /** Sekme id -> panel içeriği (alanlar). Izgarayı panel verir (2 sütun, mobilde 1). */
  panels: Record<string, ReactNode>;
  /** Gizli input'lar (id, customer_id...). */
  hiddenFields?: ReactNode;
  /** Özet satırı etiket geçersiz kılmaları (name -> "Liste fiyatı"). */
  fieldLabels?: Record<string, string>;
  /** true/false zorlar; varsayılan: toplam izlenen alan >= 5. */
  summary?: boolean;
  /** Özetin altına eklenen sabit içerik (içine form kontrolü koyma). */
  summaryExtra?: ReactNode;
  action?: (formData: FormData) => void;
  onSubmit?: (formData: FormData) => void;
  pending?: boolean;
  error?: string | null;
  /** Hata dışı uyarı (ör. çakışma freni bandı). */
  notice?: ReactNode;
  submitLabel?: string;
  pendingLabel?: string;
  /** Kaydet düğmesinin etiketini geçersiz kılar (ör. "Yine de kaydet"). */
  submitLabelOverride?: string;
  /** Başarı göstergesi (kısa süre "Kaydedildi"). */
  success?: boolean;
  /** Taslak yapılandırması (yeni kayıt akışları; düzenlemede genelde yok). */
  draft?: FormDraftConfig;
  className?: string;
};

const FIELD_SELECTOR =
  "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [role=combobox]:not([disabled])";

export function InlineTabbedPanel(props: InlineTabbedPanelProps) {
  const { trigger, open: openProp, onOpenChange } = props;
  const [inner, setInner] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : inner;
  const uid = useId();
  const panelId = `ip-${uid.replace(/:/g, "")}`;

  function setOpen(next: boolean) {
    if (controlled) onOpenChange?.(next);
    else setInner(next);
  }

  const body = open ? (
    <PanelBody {...props} panelId={panelId} onRequestClose={() => setOpen(false)} />
  ) : null;
  const host = open && typeof document !== "undefined" ? document.getElementById(INLINE_PANEL_HOST_ID) : null;

  return (
    <>
      {trigger?.({
        open,
        onClick: (e) => {
          e.stopPropagation();
          setOpen(!open);
        },
        "aria-expanded": open,
        "aria-controls": panelId,
      })}
      {body && host ? createPortal(body, host) : body}
    </>
  );
}

function PanelBody({
  panelId,
  title,
  description,
  icon,
  tabs,
  panels,
  hiddenFields,
  fieldLabels,
  summary,
  summaryExtra,
  action,
  onSubmit,
  pending = false,
  error,
  notice,
  submitLabel = "Kaydet",
  pendingLabel = "Kaydediliyor…",
  submitLabelOverride,
  success,
  draft,
  className,
  onRequestClose,
}: InlineTabbedPanelProps & { panelId: string; onRequestClose: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef<string | null>(null);
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const [dirty, setDirty] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const fieldNames = useMemo(() => Array.from(new Set(tabs.flatMap((t) => t.fields))), [tabs]);
  const info = useFormFields(formRef, fieldNames);
  const draftApi = useFormDraft(formRef, draft);
  const showSummary = summary ?? fieldNames.length >= 5;
  const tabbed = tabs.length > 1;

  const morphItems = useMemo<MorphTabItem[]>(
    () => tabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon })),
    [tabs],
  );

  function snapshot(): string {
    const form = formRef.current;
    return form ? serializeEntries(new FormData(form).entries()) : "[]";
  }

  // Açılış: görünüme kaydır, ilk alana odaklan, başlangıç görüntüsünü al.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      initialRef.current = snapshot();
      const el = sectionRef.current;
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      el?.querySelector<HTMLElement>("[data-ip-panel]:not([hidden])")
        ?.querySelector<HTMLElement>(FIELD_SELECTOR)
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Kirlilik: yalnız kullanıcı etkileşiminden (isTrusted) sonra karşılaştır.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const check = (e: Event) => {
      if (!e.isTrusted) return;
      const d = isDirty(initialRef.current, snapshot());
      setDirty((prev) => (prev === d ? prev : d));
    };
    const events = ["input", "change", "click", "keyup"] as const;
    for (const ev of events) form.addEventListener(ev, check);
    return () => {
      for (const ev of events) form.removeEventListener(ev, check);
    };
  }, []);

  // Kirliyken sekmeyi/pencereyi kapatma uyarısı.
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // Gizli sekmedeki geçersiz alan: sekmeyi aç, alana odaklan.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onInvalid = (e: Event) => {
      const el = e.target as HTMLElement;
      const tab = el.closest("[data-ip-panel]")?.getAttribute("data-ip-panel");
      if (tab && tab !== active) {
        setActive(tab);
        requestAnimationFrame(() => el.focus());
      }
    };
    form.addEventListener("invalid", onInvalid, true);
    return () => form.removeEventListener("invalid", onInvalid, true);
  }, [active]);

  // Sunucu hatası: hata bandına odak.
  useEffect(() => {
    if (!error) return;
    errorRef.current?.focus({ preventScroll: false });
  }, [error]);

  // Başarılı kayıtta taslağı temizle (pending bitti, hata yok).
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending && !error) draftApi.clear();
    wasPending.current = pending;
  }, [pending, error, draftApi]);

  function requestClose() {
    if (dirty && !pending) setConfirmLeave(true);
    else onRequestClose();
  }

  function goTo(tab: string, field?: string) {
    setActive(tab);
    requestAnimationFrame(() => {
      const panel = formRef.current?.querySelector<HTMLElement>(`[data-ip-panel="${tab}"]`);
      const target = field ? panel?.querySelector<HTMLElement>(`[name="${CSS.escape(field)}"]`) : null;
      (target ?? panel?.querySelector<HTMLElement>(FIELD_SELECTOR))?.focus();
    });
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    e.stopPropagation();
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey) {
      e.preventDefault();
      if (!pending) formRef.current?.requestSubmit();
      return;
    }
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      requestClose();
    }
  }

  const formProps = onSubmit
    ? {
        onSubmit: (e: React.FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          if (pending) return;
          onSubmit(new FormData(e.currentTarget));
        },
      }
    : { action };

  // Zorunlu (required) alanlar: boş olanlar "N zorunlu alan eksik" sayacına ve ilerleme çizgisine girer.
  const [required, setRequired] = useState<{ total: number; missing: { name: string; label: string; tab: string }[] }>({ total: 0, missing: [] });
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const frame = requestAnimationFrame(() => {
      const missing: { name: string; label: string; tab: string }[] = [];
      let total = 0;
      const seen = new Set<string>();
      form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[required]").forEach((el) => {
        if (!el.name || el.disabled || seen.has(el.name)) return;
        seen.add(el.name);
        total += 1;
        const box = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
        const empty = box ? !(el as HTMLInputElement).checked : !el.value.trim();
        if (!empty) return;
        const label = (info[el.name]?.label ?? el.getAttribute("aria-label") ?? el.name) || el.name;
        missing.push({ name: el.name, label, tab: el.closest("[data-ip-panel]")?.getAttribute("data-ip-panel") ?? tabs[0]?.id ?? "" });
      });
      setRequired((prev) =>
        prev.total === total && prev.missing.length === missing.length && prev.missing.every((m, i) => m.name === missing[i].name)
          ? prev
          : { total, missing },
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [info, tabs]);

  const summaryRows = tabs.map((t) => ({ tab: t, rows: t.fields.filter((f) => info[f]) }));
  const filled = fieldNames.filter((f) => info[f]?.text != null).length;
  const total = fieldNames.filter((f) => info[f]).length;

  const summaryNode = showSummary ? (
    <aside aria-label="Canlı özet" className="rounded-[var(--radius-card)] border border-line bg-canvas/50 p-3 lg:sticky lg:top-4 lg:self-start">
      <div className="flex items-baseline justify-between px-1 pb-2 text-xs">
        <span className="font-semibold text-ink-950">Canlı özet</span>
        <span className="numeric text-text-muted" aria-live="polite">{filled}/{total} alan dolu</span>
      </div>
      <div
        role="progressbar"
        aria-label="Doldurulan alanlar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={filled}
        className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface"
      >
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] duration-(--motion-fast) motion-reduce:transition-none"
          style={{ width: `${total ? (filled / total) * 100 : 0}%` }}
        />
      </div>
      <div className="space-y-2">
        {summaryRows.map(({ tab, rows }) =>
          rows.length === 0 ? null : (
            <div key={tab.id}>
              {tabbed ? <p className="px-1 pb-0.5 text-xs font-semibold uppercase tracking-wide text-text-faint">{tab.label}</p> : null}
              {rows.map((f) => {
                const i = info[f];
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => goTo(tab.id, f)}
                    className="focus-ring flex min-h-8 w-full items-baseline gap-3 rounded-[var(--radius-control)] px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface"
                  >
                    <span className="shrink-0 text-text-muted">{fieldLabels?.[f] ?? i.label ?? f}</span>
                    <span
                      title={i.text ?? undefined}
                      className={cn("line-clamp-3 min-w-0 flex-1 break-words text-right font-medium", i.text == null ? "text-text-faint" : "text-ink-950")}
                    >
                      {i.text ?? "Girilmedi"}
                    </span>
                  </button>
                );
              })}
            </div>
          ),
        )}
      </div>
      {summaryExtra ? <div className="mt-2 border-t border-line pt-2">{summaryExtra}</div> : null}
    </aside>
  ) : null;

  return (
    <section
      ref={sectionRef}
      id={panelId}
      aria-labelledby={`${panelId}-title`}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "mb-4 w-full overflow-hidden rounded-[var(--radius-panel)] border border-brand-300 bg-surface shadow-[var(--elev-2)]",
        className,
      )}
    >
      <header className="hairline-b flex items-start justify-between gap-4 px-4 py-4 md:px-6">
        <div className="flex items-center gap-3">
          {icon ? (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-50 text-brand-600 [&_svg]:h-5 [&_svg]:w-5">
              {icon}
            </span>
          ) : null}
          <div>
            <h2 id={`${panelId}-title`} className="font-display text-base font-bold text-ink-950">{title}</h2>
            {description ? <p className="text-xs text-text-muted">{description}</p> : null}
          </div>
        </div>
        <button
          type="button"
          onClick={requestClose}
          aria-label="Paneli kapat"
          className="focus-ring press grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-text-muted transition hover:bg-canvas hover:text-ink-950"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </header>

      <form ref={formRef} {...formProps} aria-busy={pending} className="p-4 md:p-6">
        {hiddenFields}

        {draftApi.restorable ? (
          <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-brand-300/40 bg-brand-600/5 px-4 py-2.5 text-sm">
            <p className="min-w-0 flex-1 text-ink-950">
              Kayıtlı bir taslak var.
              <span className="text-text-muted"> Yalnız hassas olmayan alanlar saklanır.</span>
            </p>
            <Button type="button" size="sm" onClick={draftApi.restore}>Geri yükle</Button>
            <Button type="button" size="sm" variant="secondary" onClick={draftApi.discard}>Sil</Button>
          </div>
        ) : null}

        {tabbed ? (
          <div className="mb-4">
            <MorphTabs
              items={morphItems}
              activeId={active}
              onSelect={(id) => setActive(id)}
              orientation="horizontal"
              label={`${title} bölümleri`}
              idPrefix={panelId}
              inactive="label"
            />
          </div>
        ) : null}

        <div className={cn("grid gap-5", showSummary && "lg:grid-cols-[minmax(0,1fr)_17rem]")}>
          <div className="min-w-0">
            {tabs.map((t) => (
              <div
                key={t.id}
                data-ip-panel={t.id}
                role={tabbed ? "tabpanel" : undefined}
                id={tabbed ? `${panelId}-panel-${t.id}` : undefined}
                aria-labelledby={tabbed ? `${panelId}-tab-${t.id}` : undefined}
                hidden={tabbed && t.id !== active}
                className="grid gap-4 sm:grid-cols-2"
              >
                {panels[t.id]}
              </div>
            ))}
          </div>
          {summaryNode}
        </div>

        {notice}
        {error ? (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-[var(--radius-control)] border border-danger-200 bg-danger-50/60 px-3 py-2 text-xs font-semibold text-danger-600 outline-none focus-visible:ring-2 focus-visible:ring-danger-500"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {confirmLeave ? (
          <div role="alertdialog" aria-label="Kaydedilmemiş değişiklikler" className="motion-enter mt-4 flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-amber-400/50 bg-amber-400/10 px-4 py-3 text-xs">
            <p className="min-w-0 flex-1 font-semibold text-amber-700">Kaydedilmemiş değişiklikler var. Yine de kapatılsın mı?</p>
            <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmLeave(false)}>Düzenlemeye dön</Button>
            <Button type="button" size="sm" variant="danger" onClick={onRequestClose}>Değişiklikleri at</Button>
          </div>
        ) : null}

        <FormActionBar
          mode="inline"
          formRef={formRef}
          pending={pending}
          error={error}
          success={success}
          dirty={dirty}
          submitLabel={submitLabelOverride ?? submitLabel}
          pendingLabel={pendingLabel}
          cancelLabel="Vazgeç"
          onCancel={requestClose}
          progress={required.total > 0 ? { done: required.total - required.missing.length, total: required.total } : null}
          missing={required.missing.map((m) => ({ label: m.label, onGo: () => goTo(m.tab, m.name) }))}
          draft={draft ? { savedAt: draftApi.savedAt, onSave: draftApi.saveNow } : null}
          shortcuts="save-esc"
          focusErrorBand={false}
        />
      </form>
    </section>
  );
}
