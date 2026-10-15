import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite) — SK4 migration'ları:
 *  (1) 20261016040000_admin_staff_broadcast: admin olayları 'admin:staff' konusuna, personel bildirimi 'staff:<uid>'
 *      konusuna; yük {t, op, by, ids?} ≤ 200 bayt ve kişisel veri taşımaz; boş deyim olay üretmez; toplu yazımda ids
 *      düşer; realtime.send yoksa yazma bozulmaz; realtime.messages politikası personel olmayan JWT'ye konuyu açmaz.
 *  (2) 20261016040100_reply_support_ticket_v3: ofisin yanıtı 'open'/'in_progress' durumunu korur, 'waiting' ilk yanıta
 *      göre open/in_progress olur; v2 v3'e devreder; tek seferlik düzeltme yalnız bozuk satırı açar.
 *  (3) 20261016040200_admin_search_members: yalnız service_role; ad ve e-postayla bulur; LIKE jokerleri kaçırılır.
 * Realtime şeması burada taslaktır: `realtime.send` gerçek sürümle AYNI biçimde yüke "id" ekler ve realtime.messages'a yazar.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.auth_role', true), '') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
create table auth.users(id uuid primary key, email text);

create schema realtime;
create table realtime.messages(
  id uuid primary key default gen_random_uuid(), topic text not null, extension text not null, payload jsonb,
  event text, private boolean default true, inserted_at timestamp default now());
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '')::text $$;
create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void language plpgsql as $$
declare generated_id uuid := gen_random_uuid(); final_payload jsonb;
begin
  if payload ? 'id' then final_payload := payload; else final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id)); end if;
  insert into realtime.messages (id, payload, event, topic, private, extension) values (generated_id, final_payload, event, topic, private, 'broadcast');
end $$;
grant usage on schema realtime to authenticated;
grant select on realtime.messages to authenticated;
grant usage on schema auth to authenticated;

create table public.platform_settings(key text primary key, value text);
create function public.growth_flag_on(p_key text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select lower(btrim(coalesce(s.value, ''))) in ('on', 'true', '1') from public.platform_settings s where s.key = p_key), false) $$;
create table public.platform_staff(id uuid primary key, role text not null default 'support', is_active boolean not null default true);
create function public.is_platform_staff() returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from public.platform_staff ps where ps.id = auth.uid() and ps.is_active = true
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true');
end $$;
grant usage on schema public to authenticated;

create table public.tenants(id uuid primary key default gen_random_uuid(), name text);
create table public.profiles(id uuid primary key, tenant_id uuid, full_name text, role text, is_active boolean default true);
create table public.support_tickets(
  id uuid primary key default gen_random_uuid(), tenant_id uuid, created_by uuid, subject text, body text, priority text default 'normal',
  status text not null default 'open', assigned_staff_id uuid, ticket_no text, version bigint not null default 1,
  first_response_at timestamptz, first_response_due_at timestamptz, first_response_breached_at timestamptz,
  last_customer_reply_at timestamptz, last_staff_reply_at timestamptz, last_activity_at timestamptz,
  resolved_at timestamptz, closed_at timestamptz, resolution_code text, resolution_summary text,
  reopened_at timestamptz, reopen_count int not null default 0, resolution_due_at timestamptz, resolution_breached_at timestamptz,
  updated_at timestamptz);
create table public.support_ticket_messages(
  id uuid primary key default gen_random_uuid(), ticket_id uuid, author_user_id uuid, author_kind text, body text, visibility text,
  request_id uuid, created_at timestamptz default now());
create table public.invoices(id uuid primary key default gen_random_uuid(), status text, total_try numeric);
create table public.subscriptions(id uuid primary key default gen_random_uuid(), status text);
create table public.alert_events(id uuid primary key default gen_random_uuid(), title text, resolved_at timestamptz);
create table public.platform_notifications(id uuid primary key default gen_random_uuid(), staff_id uuid not null, title text, body text);

create function public.support_require_service_role() returns void language plpgsql stable as $$
begin if auth.role() is distinct from 'service_role' then raise exception 'Service role required.' using errcode = '42501'; end if; end $$;
create function public.support_actor_is_valid(p_actor_id uuid, p_actor_kind text, p_tenant_id uuid default null) returns boolean language sql stable as $$ select true $$;
create function public.support_tenant_actor_can_access_ticket(p_actor uuid, p_tenant uuid, p_created_by uuid) returns boolean language sql stable as $$ select true $$;
create function public.support_resolution_interval(p text) returns interval language sql stable as $$ select interval '1 day' $$;
create table public.support_events(ticket_id uuid, kind text, payload jsonb);
create function public.support_record_event(p_ticket uuid, p_tenant uuid, p_actor uuid, p_kind text, p_event text, p_vis text, p_old jsonb, p_new jsonb, p_msg uuid)
  returns void language sql as $$ insert into public.support_events values (p_ticket, p_event, p_new) $$;
`;

const BROADCAST = "supabase/migrations/20261016040000_admin_staff_broadcast.sql";
const BROADCAST_RB = "supabase/rollbacks/20261016040000_admin_staff_broadcast.rollback.sql";
const REPLY = "supabase/migrations/20261016040100_reply_support_ticket_v3.sql";
const REPLY_RB = "supabase/rollbacks/20261016040100_reply_support_ticket_v3.rollback.sql";
const SEARCH = "supabase/migrations/20261016040200_admin_search_members.sql";

const STAFF = "11111111-1111-4111-8111-111111111111";
const OTHER_STAFF = "22222222-2222-4222-8222-222222222222";
const TENANT_USER = "33333333-3333-4333-8333-333333333333";
const TENANT = "44444444-4444-4444-8444-444444444444";

/** Migration dosyaları `set local` ve `notify` içerir: pglite tek bağlantıda işlem içinde koşar. */
const apply = (db: Db, rel: string) => db.exec(`begin; ${read(rel).replace(/^notify pgrst.*$/gm, "")} commit;`);

describe.skipIf(!mod)("SK4 admin canlı veri + destek + arama migration'ları (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const messages = async () => {
    await db.exec("reset role");
    return (await q(`select topic, payload, octet_length(payload::text) as bytes from realtime.messages order by inserted_at, id`)) as {
      topic: string;
      payload: Record<string, unknown>;
      bytes: number;
    }[];
  };
  const clear = async () => {
    await db.exec("reset role; delete from realtime.messages");
  };
  const asService = () => db.exec(`reset role; select set_config('test.auth_role','service_role',false), set_config('request.jwt.claim.sub','',false)`);
  const asUser = async (id: string, topic: string, jwt: Record<string, unknown> = {}) => {
    await db.exec(`reset role; select set_config('test.auth_role','authenticated',false), set_config('request.jwt.claim.sub','${id}',false),
      set_config('test.jwt','${JSON.stringify(jwt)}',false), set_config('realtime.topic','${topic}',false)`);
    await db.exec("set role authenticated");
  };
  const visible = async (id: string, topic: string, jwt: Record<string, unknown> = {}) => {
    await asUser(id, topic, jwt);
    const rows = await q(`select count(*)::int as n from realtime.messages where topic = realtime.topic()`);
    await db.exec("reset role");
    return Number(rows[0]!.n);
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await apply(db, BROADCAST);
    await apply(db, REPLY);
    await apply(db, SEARCH);
    await db.exec(`insert into public.platform_staff(id, role) values ('${STAFF}', 'support'), ('${OTHER_STAFF}', 'ops')`);
  });

  it("talep açılınca 'admin:staff' konusuna tek, küçük, kişisel verisiz olay düşer", async () => {
    await clear();
    const [t] = await q(`insert into public.support_tickets(tenant_id, subject, body) values ($1, 'Gizli konu', 'Gizli gövde ali@example.com') returning id`, [TENANT]);
    const all = await messages();
    expect(all).toHaveLength(1);
    expect(all[0]!.topic).toBe("admin:staff");
    expect(all[0]!.payload).toMatchObject({ t: "support_tickets", op: "INSERT", by: null, ids: [t!.id] });
    // realtime.send'in eklediği "id" dahil 200 bayt sınırı; konu/gövde/e-posta yükte yok.
    expect(all[0]!.bytes).toBeLessThanOrEqual(200);
    expect(JSON.stringify(all[0]!.payload)).not.toMatch(/Gizli|example\.com/);
  });

  it("oturumlu yazımda 'by' yazan kimliği taşır; yük yine 200 baytı aşmaz", async () => {
    await clear();
    await db.exec(`select set_config('request.jwt.claim.sub','${TENANT_USER}',false)`);
    await q(`insert into public.invoices(status, total_try) values ('open', 1200)`);
    await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
    const [m] = await messages();
    expect(m!.payload).toMatchObject({ t: "invoices", op: "INSERT", by: TENANT_USER });
    expect(m!.bytes).toBeLessThanOrEqual(200);
    expect(JSON.stringify(m!.payload)).not.toContain("1200");
  });

  it("mesajlarda ids BİLET kimliğidir; aynı deyimdeki 3 mesaj tek olay ve tek kimlik üretir", async () => {
    const [t] = await q(`insert into public.support_tickets(tenant_id, subject) values ($1, 'x') returning id`, [TENANT]);
    await clear();
    await q(`insert into public.support_ticket_messages(ticket_id, body) select $1::uuid, 'm' || g from generate_series(1, 3) g`, [t!.id]);
    const all = await messages();
    expect(all).toHaveLength(1);
    expect(all[0]!.payload).toMatchObject({ t: "support_ticket_messages", op: "INSERT", ids: [t!.id] });
  });

  it("hiç satır değiştirmeyen deyim olay üretmez; silme de olay üretir", async () => {
    await clear();
    await q(`update public.subscriptions set status = 'active' where false`);
    expect(await messages()).toHaveLength(0);
    const [s] = await q(`insert into public.subscriptions(status) values ('trialing') returning id`);
    await clear();
    await q(`delete from public.subscriptions where id = $1`, [s!.id]);
    const [m] = await messages();
    expect(m!.payload).toMatchObject({ t: "subscriptions", op: "DELETE", ids: [s!.id] });
  });

  it("toplu yazım (60 satır) tek olay üretir ve bütçeye sığmayan ids düşer", async () => {
    await q(`insert into public.alert_events(title) select 'u' || g from generate_series(1, 60) g`);
    await clear();
    await q(`update public.alert_events set resolved_at = now()`);
    const all = await messages();
    expect(all).toHaveLength(1);
    expect(all[0]!.payload).toMatchObject({ t: "alert_events", op: "UPDATE" });
    expect(all[0]!.payload).not.toHaveProperty("ids");
    expect(all[0]!.bytes).toBeLessThanOrEqual(200);
  });

  it("personel bildirimi alıcının kendi konusuna gider (satır başına)", async () => {
    await clear();
    const rows = await q(`insert into public.platform_notifications(staff_id, title, body) values ($1, 'Kritik uyarı', 'gizli'), ($2, 'b', 'c') returning id, staff_id`, [STAFF, OTHER_STAFF]);
    const all = await messages();
    expect(all.map((m) => m.topic).sort()).toEqual([`staff:${OTHER_STAFF}`, `staff:${STAFF}`].sort());
    const mine = all.find((m) => m.topic === `staff:${STAFF}`)!;
    expect(mine.payload).toMatchObject({ t: "platform_notifications", op: "INSERT", ids: [rows.find((r) => r.staff_id === STAFF)!.id] });
    expect(JSON.stringify(mine.payload)).not.toContain("Kritik");
  });

  it("realtime.messages politikası: personel olmayan JWT 'admin:staff' ve başkasının konusunu göremez", async () => {
    await clear();
    await q(`insert into public.support_tickets(tenant_id, subject) values ($1, 'p')`, [TENANT]);
    await q(`insert into public.platform_notifications(staff_id, title) values ($1, 'n')`, [STAFF]);
    expect(await visible(STAFF, "admin:staff")).toBe(1);
    expect(await visible(TENANT_USER, "admin:staff")).toBe(0);
    expect(await visible(STAFF, `staff:${STAFF}`)).toBe(1);
    expect(await visible(OTHER_STAFF, `staff:${STAFF}`)).toBe(0);
    // Ofis önizlemesindeki (impersonation) personel oturumu admin konusuna katılamaz.
    expect(await visible(STAFF, "admin:staff", { app_metadata: { impersonating: true } })).toBe(0);
    // Pasif personel katılamaz.
    await db.exec(`update public.platform_staff set is_active = false where id = '${OTHER_STAFF}'`);
    await q(`insert into public.platform_notifications(staff_id, title) values ($1, 'n2')`, [OTHER_STAFF]);
    expect(await visible(OTHER_STAFF, `staff:${OTHER_STAFF}`)).toBe(0);
    await db.exec(`update public.platform_staff set is_active = true where id = '${OTHER_STAFF}'`);
  });

  it("MFA zorunluyken aal1 personel oturumu konuya katılamaz, aal2 katılır", async () => {
    await clear();
    await q(`insert into public.support_tickets(tenant_id, subject) values ($1, 'mfa')`, [TENANT]);
    await db.exec(`insert into public.platform_settings(key, value) values ('platform.mfa_enforced', 'on')`);
    expect(await visible(STAFF, "admin:staff", { aal: "aal1" })).toBe(0);
    expect(await visible(STAFF, "admin:staff", { aal: "aal2" })).toBe(1);
    await db.exec(`delete from public.platform_settings where key = 'platform.mfa_enforced'`);
  });

  it("realtime.send yoksa yazma bozulmaz (yalın Postgres)", async () => {
    await db.exec(`reset role; alter function realtime.send(jsonb, text, text, boolean) rename to send_off`);
    try {
      const rows = await q(`insert into public.support_tickets(tenant_id, subject) values ($1, 'rt yok') returning id`, [TENANT]);
      expect(rows).toHaveLength(1);
    } finally {
      await db.exec(`alter function realtime.send_off(jsonb, text, text, boolean) rename to send`);
    }
  });

  describe("reply_support_ticket_v3", () => {
    const reply = async (ticket: string, kind: "tenant" | "staff", visibility = "public") => {
      await asService();
      await q(
        `select public.reply_support_ticket_v3($1::uuid, $2::uuid, $3::uuid, $4, 'Ek bilgi mesajı', $5, gen_random_uuid(), null)`,
        [ticket, kind === "tenant" ? TENANT : null, kind === "tenant" ? TENANT_USER : STAFF, kind, visibility],
      );
      await db.exec("reset role");
      return (await q(`select status, last_customer_reply_at, first_response_at from public.support_tickets where id = $1`, [ticket]))[0]!;
    };
    const ticket = async (status: string, firstResponse = false, assigned = false) =>
      (
        await q(
          `insert into public.support_tickets(tenant_id, created_by, subject, status, first_response_at, assigned_staff_id)
           values ($1, $2, 's', $3, ${firstResponse ? "now()" : "null"}, ${assigned ? `'${STAFF}'` : "null"}) returning id`,
          [TENANT, TENANT_USER, status],
        )
      )[0]!.id as string;

    it("ofisin ek mesajı 'open' talebi 'open' bırakır (iki talepli sınama)", async () => {
      const a = await ticket("open");
      const b = await ticket("open");
      expect((await reply(a, "tenant")).status).toBe("open");
      const after = await reply(b, "tenant");
      expect(after.status).toBe("open");
      expect(after.last_customer_reply_at).not.toBeNull();
    });

    it("'in_progress' korunur; 'waiting' ilk yanıta göre open / in_progress olur", async () => {
      expect((await reply(await ticket("in_progress", true, true), "tenant")).status).toBe("in_progress");
      expect((await reply(await ticket("waiting", false), "tenant")).status).toBe("open");
      expect((await reply(await ticket("waiting", true), "tenant")).status).toBe("in_progress");
    });

    it("personel yanıt kuralı değişmez: public yanıt 'waiting' yapar ve ilk yanıtı işler", async () => {
      const t = await ticket("open");
      const after = await reply(t, "staff");
      expect(after.status).toBe("waiting");
      expect(after.first_response_at).not.toBeNull();
    });

    it("v2 aynı imzayla v3'e devreder; service_role dışı çağrı reddedilir", async () => {
      const t = await ticket("open");
      await asService();
      await q(`select public.reply_support_ticket_v2($1::uuid, $2::uuid, $3::uuid, 'tenant', 'Ek bilgi mesajı', 'public', gen_random_uuid())`, [t, TENANT, TENANT_USER]);
      await db.exec("reset role");
      expect((await q(`select status from public.support_tickets where id = $1`, [t]))[0]!.status).toBe("open");
      await db.exec(`reset role; select set_config('test.auth_role','authenticated',false)`);
      await expect(q(`select public.reply_support_ticket_v3($1::uuid, null, $2::uuid, 'staff', 'xxx', 'public', gen_random_uuid())`, [t, STAFF])).rejects.toThrow(/Service role/);
    });

    it("tek seferlik düzeltme yalnız in_progress + ilk yanıtsız + atanmamış satırı açar", async () => {
      const broken = await ticket("in_progress", false, false);
      const handled = await ticket("in_progress", false, true);
      const answered = await ticket("in_progress", true, false);
      await apply(db, REPLY);
      const st = async (id: string) => (await q(`select status from public.support_tickets where id = $1`, [id]))[0]!.status;
      expect(await st(broken)).toBe("open");
      expect(await st(handled)).toBe("in_progress");
      expect(await st(answered)).toBe("in_progress");
    });
  });

  describe("admin_search_members", () => {
    beforeAll(async () => {
      await db.exec(`reset role; insert into public.tenants(id, name) values ('${TENANT}', 'Demo Emlak Ofisi')`);
      await db.exec(`insert into auth.users(id, email) values ('${TENANT_USER}', 'ayse.kaya@ornek.com.tr'), ('55555555-5555-4555-8555-555555555555', 'mehmet_x@ornek.com.tr')`);
      await db.exec(`insert into public.profiles(id, tenant_id, full_name, role) values ('${TENANT_USER}', '${TENANT}', 'Ayşe Kaya', 'owner'),
        ('55555555-5555-4555-8555-555555555555', '${TENANT}', 'Mehmet Yıldız', 'advisor')`);
    });
    const search = async (term: string) => {
      await asService();
      const rows = await q(`select * from public.admin_search_members($1)`, [term]);
      await db.exec("reset role");
      return rows;
    };

    it("adla ve e-postayla bulur; ofis adı ve rol döner", async () => {
      expect((await search("Ayşe")).map((r) => r.email)).toEqual(["ayse.kaya@ornek.com.tr"]);
      const byEmail = await search("ayse.kaya@ornek.com.tr");
      expect(byEmail[0]).toMatchObject({ full_name: "Ayşe Kaya", tenant_name: "Demo Emlak Ofisi", role: "owner" });
    });

    it("LIKE jokerleri kaçırılır: '_' tüm satırları getirmez", async () => {
      expect((await search("h_x")).length).toBe(0);
      expect((await search("mehmet_x")).map((r) => r.full_name)).toEqual(["Mehmet Yıldız"]);
      expect(await search("%%")).toEqual([]);
    });

    it("yalnız service_role çağırır", async () => {
      await db.exec(`reset role; select set_config('test.auth_role','authenticated',false)`);
      await expect(q(`select * from public.admin_search_members('ayse')`)).rejects.toThrow(/Service role/);
    });
  });

  it("geri alma: tetikleyiciler ve politikalar kalkar, yazma olay üretmez; v3 kalkar, v2 eski kurala döner", async () => {
    await apply(db, BROADCAST_RB);
    await clear();
    await q(`insert into public.support_tickets(tenant_id, subject) values ($1, 'rb')`, [TENANT]);
    expect(await messages()).toHaveLength(0);
    expect((await q(`select count(*)::int as n from pg_policies where schemaname = 'realtime' and policyname like 'rt_%'`))[0]!.n).toBe(0);
    await apply(db, REPLY_RB);
    expect((await q(`select to_regprocedure('public.reply_support_ticket_v3(uuid,uuid,uuid,text,text,text,uuid,bigint)') is null as gone`))[0]!.gone).toBe(true);
    const [t] = await q(`insert into public.support_tickets(tenant_id, created_by, subject, status) values ($1, $2, 'r', 'open') returning id`, [TENANT, TENANT_USER]);
    await asService();
    await q(`select public.reply_support_ticket_v2($1::uuid, $2::uuid, $3::uuid, 'tenant', 'Ek bilgi mesajı', 'public', gen_random_uuid())`, [t!.id, TENANT, TENANT_USER]);
    await db.exec("reset role");
    expect((await q(`select status from public.support_tickets where id = $1`, [t!.id]))[0]!.status).toBe("in_progress");
  });
});
