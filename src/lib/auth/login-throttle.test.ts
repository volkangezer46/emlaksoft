import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import {
  IP_BLOCK_FAILURES,
  delayAfterFailures,
  formatWait,
  throttleDecision,
  throttleMessage,
} from "./login-throttle-core";

describe("giriş kısıtlayıcı kararı", () => {
  it("serbest hatalardan sonra bekleme ikiye katlanır, 5 dk tavan", () => {
    expect(delayAfterFailures(4, 4)).toBe(0);
    expect(delayAfterFailures(5, 4)).toBe(2);
    expect(delayAfterFailures(6, 4)).toBe(4);
    expect(delayAfterFailures(9, 4)).toBe(32);
    expect(delayAfterFailures(40, 4)).toBe(300);
  });

  it("hesap kovası beklemesi son hatadan itibaren sayılır", () => {
    const t0 = 1_000_000;
    const state = { account: { failures: 6, lastFailureAtMs: t0 } };
    expect(throttleDecision(state, t0 + 1000)).toEqual({ allowed: false, scope: "account", retryAfterSec: 3 });
    expect(throttleDecision(state, t0 + 4000)).toEqual({ allowed: true });
  });

  it("IP kovası eşikte pencere sonuna kadar engeller; en uzun bekleme kazanır", () => {
    const t0 = 5_000_000;
    const d = throttleDecision(
      { account: { failures: 5, lastFailureAtMs: t0 }, ip: { failures: IP_BLOCK_FAILURES, lastFailureAtMs: t0 } },
      t0 + 10_000,
    );
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.scope).toBe("ip");
      expect(d.retryAfterSec).toBe(3590);
      expect(throttleMessage(d)).toMatch(/Bu ağdan/);
    }
  });

  it("bekleme ifadesi", () => {
    expect(formatWait(0.2)).toBe("1 saniye");
    expect(formatWait(45)).toBe("45 saniye");
    expect(formatWait(61)).toBe("2 dakika");
  });
});

const mod = await loadPglite();
const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('t.role', true), ''), 'authenticated') $$;
`;

describe.skipIf(!mod)("auth_login_throttle RPC'leri (pglite)", () => {
  let db: Db;
  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(readFileSync(resolve(process.cwd(), "supabase/migrations/20261018090000_auth_login_throttle.sql"), "utf8"));
  });

  it("service_role dışı çağrı reddedilir", async () => {
    await expect(db.query(`select * from public.auth_login_throttle_peek(array['a'])`)).rejects.toThrow(/Service role/);
    await expect(db.query(`select * from public.auth_login_throttle_fail(array['a'], array[900])`)).rejects.toThrow(/Service role/);
  });

  it("hata sayacı artar, temizleme hesabı sıfırlar, süresi dolan kova 1'den başlar", async () => {
    await db.exec(`set t.role = 'service_role'`);
    await db.query(`select * from public.auth_login_throttle_fail(array['acct','ip'], array[900, 3600])`);
    const second = await db.query(`select bucket, failures from public.auth_login_throttle_fail(array['acct','ip'], array[900, 3600]) order by bucket`);
    expect(second.rows).toEqual([{ bucket: "acct", failures: 2 }, { bucket: "ip", failures: 2 }]);

    const peek = await db.query(`select bucket, failures from public.auth_login_throttle_peek(array['acct','ip','yok']) order by bucket`);
    expect(peek.rows).toEqual([{ bucket: "acct", failures: 2 }, { bucket: "ip", failures: 2 }]);

    await db.query(`select public.auth_login_throttle_clear('acct')`);
    expect((await db.query(`select bucket from public.auth_login_throttle_peek(array['acct','ip'])`)).rows).toEqual([{ bucket: "ip" }]);

    await db.exec(`update public.auth_login_throttle set expires_at = now() - interval '1 second' where bucket = 'ip'`);
    expect((await db.query(`select * from public.auth_login_throttle_peek(array['ip'])`)).rows).toEqual([]);
    const reset = await db.query(`select failures from public.auth_login_throttle_fail(array['ip'], array[3600])`);
    expect(reset.rows).toEqual([{ failures: 1 }]);
    await db.exec(`reset t.role`);
  });

  it("geçersiz girdi reddedilir", async () => {
    await db.exec(`set t.role = 'service_role'`);
    await expect(db.query(`select * from public.auth_login_throttle_fail(array['a','b'], array[900])`)).rejects.toThrow(/matching/);
    await expect(db.query(`select * from public.auth_login_throttle_fail(array['a'], array[5])`)).rejects.toThrow(/window/);
    await db.exec(`reset t.role`);
  });
});
