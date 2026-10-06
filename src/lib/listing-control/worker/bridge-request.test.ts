import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRIDGE_HEADER, isSameOriginBridgeRequest } from "./bridge-request";

const req = (headers: Record<string, string>, url = "https://emlaksoft.vercel.app/api/app/ilan-kontrol/isci") => ({ url, headers: new Headers(headers) });

describe("eklenti ucu köken denetimi", () => {
  it("özel başlık + aynı köken kabul", () => {
    expect(isSameOriginBridgeRequest(req({ [BRIDGE_HEADER]: "1", origin: "https://emlaksoft.vercel.app" }))).toBe(true);
    expect(isSameOriginBridgeRequest(req({ [BRIDGE_HEADER]: "1", "sec-fetch-site": "same-origin" }))).toBe(true);
  });
  it("başlıksız, başka köken ya da siteler arası istek reddedilir", () => {
    expect(isSameOriginBridgeRequest(req({ origin: "https://emlaksoft.vercel.app" }))).toBe(false);
    expect(isSameOriginBridgeRequest(req({ [BRIDGE_HEADER]: "1", origin: "https://evil.example" }))).toBe(false);
    expect(isSameOriginBridgeRequest(req({ [BRIDGE_HEADER]: "1", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginBridgeRequest(req({ [BRIDGE_HEADER]: "1", origin: "chrome-extension://abc" }))).toBe(false);
  });
  it("uç yalnız mevcut işçi eylemlerine devreder: admin client yok, portala istek yok", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/app/ilan-kontrol/isci/route.ts"), "utf8");
    expect(src).not.toMatch(/createAdminClient|supabase\/admin/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).toContain("isSameOriginBridgeRequest(request)");
    expect(src).toContain("getRequestUser()");
    for (const fn of ["workerRegister", "workerClaim", "workerComplete", "workerRelease"]) expect(src).toContain(fn);
  });
});
