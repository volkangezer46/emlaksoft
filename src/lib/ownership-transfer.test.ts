import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEMOTE_ROLES,
  RPC,
  isDemoteRole,
  isTransferOpen,
  ownershipTransferMessage,
  parseOwnershipRpc,
} from "./ownership-transfer";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/20261006000720_ownership_transfer_rpc.sql");
const table = read("supabase/migrations/20260825001300_ownership_transfers.sql");
const action = read("src/app/actions/ownership-transfer.ts");

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start, fn).toBeGreaterThan(0);
  const open = sql.indexOf("$$", start);
  return sql.slice(start, sql.indexOf("$$", open + 2) + 2);
}

describe("sahiplik devri RPC'leri (20261006000720)", () => {
  for (const fn of Object.values(RPC)) {
    const b = body(fn);
    it(`${fn}: JWT kimliği, güvenli definer, destek oturumu reddi, aynı işlemde denetim kaydı`, () => {
      expect(b).toContain("security definer");
      expect(b).toContain("set search_path = ''");
      expect(b).toContain("v_uid uuid := auth.uid();");
      expect(b).toContain("v_tenant uuid := public.current_tenant_id();");
      expect(b).toContain("'impersonating'");
      expect(b).toContain("insert into public.audit_logs");
      // Kimlik parametreyle verilemez.
      expect(b).not.toMatch(/p_actor_id|p_tenant_id/);
    });
  }

  it("EXECUTE yalnız authenticated; anon/public kapalı", () => {
    for (const sig of ["ownership_transfer_request(uuid, text)", "ownership_transfer_accept(uuid)", "ownership_transfer_resolve(uuid, text)"]) {
      expect(sql).toContain(`revoke all privileges on function public.${sig} from public, anon, authenticated, service_role;`);
      expect(sql).toContain(`grant execute on function public.${sig} to authenticated;`);
    }
    expect(sql).not.toMatch(/to anon/);
  });

  it("kabul: süre dolumu kalıcı yazılır (hata fırlatıp geri alınmaz) ve rol takası + claim aynı işlemde", () => {
    const b = body(RPC.accept);
    expect(b).toMatch(/set status = 'expired'[^;]*;\s*return jsonb_build_object\('ok', false, 'code', 'expired'\);/);
    expect(b).toContain("order by p.id\n   for update;");
    expect(b.indexOf("set role = t.demote_role")).toBeLessThan(b.indexOf("set role = 'owner'"));
    expect(b).toContain("jsonb_build_object('role', 'owner', 'tenant_id', v_tenant::text)");
    expect(b).toContain("set status = 'accepted'");
  });

  it("başlatma yalnız aktif ofis sahibi; hedef sahip olmayan aktif üye; tek bekleyen talep", () => {
    const b = body(RPC.request);
    expect(b).toContain("p.role = 'owner' and p.is_active");
    expect(b).toContain("p.role <> 'owner' and p.is_active");
    expect(b).toContain("exception when unique_violation then");
    expect(table).toContain("uq_ownership_transfers_one_pending");
  });

  it("devir sonrası rol listesi tablo CHECK'i ve TS listesiyle aynı", () => {
    const list = DEMOTE_ROLES.map((r) => `'${r}'`).join(", ");
    expect(body(RPC.request)).toContain(`v_role not in (${list})`);
    expect(table).toContain(`check (demote_role in (${DEMOTE_ROLES.map((r) => `'${r}'`).join(",")}))`);
    expect(isDemoteRole("owner")).toBe(false);
    expect(isDemoteRole("gm")).toBe(true);
  });

  it("SQL'in döndürdüğü her kodun Türkçe mesajı var", () => {
    const codes = [...new Set([...sql.matchAll(/'code', '(\w+)'/g)].map((m) => m[1]!))];
    expect(codes.length).toBeGreaterThanOrEqual(8);
    const fallback = ownershipTransferMessage(null);
    for (const c of codes) expect(ownershipTransferMessage(c), c).not.toBe(fallback);
  });
});

describe("sahiplik devri action'ları", () => {
  it("service_role kullanmaz; sahip kapısı, destek oturumu reddi, parola doğrulaması ve hız sınırı var", () => {
    expect(action.startsWith('"use server";')).toBe(true);
    expect(action).not.toContain("createAdminClient");
    expect(action).toContain('requirePermission("team", "edit")');
    expect(action).toContain('gate.role !== "owner"');
    expect(action.match(/gate\.impersonating/g)?.length).toBe(3);
    expect(action.match(/await verifyPassword\(/g)?.length).toBe(2);
    expect(action.match(/await limited\(/g)?.length).toBe(3);
  });
});

describe("saf yardımcılar", () => {
  it("parseOwnershipRpc beklenmeyen biçimi başarısız sayar", () => {
    expect(parseOwnershipRpc(null)).toEqual({ ok: false });
    expect(parseOwnershipRpc([1])).toEqual({ ok: false });
    expect(parseOwnershipRpc({ ok: true, id: "x" })).toMatchObject({ ok: true, id: "x" });
    expect(parseOwnershipRpc({ ok: "true" }).ok).toBe(false);
  });
  it("isTransferOpen: yalnız süresi dolmamış bekleyen talep", () => {
    const at = Date.parse("2026-10-06T12:00:00Z");
    expect(isTransferOpen({ status: "pending", expires_at: "2026-10-06T13:00:00Z" }, at)).toBe(true);
    expect(isTransferOpen({ status: "pending", expires_at: "2026-10-06T11:00:00Z" }, at)).toBe(false);
    expect(isTransferOpen({ status: "accepted", expires_at: "2026-10-06T13:00:00Z" }, at)).toBe(false);
  });
});
