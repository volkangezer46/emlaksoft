import { createHmac, timingSafeEqual } from "node:crypto";

export const META_MAX_ENTRIES = 20;
export const META_MAX_CHANGES = 100;
export const META_MAX_MESSAGES = 100;
export const META_MAX_STATUSES = 200;
export const META_MAX_TEXT_LENGTH = 4096;
export const META_EVENT_CLAIM_LEASE_MS = 5 * 60 * 1000;

const META_MAX_ENTRY_CHANGES = 20;
const META_MAX_MESSAGE_ID_LENGTH = 512;
const META_MAX_TYPE_LENGTH = 64;

export type MetaInboundMessage = {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
};

export type ParsedMetaInboundMessage = {
  message: MetaInboundMessage;
  phoneNumberId: string;
  wabaId: string;
  /** Deliberately excludes sender address and message content. */
  eventPayload: Record<string, unknown>;
};

export type MetaDeliveryStatus = "sent" | "delivered" | "read" | "failed";

export type ParsedMetaDeliveryStatus = {
  messageId: string;
  phoneNumberId: string;
  wabaId: string;
  status: MetaDeliveryStatus;
  occurredAt: string;
  errorCode: string | null;
  /** Deliberately excludes recipient addresses and provider error details. */
  eventPayload: Record<string, unknown>;
};

export type MetaWebhookParseResult =
  | {
      ok: true;
      messages: ParsedMetaInboundMessage[];
      statuses: ParsedMetaDeliveryStatus[];
      ignoredChanges: number;
      ignoredStatuses: number;
    }
  | {
      ok: false;
      reason: "invalid_json" | "invalid_payload" | "payload_limit_exceeded";
    };

export type MetaEventClaimDecision = "claim" | "duplicate" | "busy" | "invalid";

export type MetaDeliveryState = {
  status: MetaDeliveryStatus;
  deliveredAt: string | null;
  readAt: string | null;
};

const META_DELIVERY_RANK: Record<Exclude<MetaDeliveryStatus, "failed">, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
};

/**
 * Meta explicitly warns that status notifications can arrive out of order.
 * This state machine is monotonic, so a late `sent`/`delivered` event cannot
 * erase `read`, and a late `failed` event cannot undo a confirmed delivery.
 */
export function advanceMetaDeliveryState(
  current: MetaDeliveryState,
  incoming: MetaDeliveryStatus,
  occurredAt: string,
): MetaDeliveryState | null {
  if (current.status === "failed") return null;
  if (incoming === "failed") {
    return META_DELIVERY_RANK[current.status] >= META_DELIVERY_RANK.delivered
      ? null
      : { ...current, status: "failed" };
  }

  if (META_DELIVERY_RANK[incoming] <= META_DELIVERY_RANK[current.status]) return null;
  return {
    status: incoming,
    deliveredAt:
      incoming === "delivered" || incoming === "read"
        ? current.deliveredAt ?? occurredAt
        : current.deliveredAt,
    readAt: incoming === "read" ? current.readAt ?? occurredAt : current.readAt,
  };
}

export function decideMetaEventClaim(
  status: string,
  lastAttemptAt: string | null | undefined,
  nowMs: number,
): MetaEventClaimDecision {
  if (["processed", "ignored", "unmatched", "quarantined"].includes(status)) {
    return "duplicate";
  }
  if (status === "received" || status === "failed") return "claim";
  if (status !== "processing") return "invalid";

  const lastAttemptMs = Date.parse(lastAttemptAt ?? "");
  return Number.isFinite(lastAttemptMs) && lastAttemptMs > nowMs - META_EVENT_CLAIM_LEASE_MS
    ? "busy"
    : "claim";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, max: number, min = 1): value is string {
  return typeof value === "string" && value.length >= min && value.length <= max;
}

/**
 * Verify Meta's `sha256=<hex>` signature against the exact bytes received.
 * A fixed 32-byte comparison is performed even when the header is malformed.
 */
export function verifyMetaSignature(
  appSecret: string,
  bodyBytes: Uint8Array,
  signatureHeader: string | null,
): boolean {
  const expected = createHmac("sha256", appSecret).update(bodyBytes).digest();
  const supplied = Buffer.alloc(expected.length);
  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(signatureHeader ?? "");
  if (match) Buffer.from(match[1]!, "hex").copy(supplied);
  const equal = timingSafeEqual(expected, supplied);
  return Boolean(match) && equal;
}

export function parseMetaWebhookBytes(bodyBytes: Uint8Array): MetaWebhookParseResult {
  let payload: unknown;
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
    payload = JSON.parse(json) as unknown;
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  return parseMetaWebhookPayload(payload);
}

export function parseMetaWebhookPayload(payload: unknown): MetaWebhookParseResult {
  if (!isRecord(payload) || payload.object !== "whatsapp_business_account") {
    return { ok: false, reason: "invalid_payload" };
  }
  if (!Array.isArray(payload.entry) || payload.entry.length === 0) {
    return { ok: false, reason: "invalid_payload" };
  }
  if (payload.entry.length > META_MAX_ENTRIES) {
    return { ok: false, reason: "payload_limit_exceeded" };
  }

  const parsed: ParsedMetaInboundMessage[] = [];
  const parsedStatuses: ParsedMetaDeliveryStatus[] = [];
  let changeCount = 0;
  let statusCount = 0;
  let ignoredChanges = 0;
  let ignoredStatuses = 0;

  for (const entry of payload.entry) {
    if (
      !isRecord(entry) ||
      !isBoundedString(entry.id, 32, 5) ||
      !/^\d+$/.test(entry.id)
    ) {
      return { ok: false, reason: "invalid_payload" };
    }
    const wabaId = entry.id;
    if (!Array.isArray(entry.changes) || entry.changes.length === 0) {
      return { ok: false, reason: "invalid_payload" };
    }
    if (entry.changes.length > META_MAX_ENTRY_CHANGES) {
      return { ok: false, reason: "payload_limit_exceeded" };
    }
    changeCount += entry.changes.length;
    if (changeCount > META_MAX_CHANGES) {
      return { ok: false, reason: "payload_limit_exceeded" };
    }

    for (const change of entry.changes) {
      if (!isRecord(change) || !isBoundedString(change.field, META_MAX_TYPE_LENGTH)) {
        return { ok: false, reason: "invalid_payload" };
      }
      if (change.field !== "messages") {
        ignoredChanges += 1;
        continue;
      }
      if (!isRecord(change.value) || change.value.messaging_product !== "whatsapp") {
        return { ok: false, reason: "invalid_payload" };
      }

      const metadata = change.value.metadata;
      if (!isRecord(metadata)) return { ok: false, reason: "invalid_payload" };
      const phoneNumberId = metadata.phone_number_id;
      if (!isBoundedString(phoneNumberId, 32) || !/^\d+$/.test(phoneNumberId)) {
        return { ok: false, reason: "invalid_payload" };
      }

      const statuses = change.value.statuses;
      if (statuses !== undefined) {
        if (!Array.isArray(statuses)) return { ok: false, reason: "invalid_payload" };
        statusCount += statuses.length;
        if (statusCount > META_MAX_STATUSES) {
          return { ok: false, reason: "payload_limit_exceeded" };
        }
        for (const status of statuses) {
          if (!isRecord(status)) return { ok: false, reason: "invalid_payload" };
          if (
            !isBoundedString(status.id, META_MAX_MESSAGE_ID_LENGTH) ||
            !isBoundedString(status.status, META_MAX_TYPE_LENGTH) ||
            !isBoundedString(status.timestamp, 20) ||
            !/^\d+$/.test(status.timestamp)
          ) {
            return { ok: false, reason: "invalid_payload" };
          }

          if (!["sent", "delivered", "read", "failed"].includes(status.status)) {
            ignoredStatuses += 1;
            continue;
          }

          const timestampMs = Number(status.timestamp) * 1000;
          const occurredAt = new Date(timestampMs);
          if (
            !Number.isSafeInteger(Number(status.timestamp)) ||
            !Number.isFinite(occurredAt.getTime()) ||
            occurredAt.getUTCFullYear() < 2000 ||
            occurredAt.getUTCFullYear() > 2100
          ) {
            return { ok: false, reason: "invalid_payload" };
          }

          let errorCode: string | null = null;
          if (status.errors !== undefined) {
            if (!Array.isArray(status.errors) || status.errors.length > 20) {
              return { ok: false, reason: "invalid_payload" };
            }
            const firstError = status.errors[0];
            if (firstError !== undefined) {
              if (!isRecord(firstError)) return { ok: false, reason: "invalid_payload" };
              const code = firstError.code;
              if (
                (typeof code !== "string" && typeof code !== "number") ||
                String(code).length > 64
              ) {
                return { ok: false, reason: "invalid_payload" };
              }
              errorCode = String(code);
            }
          }

          parsedStatuses.push({
            messageId: status.id,
            phoneNumberId,
            wabaId,
            status: status.status as MetaDeliveryStatus,
            occurredAt: occurredAt.toISOString(),
            errorCode,
            eventPayload: {
              field: "messages",
              messaging_product: "whatsapp",
              phone_number_id: phoneNumberId,
              waba_id: wabaId,
              message_id: status.id,
              delivery_status: status.status,
              timestamp: status.timestamp,
              error_code: errorCode,
            },
          });
        }
      }

      const messages = change.value.messages;
      if (messages === undefined) {
        ignoredChanges += 1;
        continue;
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        return { ok: false, reason: "invalid_payload" };
      }
      if (parsed.length + messages.length > META_MAX_MESSAGES) {
        return { ok: false, reason: "payload_limit_exceeded" };
      }

      for (const candidate of messages) {
        if (!isRecord(candidate)) return { ok: false, reason: "invalid_payload" };
        if (!isBoundedString(candidate.id, META_MAX_MESSAGE_ID_LENGTH)) {
          return { ok: false, reason: "invalid_payload" };
        }
        if (!isBoundedString(candidate.from, 32) || !/^\+?\d{5,32}$/.test(candidate.from)) {
          return { ok: false, reason: "invalid_payload" };
        }
        if (
          !isBoundedString(candidate.type, META_MAX_TYPE_LENGTH) ||
          !/^[a-z0-9_]+$/.test(candidate.type)
        ) {
          return { ok: false, reason: "invalid_payload" };
        }
        if (
          candidate.timestamp !== undefined &&
          (!isBoundedString(candidate.timestamp, 20) || !/^\d+$/.test(candidate.timestamp))
        ) {
          return { ok: false, reason: "invalid_payload" };
        }

        let text: MetaInboundMessage["text"];
        if (candidate.type === "text") {
          if (!isRecord(candidate.text) || !isBoundedString(candidate.text.body, META_MAX_TEXT_LENGTH, 0)) {
            return { ok: false, reason: "invalid_payload" };
          }
          text = { body: candidate.text.body };
        }

        const message: MetaInboundMessage = {
          id: candidate.id,
          from: candidate.from,
          timestamp: candidate.timestamp as string | undefined,
          type: candidate.type,
          ...(text ? { text } : {}),
        };
        parsed.push({
          message,
          phoneNumberId,
          wabaId,
          eventPayload: {
            field: "messages",
            messaging_product: "whatsapp",
            phone_number_id: phoneNumberId,
            waba_id: wabaId,
            message_id: message.id,
            message_type: message.type,
            timestamp: message.timestamp ?? null,
          },
        });
      }
    }
  }

  return {
    ok: true,
    messages: parsed,
    statuses: parsedStatuses,
    ignoredChanges,
    ignoredStatuses,
  };
}
