/**
 * Optimistik güncelleme yardımcıları — saf mantık (React/Next bağımlılığı yok).
 *
 * Desen: önce UI'yı değiştir (`apply`), sunucu action'ını bekle (`commit`),
 * hata (fırlatma ya da `{ error }` sonucu) olursa eski duruma dön (`rollback`)
 * ve kullanıcıya bildir (`onError`). Yetki/tenant/veri mantığı action'larda
 * kalır; burası yalnız istemci durumunu yönetir.
 */

export type CommitResult = { error?: string | null; ok?: boolean } | void | null | undefined;

export type OptimisticOutcome = { ok: true } | { ok: false; message: string };

export async function runOptimistic(opts: {
  apply: () => void;
  commit: () => Promise<CommitResult>;
  rollback: () => void;
  onError?: (message: string) => void;
  fallbackError?: string;
}): Promise<OptimisticOutcome> {
  const fallback = opts.fallbackError ?? "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
  opts.apply();
  try {
    const res = await opts.commit();
    const err = res && typeof res === "object" && "error" in res ? res.error : null;
    if (err) {
      opts.rollback();
      opts.onError?.(err);
      return { ok: false, message: err };
    }
    return { ok: true };
  } catch {
    opts.rollback();
    opts.onError?.(fallback);
    return { ok: false, message: fallback };
  }
}

/** Tek kaydı okundu işaretle; zaten okunmuşsa aynı dizi referansını döndürür. */
export function markReadById<T extends { id: string; read_at: string | null }>(
  items: readonly T[],
  id: string,
  nowIso: string,
): T[] | readonly T[] {
  const target = items.find((n) => n.id === id);
  if (!target || target.read_at) return items;
  return items.map((n) => (n.id === id ? { ...n, read_at: nowIso } : n));
}

/** Tüm okunmamışları okundu işaretle; zaten okunmuş olanların tarihi korunur. */
export function markAllRead<T extends { read_at: string | null }>(items: readonly T[], nowIso: string): T[] {
  return items.map((n) => (n.read_at ? n : { ...n, read_at: nowIso }));
}

/** Kimlik kümesinde öğeyi aç/kapat (favori, etiket, seçili vb.) — yeni Set döner. */
export function toggleId(set: ReadonlySet<string>, id: string, on: boolean): Set<string> {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}
