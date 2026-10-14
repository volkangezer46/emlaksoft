import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261013007200 EİDS e-posta alımı tabloları. Ofis başına tek aktif adres, Message-ID ve
 * gövde özeti tekilliği (ofis içinde), CHECK listeleri, authenticated yazamaz, ham silme ayrıştırılmış alanları korur,
 * rollback her şeyi kaldırır. Gerçek RLS oturumu DENENMEZ (politika varlığı denetlenir).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const MIG = "supabase/migrations/20261013007200_eids_inbound.sql";
const RB = "supabase/rollbacks/20261013007200_eids_inbound.rollback.sql";
const T1 = "00000000-0000-0000-0000-0000000000a1";
const T2 = "00000000-0000-0000-0000-0000000000a2";
const H = (c: string) => c.repeat(64);

describe.skipIf(!mod)("eids_inbound migration (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, unknown>[];
  const msg = (tenant: string, extra: Record<string, unknown> = {}) => {
    const cols = { tenant_id: tenant, received_via: "smtp", auth_result: "verified", ...extra };
    const keys = Object.keys(cols);
    return q(
      `insert into public.eids_inbound_messages (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      Object.values(cols),
    );
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(`
      create role service_role; create role authenticated; create role anon;
      create table public.tenants (id uuid primary key);
      create table public.properties (id uuid primary key default gen_random_uuid(), tenant_id uuid);
      create function public.current_active_tenant_id() returns uuid language sql stable as $$ select null::uuid $$;
      create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$ select false $$;
      insert into public.tenants values ('${T1}'), ('${T2}');
    `);
    await db.exec(read(MIG).replace(/notify pgrst[^;]*;/g, ""));
  });

  it("RLS açık, okuma politikası var; authenticated yalnız SELECT, anon hiçbir şey", async () => {
    const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('eids_inbound_addresses', 'eids_inbound_messages') order by relname`);
    expect(rls.map((r) => r.relrowsecurity)).toEqual([true, true]);
    const pol = await q(`select tablename, cmd from pg_policies where tablename like 'eids_inbound%' order by tablename`);
    expect(pol).toEqual([
      { tablename: "eids_inbound_addresses", cmd: "SELECT" },
      { tablename: "eids_inbound_messages", cmd: "SELECT" },
    ]);
    for (const t of ["eids_inbound_addresses", "eids_inbound_messages"]) {
      for (const priv of ["insert", "update", "delete"]) {
        expect((await q(`select has_table_privilege('authenticated', 'public.${t}', '${priv}') as p`))[0]!.p, `${t} ${priv}`).toBe(false);
      }
      expect((await q(`select has_table_privilege('authenticated', 'public.${t}', 'select') as p`))[0]!.p).toBe(true);
      expect((await q(`select has_table_privilege('anon', 'public.${t}', 'select') as p`))[0]!.p).toBe(false);
      expect((await q(`select has_table_privilege('service_role', 'public.${t}', 'insert') as p`))[0]!.p).toBe(true);
    }
  });

  it("ofis başına tek aktif adres; yenilenmiş (revoked) adres yanında yenisi açılabilir; anahtar özeti tekil", async () => {
    await q(`insert into public.eids_inbound_addresses (tenant_id, token_hash, token_sealed) values ($1, $2, $3)`, [T1, H("a"), "v1.x".padEnd(30, "x")]);
    await expect(q(`insert into public.eids_inbound_addresses (tenant_id, token_hash, token_sealed) values ($1, $2, $3)`, [T1, H("b"), "v1.y".padEnd(30, "y")])).rejects.toThrow();
    await q(`update public.eids_inbound_addresses set revoked_at = now() where tenant_id = $1`, [T1]);
    await q(`insert into public.eids_inbound_addresses (tenant_id, token_hash, token_sealed) values ($1, $2, $3)`, [T1, H("b"), "v1.y".padEnd(30, "y")]);
    await expect(q(`insert into public.eids_inbound_addresses (tenant_id, token_hash, token_sealed) values ($1, $2, $3)`, [T2, H("b"), "v1.z".padEnd(30, "z")])).rejects.toThrow();
    await expect(q(`insert into public.eids_inbound_addresses (tenant_id, token_hash, token_sealed) values ($1, 'kisa', $2)`, [T2, "v1.z".padEnd(30, "z")])).rejects.toThrow();
  });

  it("Message-ID ve gövde özeti ofis içinde tekil (aynı e-posta ikinci kez yazılamaz); başka ofiste serbest", async () => {
    await msg(T1, { message_id: "<m1@ticaret.gov.tr>", body_sha256: H("1") });
    await expect(msg(T1, { message_id: "<m1@ticaret.gov.tr>" })).rejects.toThrow();
    await expect(msg(T1, { body_sha256: H("1") })).rejects.toThrow();
    await msg(T2, { message_id: "<m1@ticaret.gov.tr>", body_sha256: H("1") });
    // Message-ID'siz yapıştırmalar birbirini engellemez (özet farklıysa).
    await msg(T1, { received_via: "paste", auth_result: "unverified", body_sha256: H("2") });
    await msg(T1, { received_via: "paste", auth_result: "unverified", body_sha256: H("3") });
  });

  it("CHECK listeleri: kaynak, doğrulama, tür, durum, taşınmaz no biçimi, ham+silme tarihi", async () => {
    await expect(msg(T1, { received_via: "imap" })).rejects.toThrow();
    await expect(msg(T1, { auth_result: "maybe" })).rejects.toThrow();
    await expect(msg(T1, { parse_kind: "extend" })).rejects.toThrow();
    await expect(msg(T1, { match_status: "done" })).rejects.toThrow();
    await expect(msg(T1, { eids_property_no: "12AB" })).rejects.toThrow();
    await expect(msg(T1, { deal_kind: "lease" })).rejects.toThrow();
    await expect(msg(T1, { raw_eml_encrypted: Buffer.from("x") })).rejects.toThrow(); // raw_purge_after zorunlu
    await msg(T1, { eids_property_no: "1234567890", deal_kind: "sale", parse_kind: "grant", match_status: "queued", valid_until: "2027-03-31" });
  });

  it("30 günlük ham silme: yalnız raw NULL'lanır, ayrıştırılmış alanlar ve doğrulama sonucu kalır", async () => {
    const [old] = await msg(T1, {
      eids_property_no: "9876543210",
      deal_kind: "rent",
      parse_kind: "revoke",
      grantor_masked: "AY** DE***",
      match_status: "applied",
      raw_eml_encrypted: Buffer.from("v1.sifreli"),
      raw_purge_after: "2020-01-01T00:00:00Z",
    });
    const [fresh] = await msg(T1, { body_sha256: H("9"), raw_eml_encrypted: Buffer.from("v1.yeni"), raw_purge_after: "2999-01-01T00:00:00Z" });
    // operational-retention adımının (inbound-retention.ts) SQL karşılığı.
    await q(`update public.eids_inbound_messages set raw_eml_encrypted = null where raw_eml_encrypted is not null and raw_purge_after < now()`);
    const [a] = await q(`select raw_eml_encrypted, eids_property_no, deal_kind, parse_kind, grantor_masked, auth_result, match_status from public.eids_inbound_messages where id = $1`, [old!.id]);
    expect(a).toMatchObject({ raw_eml_encrypted: null, eids_property_no: "9876543210", deal_kind: "rent", parse_kind: "revoke", grantor_masked: "AY** DE***", auth_result: "verified", match_status: "applied" });
    const [b] = await q(`select raw_eml_encrypted is not null as has from public.eids_inbound_messages where id = $1`, [fresh!.id]);
    expect(b!.has).toBe(true);
  });

  it("rollback iki tabloyu kaldırır", async () => {
    await db.exec(read(RB).replace(/notify pgrst[^;]*;/g, ""));
    const left = await q(`select count(*)::int as n from pg_class where relname like 'eids_inbound%' and relkind = 'r'`);
    expect(left[0]!.n).toBe(0);
  });
});
