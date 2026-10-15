import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import {
  RECOVERY_CODE_COUNT,
  RecoveryCodeConfigurationError,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "./two-factor-recovery";

const ENV = { OTP_HMAC_SECRET: "x".repeat(40) };

describe("kurtarma kodları", () => {
  it("10 benzersiz, biçimli, karışmayan alfabeli kod", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  });

  it("girdi normalizasyonu: küçük harf, boşluk, tire", () => {
    expect(normalizeRecoveryCode(" abcde-fghjk ")).toBe("ABCDEFGHJK");
    expect(normalizeRecoveryCode("ABCDE FGHJK")).toBe("ABCDEFGHJK");
    expect(normalizeRecoveryCode("ABCDE-FGHJ")).toBeNull();
    expect(normalizeRecoveryCode("ABCDE-FGHJ0")).toBeNull(); // 0 alfabede yok
  });

  it("özet kullanıcıya bağlı, biçimden bağımsız, gizli anahtar zorunlu", () => {
    const a = hashRecoveryCode("ABCDE-FGHJK", "u1", ENV);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode("abcdefghjk", "u1", ENV)).toBe(a);
    expect(hashRecoveryCode("ABCDE-FGHJK", "u2", ENV)).not.toBe(a);
    expect(() => hashRecoveryCode("ABCDE-FGHJK", "u1", { OTP_HMAC_SECRET: "kisa" })).toThrow(RecoveryCodeConfigurationError);
  });
});

const mod = await loadPglite();
const U1 = "aaaaaaaa-0000-4000-8000-000000000001";
const S1 = "sess-1";
const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('t.role', true), ''), 'service_role') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('t.jwt', true), ''), '{}')::jsonb $$;
create table auth.users(id uuid primary key);
create table public.profiles(id uuid primary key references auth.users(id), is_active boolean default true, phone text,
  two_factor_sms boolean default false, two_factor_version integer not null default 1);
create table public.two_factor_verified_sessions(session_id text primary key, user_id uuid not null, profile_version integer not null,
  verified_at timestamptz default now(), expires_at timestamptz not null);
`;

describe.skipIf(!mod)("20261018090100 ofis TOTP 2FA (pglite)", () => {
  let db: Db;
  const satisfied = async (jwt: object) => {
    await db.exec(`select set_config('t.uid', '${U1}', false), set_config('t.jwt', '${JSON.stringify(jwt)}', false)`);
    const { rows } = await db.query(`select public.current_session_two_factor_satisfied() as ok`);
    return rows[0]!.ok;
  };
  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(readFileSync(resolve(process.cwd(), "supabase/migrations/20261018090100_office_totp_two_factor.sql"), "utf8"));
    await db.exec(`insert into auth.users values ('${U1}'); insert into public.profiles(id, two_factor_sms) values ('${U1}', true);`);
  });

  it("yöntem varsayılanı sms; geçersiz yöntem reddedilir", async () => {
    expect((await db.query(`select two_factor_method from public.profiles`)).rows).toEqual([{ two_factor_method: "sms" }]);
    await expect(db.exec(`update public.profiles set two_factor_method = 'email'`)).rejects.toThrow();
  });

  it("SMS yönteminde AAL2 tek başına yetmez; oturum kanıtı gerekir", async () => {
    expect(await satisfied({ session_id: S1, aal: "aal2" })).toBe(false);
  });

  it("yöntem değişimi sürümü artırır, oturum açmış kullanıcı değiştiremez", async () => {
    await db.exec(`update public.profiles set two_factor_method = 'totp'`);
    expect((await db.query(`select two_factor_version v from public.profiles`)).rows).toEqual([{ v: 2 }]);
    await db.exec(`select set_config('t.role', 'authenticated', false)`);
    await expect(db.exec(`update public.profiles set two_factor_method = 'sms'`)).rejects.toThrow(/trusted server/);
    await db.exec(`select set_config('t.role', '', false)`);
  });

  it("TOTP yönteminde AAL2 oturum kabul edilir; AAL1 için kanıt gerekir", async () => {
    expect(await satisfied({ session_id: S1, aal: "aal2" })).toBe(true);
    expect(await satisfied({ session_id: S1, aal: "aal1" })).toBe(false);
    await db.exec(`insert into public.two_factor_verified_sessions(session_id, user_id, profile_version, expires_at)
      values ('${S1}', '${U1}', 2, now() + interval '1 hour')`);
    expect(await satisfied({ session_id: S1, aal: "aal1" })).toBe(true);
  });

  it("kurtarma kodu özeti tek kullanımlık ve kullanıcı başına benzersiz", async () => {
    const h = "a".repeat(64);
    await db.exec(`insert into public.two_factor_recovery_codes(user_id, code_hash) values ('${U1}', '${h}')`);
    await expect(db.exec(`insert into public.two_factor_recovery_codes(user_id, code_hash) values ('${U1}', '${h}')`)).rejects.toThrow();
    await expect(db.exec(`insert into public.two_factor_recovery_codes(user_id, code_hash) values ('${U1}', 'duz-kod')`)).rejects.toThrow();
    const first = await db.query(`update public.two_factor_recovery_codes set used_at = now() where code_hash = '${h}' and used_at is null returning id`);
    const second = await db.query(`update public.two_factor_recovery_codes set used_at = now() where code_hash = '${h}' and used_at is null returning id`);
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(0);
  });

  it("geri alma dosyası temiz çalışır", async () => {
    await db.exec(readFileSync(resolve(process.cwd(), "supabase/rollbacks/20261018090100_office_totp_two_factor.rollback.sql"), "utf8"));
    expect((await db.query(`select to_regclass('public.two_factor_recovery_codes') r`)).rows).toEqual([{ r: null }]);
  });
});
