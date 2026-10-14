import { beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_MATCH,
  applyErasure,
  approvePhoneMatches,
  classifyErasureError,
  findSubjectRecords,
  loadPlatformKvkkQueue,
  parseApplication,
  platformKvkkSlaCounts,
  preparePackage,
  purgeUnverifiedApplications,
  recordIdentityCheck,
  respondAndClose,
  submitApplication,
  verifyApplication,
  type PlatformKvkkSend,
} from "./platform-kvkk-service";
import {
  buildKvkkRef,
  defaultResponseText,
  maskPersonName,
  parsePackageSummary,
  erasureBlocker,
  platformKvkkDaysLeft,
  respondBlocker,
  slaBucket,
  type PlatformKvkkGateRow,
} from "./platform-kvkk";
import { evaluateAlerts } from "@/lib/alerts/evaluate";
import { mergeRuleConfigs } from "@/lib/alerts/rules";
import { kvkkVeriPaketi } from "@/lib/report-center/catalog/platform-kvkk";
import type { ReportContext } from "@/lib/report-center/types";
import { resetRpcProbes } from "@/lib/supabase/rpc-probe";

// ---------------------------------------------------------------------------------------------------------------------
// Bellek içi sahte Supabase (yalnız servisin kullandığı zincir: select/insert/update/delete + eq/neq/in/is/lt/gte/ilike,
// order/limit/range, maybeSingle/single, count/head, rpc). Gerçek iş kuralı ve gerçek sorgu zinciri çalışır.
// ---------------------------------------------------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Res = { data: unknown; error: { code?: string; message: string } | null; count?: number | null };

class FakeQuery implements PromiseLike<Res> {
  private op: "select" | "insert" | "update" | "delete" | null = null;
  private filters: ((r: Row) => boolean)[] = [];
  private payload: Row | null = null;
  private returning = false;
  private countMode = false;
  private head = false;
  private orders: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private rng: [number, number] | null = null;
  private single: "one" | "maybe" | null = null;
  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op) this.returning = true;
    else this.op = "select";
    if (opts?.count) this.countMode = true;
    if (opts?.head) this.head = true;
    return this;
  }
  insert(row: Row) {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.payload = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push((r) => r[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filters.push((r) => r[c] !== v);
    return this;
  }
  in(c: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(r[c]));
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push((r) => (r[c] ?? null) === v);
    return this;
  }
  lt(c: string, v: string) {
    this.filters.push((r) => r[c] != null && String(r[c]) < v);
    return this;
  }
  gte(c: string, v: string) {
    this.filters.push((r) => r[c] != null && String(r[c]) >= v);
    return this;
  }
  ilike(c: string, pattern: string) {
    const plain = pattern.replace(/\\(.)/g, "$1").toLowerCase();
    this.filters.push((r) => typeof r[c] === "string" && r[c].toLowerCase() === plain);
    return this;
  }
  order(col: string, o?: { ascending?: boolean }) {
    this.orders.push({ col, asc: o?.ascending !== false });
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  range(a: number, b: number) {
    this.rng = [a, b];
    return this;
  }
  maybeSingle() {
    this.single = "maybe";
    return this;
  }
  then<A, B>(ok?: ((v: Res) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.exec()).then(ok, bad);
  }

  private exec(): Res {
    if (this.op === "select" && this.db.failTables.has(this.table)) return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const rows = (this.db.tables[this.table] ??= []);
    const match = () => rows.filter((r) => this.filters.every((f) => f(r)));
    if (this.op === "insert") {
      const row = this.payload!;
      if (this.table === "platform_kvkk_requests" && rows.some((r) => r.ref === row.ref)) return { data: null, error: { code: "23505", message: "dup" } };
      rows.push({ identity_status: "pending", package_summary: null, erasure_applied_at: null, package_prepared_at: null, assignee_id: null, due_at: null, ...row });
      return { data: null, error: null };
    }
    if (this.op === "update") {
      const hit = match();
      for (const r of hit) Object.assign(r, this.payload);
      return { data: this.returning ? hit.map((r) => ({ ...r })) : null, error: null };
    }
    if (this.op === "delete") {
      const hit = match();
      this.db.tables[this.table] = rows.filter((r) => !hit.includes(r));
      return { data: this.returning ? hit : null, error: null };
    }
    let out = match();
    for (const o of [...this.orders].reverse()) out = [...out].sort((a, b) => (String(a[o.col] ?? "") < String(b[o.col] ?? "") ? -1 : String(a[o.col] ?? "") > String(b[o.col] ?? "") ? 1 : 0) * (o.asc ? 1 : -1));
    const count = out.length;
    if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
    if (this.lim !== null) out = out.slice(0, this.lim);
    if (this.single) return { data: out[0] ? { ...out[0] } : null, error: null };
    if (this.head) return { data: null, error: null, count };
    return { data: out.map((r) => ({ ...r })), error: null, count: this.countMode ? count : null };
  }
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  /** Okuması hata dönen tablolar (geçici sorgu hatası benzetimi). */
  failTables = new Set<string>();
  rpcCalls: { fn: string; args: Row }[] = [];
  from(t: string) {
    return new FakeQuery(this, t);
  }
  /** kvkk_customer_related_counts (YD7) yokmuş gibi davran: eski müşteri başına sayım yolu sınanır. */
  relatedRpcMissing = false;
  relatedRpcCalls = 0;
  /** YD7 kvkk_customer_related_counts: müşteri × ilişkili tablo sayımı tek çağrıda (SQL'in bellek içi eşi). */
  relatedCounts(args: Row): Res {
    this.relatedRpcCalls += 1;
    if (this.relatedRpcMissing) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.kvkk_customer_related_counts" } };
    const tables = ["deals", "appointments", "calls", "communications", "offers", "tasks", "iys_consents"];
    if (tables.some((t) => this.failTables.has(t)) || this.failTables.has("customers")) {
      return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    }
    const ids = new Set<string>(args.p_customer_ids as string[]);
    const out: Row[] = [];
    for (const c of (this.tables.customers ?? []).filter((r) => ids.has(r.id))) {
      for (const t of tables) {
        const n = (this.tables[t] ?? []).filter((r) => r.customer_id === c.id && r.tenant_id === c.tenant_id).length;
        if (n > 0) out.push({ customer_id: c.id, tbl: t, n });
      }
    }
    return { data: out, error: null };
  }
  async rpc(fn: string, args: Row): Promise<Res> {
    if (fn === "kvkk_customer_related_counts") return this.relatedCounts(args);
    this.rpcCalls.push({ fn, args });
    if (fn !== "anonymize_customer") return { data: null, error: { message: "unknown rpc" } };
    // Mevcut anonimleştirme RPC'sinin davranışı: kişi alanları silinir, anlaşma satırları korunur, kanıt yazılır.
    const log = (this.tables.kvkk_erasure_log ??= []);
    if (log.some((l) => l.customer_id === args.p_customer_id)) return { data: null, error: { code: "P0001", message: "Customer was already anonymized." } };
    const c = (this.tables.customers ?? []).find((r) => r.id === args.p_customer_id && r.tenant_id === args.p_tenant_id);
    if (!c) return { data: null, error: { code: "42501", message: "Customer not found in tenant." } };
    Object.assign(c, { full_name: "Anonimlestirilmis kayit", phone: null, email: null, notes: null, birth_date: null, deleted_at: c.deleted_at ?? "2026-10-14T00:00:00Z" });
    log.push({ tenant_id: args.p_tenant_id, customer_id: args.p_customer_id, actor_id: args.p_actor_id, reason: args.p_reason });
    return { data: { ok: true, ref: "A*** - 05***" }, error: null };
  }
}

const asDb = (f: FakeDb) => f as unknown as SupabaseClient;

const T0 = Date.parse("2026-10-14T09:00:00Z");
const DAY = 86_400_000;
const STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CUST_A = "c1111111-1111-4111-8111-111111111111";
const CUST_B = "c2222222-2222-4222-8222-222222222222";
const CUST_OTHER = "c3333333-3333-4333-8333-333333333333";

function seed(db: FakeDb) {
  db.tables.tenants = [
    { id: TENANT_A, name: "Kuzey Emlak" },
    { id: TENANT_B, name: "Güney Gayrimenkul" },
  ];
  db.tables.customers = [
    // e-postada `_` (ilike jokeri DEĞİL; düz metin aranmalı) ve büyük harf
    { id: CUST_A, tenant_id: TENANT_A, full_name: "Ayşe Yılmaz", phone: "05321234567", email: "Ayse_Yilmaz@Ornek.com", created_at: "2026-01-02T10:00:00Z", deleted_at: null, source: "web", notes: "3+1 arıyor", birth_date: null, customer_types: ["buyer"] },
    // yalnız telefonla eşleşen kayıt (başka ofis)
    { id: CUST_B, tenant_id: TENANT_B, full_name: "A. Yılmaz", phone: "05321234567", email: null, created_at: "2026-03-05T10:00:00Z", deleted_at: null, source: null, notes: null, birth_date: null, customer_types: [] },
    // `_` joker sayılsaydı eşleşecek başka kişi: eşleşMEmeli
    { id: CUST_OTHER, tenant_id: TENANT_A, full_name: "Başka Kişi", phone: "05550000000", email: "ayseXyilmaz@ornek.com", created_at: "2026-01-02T10:00:00Z", deleted_at: null, source: null, notes: null, birth_date: null, customer_types: [] },
  ];
  db.tables.deals = [{ id: "d1", tenant_id: TENANT_A, customer_id: CUST_A, amount: 1_000_000 }];
  db.tables.appointments = [{ id: "ap1", tenant_id: TENANT_A, customer_id: CUST_A }];
  db.tables.contract_signers = [{ id: "s1", email: "ayse_yilmaz@ornek.com", full_name: "Ayşe Yılmaz" }];
  db.tables.demo_requests = [{ id: "dr1", full_name: "Ayşe Yılmaz", email: "ayse_yilmaz@ornek.com", phone: null, company: "—", city: "İzmir", message: "Demo", notes: null, created_at: "2025-12-01T10:00:00Z" }];
}

function mailbox() {
  const sent: { key: string; to: string; vars: Record<string, string | number> }[] = [];
  const send: PlatformKvkkSend = async (m) => {
    sent.push({ key: m.key, to: m.to, vars: m.vars });
    return { ok: true };
  };
  return { sent, send };
}

const gate = (over: Partial<PlatformKvkkGateRow> = {}): PlatformKvkkGateRow => ({
  status: "open",
  request_type: "erasure",
  identity_status: "verified",
  package_prepared_at: "2026-10-14T10:00:00Z",
  erasure_applied_at: null,
  ...over,
});

beforeAll(() => {
  process.env.OTP_HMAC_SECRET = "kvkk-test-secret-0123456789abcdefghijklmnop";
});

describe("platform KVKK başvurusu: uçtan uca akış", () => {
  it("başvuru → doğrulama → kuyruk → SLA uyarısı → kimlik → veri paketi → silme (yasal saklama korunur) → yanıt", async () => {
    const db = new FakeDb();
    seed(db);
    const mail = mailbox();

    // 1) Başvuru (form doğrulaması + kayıt + kod e-postası)
    const parsed = parseApplication({
      type: "erasure",
      name: "  Ayşe   Yılmaz ",
      email: "AYSE_YILMAZ@ornek.com",
      phone: "0532 123 45 67",
      officeHint: "Kuzey Emlak",
      details: "Tüm kayıtlarımın silinmesini istiyorum.",
      consent: true,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.name).toBe("Ayşe Yılmaz");
    expect(parsed.value.email).toBe("ayse_yilmaz@ornek.com");
    expect(parsed.value.phone).toBe("05321234567");

    const sub = await submitApplication(asDb(db), parsed.value, { nowMs: T0, send: mail.send });
    expect(sub.ok).toBe(true);
    if (!sub.ok) return;
    expect(sub.ref).toMatch(/^KVKK-2026-[0-9A-Z]{6}$/);
    expect(sub.maskedEmail).toBe("ay***@ornek.com");
    const row = db.tables.platform_kvkk_requests![0]!;
    expect(row.status).toBe("awaiting_email");
    expect(row.verify_code_hash).toMatch(/^hmac-sha256-v1:/); // kod düz saklanmaz
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0]!.key).toBe("kvkk_verify");
    const code = String(mail.sent[0]!.vars.kod);
    expect(code).toMatch(/^\d{6}$/);

    // Doğrulanmamış başvuru kuyrukta görünmez
    expect((await loadPlatformKvkkQueue(asDb(db), { sayfa: 1 }, T0)).rows).toHaveLength(0);

    // 2) E-posta doğrulaması: hatalı kod deneme hakkını düşürür, doğru kod kuyruğa alır ve 30 gün başlar
    const wrong = await verifyApplication(asDb(db), { requestId: sub.requestId, code: code === "000000" ? "111111" : "000000" }, T0 + 60_000);
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain("4 deneme");
    const ok = await verifyApplication(asDb(db), { requestId: sub.requestId, code }, T0 + 120_000);
    expect(ok.ok).toBe(true);
    expect(row.status).toBe("open");
    expect(row.verify_code_hash).toBeNull();
    expect(row.due_at).toBe(new Date(T0 + 30 * DAY).toISOString());

    // 3) Admin kuyruğu + 30 gün sayacı
    const q = await loadPlatformKvkkQueue(asDb(db), { sayfa: 1 }, T0 + DAY);
    expect(q.rows.map((r) => r.ref)).toEqual([sub.ref]);
    expect(q.rows[0]!.daysLeft).toBe(29);
    expect(q.open).toBe(1);
    expect(q.late).toBe(0);

    // 4) SLA gecikmesi uyarı üretir (AD10 kvkk_sla; sayım ve kural aynı sınırı kullanır)
    const lateNow = T0 + 32 * DAY;
    expect(await platformKvkkSlaCounts(asDb(db), lateNow, 3)).toEqual({ late: 1, warn: 0, oldestLateRef: sub.ref });
    const lateQueue = await loadPlatformKvkkQueue(asDb(db), { sayfa: 1, sure: "gecikmis" }, lateNow);
    expect(lateQueue.rows).toHaveLength(1);
    const alerts = evaluateAlerts(
      {
        nowMs: lateNow,
        heartbeats: null,
        pausedJobs: new Set(),
        errorsLast5m: null,
        backup: null,
        disk: null,
        captureProblems: null,
        mrr: null,
        kvkkOpen: db.tables.platform_kvkk_requests!.filter((r) => r.status === "open").map((r) => ({ ref: r.ref, due_at: r.due_at })),
      },
      mergeRuleConfigs([]),
    );
    expect(alerts.firing.map((f) => f.fingerprint)).toEqual(["kvkk_sla:late"]);
    expect(alerts.firing[0]!.body).toContain(sub.ref);

    // 5) Kimlik doğrulanmadan veri paketi hazırlanmaz
    const early = await preparePackage(asDb(db), sub.requestId, STAFF, T0 + DAY);
    expect(early.ok).toBe(false);
    const idc = await recordIdentityCheck(asDb(db), sub.requestId, STAFF, { result: "verified", method: "e_signature", note: "e-imzalı dilekçe" }, T0 + DAY);
    expect(idc.ok).toBe(true);
    expect(row.identity_status).toBe("verified");
    expect(row.assignee_id).toBe(STAFF);

    // 6) Veri paketi: e-posta (büyük/küçük harf ve `_` düz metin) kapsamda; YALNIZ telefonla eşleşen kayıt (telefon
    // doğrulanmadı, başka kişiye ait olabilir) aday olarak listelenir ama onaylanmadan kapsama girmez; yasal saklama işaretleri
    const pkg = await preparePackage(asDb(db), sub.requestId, STAFF, T0 + DAY);
    expect(pkg.ok).toBe(true);
    if (!pkg.ok) return;
    expect(pkg.summary.customers).toBe(1);
    expect(pkg.summary.offices).toBe(1);
    expect(pkg.summary.phoneCandidates).toBe(1);
    expect(pkg.summary.demoRequests).toBe(1);
    expect(pkg.summary.records.map((r) => [r.key, r.matchedBy])).toEqual([
      [`customer:${TENANT_A}:${CUST_A}`, "email"],
      [`customer:${TENANT_B}:${CUST_B}`, "phone"],
      ["demo:dr1", "email"],
    ]);
    // Ayrıntı sayfası için: ofis + maskeli ad + gerekçe (tam ad özete yazılmaz)
    expect(pkg.summary.records[1]).toMatchObject({ office: "Güney Gayrimenkul", name: "A*** Y***", matchedBy: "phone" });
    expect(JSON.stringify(row.package_summary)).not.toContain("Ayşe Yılmaz");
    expect(pkg.summary.related).toEqual({ deals: 1, appointments: 1 });
    expect(pkg.summary.legalHolds.join(" ")).toMatch(/Anlaşma/);
    expect(pkg.summary.legalHolds.join(" ")).toMatch(/İmzalı sözleşme/);
    expect(row.status).toBe("in_progress");

    // Rapor merkezi "KVKK veri paketi": başvuru no ile kişiye ait kayıtların dökümü
    const ctx = { supabase: asDb(db) } as unknown as ReportContext;
    if (kvkkVeriPaketi.source.kind !== "compute") throw new Error("compute bekleniyordu");
    const rows = (await kvkkVeriPaketi.source.run(ctx, { basvuru: sub.ref.toLowerCase() })) as Row[];
    expect(rows.some((r) => r.alan === "Ad soyad" && r.deger === "Ayşe Yılmaz" && r.ofis === "Kuzey Emlak")).toBe(true);
    expect(rows.some((r) => r.alan === "Anlaşma" && r.deger === "1 kayıt")).toBe(true);
    expect(rows.some((r) => r.bolum === "EmlakSoft kayıtları")).toBe(true);
    expect(rows.some((r) => r.deger === "Başka Kişi")).toBe(false);
    // Onaylanmamış telefon eşleşmesi (başka ofis, başka kişi olabilir) pakete girmez
    expect(rows.some((r) => r.ofis === "Güney Gayrimenkul" || r.deger === "A. Yılmaz")).toBe(false);
    expect(await kvkkVeriPaketi.source.run(ctx, { basvuru: "KVKK-2026-YOKYOK" })).toEqual([]);

    // 7) Silme başvurusu silme uygulanmadan sonuçlandırılamaz
    const tooEarly = await respondAndClose(asDb(db), sub.requestId, STAFF, { outcome: "completed", text: "x".repeat(40), sendEmail: true }, { nowMs: T0 + DAY, send: mail.send });
    expect(tooEarly.ok).toBe(false);

    // 8) Silme: MEVCUT anonymize_customer akışı YALNIZ incelenen kapsama; anlaşma ve imzacı kayıtları (yasal saklama) korunur
    const er = await applyErasure(asDb(db), sub.requestId, STAFF, T0 + 2 * DAY);
    expect(er.ok).toBe(true);
    if (!er.ok) return;
    expect(db.rpcCalls.map((c) => c.args.p_customer_id)).toEqual([CUST_A]);
    expect(db.rpcCalls.every((c) => c.args.p_actor_id === STAFF && String(c.args.p_reason).includes(sub.ref))).toBe(true);
    expect(er.result).toMatchObject({ anonymized: 1, already: 0, failed: [], demoRequests: 1 });
    // Yalnız telefonla eşleşen (onaylanmamış) kayıt anonimleşmez
    expect(db.tables.customers!.find((c) => c.id === CUST_B)!.full_name).toBe("A. Yılmaz");
    const custA = db.tables.customers!.find((c) => c.id === CUST_A)!;
    expect(custA).toMatchObject({ full_name: "Anonimlestirilmis kayit", phone: null, email: null, notes: null });
    expect(db.tables.customers!.find((c) => c.id === CUST_OTHER)!.full_name).toBe("Başka Kişi");
    expect(db.tables.deals).toHaveLength(1); // anlaşma satırı korunur
    expect(db.tables.contract_signers![0]!.email).toBe("ayse_yilmaz@ornek.com"); // imzacı kaydı korunur
    expect(db.tables.demo_requests![0]).toMatchObject({ full_name: "Anonim", email: null });
    expect(er.result.retained.length).toBe(2);
    expect(row.erasure_applied_at).toBe(new Date(T0 + 2 * DAY).toISOString());
    // Silme ikinci kez uygulanmaz
    expect((await applyErasure(asDb(db), sub.requestId, STAFF, T0 + 2 * DAY)).ok).toBe(false);
    // Silmeden sonra e-postayla eşleşen kayıt kalmaz (yalnız saklanan imzacı sayısı ve onaylanmamış telefon adayı)
    const after = await findSubjectRecords(asDb(db), { email: "ayse_yilmaz@ornek.com", phone: "05321234567" });
    expect(after.customers.map((c) => [c.id, c.matchedBy])).toEqual([[CUST_B, "phone"]]);
    // Silmeden sonra tarama kaydı (silinen kümenin kanıtı) yeniden yazılmaz
    expect((await preparePackage(asDb(db), sub.requestId, STAFF, T0 + 2 * DAY)).ok).toBe(false);
    expect(after.signers).toBe(1);

    // 9) Yanıt (AD7 kvkk_reply) + sonuç kaydı; sayaç durur
    const text = defaultResponseText("erasure", "completed", pkg.summary);
    expect(text).toContain("anonim");
    const done = await respondAndClose(asDb(db), sub.requestId, STAFF, { outcome: "completed", text, sendEmail: true }, { nowMs: T0 + 3 * DAY, send: mail.send });
    expect(done.ok).toBe(true);
    const reply = mail.sent.at(-1)!;
    expect(reply).toMatchObject({ key: "kvkk_reply", to: "ayse_yilmaz@ornek.com" });
    expect(reply.vars).toMatchObject({ ad: "Ayşe Yılmaz", basvuru_no: sub.ref, yanit: text });
    expect(row).toMatchObject({ status: "completed", response_delivery: "sent", resolved_by: STAFF });
    expect(await platformKvkkSlaCounts(asDb(db), lateNow, 3)).toEqual({ late: 0, warn: 0, oldestLateRef: null });
    expect(platformKvkkDaysLeft(row.due_at, row.status, lateNow)).toBeNull();
  });

  it("yanıt e-postası gönderilemezse başvuru açık kalır; başka kanalla iletildiyse yalnız sonuç kaydedilir", async () => {
    const db = new FakeDb();
    db.tables.platform_kvkk_requests = [
      {
        id: "r1",
        ref: "KVKK-2026-ABCDEF",
        request_type: "access",
        status: "open",
        requester_name: "Veli",
        email: "veli@ornek.com",
        phone: null,
        identity_status: "failed",
        package_prepared_at: null,
        erasure_applied_at: null,
        created_at: "2026-10-01T10:00:00Z",
        due_at: "2026-10-31T10:00:00Z",
      },
    ];
    const failing: PlatformKvkkSend = async () => ({ ok: false, code: "disabled", error: "kapalı" });
    const text = defaultResponseText("access", "rejected", null);
    const r1 = await respondAndClose(asDb(db), "r1", STAFF, { outcome: "rejected", text, sendEmail: true }, { nowMs: T0, send: failing });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toContain("kanalı kapalı");
    expect(db.tables.platform_kvkk_requests[0]!.status).toBe("open");
    // Kimliği doğrulanmamış başvuru "yerine getirildi" olamaz; gerekçeli ret olur
    expect((await respondAndClose(asDb(db), "r1", STAFF, { outcome: "completed", text, sendEmail: false }, { nowMs: T0, send: failing })).ok).toBe(false);
    const r2 = await respondAndClose(asDb(db), "r1", STAFF, { outcome: "rejected", text, sendEmail: false }, { nowMs: T0, send: failing });
    expect(r2.ok).toBe(true);
    expect(db.tables.platform_kvkk_requests[0]).toMatchObject({ status: "rejected", response_delivery: null, response_sent_at: null });
  });

  it("aynı e-posta + tür için tekrar gönderim yeni satır açmaz, en çok 3 kod; 5 hatalı denemede kod kilitlenir", async () => {
    const db = new FakeDb();
    const mail = mailbox();
    const input = parseApplication({ type: "access", name: "Ali Veli", email: "ali@ornek.com", phone: "", officeHint: "", details: "Hangi verilerim var?", consent: true });
    if (!input.ok) throw new Error(input.error);
    const a = await submitApplication(asDb(db), input.value, { nowMs: T0, send: mail.send });
    const b = await submitApplication(asDb(db), input.value, { nowMs: T0 + 60_000, send: mail.send });
    const c = await submitApplication(asDb(db), input.value, { nowMs: T0 + 120_000, send: mail.send });
    const d = await submitApplication(asDb(db), input.value, { nowMs: T0 + 180_000, send: mail.send });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(b.requestId).toBe(a.requestId);
      expect(b.resent).toBe(true);
    }
    expect(d.ok).toBe(false);
    expect(db.tables.platform_kvkk_requests).toHaveLength(1);
    // İlk kod geçersizleşti (yeni kod gönderildi)
    if (!a.ok) return;
    const firstCode = String(mail.sent[0]!.vars.kod);
    const lastCode = String(mail.sent[2]!.vars.kod);
    if (firstCode !== lastCode) expect((await verifyApplication(asDb(db), { requestId: a.requestId, code: firstCode }, T0 + 200_000)).ok).toBe(false);
    for (let i = 0; i < 5; i++) await verifyApplication(asDb(db), { requestId: a.requestId, code: lastCode === "999999" ? "888888" : "999999" }, T0 + 200_000);
    const locked = await verifyApplication(asDb(db), { requestId: a.requestId, code: lastCode }, T0 + 210_000);
    expect(locked.ok).toBe(false);
    // Süresi dolan kod
    const db2 = new FakeDb();
    const m2 = mailbox();
    const s2 = await submitApplication(asDb(db2), input.value, { nowMs: T0, send: m2.send });
    if (!s2.ok) throw new Error(s2.error);
    const expired = await verifyApplication(asDb(db2), { requestId: s2.requestId, code: String(m2.sent[0]!.vars.kod) }, T0 + 31 * 60_000);
    expect(expired.ok).toBe(false);
    // Doğrulanmayan başvuru 7 gün sonra silinir
    expect(await purgeUnverifiedApplications(asDb(db2), T0 + 6 * DAY)).toEqual({ deleted: 0 });
    expect(await purgeUnverifiedApplications(asDb(db2), T0 + 8 * DAY)).toEqual({ deleted: 1 });
  });

  it("form doğrulaması: tür, ad, e-posta, telefon, açıklama ve beyan", () => {
    const base = { type: "access", name: "Ali Veli", email: "ali@ornek.com", phone: "", officeHint: "", details: "Bilgi talep ediyorum.", consent: true };
    expect(parseApplication(base).ok).toBe(true);
    expect(parseApplication({ ...base, type: "account_closure" }).ok).toBe(false);
    expect(parseApplication({ ...base, name: "A" }).ok).toBe(false);
    expect(parseApplication({ ...base, email: "ali@" }).ok).toBe(false);
    expect(parseApplication({ ...base, phone: "12" }).ok).toBe(false);
    expect(parseApplication({ ...base, details: "kısa" }).ok).toBe(false);
    expect(parseApplication({ ...base, consent: false }).ok).toBe(false);
  });
});

/** Kimliği doğrulanmış, kayıtları henüz taranmamış silme başvurusu (ayse_yilmaz@ornek.com + 05321234567). */
function verifiedErasure(db: FakeDb) {
  seed(db);
  db.tables.platform_kvkk_requests = [
    {
      id: "r1",
      ref: "KVKK-2026-ABCDEF",
      request_type: "erasure",
      status: "open",
      requester_name: "Ayşe Yılmaz",
      email: "ayse_yilmaz@ornek.com",
      phone: "05321234567",
      identity_status: "verified",
      package_prepared_at: null,
      package_summary: null,
      erasure_applied_at: null,
      assignee_id: STAFF,
      created_at: "2026-10-01T10:00:00Z",
      due_at: "2026-10-31T10:00:00Z",
    },
  ];
  return db.tables.platform_kvkk_requests[0]!;
}

describe("platform KVKK kapsam: telefon eşleşmesi, tarama hatası, incelenen küme", () => {
  it("telefon eşleşmesi personel tek tek onaylarsa pakete ve silmeye girer; onay geri alınabilir", async () => {
    const db = new FakeDb();
    const row = verifiedErasure(db);
    const pkg = await preparePackage(asDb(db), "r1", STAFF, T0);
    if (!pkg.ok) throw new Error(pkg.error);
    const keyB = `customer:${TENANT_B}:${CUST_B}`;
    // Taramada olmayan anahtar reddedilir; e-posta eşleşmesi "onaylanacak" bir aday değildir
    expect((await approvePhoneMatches(asDb(db), "r1", STAFF, [`customer:${TENANT_A}:${CUST_OTHER}`], T0)).ok).toBe(false);
    expect((await approvePhoneMatches(asDb(db), "r1", STAFF, [`customer:${TENANT_A}:${CUST_A}`], T0)).ok).toBe(false);
    const ap = await approvePhoneMatches(asDb(db), "r1", STAFF, [keyB], T0);
    if (!ap.ok) throw new Error(ap.error);
    expect(ap.summary).toMatchObject({ customers: 2, offices: 2, phoneCandidates: 0, approvedPhone: [keyB] });
    // Yeniden tarama onayı korur
    const again = await preparePackage(asDb(db), "r1", STAFF, T0 + 1000);
    if (!again.ok) throw new Error(again.error);
    expect(again.summary.approvedPhone).toEqual([keyB]);
    // Onaylanan kayıt veri paketine girer
    const ctx = { supabase: asDb(db) } as unknown as ReportContext;
    if (kvkkVeriPaketi.source.kind !== "compute") throw new Error("compute bekleniyordu");
    const rows = (await kvkkVeriPaketi.source.run(ctx, { basvuru: "KVKK-2026-ABCDEF" })) as Row[];
    expect(rows.some((r) => r.ofis === "Güney Gayrimenkul" && r.deger === "A. Yılmaz")).toBe(true);
    // Silme ikisine de uygulanır
    const er = await applyErasure(asDb(db), "r1", STAFF, T0 + DAY);
    if (!er.ok) throw new Error(er.error);
    expect(db.rpcCalls.map((c) => c.args.p_customer_id).sort()).toEqual([CUST_A, CUST_B].sort());
    expect(row.erasure_applied_at).not.toBeNull();
    // Silmeden sonra kapsam değiştirilemez
    expect((await approvePhoneMatches(asDb(db), "r1", STAFF, [], T0 + DAY)).ok).toBe(false);
  });

  it("taramadan sonra yeni eşleşme çıkarsa silme yapılmaz; yeniden tarama sonrası uygulanır", async () => {
    const db = new FakeDb();
    const row = verifiedErasure(db);
    expect((await preparePackage(asDb(db), "r1", STAFF, T0)).ok).toBe(true);
    const NEW = "c4444444-4444-4444-8444-444444444444";
    db.tables.customers!.push({ id: NEW, tenant_id: TENANT_B, full_name: "Ayşe Y.", phone: null, email: "ayse_yilmaz@ornek.com", created_at: "2026-10-14T10:00:00Z", deleted_at: null, source: null, notes: null, birth_date: null, customer_types: [] });
    const blocked = await applyErasure(asDb(db), "r1", STAFF, T0 + DAY);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toMatch(/1 yeni eşleşen kayıt.*yeniden tarayıp/);
    expect(db.rpcCalls).toHaveLength(0);
    expect(row.erasure_applied_at).toBeNull();
    // Yeni bir YALNIZ telefon adayı silmeyi durdurmaz (kapsama zaten girmez)
    expect((await preparePackage(asDb(db), "r1", STAFF, T0 + DAY)).ok).toBe(true);
    db.tables.customers!.push({ id: "c5555555-5555-4555-8555-555555555555", tenant_id: TENANT_B, full_name: "Başkası", phone: "05321234567", email: null, created_at: null, deleted_at: null, source: null, notes: null, birth_date: null, customer_types: [] });
    const er = await applyErasure(asDb(db), "r1", STAFF, T0 + DAY);
    if (!er.ok) throw new Error(er.error);
    expect(db.rpcCalls.map((c) => c.args.p_customer_id).sort()).toEqual([CUST_A, NEW].sort());
    // Silinen küme kaydedilen taramayla aynıdır (kimlikler özette)
    const stored = parsePackageSummary(row.package_summary)!;
    expect(stored.records.filter((r) => r.matchedBy === "email" && r.kind === "customer").map((r) => r.id).sort()).toEqual([CUST_A, NEW].sort());
  });

  it("herhangi bir tarama sorgusu hata verirse paket ve silme tamamlanmış sayılmaz", async () => {
    for (const table of ["customers", "demo_requests", "open_house_visitors", "contract_signers", "finance_parties", "tenants", "deals"]) {
      const db = new FakeDb();
      const row = verifiedErasure(db);
      db.failTables.add(table);
      const pkg = await preparePackage(asDb(db), "r1", STAFF, T0);
      expect(pkg.ok, table).toBe(false);
      if (!pkg.ok) expect(pkg.error).toMatch(/taranamadı/);
      expect(row.package_prepared_at, table).toBeNull();
      // Tarama başarılıyken hazırlanmış pakette silme anında hata: silme yazılmaz
      db.failTables.delete(table);
      expect((await preparePackage(asDb(db), "r1", STAFF, T0)).ok).toBe(true);
      db.failTables.add(table);
      const er = await applyErasure(asDb(db), "r1", STAFF, T0 + DAY);
      expect(er.ok, table).toBe(false);
      expect(row.erasure_applied_at, table).toBeNull();
      expect(db.rpcCalls).toHaveLength(0);
    }
  });

  it("ilişkili kayıt sayımı tek RPC turunda; fonksiyon yokken müşteri başına eski sayımla AYNI sonuç (YD7)", async () => {
    const who = { email: "ayse_yilmaz@ornek.com", phone: "05321234567" };
    const fast = new FakeDb();
    seed(fast);
    fast.tables.tasks = [{ id: "t1", tenant_id: TENANT_A, customer_id: CUST_A }, { id: "t2", tenant_id: TENANT_B, customer_id: CUST_A }];
    const a = await findSubjectRecords(asDb(fast), who);
    expect(fast.relatedRpcCalls).toBe(1);
    resetRpcProbes();
    const slow = new FakeDb();
    seed(slow);
    slow.tables.tasks = fast.tables.tasks;
    slow.relatedRpcMissing = true;
    const b = await findSubjectRecords(asDb(slow), who);
    resetRpcProbes();
    expect(a.customers.map((c) => [c.id, c.related])).toEqual(b.customers.map((c) => [c.id, c.related]));
    // başka ofisin aynı müşteri kimliğiyle yazılmış görev satırı sayılmaz (tenant_id eşitliği)
    expect(a.customers.find((c) => c.id === CUST_A)?.related).toEqual({ deals: 1, appointments: 1, tasks: 1 });
  });

  it("eşleşme sınırı aşılırsa tarama eksik sayılır (sessizce kesilmez)", async () => {
    const db = new FakeDb();
    verifiedErasure(db);
    for (let i = 0; i <= MAX_MATCH; i++) db.tables.demo_requests!.push({ id: `dx${String(i).padStart(4, "0")}`, full_name: "X", email: "ayse_yilmaz@ornek.com", phone: null, created_at: null });
    const pkg = await preparePackage(asDb(db), "r1", STAFF, T0);
    expect(pkg.ok).toBe(false);
    if (!pkg.ok) expect(pkg.error).toMatch(/aşıyor/);
  });

  it("RPC hataları sınıflandırılır; ham DB metni sonuca yazılmaz", async () => {
    expect(classifyErasureError({ message: "Customer was already anonymized." })).toBe("already");
    expect(classifyErasureError({ message: "Customer not found in tenant." })).toBe("gone");
    expect(classifyErasureError({ message: "Tenant not found." })).toEqual({ reason: "Ofis kaydı bulunamadı." });
    expect(classifyErasureError({ message: "Actor is not authorized for this tenant." })).toMatchObject({ reason: expect.stringMatching(/yetkisi/) });
    expect(classifyErasureError({ message: "deadlock detected on relation customers" })).toMatchObject({ reason: expect.not.stringMatching(/deadlock/) });
    const db = new FakeDb();
    const row = verifiedErasure(db);
    expect((await preparePackage(asDb(db), "r1", STAFF, T0)).ok).toBe(true);
    db.rpc = async (fn: string, args: Row) => {
      if (fn === "kvkk_customer_related_counts") return db.relatedCounts(args);
      db.rpcCalls.push({ fn, args });
      return { data: null, error: { code: "40P01", message: "deadlock detected on relation customers" } };
    };
    const er = await applyErasure(asDb(db), "r1", STAFF, T0 + DAY);
    if (!er.ok) throw new Error(er.error);
    expect(er.result.failed).toHaveLength(1);
    expect(JSON.stringify(row.erasure_result)).not.toContain("deadlock");
    expect(row.erasure_applied_at).toBeNull();
  });

  it("maskeli ad", () => {
    expect(maskPersonName("Ayşe Yılmaz")).toBe("A*** Y***");
    expect(maskPersonName("  ")).toBe("İsimsiz");
    expect(maskPersonName(null)).toBe("İsimsiz");
  });
});

describe("platform KVKK saf kurallar", () => {
  it("başvuru no biçimi ve SLA sınıfı", () => {
    expect(buildKvkkRef(2026, new Uint8Array([0, 1, 2, 3, 4, 31]))).toBe("KVKK-2026-23456Z");
    expect(slaBucket(-1, 3)).toBe("late");
    expect(slaBucket(3, 3)).toBe("warn");
    expect(slaBucket(4, 3)).toBeNull();
    expect(slaBucket(null, 3)).toBeNull();
    expect(platformKvkkDaysLeft("2026-11-13T09:00:00Z", "awaiting_email", T0)).toBeNull();
  });

  it("adım kapıları: silme yalnız silme türünde, kimlik + tarama sonrası ve bir kez; sonuç kuralları", () => {
    expect(erasureBlocker(gate())).toBeNull();
    expect(erasureBlocker(gate({ request_type: "access" }))).toMatch(/yalnız silme/);
    expect(erasureBlocker(gate({ identity_status: "pending" }))).toMatch(/kimliğini/);
    expect(erasureBlocker(gate({ package_prepared_at: null }))).toMatch(/tarayın/);
    expect(erasureBlocker(gate({ erasure_applied_at: "2026-10-14T10:00:00Z" }))).toMatch(/zaten/);
    expect(respondBlocker(gate(), "completed")).toMatch(/silmeyi/);
    expect(respondBlocker(gate({ request_type: "access" }), "completed")).toBeNull();
    expect(respondBlocker(gate({ identity_status: "failed" }), "rejected")).toBeNull();
    expect(respondBlocker(gate({ status: "completed" }), "rejected")).toMatch(/sonuçlanmış/);
  });
});
