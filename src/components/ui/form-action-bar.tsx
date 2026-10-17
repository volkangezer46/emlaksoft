"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import { AlertCircle, Check, ChevronDown, CircleCheck, Ellipsis, Loader2, Save, TriangleAlert } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { isDirty, serializeEntries } from "@/lib/form-dirty";
import { setSubmitIntent } from "@/lib/form-submit-intent";
import { formatClock } from "@/lib/form-tabs";
import { cn } from "@/lib/utils";
import { mobileSubmitLabel } from "@/components/ui/form-action-label";

/**
 * FormActionBar — TÜM kayıt ekleme/düzenleme formlarının ortak alt eylem çubuğu
 * (TabbedFormShell, InlineTabbedPanel, FormShell). docs/DESIGN_SYSTEM.md "Kaydet/İptal çubuğu".
 *
 * Sol: durum rozeti (Kaydediliyor / Kaydedilemedi / Kaydedildi / Taslak kaydedildi hh:mm /
 * Kaydedilmemiş değişiklik) + zorunlu alan sayacı (tıklayınca ilk eksik alana gider; hepsi tamamsa
 * yeşil "Hepsi tamam") + kısayol ipucu. Üst kenarda ilerleme çizgisi.
 * Sağ: İptal (kirliyse SATIR İÇİ onay, popup yok), "Taslak kaydet", "Kaydet ve yenisini ekle", Kaydet
 * (yüklemede spinner, başarıda ✓ animasyonu, hatada sallanma + hata bandına odak).
 * Mobil (sadeleştirme 2.7): altta tam genişlikte TEK "Kaydet" (etiket `mobileSubmitLabel` ile tek kelime, kırpılmaz) ve
 * solunda "Daha fazla" (…): İptal ve ikincil eylemler orada satır içi açılır. "N zorunlu alan eksik" düğmenin içinde DEĞİL,
 * alanların hemen altında (çubuğun üst satırında) yazar ve ilk eksik alana götürür. Yapışkan çubuk varken mobil alt
 * gezinme gizlenir (premium.css `.fab-bar[data-sticky]`); 44px düğmeler, safe-area; ekran klavyesi açıkken akışa döner.
 * Sunucu action'ı ve doğrulama DEĞİŞMEZ: yalnız kabuktur.
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
    // Denetim olaydan SONRA (bir sonraki görev) yapılır. Form dinleyicisi React'in kök dinleyicisinden ÖNCE çalışır; burada
    // eşzamanlı setDirty, React'in aynı olayı işlemeden önce bekleyen güncellemeyi boşaltmasına yol açıyordu: yeniden çizim
    // KONTROLLÜ alanın eski değerini DOM'a geri yazıyor, React değişikliği görmüyor ve tuş kayboluyordu (Finans > Yeni
    // kayıt tutar alanına hiçbir şey yazılamıyordu; keyup ↔ input her tuşta kirli durumunu çevirip döngüyü sürdürüyordu).
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (e: Event) => {
      if (!e.isTrusted || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        const d = isDirty(initialRef.current, snap());
        setDirty((prev) => (prev === d ? prev : d));
      }, 0);
    };
    const events = ["input", "change", "click", "keyup"] as const;
    for (const ev of events) form.addEventListener(ev, check);
    return () => {
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
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

/** Mobilde İptal "Daha fazla" satırına iner (tek birincil düğme kuralı); geniş ekranda çubukta kalır. */
const CANCEL_CLS = "max-sm:hidden";

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

/**
 * Ortak "N eksik" rozeti: birincil düğmenin içinde eksik zorunlu alan sayısı (FormActionBar, diyalog formları).
 * Düğme pasif yapılmaz; tıklanınca form ilk eksik alana odaklanır.
 */
export function MissingCountBadge({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      data-missing-count={count}
      className={cn("rounded-full bg-white/25 px-1.5 text-xs font-semibold leading-5", className)}
      aria-label={`${count} zorunlu alan eksik`}
    >
      {count} eksik
    </span>
  );
}

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
  /** Taslak desteği: son kayıt zamanı (ms) + "Taslak kaydet" (`onSave` yoksa düğme çizilmez; yalnız otomatik taslak rozeti). */
  draft?: { savedAt: number | null; onSave?: () => void } | null;
  /** "Kaydet ve yenisini ekle" (yalnız useCreateForm'lu formlar). */
  saveAndNew?: boolean;
  /** "Kaydet ve yenisini ekle" düğmesinin etiketi (ör. sade formlarda "Kaydet ve yeni"). */
  saveAndNewLabel?: string;
  /**
   * Birincil düğmeyi geçici olarak gönderim dışı bir eyleme çevirir (ör. mobil adım akışında "Sonraki").
   * null/undefined: normal Kaydet. Ctrl+Enter kısayolu yine kaydeder.
   */
  primaryAction?: { label: string; ariaLabel?: string; icon?: LucideIcon; onClick: () => void } | null;
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
  saveAndNewLabel = "Kaydet ve yenisini ekle",
  primaryAction,
  shortcuts = "save",
  focusErrorBand = true,
  mode = "sticky",
  className,
}: FormActionBarProps) {
  const keyboardOpen = useSyncExternalStore(subscribeKeyboard, getKeyboardOpen, () => false);
  const [confirming, setConfirming] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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
  // `short`: telefonda tek satırlık çubukta (WP1) Kaydet'in yanında yazan kısa metin; null → telefonda rozet yok (düğme zaten
  // "Kaydediliyor…" / "Kaydedildi" der).
  let badge: { tone: "warning" | "success" | "danger" | "neutral"; text: string; short: string | null; icon: LucideIcon; spin?: boolean } | null = null;
  if (pending) badge = { tone: "neutral", text: "Kaydediliyor…", short: null, icon: Loader2, spin: true };
  else if (error) badge = { tone: "danger", text: "Kaydedilemedi", short: "Hata", icon: AlertCircle };
  else if (success) badge = { tone: "success", text: "Kaydedildi", short: null, icon: CircleCheck };
  else if (dirty && draft?.savedAt) badge = { tone: "neutral", text: `Taslak kaydedildi ${formatClock(draft.savedAt)}`, short: `Taslak ${formatClock(draft.savedAt)}`, icon: Save };
  else if (dirty) badge = { tone: "warning", text: "Kaydedilmemiş değişiklik", short: "Kaydedilmedi", icon: TriangleAlert };

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
  const mobileLabel = mobileSubmitLabel(submitLabel);
  // İkincil eylemler: geniş ekranda çubukta, mobilde "Daha fazla" ile satır içi açılır (popup değil).
  const secondaryButtons = (
    <>
      {draft?.onSave ? (
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
          {saveAndNewLabel}
        </Button>
      ) : null}
    </>
  );

  return (
    <div
      data-kb={keyboardOpen ? "1" : undefined}
      data-sticky={mode === "sticky" ? "1" : undefined}
      className={cn(
        // Cam bütçesi: yapışkan alt çubuk opak (cam yalnız sabit üst çubukta).
        "fab-bar relative z-10 rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--elev-2)]",
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
          // Telefonda gizli (WP1): dar çubuğun sol üstünde "başıboş koyu çizgi" gibi okunuyordu; orada "N eksik" yazar.
          className="absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-t-[var(--radius-card)] max-sm:hidden"
        >
          <div
            className="h-full bg-brand-600 transition-[width] duration-(--motion-base) motion-reduce:transition-none"
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
        // Telefonda TEK SATIR (WP1): [durum] [… ] [Kaydet]; çubuk ~56 px + safe-area (eskiden iki satır, 105 px). "Daha fazla"
        // açılınca ikincil eylemler satırın üstünde tam genişlik sarılır.
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-2 py-1.5 sm:flex-nowrap sm:gap-3 sm:px-4 sm:py-3">
          {moreOpen ? (
            <div data-fab-more className="flex basis-full flex-wrap gap-2 sm:hidden [&>*]:min-h-11 [&>*]:flex-1">
              {onCancel || !cancelHref || (dirty && !pending) ? (
                <Button type="button" variant="secondary" size="lg" onClick={onCancelClick}>
                  {cancelLabel}
                </Button>
              ) : (
                <ButtonLink href={cancelHref} variant="secondary" size="lg">
                  {cancelLabel}
                </ButtonLink>
              )}
              {secondaryButtons}
            </div>
          ) : null}
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 max-sm:max-w-[45%] max-sm:shrink max-sm:flex-nowrap sm:flex-1",
              !badge?.short && !(missingCount > 0 && hasRequired && !success) && "max-sm:hidden",
            )}
            aria-live="polite"
            aria-atomic="true"
          >
            {badge ? (
              <span
                key={badge.text}
                className={cn(
                  "fab-fade inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold max-sm:px-2 max-sm:leading-4",
                  !badge.short && "max-sm:hidden",
                  toneClass[badge.tone],
                )}
              >
                <badge.icon aria-hidden="true" className={cn("h-3.5 w-3.5 shrink-0", badge.spin && "animate-spin")} />
                <span className="max-sm:hidden">{badge.text}</span>
                {badge.short ? <span className="truncate sm:hidden">{badge.short}</span> : null}
              </span>
            ) : null}
            {hasRequired && !success ? (
              missingCount > 0 ? (
                <button
                  type="button"
                  onClick={() => missing[0]?.onGo()}
                  title={`İlk eksik alan: ${missing[0]?.label ?? ""}`}
                  aria-label={`${missingCount} zorunlu alan eksik`}
                  data-missing-count={missingCount}
                  className="focus-ring inline-flex min-h-8 touch:min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-semibold text-warning-strong underline-offset-2 hover:underline"
                >
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning-strong" />
                  <span className="sm:hidden">{missingCount} eksik</span>
                  <span className="max-sm:hidden">{missingCount} zorunlu alan eksik</span>
                </button>
              ) : allDone ? (
                <span className="inline-flex items-center gap-1.5 px-1 text-xs font-semibold text-success-strong max-sm:hidden">
                  <Check aria-hidden="true" className="h-3.5 w-3.5" />
                  Hepsi tamam
                </span>
              ) : null
            ) : null}
            {shortcuts ? (
              <span className="kbd-hint hidden min-w-0 truncate text-xs text-text-faint lg:inline">
                <Kbd mod />
                {" + "}
                <Kbd>Enter</Kbd> ile kaydet
                {shortcuts === "save-tabs" ? (
                  <>
                    {" · "}
                    <Kbd>Alt</Kbd>
                    {" + "}
                    <Kbd>↑↓</Kbd> sekme
                  </>
                ) : null}
                {shortcuts === "save-esc" ? (
                  <>
                    {" · "}
                    <Kbd>Esc</Kbd> kapat
                  </>
                ) : null}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 max-sm:min-w-0 max-sm:flex-1 max-sm:flex-nowrap max-sm:justify-stretch max-sm:gap-1.5 max-sm:[&>*]:min-h-11 max-sm:[&>*]:min-w-0 max-sm:[&>button]:flex-1 max-sm:[&>a]:flex-1">
            {onCancel || !cancelHref ? (
              <Button ref={cancelBtnRef} type="button" variant="secondary" size="lg" className={CANCEL_CLS} onClick={onCancelClick}>
                {cancelLabel}
              </Button>
            ) : dirty && !pending ? (
              <Button ref={cancelBtnRef} type="button" variant="secondary" size="lg" className={CANCEL_CLS} onClick={onCancelClick}>
                {cancelLabel}
              </Button>
            ) : (
              <ButtonLink href={cancelHref} variant="secondary" size="lg" className={CANCEL_CLS}>
                {cancelLabel}
              </ButtonLink>
            )}
            {/* Mobil "Daha fazla": İptal + ikincil eylemler (her formda; İptal artık burada). */}
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className="w-11 px-0 sm:hidden max-sm:flex-none!"
              aria-label="Daha fazla"
              title="Daha fazla"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((v) => !v)}
            >
              {moreOpen ? (
                <ChevronDown aria-hidden="true" className="h-5 w-5" />
              ) : (
                <Ellipsis aria-hidden="true" className="h-5 w-5" />
              )}
            </Button>
            <span className="contents max-sm:hidden">{secondaryButtons}</span>
            <span key={shakeKey} className={cn("inline-flex min-w-0 max-sm:flex-1", shakeKey > 0 && "fab-shake")}>
              {primaryAction && !busy && !success ? (
                <Button
                  type="button"
                  size="lg"
                  iconRight={primaryAction.icon}
                  className="min-w-0 max-sm:w-full"
                  aria-label={primaryAction.ariaLabel}
                  onClick={primaryAction.onClick}
                >
                  <span className="min-w-0 whitespace-normal text-center leading-tight">{primaryAction.label}</span>
                </Button>
              ) : (
              <Button
                type="submit"
                size="lg"
                loading={busy}
                disabled={submitDisabled}
                icon={success && !busy ? undefined : submitIcon}
                className={cn("min-w-0 max-sm:w-full", submitCls)}
                onClick={() => setSubmitIntent(null)}
              >
                {success && !busy ? <Check aria-hidden="true" className="fab-pop h-4 w-4" /> : null}
                {busy ? (
                  <span className="min-w-0 whitespace-normal text-center leading-tight">{pendingLabel}</span>
                ) : success ? (
                  <span className="min-w-0">Kaydedildi</span>
                ) : (
                  <>
                    <span className="min-w-0 whitespace-normal text-center leading-tight sm:hidden">{mobileLabel}</span>
                    <span className="min-w-0 whitespace-normal leading-tight max-sm:hidden">{submitLabel}</span>
                  </>
                )}
              </Button>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
