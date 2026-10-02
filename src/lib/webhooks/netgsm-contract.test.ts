import { describe, expect, it } from "vitest";
import {
  NETGSM_EVENT_CLAIM_LEASE_MS,
  canonicalizeNetgsmReceiver,
  decideNetgsmEventClaim,
  fingerprintNetgsmFields,
  netgsmInboxPayload,
  parseNetgsmInbound,
} from "./netgsm-contract";

describe("Netgsm inbound contract", () => {
  it("parses the official Gelen SMS payload and keeps messageId as idempotency identity", () => {
    expect(
      parseNetgsmInbound({
        messageid: "120210000",
        subscribernumber: "8501234567",
        sourcenumber: "5101234567",
        messagedatetime: "2026-05-18 10:37:20",
        content: "Mesaj metni",
      }),
    ).toEqual({
      ok: true,
      value: {
        providerEventId: "inbound:120210000",
        receiver: "8501234567",
        sourceNumber: "5101234567",
        message: "Mesaj metni",
        sentAt: "2026-05-18 10:37:20",
      },
    });
  });

  it("canonicalizes Turkish receiver display formats to the provider account key", () => {
    expect(canonicalizeNetgsmReceiver("+90 (850) 123 45 67")).toBe("8501234567");
    expect(canonicalizeNetgsmReceiver("0850 123 45 67")).toBe("8501234567");
    expect(canonicalizeNetgsmReceiver("4600")).toBe("4600");
  });

  it("rejects deliveries without an exact receiver instead of guessing a tenant", () => {
    expect(
      parseNetgsmInbound({
        messageid: "120210000",
        sourcenumber: "5101234567",
        content: "Mesaj metni",
      }),
    ).toEqual({ ok: false, reason: "missing_receiver" });
  });

  it("rejects non-contract aliases that could confuse a customer with the receiver", () => {
    expect(
      parseNetgsmInbound({
        id: "120210000",
        to: "8501234567",
        from: "5101234567",
        message: "Mesaj metni",
      }),
    ).toEqual({ ok: false, reason: "missing_event_id" });
  });

  it("creates an order-independent quarantine fingerprint", () => {
    expect(fingerprintNetgsmFields({ a: "1", b: "2" })).toBe(
      fingerprintNetgsmFields({ b: "2", a: "1" }),
    );
  });

  it("keeps inbox evidence free of customer phone and message content", () => {
    const parsed = parseNetgsmInbound({
      messageid: "120210000",
      subscribernumber: "8501234567",
      sourcenumber: "5101234567",
      messagedatetime: "2026-05-18 10:37:20",
      content: "Çok özel mesaj",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const evidence = JSON.stringify(netgsmInboxPayload(parsed.value));
    expect(evidence).not.toContain("5101234567");
    expect(evidence).not.toContain("Çok özel mesaj");
  });
});

describe("Netgsm event claim lease", () => {
  const now = Date.parse("2026-08-10T12:00:00.000Z");

  it.each(["received", "failed"])("claims retryable %s events", (status) => {
    expect(decideNetgsmEventClaim(status, null, now)).toBe("claim");
  });

  it.each(["processed", "ignored", "unmatched", "quarantined"])(
    "deduplicates terminal %s events",
    (status) => {
      expect(decideNetgsmEventClaim(status, null, now)).toBe("duplicate");
    },
  );

  it("keeps a fresh processing lease busy and reclaims a stale one", () => {
    expect(decideNetgsmEventClaim("processing", new Date(now - 1000).toISOString(), now)).toBe("busy");
    expect(
      decideNetgsmEventClaim(
        "processing",
        new Date(now - NETGSM_EVENT_CLAIM_LEASE_MS - 1).toISOString(),
        now,
      ),
    ).toBe("claim");
    expect(decideNetgsmEventClaim("processing", "invalid", now)).toBe("claim");
  });
});
