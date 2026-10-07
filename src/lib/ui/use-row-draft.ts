import { createContext, useContext, useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";
import {
  SAVED_FLASH_MS,
  canSave as canSaveState,
  changedKeys,
  initRowDraft,
  isDirty,
  isLocked,
  isStale,
  rowDraftReducer,
  type DraftValues,
  type RowDraftState,
  type RowValidation,
} from "./row-draft";
import type { RowDraftStore } from "./row-draft-store";

/**
 * useRowDraft — satır içi kaydetme standardının React bağlayıcısı (istemci bileşenlerinde kullanılır).
 * Saf kurallar `row-draft.ts`'te; burada yalnız eylem çağrısı, kısa "Kaydedildi" onayı, kirli satır kaydı
 * (tablo çubuğu + ayrılma uyarısı) ve klavye (Enter = kaydet, Esc = vazgeç) var.
 * Görünüm: `components/ui/row-save-actions.tsx`; tablo sarmalayıcı: `components/ui/draft-table.tsx`.
 */

export const RowDraftStoreContext = createContext<RowDraftStore | null>(null);

export type RowSaveResult = { ok: true; version?: string | null } | { ok?: false; error?: string };

export type UseRowDraftOptions<T extends DraftValues> = {
  /** Satır kimliği (kirli satır kaydı için benzersiz). */
  id: string;
  /** Satırın okunur adı ("Volkan Emlak"). */
  label: string;
  /** Sunucudaki kayıtlı değer (props). Değişirse taslağa yansır; kirliyse satır "bayat" olur. */
  saved: T;
  /** Sunucu sürümü (ör. `updated_at`); yoksa yalnız değer karşılaştırılır. */
  version?: string | null;
  /** Saf doğrulama: geçersizse Kaydet pasif + neden. Sunucu yine doğrular. */
  validate?: (draft: T, saved: T) => RowValidation;
  /** Riskli değişiklik açıklaması (ör. "Ofisin erişimi kesilecek"); null = risk yok. */
  risk?: (draft: T, saved: T) => string | null;
  save: (draft: T, ctx: { saved: T; version: string | null }) => Promise<RowSaveResult>;
};

const OK: RowValidation = { ok: true };

export function useRowDraft<T extends DraftValues>({ id, label, saved, version = null, validate, risk, save }: UseRowDraftOptions<T>) {
  const [state, dispatch] = useReducer(rowDraftReducer<T>, undefined, () => initRowDraft(saved, version));

  // Sunucu değeri değişti mi? Önceki görüntü durumda tutulur, render sırasında karşılaştırılır (efektte setState yok).
  const key = `${version ?? ""}|${JSON.stringify(saved)}`;
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    setSeenKey(key);
    dispatch({ type: "sync", saved, version });
  }

  const validation = validate ? validate(state.draft, state.saved) : OK;
  const dirty = isDirty(state);
  const riskText = dirty && risk ? risk(state.draft, state.saved) : null;
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestVersion = useRef(version);

  useEffect(() => {
    latestVersion.current = version;
  }, [version]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function submit(): Promise<void> {
    if (inFlight.current) return;
    if (!canSaveState(state, validation)) {
      if (dirty && isStale(state)) dispatch({ type: "submit" }); // bayat → açıklayıcı hata
      return;
    }
    if (riskText && state.status !== "confirming") {
      dispatch({ type: "confirm" });
      return;
    }
    inFlight.current = true;
    dispatch({ type: "submit" });
    try {
      const res = await save(state.draft, { saved: state.saved, version: state.version });
      if (res.ok) {
        dispatch({ type: "success", version: res.version ?? latestVersion.current });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => dispatch({ type: "settle" }), SAVED_FLASH_MS);
      } else {
        dispatch({ type: "failure", error: res.error || "Kaydedilemedi. Lütfen tekrar deneyin." });
      }
    } catch {
      dispatch({ type: "failure", error: "Bağlantı kesildi; değişiklik kaydedilmedi. Tekrar deneyin." });
    } finally {
      inFlight.current = false;
    }
  }

  const reset = () => dispatch({ type: "reset" });

  // Kirli satır kaydı: tablo çubuğu "Tümünü kaydet / geri al" ve ayrılma uyarısı buradan beslenir.
  const store = useContext(RowDraftStoreContext);
  useEffect(() => {
    if (!store) return;
    if (dirty) store.register(id, { label, save: submit, reset });
    else store.unregister(id);
  });
  useEffect(() => () => store?.unregister(id), [store, id]);

  /** Satır `onKeyDownCapture`: Enter = kaydet, Esc = vazgeç (açık liste/menü içinde değilken). */
  function onKeyDownCapture(e: KeyboardEvent<HTMLElement>) {
    const t = e.target as HTMLElement;
    if (t.closest('[role="listbox"],[role="menu"],[role="dialog"]')) return;
    if (e.key === "Escape" && dirty && state.status !== "saving") {
      e.preventDefault();
      if (state.status === "confirming") dispatch({ type: "cancelConfirm" });
      else reset();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.altKey || !dirty) return;
    const tag = t.tagName;
    if (tag === "A" || tag === "TEXTAREA") return;
    const combobox = t.getAttribute("role") === "combobox";
    if (tag === "BUTTON" && !combobox) return; // düğme kendi tıklamasını yapar
    if (combobox && t.getAttribute("aria-expanded") === "true") return;
    e.preventDefault(); // kapalı seçicide Enter listeyi açmaz, kaydeder
    void submit();
  }

  return {
    state,
    draft: state.draft,
    saved: state.saved,
    status: state.status,
    error: state.error,
    dirty,
    stale: isStale(state),
    locked: isLocked(state),
    validation,
    risk: riskText,
    canSave: canSaveState(state, validation),
    changed: new Set(changedKeys(state.saved, state.draft)),
    set: <K extends keyof T>(key: K, value: T[K]) => dispatch({ type: "set", key, value }),
    reset,
    submit,
    cancelConfirm: () => dispatch({ type: "cancelConfirm" }),
    refresh: () => dispatch({ type: "refresh" }),
    onKeyDownCapture,
  };
}

export type RowDraft<T extends DraftValues> = ReturnType<typeof useRowDraft<T>>;
export type { RowDraftState };
