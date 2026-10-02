import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  META_MAX_CHANGES,
  META_MAX_ENTRIES,
  META_MAX_MESSAGES,
  META_MAX_STATUSES,
  META_MAX_TEXT_LENGTH,
  META_EVENT_CLAIM_LEASE_MS,
  advanceMetaDeliveryState,
  decideMetaEventClaim,
  parseMetaWebhookBytes,
  parseMetaWebhookPayload,
  verifyMetaSignature,
} from "@/lib/webhooks/meta-contract";

const encoder = new TextEncoder();

function message(id = "wamid.message-1", body = "Merhaba") {
  return {
    id,
    from: "905551112233",
    timestamp: "1786377600",
    type: "text",
    text: { body },
  };
}

function payload(messages: unknown[] | null = [message()], statuses?: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123456789012345",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "905550000000",
                phone_number_id: "987654321098765",
              },
              ...(messages === null ? {} : { messages }),
              ...(statuses === undefined ? {} : { statuses }),
            },
          },
        ],
      },
    ],
  };
}

describe("Meta webhook signature", () => {
  it("validates HMAC-SHA256 over the exact raw bytes", () => {
    const secret = "meta-app-secret";
    const bytes = encoder.encode('{"text":"İstanbul"}\n');
    const signature = `sha256=${createHmac("sha256", secret).update(bytes).digest("hex")}`;

    expect(verifyMetaSignature(secret, bytes, signature)).toBe(true);
    expect(verifyMetaSignature(secret, encoder.encode('{"text":"İstanbul"}'), signature)).toBe(false);
  });

  it.each([null, "", "sha1=abc", "sha256=xyz", `sha256=${"0".repeat(63)}`])(
    "rejects malformed signatures without throwing (%s)",
    (signature) => {
      expect(verifyMetaSignature("secret", encoder.encode("{}"), signature)).toBe(false);
    },
  );
});

describe("Meta event claim lease", () => {
  const now = Date.parse("2026-08-10T12:00:00.000Z");

  it.each(["received", "failed"])("claims retryable %s events", (status) => {
    expect(decideMetaEventClaim(status, null, now)).toBe("claim");
  });

  it.each(["processed", "ignored", "unmatched", "quarantined"])(
    "deduplicates terminal %s events",
    (status) => {
      expect(decideMetaEventClaim(status, null, now)).toBe("duplicate");
    },
  );

  it("keeps a fresh processing lease busy and reclaims a stale one", () => {
    expect(decideMetaEventClaim("processing", new Date(now - 1000).toISOString(), now)).toBe("busy");
    expect(
      decideMetaEventClaim(
        "processing",
        new Date(now - META_EVENT_CLAIM_LEASE_MS - 1).toISOString(),
        now,
      ),
    ).toBe("claim");
    expect(decideMetaEventClaim("processing", "not-a-date", now)).toBe("claim");
  });

  it("rejects unknown inbox states", () => {
    expect(decideMetaEventClaim("mystery", null, now)).toBe("invalid");
  });
});

describe("Meta delivery status state machine", () => {
  const sentAt = "2026-08-10T12:00:00.000Z";
  const deliveredAt = "2026-08-10T12:01:00.000Z";
  const readAt = "2026-08-10T12:02:00.000Z";

  it("advances sent -> delivered -> read while preserving first timestamps", () => {
    const delivered = advanceMetaDeliveryState(
      { status: "sent", deliveredAt: null, readAt: null },
      "delivered",
      deliveredAt,
    );
    expect(delivered).toEqual({ status: "delivered", deliveredAt, readAt: null });
    expect(advanceMetaDeliveryState(delivered!, "read", readAt)).toEqual({
      status: "read",
      deliveredAt,
      readAt,
    });
  });

  it("does not regress when Meta delivers status webhooks out of order", () => {
    const read = { status: "read" as const, deliveredAt, readAt };
    expect(advanceMetaDeliveryState(read, "sent", sentAt)).toBeNull();
    expect(advanceMetaDeliveryState(read, "delivered", deliveredAt)).toBeNull();
    expect(advanceMetaDeliveryState(read, "failed", readAt)).toBeNull();
  });

  it("accepts failure only before a confirmed delivery", () => {
    expect(
      advanceMetaDeliveryState(
        { status: "sent", deliveredAt: null, readAt: null },
        "failed",
        sentAt,
      ),
    ).toEqual({ status: "failed", deliveredAt: null, readAt: null });
    expect(
      advanceMetaDeliveryState(
        { status: "delivered", deliveredAt, readAt: null },
        "failed",
        readAt,
      ),
    ).toBeNull();
  });
});

describe("Meta webhook payload parser", () => {
  it("extracts message batches and emits a PII-minimized inbox payload", () => {
    const parsed = parseMetaWebhookPayload(payload());

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]).toMatchObject({
      phoneNumberId: "987654321098765",
      wabaId: "123456789012345",
      message: { id: "wamid.message-1", from: "905551112233", type: "text" },
    });
    const inboxPayload = JSON.stringify(parsed.messages[0]!.eventPayload);
    expect(inboxPayload).not.toContain("905551112233");
    expect(inboxPayload).not.toContain("Merhaba");
  });

  it("extracts status-only changes without recipient PII", () => {
    const parsed = parseMetaWebhookPayload(
      payload(null, [
        { id: "wamid.outbound-1", status: "delivered", timestamp: "1786377601" },
      ]),
    );

    expect(parsed).toMatchObject({
      ok: true,
      messages: [],
      ignoredChanges: 1,
      ignoredStatuses: 0,
    });
    if (!parsed.ok) return;
    expect(parsed.statuses).toHaveLength(1);
    expect(parsed.statuses[0]).toMatchObject({
      messageId: "wamid.outbound-1",
      phoneNumberId: "987654321098765",
      wabaId: "123456789012345",
      status: "delivered",
      occurredAt: "2026-08-10T16:00:01.000Z",
    });
    expect(JSON.stringify(parsed.statuses[0]!.eventPayload)).not.toContain("recipient_id");
  });

  it("handles mixed status and inbound message batches", () => {
    const body = payload([message("wamid.inbound")], [
      { id: "wamid.outbound", status: "read", timestamp: "1786377601" },
    ]);
    const parsed = parseMetaWebhookPayload(body);

    expect(parsed).toMatchObject({ ok: true, ignoredStatuses: 0 });
    if (parsed.ok) {
      expect(parsed.messages).toHaveLength(1);
      expect(parsed.statuses).toHaveLength(1);
    }
  });

  it("ignores provider statuses outside the delivery allowlist", () => {
    const parsed = parseMetaWebhookPayload(
      payload(null, [
        { id: "wamid.outbound", status: "deleted", timestamp: "1786377601" },
      ]),
    );

    expect(parsed).toMatchObject({ ok: true, statuses: [], ignoredStatuses: 1 });
  });

  it.each([
    [null, "invalid_payload"],
    [{}, "invalid_payload"],
    [{ ...payload(), object: "page" }, "invalid_payload"],
    [{ ...payload(), entry: [] }, "invalid_payload"],
    [{ ...payload(), entry: [{ ...payload().entry[0], id: "fake-waba" }] }, "invalid_payload"],
    [payload([]), "invalid_payload"],
    [payload([{ ...message(), from: "not-a-phone" }]), "invalid_payload"],
    [payload([{ ...message(), id: "" }]), "invalid_payload"],
    [payload([{ ...message(), timestamp: "yesterday" }]), "invalid_payload"],
    [payload([{ ...message(), type: "TEXT" }]), "invalid_payload"],
    [payload([{ ...message(), text: { body: 123 } }]), "invalid_payload"],
    [payload(null, [{ id: "wamid.outbound", status: "read" }]), "invalid_payload"],
    [payload(null, [{ id: "", status: "read", timestamp: "1786377601" }]), "invalid_payload"],
    [payload(null, [{ id: "wamid.outbound", status: "read", timestamp: "yesterday" }]), "invalid_payload"],
  ])("rejects malformed payload shape %#", (input, reason) => {
    expect(parseMetaWebhookPayload(input)).toEqual({ ok: false, reason });
  });

  it("enforces text and batch cardinality limits", () => {
    expect(parseMetaWebhookPayload(payload([message("wamid.long", "x".repeat(META_MAX_TEXT_LENGTH + 1))])))
      .toEqual({ ok: false, reason: "invalid_payload" });

    expect(
      parseMetaWebhookPayload(
        payload(Array.from({ length: META_MAX_MESSAGES + 1 }, (_, index) => message(`wamid.${index}`))),
      ),
    ).toEqual({ ok: false, reason: "payload_limit_exceeded" });

    expect(
      parseMetaWebhookPayload(
        payload(null, Array.from({ length: META_MAX_STATUSES + 1 }, () => ({ status: "read" }))),
      ),
    ).toEqual({ ok: false, reason: "payload_limit_exceeded" });
  });

  it("enforces entry and change limits", () => {
    const base = payload();
    expect(
      parseMetaWebhookPayload({
        ...base,
        entry: Array.from({ length: META_MAX_ENTRIES + 1 }, () => base.entry[0]),
      }),
    ).toEqual({ ok: false, reason: "payload_limit_exceeded" });

    const entries = Array.from({ length: Math.ceil((META_MAX_CHANGES + 1) / 20) }, (_, entryIndex) => ({
      id: String(10000 + entryIndex),
      changes: Array.from(
        { length: Math.min(20, META_MAX_CHANGES + 1 - entryIndex * 20) },
        () => ({ field: "account_update", value: {} }),
      ),
    }));
    expect(parseMetaWebhookPayload({ object: "whatsapp_business_account", entry: entries })).toEqual({
      ok: false,
      reason: "payload_limit_exceeded",
    });
  });

  it("returns invalid_json for malformed JSON and invalid UTF-8", () => {
    expect(parseMetaWebhookBytes(encoder.encode("{"))).toEqual({ ok: false, reason: "invalid_json" });
    expect(parseMetaWebhookBytes(Uint8Array.from([0xc3, 0x28]))).toEqual({
      ok: false,
      reason: "invalid_json",
    });
  });
});
