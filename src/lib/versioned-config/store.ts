import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";

/**
 * Taslak / yayın / sürüm geçmişi / varsayılana dön için ORTAK depolama kalıbı (platform_settings, yeni migration yok).
 * Site menüsü (src/lib/site-menu/store.ts) aynı sırayı ve sınırları kullanır; yeni yönetilen içerikler bunu yeniden yazmaz:
 *   <prefix>.live    -> yayındaki yapılandırma (yoksa kod içi varsayılan)
 *   <prefix>.draft   -> taslak (yoksa canlıyla aynı)
 *   <prefix>.history -> son yayınlar: [{id,at,by,label,cfg}] (en yeni başta)
 * Yazma sırası: geçmiş (geri dönüş güvencesi) -> canlı -> taslak. Her yazma okunarak doğrulanır.
 */

export type HistoryEntry<T> = { id: string; at: string; by: string; label: string; cfg: T };
export type StoreResult = { ok: true } | { ok: false; error: string };
export type EntryMeta = { id: string; at: string; by: string; label: string };
export type VersionedState<T> = { live: T | null; draft: T | null; history: HistoryEntry<T>[] };

export const MAX_HISTORY = 10;
export const MAX_HISTORY_BYTES = 600 * 1024;

export function trimHistory<T>(list: HistoryEntry<T>[]): HistoryEntry<T>[] {
  let out = list.slice(0, MAX_HISTORY);
  while (out.length > 1 && JSON.stringify(out).length > MAX_HISTORY_BYTES) out = out.slice(0, -1);
  return out;
}

export function createVersionedStore<T>(opts: {
  prefix: string;
  /** Bilinmeyen değeri doğrular; geçersizse null. */
  parseValue: (value: unknown) => T | null;
  unavailableMessage: string;
}) {
  const LIVE = `${opts.prefix}.live`;
  const DRAFT = `${opts.prefix}.draft`;
  const HISTORY = `${opts.prefix}.history`;
  const fail: StoreResult = { ok: false, error: opts.unavailableMessage };

  const parseConfig = (raw: string | null): T | null => {
    if (!raw) return null;
    try {
      return opts.parseValue(JSON.parse(raw));
    } catch {
      return null;
    }
  };

  const parseHistory = (raw: string | null): HistoryEntry<T>[] => {
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return [];
      const out: HistoryEntry<T>[] = [];
      for (const e of arr as Array<Partial<HistoryEntry<unknown>>>) {
        if (typeof e?.id !== "string" || typeof e.at !== "string" || typeof e.label !== "string") continue;
        const cfg = opts.parseValue(e.cfg);
        if (cfg === null) continue;
        out.push({ id: e.id, at: e.at, by: typeof e.by === "string" ? e.by : "", label: e.label, cfg });
      }
      return out;
    } catch {
      return [];
    }
  };

  async function writeVerified(key: string, value: string | null, staffId: string): Promise<boolean> {
    if (!(await setPlatformSetting(key, value, staffId))) return false;
    return (await getPlatformSetting(key)) === value;
  }

  async function readState(): Promise<VersionedState<T>> {
    const [live, draft, history] = await Promise.all([getPlatformSetting(LIVE), getPlatformSetting(DRAFT), getPlatformSetting(HISTORY)]);
    return { live: parseConfig(live), draft: parseConfig(draft), history: parseHistory(history) };
  }

  return {
    keys: { live: LIVE, draft: DRAFT, history: HISTORY },
    parseConfig,
    parseHistory,
    /** Önbelleksiz canlı değer (yoksa/bozuksa null). */
    async readLive(): Promise<T | null> {
      return parseConfig(await getPlatformSetting(LIVE));
    },
    readState,
    async saveDraft(cfg: T, staffId: string): Promise<StoreResult> {
      return (await writeVerified(DRAFT, JSON.stringify(cfg), staffId)) ? { ok: true } : fail;
    },
    async publish(cfg: T, entry: EntryMeta, staffId: string): Promise<StoreResult> {
      const state = await readState();
      const history = trimHistory([{ ...entry, cfg }, ...state.history]);
      const json = JSON.stringify(cfg);
      if (!(await writeVerified(HISTORY, JSON.stringify(history), staffId))) return fail;
      if (!(await writeVerified(LIVE, json, staffId))) return fail;
      if (!(await writeVerified(DRAFT, json, staffId))) return fail;
      return { ok: true };
    },
    /** Canlıyı siler (site kod içi varsayılana döner), taslağı eşitler; eski canlı geçmişe yazılır. */
    async resetToDefault(entry: Omit<EntryMeta, "label">, staffId: string): Promise<StoreResult> {
      const state = await readState();
      if (state.live) {
        const history = trimHistory([{ ...entry, label: "Varsayılana dönmeden önceki yayın", cfg: state.live }, ...state.history]);
        if (!(await writeVerified(HISTORY, JSON.stringify(history), staffId))) return fail;
      }
      if (!(await writeVerified(LIVE, null, staffId))) return fail;
      if (!(await writeVerified(DRAFT, null, staffId))) return fail;
      return { ok: true };
    },
  };
}
