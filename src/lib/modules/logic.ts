import { FEATURE_KEYS, isFeatureKey, normalizeClosed, type FeatureKey } from "@/lib/modules/registry";

/**
 * Modül durumu saf mantığı (sunucu/istemci/test ortak). DB'den gelen satırlardan
 * "kapalı" ve "platform kilitli" kümelerini çıkarır. SATIR YOKSA AÇIK.
 */

export type ModuleRow = { module_key: string; enabled: boolean; locked_by_platform: boolean };

/**
 * ok: tablo okundu. unavailable: tablo henüz yok (migration uygulanmadı), tüm modüller AÇIK.
 * error: beklenmeyen okuma hatası, güvenli varsayılan AÇIK ama arayüz uyarı gösterir (sessiz yutma yok).
 */
export type ModuleStateStatus = "ok" | "unavailable" | "error";

export type TenantModuleState = {
  status: ModuleStateStatus;
  /** Kapalı modüller (çekirdek asla burada olmaz). */
  closed: FeatureKey[];
  /** Platformun kilitlediği modüller (ofis değiştiremez). */
  locked: FeatureKey[];
  /** error durumunda gösterilecek kısa metin. */
  message?: string;
};

export const ALL_OPEN_STATE: TenantModuleState = { status: "ok", closed: [], locked: [] };

export function unavailableState(): TenantModuleState {
  return { status: "unavailable", closed: [], locked: [] };
}

/** Satırlardan durum. Bilinmeyen/çekirdek anahtarlar yok sayılır (çekirdek kapatılamaz). */
export function resolveModuleState(rows: readonly ModuleRow[]): TenantModuleState {
  const closed = new Set<FeatureKey>();
  const locked = new Set<FeatureKey>();
  for (const row of rows) {
    if (!isFeatureKey(row.module_key)) continue;
    if (row.enabled === false) closed.add(row.module_key);
    if (row.locked_by_platform === true) locked.add(row.module_key);
  }
  // Bağımlılık tutarlılığı: kapalı modüle bağlı olan modül de kapalı sayılır (ör. portallar kapalı -> kaçak da).
  return {
    status: "ok",
    closed: normalizeClosed(closed),
    locked: FEATURE_KEYS.filter((k) => locked.has(k)),
  };
}

export function isFeatureEnabledIn(state: Pick<TenantModuleState, "closed">, key: string): boolean {
  if (!isFeatureKey(key)) return true;
  return !state.closed.includes(key);
}

/** PostgREST/Postgres "tablo yok" hatası mı? (migration henüz uygulanmamış) */
export function isMissingTableError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42P01" || code === "PGRST205") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("tenant_modules") && (msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find"));
}

/** Okuma sonucundan durum (hata türüne göre). */
export function stateFromQuery(
  rows: readonly ModuleRow[] | null | undefined,
  error: { code?: string | null; message?: string | null } | null | undefined,
): TenantModuleState {
  if (error) {
    if (isMissingTableError(error)) return unavailableState();
    return { status: "error", closed: [], locked: [], message: "Modül durumu okunamadı; tüm modüller açık gösteriliyor." };
  }
  return resolveModuleState(rows ?? []);
}

/* ------------------------------ Ofis tipi ön ayarları ------------------------------ */

export type ModulePreset = {
  id: "konut" | "arsa_ticari" | "kiralama" | "franchise";
  title: string;
  desc: string;
  close: readonly FeatureKey[];
  open: readonly FeatureKey[];
};

export const MODULE_PRESETS: readonly ModulePreset[] = [
  {
    id: "konut",
    title: "Konut ağırlıklı",
    desc: "Konut alım-satım ofisi: proje, yabancıya satış, şube ve TV panosu kapanır; diğerleri açık kalır.",
    close: ["projects", "foreign_sale", "franchise", "tv_board"],
    open: FEATURE_KEYS.filter((k) => !["projects", "foreign_sale", "franchise", "tv_board"].includes(k)),
  },
  {
    id: "arsa_ticari",
    title: "Arsa ve ticari",
    desc: "Arsa ve ticari gayrimenkul: açık ev, kiralama, kampanya, şube ve TV panosu kapanır.",
    close: ["open_house", "rentals", "campaigns", "tv_board", "franchise"],
    open: ["foreign_sale", "projects", "network", "presentations", "valuation"],
  },
  {
    id: "kiralama",
    title: "Kiralama ve mülk yönetimi",
    desc: "Kira ağırlıklı ofis: kiralama, gider, sözleşme, belge, anahtar ve portal açık; satış odaklı araçlar kapanır.",
    close: ["projects", "foreign_sale", "network", "franchise", "portals", "leak", "open_house"],
    open: ["rentals", "expenses", "contracts", "documents", "keys", "client_portals", "campaigns"],
  },
  {
    id: "franchise",
    title: "Franchise ve çok şubeli",
    desc: "Çok şubeli yapı: ekip performansı, şube raporları, onay, TV panosu, rapor ve ağ açılır.",
    close: [],
    open: ["team_perf", "franchise", "approvals", "tv_board", "reports", "network"],
  },
];

export type PresetChange = { toClose: FeatureKey[]; toOpen: FeatureKey[]; skipped: { key: FeatureKey; reason: "platform" | "paket" }[] };

/**
 * Ön ayarın uygulanmasıyla oluşacak değişiklik (önizleme ve uygulama aynı fonksiyon).
 * Platform kilitli ve pakette olmayan modüllere dokunulmaz; bağımlılıklar tutarlı bırakılır.
 */
export function computePresetChanges(
  preset: ModulePreset,
  currentClosed: readonly string[],
  opts: { locked?: readonly string[]; planLocked?: readonly string[] } = {},
): PresetChange {
  const locked = new Set(opts.locked ?? []);
  const planLocked = new Set(opts.planLocked ?? []);
  const skipped: PresetChange["skipped"] = [];
  const untouchable = (k: FeatureKey) => {
    if (locked.has(k)) {
      skipped.push({ key: k, reason: "platform" });
      return true;
    }
    if (planLocked.has(k)) {
      skipped.push({ key: k, reason: "paket" });
      return true;
    }
    return false;
  };

  const next = new Set<FeatureKey>(currentClosed.filter(isFeatureKey));
  for (const k of preset.open) {
    if (untouchable(k)) continue;
    next.delete(k);
  }
  for (const k of preset.close) {
    if (untouchable(k)) continue;
    next.add(k);
  }
  // Açılan modülün kapalı bağımlılığı varsa o modül kapalı kalır (normalize ile tutarlı); kilitli satırlar dokunulmaz.
  const normalized = new Set(normalizeClosed(next));
  for (const k of locked) if (isFeatureKey(k) && !currentClosed.includes(k)) normalized.delete(k);
  const before = new Set<FeatureKey>(normalizeClosed(currentClosed));
  const toClose = FEATURE_KEYS.filter((k) => normalized.has(k) && !before.has(k) && !locked.has(k) && !planLocked.has(k));
  const toOpen = FEATURE_KEYS.filter((k) => !normalized.has(k) && before.has(k) && !locked.has(k) && !planLocked.has(k));
  return { toClose, toOpen, skipped };
}
