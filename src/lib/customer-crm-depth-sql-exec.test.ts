import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): C1 CRM derinliği migration'ları.
 *  - 20261020010000 customer_contacts: arama sütunu tetikleyicisi, ek numarayla arayan tanıma, "birincil yap", KVKK temizliği.
 *  - 20261020010001 customer_relations: kendine ilişki ve aynı çiftin ters yönden tekrarı reddedilir.
 *  - 20261020010002 eski serbest notun not listesine kopyası (yıkıcısız, idempotent).
 *  - 20261020010004 merge_customers v3: farklı telefon nota değil ek iletişim bilgisine; ilişkiler taşınır/temizlenir.
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
create function public.fold_tr(v text) returns text language sql immutable as $$ select lower(coalesce(v, '')) $$;
create table public.tenants(id uuid primary key);
create table public.profiles(id uuid primary key, tenant_id uuid, full_name text, unique (id, tenant_id));
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, full_name text,
  phone text, email text, notes text, source text, birth_date date, anniversary_date date, anniversary_note text,
  province_id uuid, district_id uuid, branch_id uuid, assigned_to uuid, customer_types text[], tags text[],
  phone_digits text generated always as (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) stored,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz, deleted_at timestamptz,
  unique (id, tenant_id));
create table public.kvkk_erasure_log(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, customer_id uuid not null);
create table public.communications(id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  customer_id uuid references public.customers(id), created_by uuid, channel text, direction text, subject text, body text,
  created_at timestamptz not null default now());
create table public.share_links(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, entity_type text, entity_id uuid);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text,
  entity_type text, entity_id uuid, old_value jsonb, new_value jsonb);
`;

describe.skipIf(!mod)("C1 CRM derinliği SQL (pglite)", () => {
  let db: Db;
  const T = "00000000-0000-4000-8000-0000000000c1";
  const U = "00000000-0000-4000-8000-000000000011";
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async (sql: string, params?: unknown[]) => (await q(sql, params))[0]!;
  const as = (perms: string) =>
    db.exec(
      `select set_config('request.jwt.claim.sub','${U}',false), set_config('test.tenant','${T}',false), set_config('test.perms','${perms}',false)`,
    );
  const cust = async (fields: Record<string, unknown>) => {
    const keys = Object.keys(fields);
    const cols = ["tenant_id", ...keys].join(", ");
    const vals = ["$1", ...keys.map((_, i) => `$${i + 2}`)].join(", ");
    return (await one(`insert into public.customers(${cols}) values (${vals}) returning id`, [T, ...Object.values(fields)])).id as string;
  };
  const contact = (customerId: string, kind: string, value: string, label = "cep") =>
    q(`insert into public.customer_contacts(tenant_id, customer_id, kind, value, label) values ($1,$2,$3,$4,$5)`, [T, customerId, kind, value, label]);

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await q(`insert into public.tenants(id) values ($1)`, [T]);
    await q(`insert into public.profiles(id, tenant_id, full_name) values ($1,$2,'Danışman Bir')`, [U, T]);
    await db.exec(read("supabase/migrations/20261018010000_merge_customers_v2.sql"));
    await db.exec(read("supabase/migrations/20261020010000_customer_contacts.sql"));
    await db.exec(read("supabase/migrations/20261020010001_customer_relations.sql"));
    await db.exec(read("supabase/migrations/20261020010004_merge_customers_contacts.sql"));
  });

  it("ek iletişim: arama sütunu tetikleyiciyle eşitlenir, e-posta küçük harf şartı", async () => {
    const A = await cust({ full_name: "Kemal Işık", phone: "05321112233" });
    await contact(A, "phone", "05449998877", "is");
    await contact(A, "email", "kemal@ornek.com", "diger");
    expect((await one(`select contacts_fold from public.customers where id=$1`, [A])).contacts_fold).toBe("05449998877 kemal@ornek.com");
    await expect(contact(A, "email", "BUYUK@ornek.com")).rejects.toThrow();
    await expect(contact(A, "phone", "05449998877")).rejects.toThrow(/unique|duplicate/i);
    await q(`delete from public.customer_contacts where customer_id=$1 and kind='phone'`, [A]);
    expect((await one(`select contacts_fold from public.customers where id=$1`, [A])).contacts_fold).toBe("kemal@ornek.com");
  });

  it("arayan tanıma ek numarayı da bulur ve eşleşen numarayı maskeler; yetkisiz boş döner", async () => {
    const A = await cust({ full_name: "Selin Ak", phone: "05300000001", assigned_to: U });
    await contact(A, "phone", "05557776655", "whatsapp");
    await as("customers:view");
    const rows = await q(`select * from public.lookup_customer_by_phone('+90 555 777 66 55')`);
    expect(rows).toEqual([{ full_name: "Selin Ak", phone_masked: "0555 *** ** 55", advisor_name: "Danışman Bir" }]);
    expect(await q(`select * from public.lookup_customer_by_phone('05557776655', array[$1]::uuid[])`, [A])).toEqual([]);
    await as("");
    expect(await q(`select * from public.lookup_customer_by_phone('05557776655')`)).toEqual([]);
  });

  it("birincil yap: ek numara ile birincil yer değiştirir; birincil boşsa ek kayıt silinir", async () => {
    const A = await cust({ full_name: "Can Er", phone: "05310000001" });
    await contact(A, "phone", "05310000002", "is");
    const id = (await one(`select id from public.customer_contacts where customer_id=$1`, [A])).id;
    await as("customers:view");
    await expect(q(`select public.customer_contact_make_primary($1)`, [id])).rejects.toThrow(/yetkiniz/);
    await as("customers:edit");
    await q(`select public.customer_contact_make_primary($1)`, [id]);
    expect((await one(`select phone from public.customers where id=$1`, [A])).phone).toBe("05310000002");
    expect(await q(`select value, label from public.customer_contacts where customer_id=$1`, [A])).toEqual([{ value: "05310000001", label: "is" }]);

    const B = await cust({ full_name: "E-postasız" });
    await contact(B, "email", "yeni@ornek.com", "diger");
    const eid = (await one(`select id from public.customer_contacts where customer_id=$1`, [B])).id;
    await q(`select public.customer_contact_make_primary($1)`, [eid]);
    expect((await one(`select email from public.customers where id=$1`, [B])).email).toBe("yeni@ornek.com");
    expect(await q(`select 1 from public.customer_contacts where customer_id=$1`, [B])).toEqual([]);
  });

  it("ilişki: kendine ilişki ve aynı çiftin ters yönü reddedilir; KVKK silmesi ek bilgi + ilişkiyi temizler", async () => {
    const A = await cust({ full_name: "Eş Bir" });
    const B = await cust({ full_name: "Eş İki" });
    await expect(q(`insert into public.customer_relations(tenant_id, customer_id, related_customer_id, relation) values ($1,$2,$2,'es')`, [T, A])).rejects.toThrow();
    await q(`insert into public.customer_relations(tenant_id, customer_id, related_customer_id, relation) values ($1,$2,$3,'es')`, [T, A, B]);
    await expect(q(`insert into public.customer_relations(tenant_id, customer_id, related_customer_id, relation) values ($1,$3,$2,'es')`, [T, A, B])).rejects.toThrow(/unique|duplicate/i);
    await expect(q(`insert into public.customer_relations(tenant_id, customer_id, related_customer_id, relation) values ($1,$2,$3,'kuzen')`, [T, A, await cust({ full_name: "X" })])).rejects.toThrow();

    await contact(B, "phone", "05420000000");
    await q(`insert into public.kvkk_erasure_log(tenant_id, customer_id) values ($1,$2)`, [T, B]);
    expect(await q(`select 1 from public.customer_contacts where customer_id=$1`, [B])).toEqual([]);
    expect(await q(`select 1 from public.customer_relations where customer_id=$1 or related_customer_id=$1`, [B])).toEqual([]);
  });

  it("birleştirme v3: farklı telefon/e-posta ek iletişim olur (nota yazılmaz), ilişkiler taşınır ve temizlenir", async () => {
    const A = await cust({ full_name: "Ayşe Kaya", phone: "05330000001", email: "ayse@ornek.com", notes: "Ana not" });
    const B = await cust({ full_name: "Ayşe K.", phone: "05330000002", email: "ayse.is@ornek.com", notes: "Kopya not" });
    const X = await cust({ full_name: "Eşi" });
    const Y = await cust({ full_name: "Ortak" });
    await contact(B, "phone", "05330000001", "ev"); // ana kaydın birincili ile aynı → temizlenir
    await contact(B, "phone", "05339999999", "is"); // taşınır
    await q(
      `insert into public.customer_relations(tenant_id, customer_id, related_customer_id, relation) values
         ($1,$2,$3,'es'), ($1,$4,$3,'es'), ($1,$4,$2,'diger'), ($1,$4,$5,'ortak')`,
      [T, A, X, B, Y],
    );

    const res = (await one(`select public.merge_customers($1,$2,$3::uuid[],$4) as r`, [T, A, [B], U])).r as {
      contacts_added: number;
      filled_fields: string[];
    };
    expect(res.contacts_added).toBe(2);
    expect(res.filled_fields).toContain("Ek iletişim bilgisi");

    const a = await one(`select phone, notes, contacts_fold from public.customers where id=$1`, [A]);
    expect(a.phone).toBe("05330000001");
    expect(String(a.notes)).not.toContain("ek telefon");
    expect(String(a.notes)).toContain("Kopya not");
    const contacts = await q(`select kind, value, label from public.customer_contacts where customer_id=$1 order by kind, value`, [A]);
    expect(contacts).toEqual([
      { kind: "email", value: "ayse.is@ornek.com", label: "diger" },
      { kind: "phone", value: "05330000002", label: "cep" },
      { kind: "phone", value: "05339999999", label: "is" },
    ]);
    expect(String(a.contacts_fold)).toContain("05339999999");

    const rels = await q(
      `select customer_id = $1 as from_a, related_customer_id, relation from public.customer_relations
        where customer_id = $1 or related_customer_id = $1 order by relation`,
      [A],
    );
    // A↔X tekrar etmedi (B↔X düştü), A↔B (kendine) düştü, B↔Y ana kayda geçti.
    expect(rels).toEqual([
      { from_a: true, related_customer_id: X, relation: "es" },
      { from_a: true, related_customer_id: Y, relation: "ortak" },
    ]);
    const audit = await one(`select new_value from public.audit_logs where entity_id=$1 and action='customer.merge'`, [A]);
    expect((audit.new_value as { relations: unknown }).relations).toEqual({ moved: 1, dropped: 2 });
  });

  it("eski serbest not: not listesine kopyalanır, kaynak değişmez, tekrar koşunca çoğalmaz", async () => {
    const A = await cust({ full_name: "Notlu", notes: "  Eşi evi görmeden karar vermez  " });
    await cust({ full_name: "Silinmiş", notes: "gizli", deleted_at: "2026-01-01" });
    // communications.origin vb. bu migration'da eklenir; enum yerine metin sütunlu taklit yeterli.
    await db.exec(read("supabase/migrations/20261020010002_communications_pin_mention.sql"));
    await db.exec(read("supabase/migrations/20261020010002_communications_pin_mention.sql"));
    const rows = await q(`select subject, body, origin, mentioned_user_ids from public.communications where customer_id=$1`, [A]);
    expect(rows).toEqual([{ subject: "Önceki notlar", body: "Eşi evi görmeden karar vermez", origin: "customers.notes", mentioned_user_ids: [] }]);
    expect((await one(`select notes from public.customers where id=$1`, [A])).notes).toBe("  Eşi evi görmeden karar vermez  ");
    expect((await one(`select count(*)::int as n from public.communications where body='gizli'`)).n).toBe(0);

    await db.exec(read("supabase/rollbacks/20261020010002_communications_pin_mention.rollback.sql"));
    expect((await one(`select count(*)::int as n from public.communications where customer_id=$1`, [A])).n).toBe(0);
  });

  it("rollback: v2 birleştirme geri gelir; ilişki ve ek iletişim tabloları düşer", async () => {
    await db.exec(read("supabase/rollbacks/20261020010004_merge_customers_contacts.rollback.sql"));
    await db.exec(read("supabase/rollbacks/20261020010001_customer_relations.rollback.sql"));
    await db.exec(read("supabase/rollbacks/20261020010000_customer_contacts.rollback.sql"));
    const left = await q(`select to_regclass('public.customer_contacts') as c, to_regclass('public.customer_relations') as r`);
    expect(left).toEqual([{ c: null, r: null }]);
    const cols = await q(`select 1 from information_schema.columns where table_name='customers' and column_name='contacts_fold'`);
    expect(cols).toEqual([]);
    const body = (await one(`select prosrc from pg_proc where proname='merge_customers'`)).prosrc as string;
    expect(body).toContain("[birleştirme] ek telefon");
  });
});
