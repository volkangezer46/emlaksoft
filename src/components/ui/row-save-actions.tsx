"use client";

import { AlertTriangle, Check, RefreshCw, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { DraftValues } from "@/lib/ui/row-draft";
import type { RowDraft } from "@/lib/ui/use-row-draft";

/**
 * RowSaveActions — satır içi kaydetme standardının görünümü (docs/DESIGN_SYSTEM.md "Satır içi kaydetme standardı").
 *
 *  - Kaydet başlangıçta PASİF (sönük ama okunur); yalnız gerçek değişiklikte AKTİF.
 *  - Geçersiz seçimde PASİF + nedeni satır altında; bayat satırda "Yenile".
 *  - Kaydederken spinner + "Kaydediliyor…" (seçiciler `draft.locked` ile kilitlenir; çift gönderim yok).
 *  - Başarıda ≈1,5 sn "Kaydedildi" → tekrar pasif; hatada mesaj satırda, taslak korunur.
 *  - Kirliyken "Kaydedilmemiş" etiketi + ↺ Vazgeç; riskli değişiklikte satır içi onay adımı.
 *  - Durum değişimleri `aria-live` ile duyurulur.
 * Satırın kendisi `rowDraftProps(draft)` ile işaretlenir (solda amber şerit + Enter/Esc).
 */
export function RowSaveActions<T extends DraftValues>({
  draft,
  saveLabel = "Kaydet",
  confirmLabel = "Onayla",
  children,
  showUnsavedLabel = true,
}: {
  draft: RowDraft<T>;
  saveLabel?: string;
  confirmLabel?: string;
  /** Kaydet'in yanındaki diğer satır eylemleri (Yönet, Ofise gir, ⋮). */
  children?: ReactNode;
  showUnsavedLabel?: boolean;
}) {
  const { status, dirty, canSave, validation, error, stale, risk } = draft;
  const saving = status === "saving";
  const saved = status === "saved";
  const invalidReason = dirty && !validation.ok ? validation.reason : null;

  const live = saving
    ? "Kaydediliyor"
    : saved
      ? "Kaydedildi"
      : status === "error" && error
        ? `Kaydedilemedi: ${error}`
        : status === "confirming" && risk
          ? `Onay gerekiyor: ${risk}`
          : dirty
            ? "Kaydedilmemiş değişiklik var"
            : "";

  return (
    <div className="rs-actions">
      {status === "confirming" && risk ? (
        <div className="rs-confirm" role="group" aria-label="Riskli değişiklik onayı">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{risk}</span>
          <Button size="xs" variant="danger" onClick={() => void draft.submit()} autoFocus>
            {confirmLabel}
          </Button>
          <Button size="xs" variant="ghost" onClick={draft.cancelConfirm}>
            Vazgeç
          </Button>
        </div>
      ) : (
        <>
          {dirty && showUnsavedLabel && !saving ? <span className="rs-unsaved">Kaydedilmemiş</span> : null}
          {dirty && !saving ? (
            <Button size="icon" variant="ghost" onClick={draft.reset} aria-label="Değişikliği geri al (Esc)" title="Değişikliği geri al (Esc)">
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="navy"
            icon={Check}
            loading={saving}
            disabled={!canSave && !saving}
            onClick={() => void draft.submit()}
            className={saved ? "btn-saved" : undefined}
            title={invalidReason ?? (canSave ? "Kaydet (Enter)" : dirty ? undefined : "Değişiklik yok")}
          >
            {saving ? "Kaydediliyor…" : saved ? "Kaydedildi" : saveLabel}
          </Button>
        </>
      )}
      {children}
      {stale ? (
        <p className="rs-hint" data-tone="error" role="alert">
          Bu satır başkası tarafından güncellendi.{" "}
          <button type="button" onClick={draft.refresh} className="focus-ring inline-flex items-center gap-1 font-bold underline underline-offset-2">
            <RefreshCw className="h-3 w-3" aria-hidden="true" /> Yenile
          </button>
        </p>
      ) : status === "error" && error ? (
        <p className="rs-hint" data-tone="error" role="alert">
          {error}
        </p>
      ) : invalidReason ? (
        <p className="rs-hint" data-tone="info">
          {invalidReason}
        </p>
      ) : null}
      <span className="sr-only" aria-live="polite" role="status">
        {live}
      </span>
    </div>
  );
}

/** Satır (`<tr>` ya da kart) öznitelikleri: kirli şerit, durum ve klavye kısayolları. */
export function rowDraftProps<T extends DraftValues>(draft: RowDraft<T>) {
  return {
    "data-dirty": draft.dirty ? "1" : undefined,
    "data-row-state": draft.status,
    "aria-busy": draft.locked || undefined,
    onKeyDownCapture: draft.onKeyDownCapture,
  } as const;
}
