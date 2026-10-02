import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ingestMessage = vi.fn();
const ingestStatus = vi.fn();
vi.mock("@/lib/webhooks/meta-inbound", () => ({
  ingestMetaInboundMessage: (...a: unknown[]) => ingestMessage(...a),
  ingestMetaDeliveryStatus: (...a: unknown[]) => ingestStatus(...a),
}));

import { GET, POST } from "./route";

const SECRET = "test-app-secret";
const URL_BASE = "http://localhost/api/webhooks/meta";

function sign(body: string, secret = SECRET) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}
function post(body: string, headers: Record<string, string> = {}) {
  return new NextRequest(URL_BASE, { method: "POST", body, headers });
}

describe("meta webhook", () => {
  beforeEach(() => {
    ingestMessage.mockReset();
    ingestStatus.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POST: META_APP_SECRET yoksa 503 (kapalı güvenli)", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    const res = await POST(post("{}", { "x-hub-signature-256": sign("{}") }));
    expect(res.status).toBe(503);
    expect(ingestMessage).not.toHaveBeenCalled();
  });

  it("POST: imza yoksa veya yanlışsa 401 ve içeri alım yapılmaz", async () => {
    vi.stubEnv("META_APP_SECRET", SECRET);
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    expect((await POST(post(body))).status).toBe(401);
    expect((await POST(post(body, { "x-hub-signature-256": sign(body, "other") }))).status).toBe(401);
    expect((await POST(post(body, { "x-hub-signature-256": "sha256=zz" }))).status).toBe(401);
    expect(ingestMessage).not.toHaveBeenCalled();
    expect(ingestStatus).not.toHaveBeenCalled();
  });

  it("POST: imzalı ama bozuk JSON gövde 400", async () => {
    vi.stubEnv("META_APP_SECRET", SECRET);
    const body = "{not json";
    const res = await POST(post(body, { "x-hub-signature-256": sign(body) }));
    expect(res.status).toBe(400);
    expect(ingestMessage).not.toHaveBeenCalled();
  });

  it("POST: çok büyük Content-Length 413", async () => {
    vi.stubEnv("META_APP_SECRET", SECRET);
    const res = await POST(
      post("{}", { "content-length": "999999999", "x-hub-signature-256": sign("{}") }),
    );
    expect(res.status).toBe(413);
  });

  it("GET: META_VERIFY_TOKEN yoksa 503, yanlış token 403, doğru token challenge", async () => {
    const q = (t: string) =>
      new NextRequest(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=abc123`);
    vi.stubEnv("META_VERIFY_TOKEN", "");
    expect((await GET(q("x"))).status).toBe(503);
    vi.stubEnv("META_VERIFY_TOKEN", "tok");
    expect((await GET(q("wrong"))).status).toBe(403);
    const ok = await GET(q("tok"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("abc123");
  });
});
