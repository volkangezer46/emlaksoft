import type { AppSession, ExtensionStatusView } from "@/lib/listing-control/worker/extension-status-view";

/**
 * Eklenti içi ileti sözleşmesi (içerik betiği / açılır pencere → service worker). Sayfa ↔ eklenti sözleşmesi AYRI ve
 * tek kaynaktır: `src/lib/listing-control/worker/bridge.ts` (uygulamanın dosyası doğrudan derlenir).
 */

export type ProbeJob = { portal: string; url: string; externalId: string | null };
export type InventoryJob = { portal: string; url: string };

export type OutboxPut = {
  jobId: string;
  clientId: string;
  result: string;
  observed: Record<string, unknown>;
  telemetry: Record<string, unknown> | null;
};

export type BgRequest =
  | { kind: "status" }
  | { kind: "setPaused"; paused: boolean }
  /** Kullanıcı eylemiyle bağla/kes. Yalnız açılır pencere ya da izinli EmlakSoft sekmesi gönderebilir (arka planda doğrulanır). */
  | { kind: "setConnected"; connected: boolean }
  /** İçerik betiği: EmlakSoft sekmesi görüldü / oturum durumu. */
  | { kind: "appSeen"; session: AppSession }
  | { kind: "saveSettings"; settings: unknown }
  | { kind: "lease"; token: string }
  | { kind: "releaseLease"; token: string }
  | { kind: "deviceKey" }
  | { kind: "canFetch" }
  | { kind: "probe"; job: ProbeJob; wait: boolean }
  | { kind: "inventory"; job: InventoryJob }
  | { kind: "outboxPut"; entry: OutboxPut }
  | { kind: "outboxDue" }
  | { kind: "outboxDone"; jobId: string }
  | { kind: "outboxFail"; jobId: string }
  /** Günlük mağaza taraması: şimdi başlat (açılır pencere / sayfadaki "Şimdi tara"; bağlı olmak şart). */
  | { kind: "scanNow" }
  /** İçerik betiği: EmlakSoft'a yüklenmeyi bekleyen tarama sonucu (en çok 1) ve sonucu. */
  | { kind: "scanPendingDue" }
  | { kind: "scanPendingDone"; id: string }
  | { kind: "scanPendingFail"; id: string }
  /** (0.4.0) Kullanıcının onayladığı TEK sahibinden ilan kaydı: kuyruğa yazılır, açık EmlakSoft sekmesi gönderir. */
  | { kind: "fsboPut"; payload: unknown }
  | { kind: "fsboPendingDue" }
  | { kind: "fsboPendingDone"; id: string; summary: string }
  | { kind: "fsboPendingFail"; id: string }
  | { kind: "fsboLast" }
  /**
   * (0.5.0) Portala aktar: içerik betiği EmlakSoft'tan tükettiği paketi (`data`) ve fotoğrafları service worker'a verir;
   * açılır pencere portal sekmesinde formu bu paketle doldurur. Fotoğraflar `chrome.storage.session`'da tutulur (tarayıcı kapanınca silinir).
   */
  | { kind: "transferPut"; data: unknown }
  | { kind: "transferPhoto"; sessionId: string; index: number; name: string; type: string; b64: string }
  | { kind: "transferPhotosDone"; sessionId: string; skipped: number }
  | { kind: "transferGet" }
  | { kind: "transferPhotos"; from: number; count: number }
  | { kind: "transferClear" }
  /** (0.5.0) Yayın sonrası ilan no/URL (ve ilerleme) → kuyruk → açık EmlakSoft sekmesi `tamamla` ucuna gönderir. */
  | { kind: "transferDonePut"; payload: unknown }
  | { kind: "transferDoneDue" }
  | { kind: "transferDoneAck"; id: string; ok: boolean; summary: string }
  | { kind: "transferDoneFail"; id: string }
  /** (0.5.0) Portaldaki ilanlarımı EmlakSoft'a al: kullanıcının seçtikleri kuyruğa yazılır, içerik betiği `ice-al` ucuna gönderir. */
  | { kind: "importPut"; payload: unknown }
  | { kind: "importDue" }
  | { kind: "importAck"; id: string; ok: boolean; summary: string }
  | { kind: "importFail"; id: string }
  | { kind: "importLast" };

/** Sayfadan (externally_connectable) gelen TEK ileti türü: salt okunur yoklama. Bağlama ve veri okuma bu kanaldan YAPILMAZ. */
export type ExternalRequest = { kind: "ping" };

export type StatusReply = ExtensionStatusView;

export const STORAGE_KEYS = {
  paused: "es_paused",
  pacing: "es_pacing",
  deviceKey: "es_device_key",
  stats: "es_stats",
  lease: "es_lease",
  pairing: "es_pairing",
  app: "es_app",
  settings: "es_settings",
  health: "es_health",
  history: "es_history",
  recent: "es_recent",
  outbox: "es_outbox",
  /** Türetilmiş bayraklar ({connected, paused}); içerik betiği belge köküne yansıtır. */
  flags: "es_flags",
  /** Süren günlük tarama ilerlemesi (MV3 service worker kapanırsa dakikalık alarm kaldığı yerden sürdürür). */
  scan: "es_scan",
  scanStates: "es_scan_states",
  /** EmlakSoft'a yüklenmeyi bekleyen tarama sonuçları. */
  scanUploads: "es_scan_uploads",
  /** EmlakSoft'a gönderilmeyi bekleyen sahibinden ilan kayıtları ve son gönderim özeti. */
  fsboPending: "es_fsbo_pending",
  fsboLast: "es_fsbo_last",
  /** (0.5.0) Portala aktar: kodu tüketilmiş paket (kalıcı, küçük) ve fotoğraflar (oturum deposu; `es_tphoto_<sıra>`). */
  transfer: "es_transfer",
  transferPhotoPrefix: "es_tphoto_",
  transferDone: "es_transfer_done",
  transferDoneLast: "es_transfer_done_last",
  importPending: "es_import_pending",
  importLast: "es_import_last",
} as const;

export const ALARM_TICK = "es-tick";
/** Saatte bir uyanır; son tam taramadan 20 saat geçtiyse günlük taramayı başlatır (kaçırılan gün ilk açılışta telafi edilir). */
export const ALARM_SCAN = "es-scan";
