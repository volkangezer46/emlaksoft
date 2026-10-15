/**
 * Talep × portföy eşleşme DURUMU (CRM-G4) — SAF modül (DB/DOM yok; istemci bileşenleri de içe aktarabilir).
 *
 * Tablo: `demand_property_matches` (migration 20261018020000). Tek satır = tek çift; GÜNCEL durum + son gönderim /
 * gizleme bilgisi. Olay geçmişi audit_logs'ta (`match.sent`, `match.dismissed`, `match.restored`).
 *
 * Durum birleştirme kuralı (`mergeMatchState`): sistem önerisi ("suggested") var olan hiçbir durumu ezmez; daha çok bilgi
 * taşıyan durum (gösterildi > beğendi/beğenmedi > görüldü > gönderildi > önerildi) geri düşmez. Danışmanın açık kararları
 * ("uygun değil" ve "geri al") her zaman uygulanır; gizlenmiş çifti yeniden göndermek gizlemeyi kaldırır.
 */

export const MATCH_STATES = ["suggested", "sent", "viewed", "liked", "disliked", "shown", "dismissed"] as const;
export type MatchState = (typeof MATCH_STATES)[number];

export const MATCH_STATE_LABELS: Record<MatchState, string> = {
  suggested: "Önerildi",
  sent: "Gönderildi",
  viewed: "Müşteri açtı",
  liked: "Müşteri beğendi",
  disliked: "Müşteri beğenmedi",
  shown: "Yer gösterildi",
  dismissed: "Uygun değil",
};

export const DISMISS_REASONS = [
  { key: "price", label: "Fiyat uymuyor" },
  { key: "location", label: "Konum uymuyor" },
  { key: "floor", label: "Kat uymuyor" },
  { key: "rooms", label: "Oda sayısı uymuyor" },
  { key: "other", label: "Diğer" },
] as const;
export type DismissReason = (typeof DISMISS_REASONS)[number]["key"];

export const MATCH_CHANNELS = ["link", "whatsapp", "sms", "email", "presentation"] as const;
export type MatchChannel = (typeof MATCH_CHANNELS)[number];

const CHANNEL_LABELS: Record<MatchChannel, string> = {
  link: "bağlantı",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "e-posta",
  presentation: "sunum",
};

export function isMatchState(v: unknown): v is MatchState {
  return typeof v === "string" && (MATCH_STATES as readonly string[]).includes(v);
}
export function isDismissReason(v: unknown): v is DismissReason {
  return typeof v === "string" && DISMISS_REASONS.some((r) => r.key === v);
}
export function isMatchChannel(v: unknown): v is MatchChannel {
  return typeof v === "string" && (MATCH_CHANNELS as readonly string[]).includes(v);
}

export function dismissReasonLabel(v: string | null | undefined): string | null {
  return DISMISS_REASONS.find((r) => r.key === v)?.label ?? null;
}

/** Okuyucunun taşıdığı satır biçimi (select listesi `MATCH_STATE_COLUMNS`). */
export type MatchStateRow = {
  demand_id: string;
  property_id: string;
  state: MatchState;
  dismiss_reason: string | null;
  dismissed_at: string | null;
  sent_at: string | null;
  send_count: number;
  channel: string | null;
  share_token: string | null;
  updated_at: string;
};

export const MATCH_STATE_COLUMNS =
  "demand_id, property_id, state, dismiss_reason, dismissed_at, sent_at, send_count, channel, share_token, updated_at";

export const matchPairKey = (demandId: string, propertyId: string) => `${demandId}:${propertyId}`;

/** Bilgi sırası: yüksek olan düşükle ezilmez (açık danışman kararları hariç). */
const RANK: Record<MatchState, number> = {
  suggested: 0,
  sent: 1,
  viewed: 2,
  liked: 3,
  disliked: 3,
  shown: 4,
  dismissed: 5,
};

export type MatchEvent =
  | { kind: "suggest" }
  | { kind: "send" }
  | { kind: "view" }
  | { kind: "feedback"; liked: boolean }
  | { kind: "show" }
  | { kind: "dismiss" }
  | { kind: "restore" };

/**
 * Var olan durum + olay → yeni durum. `current` null ise satır yoktur.
 * `restore` gizlemeyi kaldırır: daha önce gönderildiyse "sent", yoksa "suggested".
 */
export function mergeMatchState(
  current: Pick<MatchStateRow, "state" | "sent_at"> | null,
  event: MatchEvent,
): MatchState {
  const cur = current?.state ?? null;
  switch (event.kind) {
    case "suggest":
      return cur ?? "suggested";
    case "dismiss":
      return "dismissed";
    case "restore":
      return current?.sent_at ? "sent" : "suggested";
    case "send":
      // Gizlenmiş çifti bilerek göndermek gizlemeyi kaldırır; daha ileri durum (görüldü/beğendi/gösterildi) korunur.
      if (cur == null || cur === "dismissed" || RANK[cur] < RANK.sent) return "sent";
      return cur;
    case "view":
      return cur == null || (cur !== "dismissed" && RANK[cur] < RANK.viewed) ? "viewed" : cur;
    case "feedback": {
      const next: MatchState = event.liked ? "liked" : "disliked";
      return cur == null || (cur !== "dismissed" && cur !== "shown") ? next : cur;
    }
    case "show":
      return cur === "dismissed" ? cur : "shown";
  }
}

/** Listeden gizlenen durumlar ("Gizlenenleri göster" ile açılır). */
export function isHiddenMatchState(state: MatchState | null | undefined): boolean {
  return state === "dismissed" || state === "disliked";
}

/** Gönderim sayılır mı (toplu gönderim önizlemesi daha önce gönderilenleri varsayılan hariç tutar). */
export function wasSent(row: Pick<MatchStateRow, "sent_at" | "send_count"> | null | undefined): boolean {
  return Boolean(row && (row.sent_at || row.send_count > 0));
}

function relativeDays(iso: string, nowMs: number): string {
  const days = Math.floor((nowMs - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return "bugün";
  if (days === 1) return "dün";
  return `${days} gün önce`;
}

export type MatchStateBadge = { label: string; tone: "info" | "success" | "warning" | "neutral"; title?: string };

/**
 * Satır rozeti: "3 gün önce WhatsApp ile gönderildi · açıldı", "Uygun değil · Fiyat uymuyor".
 * Öneri ("suggested") rozetsizdir — gürültü yok.
 */
export function matchStateBadge(
  row: MatchStateRow | null | undefined,
  nowMs: number,
  opts: { opened?: boolean } = {},
): MatchStateBadge | null {
  if (!row) return null;
  if (row.state === "dismissed") {
    const reason = dismissReasonLabel(row.dismiss_reason);
    return {
      label: reason ? `Uygun değil · ${reason}` : "Uygun değil",
      tone: "neutral",
      title: row.dismissed_at ? `${relativeDays(row.dismissed_at, nowMs)} gizlendi` : undefined,
    };
  }
  if (row.state === "disliked") return { label: "Müşteri beğenmedi", tone: "warning" };
  if (row.state === "shown") return { label: "Yer gösterildi", tone: "success" };
  if (row.state === "liked") return { label: "Müşteri beğendi", tone: "success" };
  if (row.sent_at) {
    const ch = isMatchChannel(row.channel) ? CHANNEL_LABELS[row.channel] : null;
    const parts = [`${relativeDays(row.sent_at, nowMs)} ${ch ? `${ch} ile ` : ""}gönderildi`];
    if (row.send_count > 1) parts.push(`${row.send_count}. gönderim`);
    if (opts.opened || row.state === "viewed") parts.push("açıldı");
    return { label: parts.join(" · "), tone: opts.opened || row.state === "viewed" ? "success" : "info" };
  }
  return null;
}

export const MATCH_BADGE_CLS: Record<MatchStateBadge["tone"], string> = {
  info: "bg-cyan-400/12 text-cyan-700",
  success: "bg-mint-500/12 text-mint-600",
  warning: "bg-amber-400/15 text-amber-700",
  neutral: "bg-ink-950/8 text-text-muted",
};
