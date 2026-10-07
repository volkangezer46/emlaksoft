/**
 * Kirli satır kaydı (satır içi kaydetme standardı) — saf, çerçevesiz dış depo.
 * Her kirli satır kendini `register` ile bildirir (kaydet/geri al tutamaçlarıyla), temizlenince `unregister`.
 * Tablo çubuğu ("3 satırda kaydedilmemiş değişiklik · Tümünü kaydet · Tümünü geri al") ve sayfadan ayrılma
 * uyarısı bu depodan okur. `useSyncExternalStore` ile bağlanır (React durumu yok → satır başına yeniden çizim yok).
 */

export type DirtyRowHandle = {
  /** Ekran okuyucu ve çubuk için satır adı ("Volkan Emlak"). */
  label: string;
  /** Kaydı başlatır (riskli satırda onay adımına geçer). Bitince çözülür. */
  save: () => Promise<void> | void;
  reset: () => void;
};

export type RowDraftStore = {
  register: (id: string, handle: DirtyRowHandle) => void;
  unregister: (id: string) => void;
  subscribe: (listener: () => void) => () => void;
  /** Değişmez anlık görüntü: kirli satır sayısı (useSyncExternalStore için ilkel). */
  getCount: () => number;
  handles: () => [string, DirtyRowHandle][];
  saveAll: () => Promise<void>;
  resetAll: () => void;
};

export function createRowDraftStore(): RowDraftStore {
  const rows = new Map<string, DirtyRowHandle>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    register(id, handle) {
      const had = rows.has(id);
      rows.set(id, handle);
      if (!had) emit();
    },
    unregister(id) {
      if (rows.delete(id)) emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getCount: () => rows.size,
    handles: () => [...rows.entries()],
    async saveAll() {
      // Sıralı: sunucuya aynı anda N yazma gitmez; riskli satırlar kendi onay adımında bekler.
      for (const [, h] of [...rows.entries()]) await h.save();
    },
    resetAll() {
      for (const [, h] of [...rows.entries()]) h.reset();
    },
  };
}

/** "3 satırda kaydedilmemiş değişiklik" (Türkçe; tekil/çoğul ayrımı yok). */
export function unsavedSummary(count: number): string {
  return count <= 0 ? "" : `${count} satırda kaydedilmemiş değişiklik`;
}

export const LEAVE_WARNING = "Kaydedilmemiş değişiklikler var. Sayfadan ayrılırsanız kaybolacak. Devam edilsin mi?";
