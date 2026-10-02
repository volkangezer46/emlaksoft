import { createHash } from "node:crypto";

// Netgsm's official URL forwarding contract has exactly these five fields.
// Broad aliases such as `to`/`number` are deliberately rejected: confusing a
// customer number with subscriberNumber would route an SMS to the wrong tenant.
const EVENT_ID_KEYS = ["messageid"] as const;
const RECEIVER_KEYS = ["subscribernumber"] as const;
const SOURCE_KEYS = ["sourcenumber"] as const;
const MESSAGE_KEYS = ["content"] as const;
const SENT_AT_KEYS = ["messagedatetime"] as const;

export const NETGSM_EVENT_CLAIM_LEASE_MS = 5 * 60 * 1000;

export type NetgsmInboundMessage = {
  providerEventId: string;
  receiver: string;
  sourceNumber: string;
  message: string;
  sentAt: string | null;
};

export type NetgsmInboundParseResult =
  | { ok: true; value: NetgsmInboundMessage }
  | { ok: false; reason: "missing_event_id" | "missing_receiver" | "missing_source" | "missing_message" };

export type NetgsmEventClaimDecision = "claim" | "duplicate" | "busy" | "invalid";

export function decideNetgsmEventClaim(
  status: string,
  lastAttemptAt: string | null | undefined,
  nowMs: number,
): NetgsmEventClaimDecision {
  if (["processed", "ignored", "unmatched", "quarantined"].includes(status)) {
    return "duplicate";
  }
  if (status === "received" || status === "failed") return "claim";
  if (status !== "processing") return "invalid";

  const lastAttemptMs = Date.parse(lastAttemptAt ?? "");
  return Number.isFinite(lastAttemptMs) && lastAttemptMs > nowMs - NETGSM_EVENT_CLAIM_LEASE_MS
    ? "busy"
    : "claim";
}

function pick(fields: Record<string, string>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = fields[key]?.trim();
    if (value) return value;
  }
  return "";
}

/** Netgsm subscriberNumber values are stored as digits without +90/leading 0. */
export function canonicalizeNetgsmReceiver(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("90")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

export function parseNetgsmInbound(fields: Record<string, string>): NetgsmInboundParseResult {
  const eventId = pick(fields, EVENT_ID_KEYS).slice(0, 160);
  if (!eventId) return { ok: false, reason: "missing_event_id" };

  const receiver = canonicalizeNetgsmReceiver(pick(fields, RECEIVER_KEYS));
  if (receiver.length < 4 || receiver.length > 20) {
    return { ok: false, reason: "missing_receiver" };
  }

  const sourceNumber = pick(fields, SOURCE_KEYS).slice(0, 40);
  if (!sourceNumber) return { ok: false, reason: "missing_source" };

  const message = pick(fields, MESSAGE_KEYS).slice(0, 2_000);
  if (!message) return { ok: false, reason: "missing_message" };

  return {
    ok: true,
    value: {
      providerEventId: `inbound:${eventId}`,
      receiver,
      sourceNumber,
      message,
      sentAt: pick(fields, SENT_AT_KEYS).slice(0, 80) || null,
    },
  };
}

/** Stable fallback identity for malformed events that still need quarantine dedupe. */
export function fingerprintNetgsmFields(fields: Record<string, string>): string {
  const canonical = Object.entries(fields)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return `quarantine:${createHash("sha256").update(canonical).digest("hex")}`;
}

/** Webhook inbox evidence without customer phone or message content. */
export function netgsmInboxPayload(message: NetgsmInboundMessage): Record<string, unknown> {
  return {
    field: "inbound_sms",
    provider_event_id: message.providerEventId,
    receiver: message.receiver,
    sent_at: message.sentAt,
  };
}
