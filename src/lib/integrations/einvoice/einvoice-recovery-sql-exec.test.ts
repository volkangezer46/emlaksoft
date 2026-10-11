import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { createNilveraAdapter } from "./nilvera";
import { isAmbiguousIssueError, resolveIssueOutcome, rowToDraft, rowToRef, type EInvoiceRow } from "./service";
import { installFakeFetch, restoreFetch } from "./test-support";

/**
 * KURTARMA (Konsey Tur 3 #20+#41): sağlayıcıya istek gitti ama yanıt alınamadı -> satır kilitte takılı kalmaz,
 * sonuç sağlayıcıda UUID ile aranır, ASLA ikinci resmileştirme yapılmaz. pglite (gerçek RPC'ler) + sahte fetch.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb, created_at timestamptz default now());
grant usage on schema public to authenticated, service_role;
`;

afterEach(() => restoreFetch());

describe.skipIf(!mod)("e-Fatura belirsiz sonuç kurtarma (pglite + sahte sağlayıcı)", () => {
  let db: Db;
  let T: string, T2: string, USER: string, USER2: string;
  const CAN = "commissions:create";
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false)`);
    await db.exec(`set role authenticated`);
  };
  const asService = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('test.tenant','',false)`);
    await db.exec(`set role service_role`);
  };
  const attempt = async (sql: string, params?: unknown[]) => {
    try {
      await db.query(sql, params);
      return null;
    } catch (e) {
      return e as { message: string };
    }
  };
  const payload = (key: string) => ({
    provider: "nilvera", mode: "live", source_type: "free", source_label: "Serbest", doc_type: "e-arsiv",
    buyer_name: "Ali Veli", buyer_tax_id: "12345678901",
    lines: [{ description: "Hizmet", quantity: 1, unitPrice: 1000, vatRate: 20 }],
    net_total: 1000, vat_total: 200, gross_total: 1200, issue_date: "2026-10-11", idempotency_key: key,
  });
  const save = async (key: string) =>
    (await q(`select public.einvoice_save_draft(null, $1::jsonb) as r`, [JSON.stringify(payload(key))]))[0]!.r as string;
  const rowOf = async (id: string) => {
    await db.exec(`reset role`);
    return (await q(`select * from public.einvoices where id = $1`, [id]))[0] as unknown as EInvoiceRow & { status: string };
  };
  const age = async (id: string) => {
    await db.exec(`reset role; update public.einvoices set issue_claimed_at = now() - interval '6 minutes' where id = '${id}'`);
  };

  const COMPANY = { Name: "Demo Emlak", TaxNumber: "9876543210" };

  /** Eylem akışının sunucu adımları: talep -> sağlayıcı kimliği -> İŞARET -> ConfirmAndSend (yanıt kaybolur). */
  async function lostResponseIssue(key: string, calls: ReturnType<typeof installFakeFetch>) {
    await as(USER, T, CAN);
    const id = await save(key);
    const claimed = (await q(`select * from public.einvoice_claim_issue($1)`, [id]))[0] as unknown as EInvoiceRow;
    const adapter = createNilveraAdapter({ apiKey: "K" }, "live");
    const created = await adapter.createDraft(rowToDraft(claimed));
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("taslak");
    await q(`select public.einvoice_record_progress($1, $2::jsonb, null, null, false)`, [id, JSON.stringify(created.value.ref)]);
    expect((await q(`select public.einvoice_mark_issue_sent($1) as r`, [id]))[0]!.r).toBe(true);
    const ref = rowToRef(await rowOf(id));
    await as(USER, T, CAN);
    const issued = await adapter.issue(ref!);
    expect(issued.ok).toBe(false);
    if (!issued.ok) expect(isAmbiguousIssueError(issued.error.code)).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/ConfirmAndSend")).length).toBe(1);
    return id;
  }

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    USER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    USER2 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T2]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000700_einvoice.sql"));
    await db.exec(read("supabase/migrations/20261011000600_einvoice_state_machine.sql"));
    await db.exec(read("supabase/migrations/20261012000100_einvoice_recovery.sql"));
    await db.exec(`grant all on all tables in schema public to service_role`);
  });

  it("zaman aşımı -> yeniden talep ENGELLİ -> kilit dolunca sağlayıcıda bulundu -> TEK resmi fatura", async () => {
    const calls = installFakeFetch((c) => {
      if (c.url.endsWith("/general/Company")) return { json: COMPANY };
      if (c.url.endsWith("/earchive/Draft/Create")) return { json: { UUID: "ignored", InvoiceNumber: "T-1" } };
      if (c.url.endsWith("/earchive/Draft/ConfirmAndSend")) return { status: 503 }; // yanıt kayboldu / 5xx
      if (c.url.endsWith("/Status")) return { json: { StatusCode: "waiting", CancelStatus: false } };
      return undefined;
    });
    const id = await lostResponseIssue("free:recover-a:invoice", calls);

    // Satır kilitte takılı: kilit 5 dk içinde ve sonrasında da issue_stage nedeniyle yeniden talep edilemez.
    await as(USER, T, CAN);
    expect((await q(`select count(*)::int as n from public.einvoice_claim_issue($1)`, [id]))[0]!.n).toBe(0);
    await age(id);
    await as(USER, T, CAN);
    expect((await q(`select count(*)::int as n from public.einvoice_claim_issue($1)`, [id]))[0]!.n).toBe(0);
    expect((await attempt(`select public.einvoice_save_draft($1, $2::jsonb)`, [id, JSON.stringify(payload("free:recover-a:invoice"))]))?.message).toContain("dogrulaniyor");

    // Kurtarma (cron): sağlayıcıda ara -> bulundu -> issued/waiting
    const row = await rowOf(id);
    expect(row.issue_stage).toBe("issue_sent");
    const outcome = await resolveIssueOutcome(createNilveraAdapter({ apiKey: "K" }, "live"), row);
    expect(outcome.outcome).toBe("sent");
    await asService();
    const applied = (await q(`select public.einvoice_recover_issue($1, 'sent', $2::jsonb, $3) as r`, [
      id,
      JSON.stringify(outcome.outcome === "sent" ? outcome.ref : null),
      outcome.outcome === "sent" ? outcome.number : null,
    ]))[0]!.r;
    expect(applied).toBe(true);
    const after = await rowOf(id);
    expect(after.status).toBe("issued");
    expect(after.issue_stage).toBeNull();
    expect(after.issue_claimed_at).toBeNull();
    // İkinci uygulama etkisiz; yeniden talep edilemez (issued); ConfirmAndSend hâlâ TEK.
    await asService();
    expect((await q(`select public.einvoice_recover_issue($1, 'sent', null, null) as r`, [id]))[0]!.r).toBe(false);
    await as(USER, T, CAN);
    expect((await q(`select count(*)::int as n from public.einvoice_claim_issue($1)`, [id]))[0]!.n).toBe(0);
    expect(calls.filter((c) => c.url.endsWith("/ConfirmAndSend")).length).toBe(1);
  });

  it("sağlayıcıda belge YOK (404) -> kilit çözülür; yeniden deneme yalnız kullanıcının açık eylemi", async () => {
    let statusHits = 0;
    const calls = installFakeFetch((c) => {
      if (c.url.endsWith("/general/Company")) return { json: COMPANY };
      if (c.url.endsWith("/earchive/Draft/Create")) return { json: { UUID: "x", InvoiceNumber: "T-2" } };
      if (c.url.endsWith("/earchive/Draft/ConfirmAndSend")) return { status: 502 };
      if (c.url.endsWith("/Status")) {
        statusHits += 1;
        return { status: 404 };
      }
      return undefined;
    });
    const id = await lostResponseIssue("free:recover-b:invoice", calls);
    const row0 = await rowOf(id);
    // Kilit dolmadan uygulama etkisiz (istek hâlâ sürüyor olabilir)
    await asService();
    expect((await q(`select public.einvoice_recover_issue($1, 'not_sent', null, null) as r`, [id]))[0]!.r).toBe(false);
    await age(id);
    const outcome = await resolveIssueOutcome(createNilveraAdapter({ apiKey: "K" }, "live"), row0);
    expect(outcome.outcome).toBe("not_sent");
    expect(statusHits).toBe(1);
    await asService();
    expect((await q(`select public.einvoice_recover_issue($1, 'not_sent', null, null) as r`, [id]))[0]!.r).toBe(true);
    const after = await rowOf(id);
    expect(after.status).toBe("draft");
    expect(after.issue_stage).toBeNull();
    expect(after.error).toContain("olusmadigi");
    // Sonra kullanıcı isterse yeniden talep edebilir
    await as(USER, T, CAN);
    expect((await q(`select count(*)::int as n from public.einvoice_claim_issue($1)`, [id]))[0]!.n).toBe(1);
    // Kurtarma sırasında ConfirmAndSend EKLENMEDİ
    expect(calls.filter((c) => c.url.endsWith("/ConfirmAndSend")).length).toBe(1);
  });

  it("sağlayıcı sorgusu da hata verirse sonuç BELİRSİZ kalır (satıra dokunulmaz)", async () => {
    const calls = installFakeFetch((c) => {
      if (c.url.endsWith("/general/Company")) return { json: COMPANY };
      if (c.url.endsWith("/earchive/Draft/Create")) return { json: { UUID: "x", InvoiceNumber: "T-3" } };
      return { status: 503 };
    });
    const id = await lostResponseIssue("free:recover-c:invoice", calls);
    await age(id);
    const outcome = await resolveIssueOutcome(createNilveraAdapter({ apiKey: "K" }, "live"), await rowOf(id));
    expect(outcome.outcome).toBe("unknown");
    const row = await rowOf(id);
    expect(row.status).toBe("draft");
    expect(row.issue_stage).toBe("issue_sent");
  });

  it("kesin ret (4xx) serbest bırakır: isaret temizlenir; belirsiz hata sınıfı yalnız ağ/5xx/çözümlenemez", async () => {
    expect(isAmbiguousIssueError("unavailable")).toBe(true);
    expect(isAmbiguousIssueError("invalid_response")).toBe(true);
    for (const code of ["rejected", "unauthorized", "not_supported", "invalid_input", "rate_limited", "not_found"]) {
      expect(isAmbiguousIssueError(code)).toBe(false);
    }
    await as(USER, T, CAN);
    const id = await save("free:release:invoice");
    await q(`select * from public.einvoice_claim_issue($1)`, [id]);
    await q(`select public.einvoice_record_progress($1, '{"externalId":"r"}'::jsonb, null, null, false)`, [id]);
    expect((await q(`select public.einvoice_mark_issue_sent($1) as r`, [id]))[0]!.r).toBe(true);
    // ikinci işaret reddedilir
    expect((await q(`select public.einvoice_mark_issue_sent($1) as r`, [id]))[0]!.r).toBe(false);
    await q(`select public.einvoice_record_progress($1, null, null, 'Reddedildi', true)`, [id]);
    const row = await rowOf(id);
    expect(row.issue_stage).toBeNull();
    expect(row.issue_claimed_at).toBeNull();
  });

  it("yetki: işaret/kurtarma kapılı; ofis izolasyonu; cron RPC'si kullanıcıya, kullanıcı RPC'leri service_role'e KAPALI", async () => {
    await as(USER, T, CAN);
    const id = await save("free:perm-r:invoice");
    await q(`select * from public.einvoice_claim_issue($1)`, [id]);
    await q(`select public.einvoice_record_progress($1, '{"externalId":"p"}'::jsonb, null, null, false)`, [id]);
    await as(USER2, T2, CAN);
    expect((await q(`select public.einvoice_mark_issue_sent($1) as r`, [id]))[0]!.r).toBe(false);
    await as(USER, T, "commissions:view");
    expect((await attempt(`select public.einvoice_mark_issue_sent($1)`, [id]))?.message).toContain("yetkiniz yok");
    expect((await attempt(`select public.einvoice_recover_issue_mine($1, 'sent', null, null)`, [id]))?.message).toContain("yetkiniz yok");
    await as(USER, T, CAN);
    expect((await attempt(`select public.einvoice_recover_issue($1, 'sent', null, null)`, [id]))?.message).toContain("permission denied");
    expect((await attempt(`select public._einvoice_recover_apply($1, $2, 'sent', null, null)`, [T, id]))?.message).toContain("permission denied");
    await asService();
    expect((await attempt(`select public.einvoice_claim_issue($1)`, [id]))?.message).toContain("permission denied");
    expect((await attempt(`select public.einvoice_mark_issued($1, null, null)`, [id]))?.message).toContain("permission denied");
    // Kullanıcı yolu (kilit dolmuş + işaretli): başka ofis uygulayamaz, kendi ofisi uygular
    await as(USER, T, CAN);
    await q(`select public.einvoice_mark_issue_sent($1)`, [id]);
    await age(id);
    await as(USER2, T2, CAN);
    expect((await q(`select public.einvoice_recover_issue_mine($1, 'not_sent', null, null) as r`, [id]))[0]!.r).toBe(false);
    await as(USER, T, CAN);
    expect((await q(`select public.einvoice_recover_issue_mine($1, 'not_sent', null, null) as r`, [id]))[0]!.r).toBe(true);
    expect((await attempt(`select public.einvoice_recover_issue_mine($1, 'bogus', null, null)`, [id]))?.message).toContain("Gecersiz");
  });

  it("rollback dosyası fonksiyonları ve sütunu düşürür", async () => {
    await db.exec(`reset role`);
    await db.exec(`delete from public.einvoices where issue_stage is not null`);
    await db.exec(read("supabase/rollbacks/20261012000100_einvoice_recovery.rollback.sql"));
    expect((await q(`select count(*)::int as n from pg_proc where proname in ('einvoice_recover_issue','einvoice_mark_issue_sent')`))[0]!.n).toBe(0);
    expect((await q(`select count(*)::int as n from information_schema.columns where table_name = 'einvoices' and column_name = 'issue_stage'`))[0]!.n).toBe(0);
    vi.clearAllMocks();
  });
});
