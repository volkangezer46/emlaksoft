/**
 * Eklenti içi ileti sözleşmesi (içerik betiği / açılır pencere → service worker). Sayfa ↔ eklenti sözleşmesi AYRI ve
 * tek kaynaktır: `src/lib/listing-control/worker/bridge.ts` (uygulamanın dosyası doğrudan derlenir).
 */

export type ProbeJob = { portal: string; url: string; externalId: string | null };
export type InventoryJob = { portal: string; url: string };

export type BgRequest =
  | { kind: "status" }
  | { kind: "setPaused"; paused: boolean }
  | { kind: "lease"; token: string }
  | { kind: "releaseLease"; token: string }
  | { kind: "deviceKey" }
  | { kind: "canFetch" }
  | { kind: "probe"; job: ProbeJob; wait: boolean }
  | { kind: "inventory"; job: InventoryJob };

export type StatusReply = {
  paused: boolean;
  today: number;
  lastAt: number | null;
  lastOutcome: "found" | "not_found" | "blocked" | "error" | null;
  lastError: string | null;
  cooldownUntil: number;
  leaderActive: boolean;
  version: string;
  rulesVersion: string;
};

export const STORAGE_KEYS = {
  paused: "es_paused",
  pacing: "es_pacing",
  deviceKey: "es_device_key",
  stats: "es_stats",
  lease: "es_lease",
} as const;
