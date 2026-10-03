import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const NAME = "20260814000100_international_phone_constraints";
const fwd = readFileSync(`supabase/migrations/${NAME}.sql`, "utf8");
const rb = readFileSync(`supabase/rollbacks/${NAME}.rollback.sql`, "utf8");
const code = (s: string) => s.replace(/--[^\n]*/g, "");

const NEW_PATTERN = String.raw`'^(0[0-9]{10}|\+[1-9][0-9]{6,14})$'`;
const NEW_CHECK = String.raw`^(0[0-9]{10}|\+[1-9][0-9]{6,14})$`;

describe("migration uluslararası telefon sözleşmesi", () => {
  it("customers ve calls kısıtları yeni biçimle, NOT VALID eklenir ve VALIDATE edilmez", () => {
    const sql = code(fwd);
    expect(sql).toMatch(/drop constraint if exists customers_phone_tr_format/);
    expect(sql).toMatch(/drop constraint if exists calls_phone_tr_format/);
    expect(sql).toContain(`phone is null or phone ~ '${NEW_CHECK}') not valid`);
    expect(sql).toContain(`check (phone ~ '${NEW_CHECK}') not valid`);
    expect(sql).not.toMatch(/validate constraint/i);
  });

  it("profiles kısıtına dokunmaz", () => {
    expect(code(fwd)).not.toContain("profiles_phone_tr_format");
    expect(code(rb)).not.toContain("profiles_phone_tr_format");
  });

  it("randevu RPC'lerinde eski TR-cep deseni kalmaz, yeni desen iki fonksiyonda da vardır", () => {
    const sql = code(fwd);
    expect(sql).not.toContain("^05");
    // 2 fonksiyon; kısıtlar tek tırnaklı aynı literal'i paylaştığı için toplam 4 geçiş.
    expect(sql.split(NEW_PATTERN).length - 1).toBe(4);
    expect(sql).toContain("FUNCTION public.create_public_booking_atomic_state_v1");
    expect(sql).toContain("FUNCTION public.create_public_booking_atomic(");
  });

  it("fonksiyonlar search_path sabit, SECURITY DEFINER, extensions.digest kullanır", () => {
    const sql = code(fwd);
    expect(sql.match(/SECURITY DEFINER/g)?.length).toBe(2);
    expect(sql.match(/SET search_path TO 'public', 'pg_temp'/g)?.length).toBe(2);
    expect(sql).toContain("extensions.digest(");
    expect(sql).not.toMatch(/(?<![.\w])digest\(/);
  });

  it("izinler yeniden uygulanır: wrapper yalnız service_role", () => {
    const sql = code(fwd);
    expect(sql).toMatch(/grant execute on function public\.create_public_booking_atomic\(uuid, timestamptz, text, text, text, text\) to service_role/);
    expect(sql).toMatch(/revoke all on function public\.create_public_booking_atomic_state_v1/);
  });

  it("enum ADD VALUE yok; rollback eski deseni ve NOT VALID kısıtları geri koyar", () => {
    expect(code(fwd)).not.toMatch(/add value/i);
    const r = code(rb);
    expect(r).toContain(String.raw`'^05\d{9}$') not valid`);
    expect(r.split("^05[0-9]{9}$").length - 1).toBe(2);
    expect(r).not.toContain(NEW_PATTERN);
    expect(r).not.toMatch(/validate constraint/i);
  });
});
