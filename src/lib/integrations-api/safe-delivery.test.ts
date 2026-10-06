import { describe, expect, it } from "vitest";
import { guardedLookup, isForbiddenIp, safeWebhookPost } from "@/lib/integrations-api/safe-delivery";

describe("isForbiddenIp", () => {
  it("özel / yerel / link-local / metadata / ayrılmış IPv4 reddedilir", () => {
    for (const ip of [
      "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
      "192.168.1.1", "192.0.2.5", "198.18.0.1", "203.0.113.9", "224.0.0.1", "255.255.255.255",
    ]) expect(isForbiddenIp(ip), ip).toBe(true);
  });
  it("genel IPv4 kabul edilir", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.216.34"]) expect(isForbiddenIp(ip), ip).toBe(false);
  });
  it("IPv6: döngü, ULA, link-local, eşlenmiş/gömülü özel IPv4, NAT64/6to4 reddedilir; genel kabul", () => {
    for (const ip of ["::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe", "2002:0a00:0001::1", "2001:db8::1"]) {
      expect(isForbiddenIp(ip), ip).toBe(true);
    }
    for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8"]) expect(isForbiddenIp(ip), ip).toBe(false);
  });
  it("tanınmayan biçim reddedilir (fail-closed)", () => {
    expect(isForbiddenIp("localhost")).toBe(true);
    expect(isForbiddenIp("")).toBe(true);
  });
});

describe("guardedLookup", () => {
  const run = (addrs: { address: string; family: number }[], all = false) =>
    new Promise<{ err: Error | null; address: unknown }>((resolve) => {
      guardedLookup(async () => addrs)("ornek.com", { all }, (err, address) => resolve({ err, address }));
    });

  it("karışık yanıtta TEK özel adres bile reddeder (rebinding atlatması yok)", async () => {
    const r = await run([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]);
    expect(r.err?.name).toBe("ForbiddenTargetError");
  });
  it("genel adreste denetlenen adresi döndürür", async () => {
    const r = await run([{ address: "93.184.216.34", family: 4 }]);
    expect(r.err).toBeNull();
    expect(r.address).toBe("93.184.216.34");
  });
  it("boş çözüm reddedilir", async () => {
    const r = await run([]);
    expect(r.err?.name).toBe("ForbiddenTargetError");
  });
});

describe("safeWebhookPost", () => {
  it("iç ağa çözülen ada bağlanmadan reddeder", async () => {
    const r = await safeWebhookPost("https://rebind.ornek.com/hook", { "Content-Type": "application/json" }, "{}", {
      timeoutMs: 2000,
      resolver: async () => [{ address: "169.254.169.254", family: 4 }],
    });
    expect(r).toEqual({ ok: false, status: null, error: "İç ağ adresi reddedildi" });
  });
  it("https dışı / IP literal / özel port adresini ağa çıkmadan reddeder", async () => {
    for (const u of ["http://ornek.com/h", "https://127.0.0.1/h", "https://ornek.com:8443/h", "https://[::1]/h"]) {
      const r = await safeWebhookPost(u, {}, "{}", { timeoutMs: 1000, resolver: async () => [{ address: "8.8.8.8", family: 4 }] });
      expect(r.ok, u).toBe(false);
      expect(r.status, u).toBeNull();
    }
  });
});
