import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isRpcMissing, purgeSampleData, reportFromRpc, PURGE_RPC } from "./purge";

vi.mock("@/lib/sample-clear", () => ({
  deleteSampleRecords: vi.fn(async () => ({ deleted: { customers: 2 }, unavailable: [], failed: [], totalDeleted: 2, complete: true })),
}));

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261006000600_purge_sample_data_rpc.sql"), "utf8");
const rollback = readFileSync(join(process.cwd(), "supabase/rollbacks/20261006000600_purge_sample_data_rpc.rollback.sql"), "utf8");

function fnBody(): string {
  const start = sql.indexOf("create or replace function public.purge_tenant_sample_data");
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

describe("purge_tenant_sample_data SQL sözleşmesi", () => {
  const body = fnBody();
  const deletes = body.match(/delete from public\.[a-z_]+[\s\S]*?;/g) ?? [];

  it("SECURITY DEFINER + boş search_path; anon/public EXECUTE yok", () => {
    expect(body).toContain("security definer");
    expect(body).toContain("set search_path = ''");
    expect(sql).toContain("revoke all on function public.purge_tenant_sample_data(uuid) from public, anon;");
    expect(sql).toContain("grant execute on function public.purge_tenant_sample_data(uuid) to authenticated, service_role;");
  });

  it("çağıranın ofisi ve rolü (owner/gm) içeride doğrulanır; service_role istisnası açık", () => {
    expect(body).toMatch(/p\.id = v_uid and p\.tenant_id = p_tenant_id and p\.is_active and p\.role in \('owner', 'gm'\)/);
    expect(body).toContain("errcode = '42501'");
    expect(body).toContain("'service_role'");
  });

  it("her DELETE yalnız örnek satırları ve yalnız bu ofisi siler", () => {
    expect(deletes.length).toBeGreaterThanOrEqual(14);
    for (const d of deletes) {
      if (d.startsWith("delete from public.rent_charges")) {
        // Tahakkukta is_sample yok: yalnız örnek kiralara bağlı satırlar (alt sorgu da is_sample + tenant süzer).
        expect(d).toContain("where tenant_id = p_tenant_id");
        expect(d).toContain("r.is_sample = true and r.tenant_id = p_tenant_id");
        continue;
      }
      expect(d, d).toMatch(/where is_sample = true and tenant_id = p_tenant_id;$/);
    }
  });

  it("profiles ve tenants SİLİNMEZ (gerçek kullanıcı/ofis korunur); FK sırası: bağımlı → ana", () => {
    expect(body).not.toMatch(/delete from public\.(profiles|tenants)\b/);
    const order = deletes.map((d) => /delete from public\.([a-z_]+)/.exec(d)![1]);
    expect(order.indexOf("commissions")).toBeLessThan(order.indexOf("deals"));
    expect(order.indexOf("deals")).toBeLessThan(order.indexOf("properties"));
    expect(order.indexOf("rentals")).toBeLessThan(order.indexOf("properties"));
    expect(order.indexOf("customer_demands")).toBeLessThan(order.indexOf("customers"));
    expect(order.at(-1)).toBe("customers");
  });

  it("rollback dosyası fonksiyonu ve sihirbaz sütunlarını düşürür; ledger'a dokunmaz", () => {
    expect(rollback).toContain("drop function if exists public.purge_tenant_sample_data(uuid);");
    expect(rollback).toContain("drop column if exists office_type");
    expect(rollback).not.toMatch(/schema_migrations/i.source === "" ? /x^/ : /delete from .*schema_migrations/i);
  });
});

describe("purgeSampleData (TS sarmalayıcı)", () => {
  it("RPC varsa onu oturum istemcisiyle çağırır, raporu sayılardan kurar", async () => {
    const rpc = vi.fn(async () => ({ data: { deleted: { customers: 12, properties: 9, bad: -1 } }, error: null }));
    const res = await purgeSampleData({ session: { rpc } as never, tenantId: "t-1", fallbackAdmin: {} as never });
    expect(rpc).toHaveBeenCalledWith(PURGE_RPC, { p_tenant_id: "t-1" });
    expect(res).toMatchObject({ ok: true, via: "rpc", report: { totalDeleted: 21, deleted: { customers: 12, properties: 9 } } });
  });

  it("RPC yetki hatasında (42501) geri dönüşe DÜŞMEZ; Türkçe mesaj döner", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ data: null, error: { code: "42501", message: "x" } }));
    const res = await purgeSampleData({ session: { rpc } as never, tenantId: "t-1", fallbackAdmin: {} as never });
    expect(res).toMatchObject({ ok: false });
    expect(res.ok ? "" : res.error).toMatch(/ofis sahibi veya genel müdür/);
  });

  it("RPC yoksa (migration uygulanmamış) eski tablo-tablo yola düşer ve damgayı sıfırlar", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }));
    const updates: unknown[] = [];
    const admin = { from: () => ({ update: (p: unknown) => ({ eq: async () => (updates.push(p), { error: null }) }) }) };
    const res = await purgeSampleData({ session: { rpc } as never, tenantId: "t-1", fallbackAdmin: admin as never });
    expect(res).toMatchObject({ ok: true, via: "fallback" });
    expect(updates[0]).toEqual({ sample_seeded_at: null });
  });

  it("isRpcMissing / reportFromRpc kenar durumları", () => {
    expect(isRpcMissing(null)).toBe(false);
    expect(isRpcMissing({ code: "42883" })).toBe(true);
    expect(isRpcMissing({ code: "42501", message: "permission denied" })).toBe(false);
    expect(reportFromRpc(null)).toMatchObject({ totalDeleted: 0, complete: true });
  });
});
