/**
 * Satır içi kaydetme standardı — SAF durum makinesi (React/DOM/zaman yok; vitest kapsamında).
 * Kılavuz: docs/DESIGN_SYSTEM.md "Satır içi kaydetme standardı". Hook: `use-row-draft.ts`,
 * görünüm: `components/ui/row-save-actions.tsx`, tablo çubuğu: `components/ui/draft-table.tsx`.
 *
 * Kurallar:
 *  - "Kirli" DEĞER karşılaştırmasıdır (taslak ≠ kayıtlı), tıklama sayımı değil: aynı değere dönülürse temizdir.
 *  - Kaydet yalnız kirli + geçerli + kaydetmiyor + bayat değilken açıktır.
 *  - Riskli değişiklik (askıya alma, paket düşürme…) önce `confirming` adımına geçer.
 *  - Hata olursa taslak KORUNUR (status `error`), başarıda kayıtlı değer taslağa eşitlenir (`saved` → kısa onay → `idle`).
 *  - Sunucu değeri başkası tarafından değişirse (sürüm farklı) ve satır kirliyse `stale`: kayıt engellenir, "yenile" önerilir.
 */

export type DraftValues = Record<string, string | number | boolean | null>;

export type RowDraftStatus = "idle" | "confirming" | "saving" | "saved" | "error";

export type RowDraftState<T extends DraftValues> = {
  saved: T;
  draft: T;
  status: RowDraftStatus;
  error: string | null;
  /** Taslağın dayandığı sunucu sürümü (ör. `updated_at`). */
  version: string | null;
  /** Kirliyken sunucuda daha yeni sürüm görüldü. */
  staleVersion: string | null;
  /** Bayat durumda sunucunun yeni değeri ("yenile" ile benimsenir). */
  pendingSaved: T | null;
};

export type RowDraftAction<T extends DraftValues> =
  | { type: "set"; key: keyof T; value: T[keyof T] }
  | { type: "reset" }
  | { type: "confirm" }
  | { type: "cancelConfirm" }
  | { type: "submit" }
  | { type: "success"; version?: string | null }
  | { type: "failure"; error: string }
  | { type: "settle" }
  | { type: "sync"; saved: T; version: string | null }
  | { type: "refresh" };

export type RowValidation = { ok: true } | { ok: false; reason: string };

export const STALE_MESSAGE = "Bu satır başkası tarafından güncellendi. Yenileyip tekrar deneyin.";
export const SAVED_FLASH_MS = 1500;

export function initRowDraft<T extends DraftValues>(saved: T, version: string | null = null): RowDraftState<T> {
  return { saved, draft: saved, status: "idle", error: null, version, staleVersion: null, pendingSaved: null };
}

export function draftEquals<T extends DraftValues>(a: T, b: T): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!Object.is(a[k], b[k])) return false;
  return true;
}

export function changedKeys<T extends DraftValues>(saved: T, draft: T): (keyof T)[] {
  return (Object.keys(draft) as (keyof T)[]).filter((k) => !Object.is(saved[k], draft[k]));
}

export function isDirty<T extends DraftValues>(s: RowDraftState<T>): boolean {
  return !draftEquals(s.saved, s.draft);
}

export function isStale<T extends DraftValues>(s: RowDraftState<T>): boolean {
  return s.staleVersion !== null;
}

/** Kaydet düğmesi açık mı? (geçerlilik çağırandan; sunucu yine doğrular) */
export function canSave<T extends DraftValues>(s: RowDraftState<T>, validation: RowValidation = { ok: true }): boolean {
  return isDirty(s) && validation.ok && !isStale(s) && s.status !== "saving" && s.status !== "saved";
}

/** Seçiciler kilitli mi? (kaydederken çift gönderim/değişiklik yok) */
export function isLocked<T extends DraftValues>(s: RowDraftState<T>): boolean {
  return s.status === "saving";
}

export function rowDraftReducer<T extends DraftValues>(s: RowDraftState<T>, a: RowDraftAction<T>): RowDraftState<T> {
  switch (a.type) {
    case "set": {
      if (s.status === "saving") return s;
      const draft = { ...s.draft, [a.key]: a.value } as T;
      // Değişiklik onay adımını ve eski hatayı düşürür; "saved" onayı da biter.
      return { ...s, draft, status: "idle", error: null };
    }
    case "reset":
      if (s.status === "saving") return s;
      return { ...s, draft: s.saved, status: "idle", error: null };
    case "confirm":
      if (!isDirty(s) || s.status === "saving" || isStale(s)) return s;
      return { ...s, status: "confirming", error: null };
    case "cancelConfirm":
      return s.status === "confirming" ? { ...s, status: "idle" } : s;
    case "submit":
      if (s.status === "saving" || !isDirty(s)) return s;
      if (isStale(s)) return { ...s, status: "error", error: STALE_MESSAGE };
      return { ...s, status: "saving", error: null };
    case "success":
      if (s.status !== "saving") return s;
      return { ...s, saved: s.draft, status: "saved", error: null, version: a.version ?? s.version };
    case "failure":
      if (s.status !== "saving") return s;
      return { ...s, status: "error", error: a.error };
    case "settle":
      return s.status === "saved" ? { ...s, status: "idle" } : s;
    case "sync": {
      // Sunucudan gelen yeni kayıtlı değer. Kaydetme sürerken gelen yenileme bekletilmez: başarıda zaten eşitlenir.
      if (a.version === s.version && draftEquals(a.saved, s.saved)) return s;
      if (s.status === "saving") return s;
      if (!isDirty(s) || draftEquals(a.saved, s.draft)) {
        // Temiz satır (ya da sunucu tam bizim taslağa geldi): yeni değeri benimse.
        return { ...s, saved: a.saved, draft: a.saved, version: a.version, staleVersion: null, pendingSaved: null };
      }
      // Kirli satırın altında sunucu değişti: taslak korunur, kayıt "yenile" diyene kadar engellenir.
      return { ...s, staleVersion: a.version ?? "unknown", pendingSaved: a.saved };
    }
    case "refresh": {
      const next = s.pendingSaved ?? s.saved;
      const version = s.staleVersion && s.staleVersion !== "unknown" ? s.staleVersion : s.version;
      return { saved: next, draft: next, status: "idle", error: null, version, staleVersion: null, pendingSaved: null };
    }
    default:
      return s;
  }
}
