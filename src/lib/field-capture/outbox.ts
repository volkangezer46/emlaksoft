/**
 * Saha formları için YEREL TASLAK + ÇEVRİMDIŞI GÖNDERİM KUYRUĞU (istemci; bağımlılıksız, saf çekirdek + tarayıcı deposu).
 *
 * Taslak: form alanları yazdıkça bu cihazda saklanır; sayfa yenilense/sekme kapansa geri gelir, kayıt başarılı olunca silinir.
 * Kuyruk: bağlantı yokken (ya da istek ağ hatasıyla düştüğünde) form değerleri İSTEK KİMLİĞİYLE sıraya girer; bağlantı gelince
 * sırayla gönderilir. Aynı kuyruk iki kez boşaltılmaya çalışılsa da (çevrimiçi olayı + sayfa açılışı, iki sekme) her öğe aynı
 * istek kimliğiyle gider ve sunucudaki fren (`submission-guard.ts`) ikinci kaydı açmaz; sekme içinde de boşaltma tek uçuşludur.
 * Depo yalnız bu tarayıcıdadır (localStorage); erişilemezse (gizli pencere, engelli site verisi) taslak/kuyruk sessizce kapalıdır
 * ve form normal çalışır. Kişisel veri (ad, telefon) cihazda en çok 7 gün tutulur: süresi dolan taslak okunurken, süresi
 * dolan kuyruk öğesi (bekleyen ya da reddedilen) `pruneOutbox` ile silinir.
 *
 * KAPSAM: kuyruk ve taslak anahtarları KİRACI + KULLANICIya bağlıdır (`<önek>:<tenant>:<user>`); aynı cihazda başka
 * kullanıcı ya da başka ofis (aktif ofis değişimi, "ofis adına gör") bir öncekinin kuyruğunu/taslağını göremez ve
 * gönderemez. Öğe ayrıca kiracı/kullanıcıyı taşır ve sunucu gönderimde oturumla karşılaştırır (bkz. `submission-guard.ts`
 * `scopeMismatchError`). Çıkışta `clearFieldCaptureStorage` bu cihazdaki tüm saha anahtarlarını siler.
 */

export type OutboxKind = "customer" | "call" | "appointment" | "property";

/** Kuyruk/taslak sahibi: aktif oturumun kiracısı ve kullanıcısı. */
export type CaptureScope = { tenantId: string; userId: string };

/** Sunucuya giden kapsam alanları (sunucu oturumla karşılaştırır). */
export const SCOPE_TENANT_FIELD = "client_tenant_id";
export const SCOPE_USER_FIELD = "client_user_id";

export type OutboxItem = {
  /** İstek kimliği (UUID) — sunucuda çift kayıt freni anahtarı. */
  id: string;
  kind: OutboxKind;
  /** FormData girdileri (yalnız metin; fotoğraflar IndexedDB'de, öğeye `photo_batch` alanıyla bağlı — `photo-queue.ts`). */
  fields: [string, string][];
  /** Listede gösterilecek kısa ad ("Müşteri: Ali Kaya"). */
  label: string;
  /** Sıraya alan oturum (kapsam dışı öğe okunmaz, gönderilmez). */
  tenantId: string;
  userId: string;
  /** Seçici alanların (müşteri/portföy) görünen etiketi: forma geri yüklemede seçim etiketiyle gelir. */
  labels?: Record<string, string>;
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

/** Bu cihazdaki tüm saha anahtarlarının ortak öneki (çıkışta silinir). */
export const FIELD_CAPTURE_PREFIX = "emlaksoft:saha-";
const OUTBOX_PREFIX = `${FIELD_CAPTURE_PREFIX}kuyruk:v1:`;
const DRAFT_PREFIX = `${FIELD_CAPTURE_PREFIX}taslak:v1:`;
export const DRAFT_TTL_MS = 7 * 86_400_000;
/** Kuyruk öğesinin cihazda en uzun kalma süresi (taslakla aynı KVKK sınırı). */
export const OUTBOX_TTL_MS = DRAFT_TTL_MS;
const MAX_ITEMS = 50;
/** Saha fotoğraf kuyruğunun IndexedDB adı (`photo-idb.ts`); çıkışta saha anahtarlarıyla birlikte silinir. */
export const FIELD_PHOTO_DB = "emlaksoft-saha-foto";
/**
 * Yüklenmeyi bekleyen fotoğrafı olan portföy sayısının kapsam başına özeti (IndexedDB eşzamansız; çıkış uyarısı
 * eşzamanlı okur). `photo-sync.ts` yazar; önek saha öneki olduğu için çıkışta silinir.
 */
const PHOTO_PENDING_PREFIX = `${FIELD_CAPTURE_PREFIX}foto-bekleyen:v1:`;

export function writePendingPhotoCount(store: KeyValueStore | null, scope: CaptureScope, count: number) {
  if (!store) return;
  const key = PHOTO_PENDING_PREFIX + scopeId(scope);
  if (count > 0) store.set(key, String(count));
  else store.remove(key);
}

function scopeId(scope: CaptureScope): string {
  return `${scope.tenantId || "-"}:${scope.userId || "-"}`;
}

/** Kapsamın kuyruk anahtarı (depo olayı dinleyicisi de bunu kullanır). */
export function outboxKey(scope: CaptureScope): string {
  return OUTBOX_PREFIX + scopeId(scope);
}

/** Depo olayındaki anahtar bir kuyruk anahtarı mı (sekmeler arası güncelleme). */
export function isOutboxStorageKey(key: string | null): boolean {
  return key === null || key.startsWith(OUTBOX_PREFIX);
}

function draftStorageKey(scope: CaptureScope, key: string): string {
  return `${DRAFT_PREFIX}${scopeId(scope)}:${key}`;
}

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
  return Boolean(
    o &&
      typeof o.id === "string" &&
      typeof o.kind === "string" &&
      Array.isArray(o.fields) &&
      typeof o.createdAt === "number" &&
      typeof o.tenantId === "string" &&
      typeof o.userId === "string",
  );
}

/** Kapsamın kuyruğu; başka kiracı/kullanıcıya ait öğe (anahtar kurcalanmış olsa da) okunmaz. */
export function readOutbox(store: KeyValueStore | null, scope: CaptureScope): OutboxItem[] {
  if (!store) return [];
  try {
    const parsed = JSON.parse(store.get(outboxKey(scope)) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(isItem).filter((i) => i.tenantId === scope.tenantId && i.userId === scope.userId)
      : [];
  } catch {
    return [];
  }
}

function writeOutbox(store: KeyValueStore, scope: CaptureScope, items: OutboxItem[]) {
  if (items.length === 0) store.remove(outboxKey(scope));
  else store.set(outboxKey(scope), JSON.stringify(items.slice(-MAX_ITEMS)));
}

/** Formu kuyruğa ekler. Aynı istek kimliği zaten sıradaysa yeni öğe eklenmez (çift dokunma). */
export function enqueueOutbox(
  store: KeyValueStore | null,
  scope: CaptureScope,
  input: { id: string; kind: OutboxKind; fields: [string, string][]; label: string; labels?: Record<string, string>; nowMs: number },
): boolean {
  if (!store) return false;
  const items = readOutbox(store, scope);
  if (items.some((i) => i.id === input.id)) return true;
  items.push({
    id: input.id,
    kind: input.kind,
    fields: input.fields,
    label: input.label,
    tenantId: scope.tenantId,
    userId: scope.userId,
    ...(input.labels && Object.keys(input.labels).length > 0 ? { labels: input.labels } : {}),
    createdAt: input.nowMs,
    attempts: 0,
    state: "pending",
  });
  writeOutbox(store, scope, items);
  return readOutbox(store, scope).some((i) => i.id === input.id);
}

export function removeOutboxItem(store: KeyValueStore | null, scope: CaptureScope, id: string) {
  if (!store) return;
  writeOutbox(store, scope, readOutbox(store, scope).filter((i) => i.id !== id));
}

function patchItem(store: KeyValueStore, scope: CaptureScope, id: string, patch: Partial<OutboxItem>) {
  writeOutbox(store, scope, readOutbox(store, scope).map((i) => (i.id === id ? { ...i, ...patch } : i)));
}

/** Öğe 7 günü aştı mı (bekleyen ya da reddedilen fark etmez; kişisel veri cihazda süresiz kalmaz). */
export function isOutboxItemExpired(item: Pick<OutboxItem, "createdAt">, nowMs: number): boolean {
  return nowMs - item.createdAt > OUTBOX_TTL_MS;
}

/** Süresi dolan öğeleri kuyruktan siler ve silinenleri döner (panel kullanıcıya bildirir). */
export function pruneOutbox(store: KeyValueStore | null, scope: CaptureScope, nowMs: number): OutboxItem[] {
  if (!store) return [];
  const items = readOutbox(store, scope);
  const expired = items.filter((i) => isOutboxItemExpired(i, nowMs));
  if (expired.length > 0) writeOutbox(store, scope, items.filter((i) => !isOutboxItemExpired(i, nowMs)));
  return expired;
}

export type FlushReport = { sent: OutboxItem[]; rejected: OutboxItem[]; expired: OutboxItem[]; pending: number };

// Tek uçuş kilidi depo + kapsam başına.
const inflight = new WeakMap<KeyValueStore, Map<string, Promise<FlushReport>>>();

/**
 * Bekleyen öğeleri SIRAYLA gönderir. Tek uçuşlu: boşaltma sürerken gelen ikinci çağrı aynı sözü döner (aynı öğe iki kez
 * gönderilmez). Başarılı öğe kuyruktan çıkar; reddedilen "failed" olur (kullanıcı forma geri yükler ya da siler); geçici
 * hata kuyrukta kalır ve boşaltma durur (bağlantı yine gitmiş olabilir). Yalnız `scope`un öğeleri gönderilir; süresi dolan
 * öğeler önce budanır (gönderilmez).
 */
export function flushOutbox(
  store: KeyValueStore | null,
  scope: CaptureScope,
  send: (item: OutboxItem) => Promise<SendOutcome>,
  nowMs: number,
): Promise<FlushReport> {
  if (!store) return Promise.resolve({ sent: [], rejected: [], expired: [], pending: 0 });
  let byScope = inflight.get(store);
  if (!byScope) {
    byScope = new Map();
    inflight.set(store, byScope);
  }
  const sid = scopeId(scope);
  const running = byScope.get(sid);
  if (running) return running;
  const run = (async (): Promise<FlushReport> => {
    const sent: OutboxItem[] = [];
    const rejected: OutboxItem[] = [];
    const expired = pruneOutbox(store, scope, nowMs);
    for (const item of readOutbox(store, scope).filter((i) => i.state === "pending")) {
      // Başka sekme bu arada göndermiş olabilir: güncel depoda hâlâ bekliyor mu?
      if (!readOutbox(store, scope).some((i) => i.id === item.id && i.state === "pending")) continue;
      let outcome: SendOutcome;
      try {
        outcome = await send(item);
      } catch {
        outcome = { kind: "retry" };
      }
      if (outcome.kind === "ok") {
        removeOutboxItem(store, scope, item.id);
        sent.push(item);
      } else if (outcome.kind === "rejected") {
        patchItem(store, scope, item.id, { state: "failed", attempts: item.attempts + 1, lastError: outcome.error });
        rejected.push({ ...item, state: "failed", lastError: outcome.error });
      } else {
        patchItem(store, scope, item.id, { attempts: item.attempts + 1, lastError: outcome.error });
        break;
      }
    }
    return { sent, rejected, expired, pending: readOutbox(store, scope).filter((i) => i.state === "pending").length };
  })().finally(() => byScope.delete(sid));
  byScope.set(sid, run);
  return run;
}

export const CONFLICT_HINT = "Forma geri yükleyip kontrol edin; yine de kaydetmek için \"Yine de kaydet\" seçin.";
export const DUPLICATE_ERROR =
  "Benzer bir portföy zaten kayıtlı (mükerrer olabilir). Forma geri yükleyip kontrol edin; yine de açmak için \"Yine de yeni taslak aç\" seçin.";

/**
 * Sunucu action sonucunu kuyruk sonucuna çevirir ("az önce gönderildi" yanıtı geçicidir). Randevu çakışması
 * (`conflictWarning`, `error` boş) ve mükerrer portföy (`duplicate`) gerçek nedeniyle reddedilir.
 */
export function outcomeFromResult(
  res: { ok?: boolean; id?: string; error?: string; conflictWarning?: string; duplicate?: boolean } | null | undefined,
): SendOutcome {
  if (res?.ok) return { kind: "ok", id: res.id };
  if (res?.conflictWarning) return { kind: "rejected", error: `${res.conflictWarning} ${CONFLICT_HINT}` };
  if (res?.duplicate) return { kind: "rejected", error: DUPLICATE_ERROR };
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

/** Geri yüklenen seçici etiketinin taslaktaki anahtarı (form alanı değildir, sunucuya gitmez). */
export function pickerLabelKey(field: string): string {
  return `${field}:etiket`;
}

export function saveDraft(store: KeyValueStore | null, scope: CaptureScope, key: string, values: DraftValues, nowMs: number) {
  if (!store) return;
  const sk = draftStorageKey(scope, key);
  const meaningful = Object.entries(values).some(([, v]) => v.trim() !== "");
  if (!meaningful) {
    store.remove(sk);
    return;
  }
  store.set(sk, JSON.stringify({ at: nowMs, values }));
}

export function loadDraft(store: KeyValueStore | null, scope: CaptureScope, key: string, nowMs: number): DraftValues | null {
  if (!store) return null;
  const sk = draftStorageKey(scope, key);
  try {
    const parsed = JSON.parse(store.get(sk) ?? "null") as { at?: number; values?: DraftValues } | null;
    if (!parsed || typeof parsed.at !== "number" || !parsed.values) return null;
    if (nowMs - parsed.at > DRAFT_TTL_MS) {
      store.remove(sk);
      return null;
    }
    return parsed.values;
  } catch {
    return null;
  }
}

export function clearDraft(store: KeyValueStore | null, scope: CaptureScope, key: string) {
  store?.remove(draftStorageKey(scope, key));
}

// ---------------------------------------------------------------------------
// Çıkış temizliği
// ---------------------------------------------------------------------------

/** Anahtar listeleyebilen depo (localStorage); testte bellek içi eşi verilir. */
export type EnumerableStore = { length: number; key(index: number): string | null; getItem(key: string): string | null; removeItem(key: string): void };

function localStorageOrNull(): EnumerableStore | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

function fieldCaptureKeys(ls: EnumerableStore): string[] {
  const keys: string[] = [];
  for (let i = 0; i < ls.length; i += 1) {
    const k = ls.key(i);
    if (k && k.startsWith(FIELD_CAPTURE_PREFIX)) keys.push(k);
  }
  return keys;
}

/**
 * Bu cihazdaki (tüm kapsamların) gönderilmemiş kuyruk öğesi sayısı + fotoğrafları henüz yüklenmemiş portföy sayısı:
 * çıkışta kullanıcı uyarılır.
 */
export function countUnsentOnDevice(ls: EnumerableStore | null = localStorageOrNull()): number {
  if (!ls) return 0;
  try {
    let n = 0;
    for (const k of fieldCaptureKeys(ls)) {
      if (k.startsWith(PHOTO_PENDING_PREFIX)) {
        const c = Number(ls.getItem(k));
        if (Number.isFinite(c) && c > 0) n += Math.floor(c);
        continue;
      }
      if (!k.startsWith(OUTBOX_PREFIX)) continue;
      const parsed = JSON.parse(ls.getItem(k) ?? "[]") as unknown;
      if (Array.isArray(parsed)) n += parsed.filter(isItem).length;
    }
    return n;
  } catch {
    return 0;
  }
}

/**
 * Çıkışta bu cihazdaki TÜM saha taslaklarını, kuyruklarını ve kuyruktaki fotoğrafları (IndexedDB) siler (kişisel veri
 * sonraki kullanıcıya kalmaz).
 */
export function clearFieldCaptureStorage(ls: EnumerableStore | null = localStorageOrNull()) {
  try {
    if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(FIELD_PHOTO_DB);
  } catch {
    // IndexedDB yok/engelli: fotoğraf kuyruğu da yoktur
  }
  if (!ls) return;
  try {
    for (const k of fieldCaptureKeys(ls)) ls.removeItem(k);
  } catch {
    // depo erişilemedi: yapılacak bir şey yok
  }
}
