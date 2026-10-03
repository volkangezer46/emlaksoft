"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { AlertCircle, Check, CircleCheck, Loader2, Save, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { isDirty, serializeEntries } from "@/lib/form-dirty";
import { setSubmitIntent } from "@/lib/form-submit-intent";
import { formatClock } from "@/lib/form-tabs";
import { cn } from "@/lib/utils";

/**
 * FormActionBar — TÜM kayıt ekleme/düzenleme formlarının ortak alt eylem çubuğu
 * (TabbedFormShell, InlineTabbedPanel, FormShell). docs/DESIGN_SYSTEM.md "Kaydet/İptal çubuğu".
 *
 * Sol: durum rozeti (Kaydediliyor / Kaydedilemedi / Kaydedildi / Taslak kaydedildi hh:mm /
 * Kaydedilmemiş değişiklik) + zorunlu alan sayacı (tıklayınca ilk eksik alana gider; hepsi tamamsa
 * yeşil "Hepsi tamam") + kısayol ipucu. Üst kenarda ilerleme çizgisi.
 * Sağ: İptal (kirliyse SATIR İÇİ onay, popup yok), "Taslak kaydet", "Kaydet ve yenisini ekle", Kaydet
 * (yüklemede spinner, başarıda ✓ animasyonu, hatada sallanma + hata bandına odak).
 * Mobil: iki satır (durum / düğmeler), 44px düğmeler, safe-area, alt gezinmenin üstünde yapışır;
 * ekran klavyesi açıkken akışa döner. Sunucu action'ı ve doğrulama DEĞİŞMEZ: yalnız kabuktur.
 */

/** Kullanıcı etkileşiminden sonra form değişti mi (kaydedilmemiş değişiklik)? `disabled`: başarıdan sonra susar. */
export function useFormDirty(formRef: RefObject<HTMLFormElement | null>, disabled = false): boolean {
  const [dirty, setDirty] = useState(false);
  const initialRef = useRef<string | null>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const snap = () => serializeEntries(new FormData(form).entries());
    const frame = requestAnimationFrame(() => {
      initialRef.current = snap();
    });
    const check = (e: Event) => {
      if (!e.isTrusted) return;
      const d = isDirty(initialRef.current, snap());
      setDirty((prev) => (prev === d ? prev : d));
    };
    const events = ["input", "change", "click", "keyup"] as const;
    for (const ev of events) form.addEventListener(ev, check);
    return () => {
      cancelAnimationFrame(frame);
      for (const ev of events) form.removeEventListener(ev, check);
    };
  }, [formRef]);

  const active = dirty && !disabled;

  // Kirliyken sekmeyi/pencereyi kapatma uyarısı.
  useEffect(() => {
    if (!active) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [active]);

  return active;
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

export type MissingField = { label: string; onGo: () => void };

export type FormActionBarProps = {
  formRef: RefObject<HTMLFormElement | null>;
  pending: boolean;
  error?: string | null;
  /** Dışarıdan zorlanan başarı durumu (verilmezse pending→bitti+hatasız ile kendisi anlar). */
  success?: boolean;
  dirty: boolean;
  submitLabel: string;
  pendingLabel?: string;
  submitIcon?: LucideIcon;
  submitDisabled?: boolean;
  /** Yıkıcı eylem: Kaydet kırmızı olur. */
  destructive?: boolean;
  /** İptal: href (kirliyse satır içi onay) veya onCancel (çağıran kendi onayını yönetir). */
  cancelHref?: string;
  onCancel?: () => void;
  cancelLabel?: string;
  /** İlerleme çizgisi + "Hepsi tamam" için. */
  progress?: { done: number; total: number } | null;
  /** Eksik zorunlu alanlar; ilki sayaçta tıklanınca gidilir. */
  missing?: MissingField[];
  /** Taslak desteği: son kayıt zamanı (ms) + "Taslak kaydet". */
  draft?: { savedAt: number | null; onSave: () => void } | null;
  /** "Kaydet ve yenisini ekle" (yalnız useCreateForm'lu formlar). */
  saveAndNew?: boolean;
  /** Klavye kısayol ipucu. */
  shortcuts?: "save" | "save-tabs" | "save-esc" | false;
  /** Sunucu hatasında hata bandına odaklan (panelin kendi odağı varsa false). */
  focusErrorBand?: boolean;
  /** "sticky": sayfa altında yapışkan; "inline": panel içi (yapışmaz). */
  mode?: "sticky" | "inline";
  className?: string;
};

export function FormActionBar({
  formRef,
  pending,
  error,
  success: successProp,
  dirty,
  submitLabel,
  pendingLabel = "Kaydediliyor…",
  submitIcon,
  submitDisabled,
  destructive,
  cancelHref,
  onCancel,
  cancelLabel = "İptal",
  progress,
  missing = [],
  draft,
  saveAndNew,
  shortcuts = "save",
  focusErrorBand = true,
  mode = "sticky",
  className,
}: FormActionBarProps) {
  const keyboardOpen = useSyncExternalStore(subscribeKeyboard, getKeyboardOpen, () => false);
  const [confirming, setConfirming] = useState(false);
  const [okFlash, setOkFlash] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const wasPending = useRef(false);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // pending bitti: hatasızsa ✓ animasyonu, hatalıysa sallanma + hata bandına odak.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    if (wasPending.current && !pending) {
      if (error) {
        frame = requestAnimationFrame(() => {
          setShakeKey((k) => k + 1);
          if (focusErrorBand) {
            const band = formRef.current?.querySelector<HTMLElement>('[role="alert"]');
            if (band) {
              if (!band.hasAttribute("tabindex")) band.setAttribute("tabindex", "-1");
              band.focus({ preventScroll: false });
            }
          }
        });
      } else {
        frame = requestAnimationFrame(() => setOkFlash(true));
        timer = setTimeout(() => setOkFlash(false), 2400);
      }
    }
    wasPending.current = pending;
    return () => {
      if (timer) clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pending, error, focusErrorBand, formRef]);

  const success = successProp ?? okFlash;
  const missingCount = missing.length;
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const allDone = total > 0 && missingCount === 0 && done >= total;
  const hasRequired = total > 0 || missingCount > 0;

  // Rozet önceliği: kaydediliyor > hata > kaydedildi > taslak > kaydedilmemiş.
  let badge: { tone: "warning" | "success" | "danger" | "neutral"; text: string; icon: LucideIcon; spin?: boolean } | null = null;
  if (pending) badge = { tone: "neutral", text: "Kaydediliyor…", icon: Loader2, spin: true };
  else if (error) badge = { tone: "danger", text: "Kaydedilemedi", icon: AlertCircle };
  else if (success) badge = { tone: "success", text: "Kaydedildi", icon: CircleCheck };
  else if (dirty && draft?.savedAt) badge = { tone: "neutral", text: `Taslak kaydedildi ${formatClock(draft.savedAt)}`, icon: Save };
  else if (dirty) badge = { tone: "warning", text: "Kaydedilmemiş değişiklik", icon: TriangleAlert };

  const toneClass = {
    warning: "tone-warning",
    success: "tone-success",
    danger: "tone-danger",
    neutral: "border border-line bg-canvas text-text-muted",
  } as const;

  function onCancelClick() {
    if (onCancel) {
      onCancel();
      return;
    }
    if (dirty && !pending) setConfirming(true);
  }

  const submitCls = destructive ? "bg-danger-500 text-white hover:bg-danger-600" : undefined;
  const busy = pending;

  return (
    <div
      data-kb={keyboardOpen ? "1" : undefined}
      className={cn(
        "fab-bar relative z-10 rounded-[var(--radius-card)] border border-line bg-surface/95 shadow-[var(--elev-2)] backdrop-blur",
        mode === "sticky" &&
          "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] lg:bottom-2 lg:pb-0",
        mode === "inline" && "mt-5",
        className,
      )}
    >
      {total > 0 ? (
        <div
          role="progressbar"
          aria-label="Form ilerlemesi"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-[var(--radius-card)]"
        >
          <div
            className="h-full bg-brand-600 transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      ) : null}

      {confirming ? (
        <div
          role="alertdialog"
          aria-label="Kaydedilmemiş değişiklikler"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setConfirming(false);
              requestAnimationFrame(() => cancelBtnRef.current?.focus());
            }
          }}
          className="fab-fade flex flex-wrap items-center gap-2 px-3 py-3 sm:px-4"
        >
          <p className="tone-warning min-w-0 flex-1 basis-60 rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold">
            Kaydedilmemiş değişiklikler silinecek. Yine de çıkılsın mı?
          </p>
          <Button type="button" variant="secondary" size="lg" className="min-w-28 flex-1 sm:flex-none" autoFocus onClick={() => setConfirming(false)}>
            Düzenlemeye dön
          </Button>
          {cancelHref ? (
            <ButtonLink href={cancelHref} variant="danger" size="lg" className="min-w-28 flex-1 sm:flex-none">
              Değişiklikleri at
            </ButtonLink>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:flex-1" aria-live="polite" aria-atomic="true">
            {badge ? (
              <span
                key={badge.text}
                className={cn("fab-fade inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", toneClass[badge.tone])}
              >
                <badge.icon aria-hidden="true" className={cn("h-3.5 w-3.5", badge.spin && "animate-spin")} />
                {badge.text}
              </span>
            ) : null}
            {hasRequired && !success ? (
              missingCount > 0 ? (
                <button
                  type="button"
                  onClick={() => missing[0]?.onGo()}
                  title={`İlk eksik alan: ${missing[0]?.label ?? ""}`}
                  className="focus-ring inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-warning-strong underline-offset-2 hover:underline"
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning-strong" />
                  {missingCount} zorunlu alan eksik
                </button>
              ) : allDone ? (
                <span className="inline-flex items-center gap-1.5 px-1 text-xs font-semibold text-success-strong">
                  <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  Hepsi tamam
                </span>
              ) : null
            ) : null}
            {shortcuts ? (
              <span className="hidden min-w-0 truncate text-xs text-text-faint lg:inline">
                <kbd className="rounded border border-line bg-canvas px-1 font-sans">Ctrl</kbd>
                {" + "}
                <kbd className="rounded border border-line bg-canvas px-1 font-sans">Enter</kbd> ile kaydet
                {shortcuts === "save-tabs" ? (
                  <>
                    {" · "}
                    <kbd className="rounded border border-line bg-canvas px-1 font-sans">Alt</kbd>
                    {" + "}
                    <kbd className="rounded border border-line bg-canvas px-1 font-sans">↑↓</kbd> sekme
                  </>
                ) : null}
                {shortcuts === "save-esc" ? (
                  <>
                    {" · "}
                    <kbd className="rounded border border-line bg-canvas px-1 font-sans">Esc</kbd> kapat
                  </>
                ) : null}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 max-sm:[&>*]:min-h-11 max-sm:[&>button]:flex-1 max-sm:[&>a]:flex-1">
            {onCancel || !cancelHref ? (
              <Button ref={cancelBtnRef} type="button" variant="secondary" size="lg" onClick={onCancelClick}>
                {cancelLabel}
              </Button>
            ) : dirty && !pending ? (
              <Button ref={cancelBtnRef} type="button" variant="secondary" size="lg" onClick={onCancelClick}>
                {cancelLabel}
              </Button>
            ) : (
              <ButtonLink href={cancelHref} variant="secondary" size="lg">
                {cancelLabel}
              </ButtonLink>
            )}
            {draft ? (
              <Button type="button" variant="ghost" size="lg" icon={Save} disabled={busy || !dirty} onClick={draft.onSave}>
                Taslak kaydet
              </Button>
            ) : null}
            {saveAndNew ? (
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                disabled={busy || submitDisabled}
                onClick={() => setSubmitIntent("new")}
              >
                Kaydet ve yenisini ekle
              </Button>
            ) : null}
            <span key={shakeKey} className={cn("inline-flex max-sm:flex-1", shakeKey > 0 && "fab-shake")}>
              <Button
                type="submit"
                size="lg"
                loading={busy}
                disabled={submitDisabled}
                icon={success && !busy ? undefined : submitIcon}
                className={cn("max-sm:w-full", submitCls)}
                onClick={() => setSubmitIntent(null)}
              >
                {success && !busy ? <Check aria-hidden="true" className="fab-pop h-4 w-4" /> : null}
                {busy ? pendingLabel : success ? "Kaydedildi" : submitLabel}
              </Button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
