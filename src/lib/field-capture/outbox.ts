/**
 * Saha formları için YEREL TASLAK + ÇEVRİMDIŞI GÖNDERİM KUYRUĞU (istemci; bağımlılıksız, saf çekirdek + tarayıcı deposu).
 *
 * Taslak: form alanları yazdıkça bu cihazda saklanır; sayfa yenilense/sekme kapansa geri gelir, kayıt başarılı olunca silinir.
 * Kuyruk: bağlantı yokken (ya da istek ağ hatasıyla düştüğünde) form değerleri İSTEK KİMLİĞİYLE sıraya girer; bağlantı gelince
 * sırayla gönderilir. Aynı kuyruk iki kez boşaltılmaya çalışılsa da (çevrimiçi olayı + sayfa açılışı, iki sekme) her öğe aynı
 * istek kimliğiyle gider ve sunucudaki fren (`submission-guard.ts`) ikinci kaydı açmaz; sekme içinde de boşaltma tek uçuşludur.
 * Depo yalnız bu tarayıcıdadır (localStorage); erişilemezse (gizli pencere, engelli site verisi) taslak/kuyruk sessizce kapalıdır
 * ve form normal çalışır. Kişisel veri (ad, telefon) cihazda en çok 7 gün tutulur.
 */

export type OutboxKind = "customer" | "call" | "appointment" | "property";

export type OutboxItem = {
  /** İstek kimliği (UUID) — sunucuda çift kayıt freni anahtarı. */
  id: string;
  kind: OutboxKind;
  /** FormData girdileri (yalnız metin). */
  fields: [string, string][];
  /** Listede gösterilecek kısa ad ("Müşteri: Ali Kaya"). */
  label: string;
  createdAt: number;
  attempts: number;
  state: "pending" | "failed";
  lastError?: string;
};

export type KeyValueStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

export type SendOutcome =
  | { kind: "ok"; id?: string }
  /** Sunucu iş kuralıyla reddetti (eksik alan, çakışma...): otomatik yeniden denenmez, kullanıcı forma geri yükler. */
  | { kind: "rejected"; error: string }
  /** Ağ/geçici hata: kuyrukta kalır, sonra yeniden denenir. */
  | { kind: "retry"; error?: string };

export const OUTBOX_KEY = "emlaksoft:saha-kuyruk:v1";
const DRAFT_PREFIX = "emlaksoft:saha-taslak:v1:";
export const DRAFT_TTL_MS = 7 * 86_400_000;
const MAX_ITEMS = 50;

let browserStoreCache: KeyValueStore | null | undefined;

/**
 * localStorage sarmalayıcısı (sekme başına TEK örnek: tek uçuş kilidi bu örneğe bağlı); her erişim try/catch
 * (gizli pencere / engelli depo). Sunucuda null.
 */
export function browserStore(): KeyValueStore | null {
  if (typeof window === "undefined") return null;
  if (browserStoreCache !== undefined) return browserStoreCache;
  browserStoreCache = createBrowserStore();
  return browserStoreCache;
}

function createBrowserStore(): KeyValueStore | null {
  try {
    if (!window.localStorage) return null;
    const ls = window.localStorage;
    return {
      get: (k) => {
        try {
          return ls.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k, v) => {
        try {
          ls.setItem(k, v);
        } catch {
          // kota dolu / engelli: taslak bu kez saklanamadı
        }
      },
      remove: (k) => {
        try {
          ls.removeItem(k);
        } catch {
          // yok say
        }
      },
    };
  } catch {
    return null;
  }
}

/** Bellek içi depo (testler ve depo erişilemediğinde). */
export function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

function isItem(x: unknown): x is OutboxItem {
  const o = x as OutboxItem;
  return Boolean(o && typeof o.id === "string" && typeof o.kind === "string" && Array.isArray(o.fields) && typeof o.createdAt === "number");
}

export function readOutbox(store: KeyValueStore | null): OutboxItem[] {
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.get(OUTBOX_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return [];
  }
}

function writeOutbox(store: KeyValueStore, items: OutboxItem[]) {
  if (items.length === 0) store.remove(OUTBOX_KEY);
  else store.set(OUTBOX_KEY, JSON.stringify(items.slice(-MAX_ITEMS)));
}

/** Formu kuyruğa ekler. Aynı istek kimliği zaten sıradaysa yeni öğe eklenmez (çift dokunma). */
export function enqueueOutbox(
  store: KeyValueStore | null,
  input: { id: string; kind: OutboxKind; fields: [string, string][]; label: string; nowMs: number },
): boolean {
  if (!store) return false;
  const items = readOutbox(store);
  if (items.some((i) => i.id === input.id)) return true;
  items.push({ id: input.id, kind: input.kind, fields: input.fields, label: input.label, createdAt: input.nowMs, attempts: 0, state: "pending" });
  writeOutbox(store, items);
  return readOutbox(store).some((i) => i.id === input.id);
}

export function removeOutboxItem(store: KeyValueStore | null, id: string) {
  if (!store) return;
  writeOutbox(store, readOutbox(store).filter((i) => i.id !== id));
}

function patchItem(store: KeyValueStore, id: string, patch: Partial<OutboxItem>) {
  writeOutbox(store, readOutbox(store).map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

export type FlushReport = { sent: OutboxItem[]; rejected: OutboxItem[]; pending: number };

const inflight = new WeakMap<KeyValueStore, Promise<FlushReport>>();

/**
 * Bekleyen öğeleri SIRAYLA gönderir. Tek uçuşlu: boşaltma sürerken gelen ikinci çağrı aynı sözü döner (aynı öğe iki kez
 * gönderilmez). Başarılı öğe kuyruktan çıkar; reddedilen "failed" olur (kullanıcı forma geri yükler ya da siler); geçici
 * hata kuyrukta kalır ve boşaltma durur (bağlantı yine gitmiş olabilir).
 */
export function flushOutbox(
  store: KeyValueStore | null,
  send: (item: OutboxItem) => Promise<SendOutcome>,
): Promise<FlushReport> {
  if (!store) return Promise.resolve({ sent: [], rejected: [], pending: 0 });
  const running = inflight.get(store);
  if (running) return running;
  const run = (async (): Promise<FlushReport> => {
    const sent: OutboxItem[] = [];
    const rejected: OutboxItem[] = [];
    for (const item of readOutbox(store).filter((i) => i.state === "pending")) {
      // Başka sekme bu arada göndermiş olabilir: güncel depoda hâlâ bekliyor mu?
      if (!readOutbox(store).some((i) => i.id === item.id && i.state === "pending")) continue;
      let outcome: SendOutcome;
      try {
        outcome = await send(item);
      } catch {
        outcome = { kind: "retry" };
      }
      if (outcome.kind === "ok") {
        removeOutboxItem(store, item.id);
        sent.push(item);
      } else if (outcome.kind === "rejected") {
        patchItem(store, item.id, { state: "failed", attempts: item.attempts + 1, lastError: outcome.error });
        rejected.push({ ...item, state: "failed", lastError: outcome.error });
      } else {
        patchItem(store, item.id, { attempts: item.attempts + 1, lastError: outcome.error });
        break;
      }
    }
    return { sent, rejected, pending: readOutbox(store).filter((i) => i.state === "pending").length };
  })().finally(() => inflight.delete(store));
  inflight.set(store, run);
  return run;
}

/** Sunucu action sonucunu kuyruk sonucuna çevirir ("az önce gönderildi" yanıtı geçicidir). */
export function outcomeFromResult(res: { ok?: boolean; id?: string; error?: string } | null | undefined): SendOutcome {
  if (res?.ok) return { kind: "ok", id: res.id };
  const error = res?.error ?? "Kayıt gönderilemedi.";
  if (/az önce gönderildi/i.test(error)) return { kind: "retry", error };
  return { kind: "rejected", error };
}

/** Sunucu action'ı ağ hatasıyla mı düştü (yanıt hiç gelmedi)? */
export function isNetworkFailure(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = e instanceof Error ? `${e.name} ${e.message}` : String(e ?? "");
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg);
}

// ---------------------------------------------------------------------------
// Taslak
// ---------------------------------------------------------------------------

export type DraftValues = Record<string, string>;

export function formValues(form: HTMLFormElement, skip: readonly string[] = []): DraftValues {
  const out: DraftValues = {};
  for (const [k, v] of new FormData(form).entries()) {
    if (typeof v !== "string" || skip.includes(k)) continue;
    out[k] = v.slice(0, 4000);
  }
  return out;
}

export function saveDraft(store: KeyValueStore | null, key: string, values: DraftValues, nowMs: number) {
  if (!store) return;
  const meaningful = Object.entries(values).some(([, v]) => v.trim() !== "");
  if (!meaningful) {
    store.remove(DRAFT_PREFIX + key);
    return;
  }
  store.set(DRAFT_PREFIX + key, JSON.stringify({ at: nowMs, values }));
}

export function loadDraft(store: KeyValueStore | null, key: string, nowMs: number): DraftValues | null {
  if (!store) return null;
  try {
    const parsed = JSON.parse(store.get(DRAFT_PREFIX + key) ?? "null") as { at?: number; values?: DraftValues } | null;
    if (!parsed || typeof parsed.at !== "number" || !parsed.values) return null;
    if (nowMs - parsed.at > DRAFT_TTL_MS) {
      store.remove(DRAFT_PREFIX + key);
      return null;
    }
    return parsed.values;
  } catch {
    return null;
  }
}

export function clearDraft(store: KeyValueStore | null, key: string) {
  store?.remove(DRAFT_PREFIX + key);
}
