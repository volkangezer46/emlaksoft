import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ingest = vi.fn();
const quarantine = vi.fn();
vi.mock("@/lib/webhooks/netgsm-inbound", () => ({
  ingestNetgsmInbound: (...a: unknown[]) => ingest(...a),
  quarantineNetgsmEvent: (...a: unknown[]) => quarantine(...a),
}));

import { POST } from "./route";

const URL_BASE = "http://localhost/api/webhooks/netgsm-sms";

function post(body: string, headers: Record<string, string> = {}, qs = "") {
  return new NextRequest(URL_BASE + qs, { method: "POST", body, headers });
}

describe("netgsm-sms webhook", () => {
  beforeEach(() => {
    ingest.mockReset();
    quarantine.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("secret tanımsızsa 503", async () => {
    vi.stubEnv("NETGSM_WEBHOOK_SECRET", "");
    const res = await POST(post("a=b", { "x-webhook-secret": "x" }));
    expect(res.status).toBe(503);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("secret eksik veya yanlışsa 401", async () => {
    vi.stubEnv("NETGSM_WEBHOOK_SECRET", "s3cret");
    expect((await POST(post("a=b"))).status).toBe(401);
    expect((await POST(post("a=b", { "x-webhook-secret": "nope" }))).status).toBe(401);
    expect((await POST(post("a=b", {}, "?secret=nope"))).status).toBe(401);
    expect(ingest).not.toHaveBeenCalled();
    expect(quarantine).not.toHaveBeenCalled();
  });

  it("doğru secret + bozuk JSON gövde 400", async () => {
    vi.stubEnv("NETGSM_WEBHOOK_SECRET", "s3cret");
    const res = await POST(
      post("{broken", { "x-webhook-secret": "s3cret", "content-type": "application/json" }),
    );
    expect(res.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });

  it("desteklenmeyen content-type 400", async () => {
    vi.stubEnv("NETGSM_WEBHOOK_SECRET", "s3cret");
    const res = await POST(
      post("<x/>", { "x-webhook-secret": "s3cret", "content-type": "application/xml" }),
    );
    expect(res.status).toBe(400);
  });

  it("çok büyük Content-Length 413", async () => {
    vi.stubEnv("NETGSM_WEBHOOK_SECRET", "s3cret");
    const res = await POST(
      post("a=b", { "x-webhook-secret": "s3cret", "content-length": "999999999" }),
    );
    expect(res.status).toBe(413);
  });

  it("geçerli secret ama eksik alanlar karantinaya alınır (202), içeri alım yok", async () => {
    vi.stubEnv("NETGSM_WEBHOOK_SECRET", "s3cret");
    quarantine.mockResolvedValue({ ok: true });
    const res = await POST(post("foo=bar", { "x-webhook-secret": "s3cret" }));
    expect(res.status).toBe(202);
    expect(quarantine).toHaveBeenCalledTimes(1);
    expect(ingest).not.toHaveBeenCalled();
  });
});
