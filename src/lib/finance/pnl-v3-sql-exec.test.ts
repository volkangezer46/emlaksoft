import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";
import { applyFinanceBase, applyWp2, OWNER_FINANCE_PERMS, readRepo, WP2_ROLLBACKS } from "@/lib/test-support/finance-accrual-db";

/**
 * İŞLEVSEL SQL TESTİ (pglite): K/Z v3 (20261017010400) — WP2 öncesi/sonrası aynı 2026 tohum verisi.
 *  - 'tahakkuk' (varsayılan) ay NET'i eskiyle AYNI. Bilinçli sunum farkı: komisyon artık brüt gelir + ayrı 'danisman_hakedis'
 *    gider satırı (eski: tek satır brüt − ofis dışı paylar); gelir ve gider pay kadar büyür, net değişmez.
 *  - KDV özeti (tahakkuk) e-fatura yokken eskiyle aynı; kesilmiş e-fatura varsa komisyon KDV'si fatura ayına geçer.
 *  - 'nakit': komisyon tahsilat ayında (KDV orantılı düşülür), kasa dışı kapanış yok.
 *  - Emanet: depozito hareketi K/Z dışı (eski K/Z elle gelir sayıyordu). Kilitli ay ters kaydı ilk açık ayda eksi.
 *  - Eski çağrı biçimi ({p_from, p_to}) aynı kolonları döner; geri alma iki parametreli eski gövdeye döner.
 */
const mod = await loadPglite();

type Json = Record<string, unknown>;
type Month = { m: string; i: number; e: number; n: number; ic: Record<string, number>; ec: Record<string, number> };

describe.skipIf(!mod)("K/Z v3: tahakkuk / nakit esası (pglite, 20261017010400)", () => {
  let db: Db;
  let T: string, OWNER: string, ADV: string, CUSTOMER: string, BANKA: string;
  let C1: string, C2: string;
  let oldPnl: Month[];
  let oldVat: { m: string; o: number; i: number }[];
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async <R = unknown>(sql: string, params: unknown[] = []) => (await q(`select ${sql} as r`, params))[0]!.r as R;
  const asOwner = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${OWNER}',false), set_config('test.tenant','${T}',false),
      set_config('test.perms','${OWNER_FINANCE_PERMS}',false), set_config('test.role','owner',false)`);
    await db.exec(`set role authenticated`);
  };
  const sudo = async () => db.exec(`reset role`);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const numRec = (v: unknown) => Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([k, x]) => [k, r2(Number(x))]));
  const pnl = async (basis?: "tahakkuk" | "nakit"): Promise<Month[]> => {
    await asOwner();
    const sql = basis
      ? `select * from public.finance_pnl('2026-01-01'::date, '2026-12-31'::date, '${basis}')`
      : `select * from public.finance_pnl(p_from => '2026-01-01'::date, p_to => '2026-12-31'::date)`;
    const rows = await q(sql);
    return rows.map((r) => ({ m: mkey(r.month), i: r2(Number(r.income)), e: r2(Number(r.expense)), n: r2(Number(r.net)),
      ic: numRec(r.income_by_category), ec: numRec(r.expense_by_category) }));
  };
  const vat = async (basis?: "tahakkuk" | "nakit") => {
    await asOwner();
    const rows = await q(basis
      ? `select * from public.finance_vat_summary('2026-01-01'::date, '2026-12-31'::date, '${basis}')`
      : `select * from public.finance_vat_summary(p_from => '2026-01-01'::date, p_to => '2026-12-31'::date)`);
    return rows.map((r) => ({ m: mkey(r.month), o: r2(Number(r.output_vat)), i: r2(Number(r.input_vat)) }));
  };
  const mkey = (v: unknown) => (v instanceof Date ? `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}` : String(v).slice(0, 7));
  const nets = (ms: Month[]) => ms.map((x) => [x.m, x.n]);
  const month = (ms: Month[], key: string) => ms.find((x) => x.m === key)!;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await applyFinanceBase(db);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    OWNER = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Ofis Sahibi') returning id`, [T]))[0]!.id as string;
    ADV = (await q(`insert into public.profiles(tenant_id, full_name) values ($1, 'Deniz Danışman') returning id`, [T]))[0]!.id as string;
    CUSTOMER = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Ayşe Yılmaz') returning id`, [T]))[0]!.id as string;
    await asOwner();
    BANKA = (await one<Json>(`public.finance_account_create('office','bank','Banka',null,'TRY',50000::numeric,'2026-01-01'::date)`)).account_id as string;
    await sudo();

    // --- 2026 tohum verisi (WP2 ÖNCESİ yazılır) ---
    const deal = async () => (await q(`insert into public.deals(tenant_id, customer_id) values ($1, $2) returning id`, [T, CUSTOMER]))[0]!.id as string;
    const comm = async (gross: number, vatAmt: number, at: string, status = "calculated", sample = false) =>
      (await q(`insert into public.commissions(tenant_id, deal_id, gross_amount, vat_amount, created_at, status, is_sample) values ($1,$2,$3,$4,$5::timestamptz,$6,$7) returning id`,
        [T, await deal(), gross, vatAmt, at, status, sample]))[0]!.id as string;
    const split = (c: string, kind: string, amount: number, profile: string | null, label = "Pay") =>
      q(`insert into public.commission_splits(tenant_id, commission_id, kind, amount, profile_id, label) values ($1,$2,$3,$4,$5,$6)`, [T, c, kind, amount, profile, label]);
    C1 = await comm(100000, 20000, "2026-03-10T10:00:00+03");
    await split(C1, "advisor", 50000, ADV, "Danışman");
    await split(C1, "office", 40000, null, "Ofis");
    await split(C1, "referral", 10000, null, "Yönlendiren");
    C2 = await comm(40000, 8000, "2026-04-02T10:00:00+03", "paid");
    await split(C2, "advisor", 20000, ADV, "Danışman");
    await comm(30000, 6000, "2026-04-05T10:00:00+03", "cancelled");
    await comm(70000, 14000, "2026-04-06T10:00:00+03", "calculated", true);
    await q(`insert into public.commission_payouts(tenant_id, commission_id, profile_id, amount, status, approved_at, paid_at)
             select $1, $2, $3, 20000, 'paid', '2026-04-20T10:00:00+03', '2026-04-20T10:00:00+03'`, [T, C2, ADV]);
    await q(`update public.commission_payouts set split_id = (select id from public.commission_splits where commission_id = $1 and kind = 'advisor') where commission_id = $1`, [C2]);
    // Kira yönetim ücreti + kira tahsilatı (emanet) + mülk sahibi ödemesi.
    const rental = (await q(`insert into public.rentals(tenant_id, renter_customer_id) values ($1, $2) returning id`, [T, CUSTOMER]))[0]!.id as string;
    const rp = (await q(`insert into public.rent_payments(tenant_id, rental_id, amount, management_fee, paid_on) values ($1,$2,20000,2000,'2026-05-05') returning id`, [T, rental]))[0]!.id as string;
    await asOwner();
    // Eski yol komisyon tahsilatı (KDV DAHİL, KDV kolonu boş) ve diğer hareketler.
    await one(`public.finance_record_entry($1::uuid,'in',60000::numeric,'2026-03-20'::date,'komisyon','Komisyon tahsilatı',null,null,null,'commission',$2::uuid)`, [BANKA, C1]);
    await one(`public.finance_record_entry($1::uuid,'in',48000::numeric,'2026-05-02'::date,'komisyon','Komisyon tahsilatı',null,null,null,'commission',$2::uuid)`, [BANKA, C2]);
    await one(`public.finance_record_entry($1::uuid,'in',20000::numeric,'2026-05-05'::date,'kira_tahsilat','Kira',null,null,null,'rent',$2::uuid)`, [BANKA, rp]);
    const rec = (p: Json) => one(`public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify(p)]);
    await rec({ account_id: BANKA, direction: "in", amount: 6000, entry_date: "2026-03-15", category: "hizmet_bedeli", title: "Danışmanlık", vat_rate: 20, vat_included: true });
    await rec({ account_id: BANKA, direction: "out", amount: 12000, entry_date: "2026-03-01", category: "kira", title: "Ofis kirası", vat_rate: 20, vat_included: true });
    await rec({ account_id: BANKA, direction: "out", amount: 30000, entry_date: "2026-04-30", category: "maas", title: "Maaş" });
    await rec({ account_id: BANKA, direction: "out", amount: 18000, entry_date: "2026-05-15", category: "mulk_sahibi_odeme", title: "Malik ödemesi" });
    // Elle vadeli alacak, aynı ayda tamamen tahsil (tahakkuk = nakit ayı; net eşit kalır).
    const item = await one<string>(`public.finance_open_item_create($1::jsonb)`, [JSON.stringify({
      direction: "receivable", party_name: "Demir Ltd", title: "Danışmanlık faturası", category: "hizmet_bedeli", amount: 12000,
      vat_rate: 20, issue_date: "2026-06-05", due_date: "2026-06-30" })]);
    await one(`public.finance_open_item_settle($1::uuid, $2::uuid, null, '2026-06-20'::date, null)`, [item, BANKA]);
    await sudo();
    await q(`insert into public.expenses(tenant_id, category, title, amount, expense_date) values ($1, 'kirtasiye', 'Kırtasiye', 750, '2026-03-12')`, [T]);

    oldPnl = await pnl();
    oldVat = await vat();
    await sudo();
    await applyWp2(db);
  }, 180_000);

  it("tahakkuk: ay neti eskiyle aynı; komisyon brüt gelir + danışman/dış pay ayrı gider satırı (bilinçli sunum farkı)", async () => {
    const now = await pnl("tahakkuk");
    expect(nets(now)).toEqual(nets(oldPnl));
    const mar = month(now, "2026-03");
    const oldMar = month(oldPnl, "2026-03");
    expect(oldMar.ic.komisyon).toBe(40000); // eski: 100.000 − (50.000 + 10.000)
    expect(mar.ic.komisyon).toBe(100000);
    expect(mar.ec.danisman_hakedis).toBe(60000);
    expect(mar.i - oldMar.i).toBe(60000);
    expect(mar.e - oldMar.e).toBe(60000);
    // Nisan: ödenmiş (nakitsiz hakedişli) komisyon; iptal ve örnek komisyon sayılmaz.
    expect(month(now, "2026-04").ic.komisyon).toBe(40000);
    expect(month(now, "2026-04").ec.danisman_hakedis).toBe(20000);
    // Haziran: elle kalem düzenleme ayında KDV hariç (10.000), bağlı tahsilat tekrar sayılmaz.
    expect(month(now, "2026-06").ic.hizmet_bedeli).toBe(10000);
    // Varsayılan esas = tahakkuk (eski {p_from, p_to} çağrısı).
    expect(await pnl()).toEqual(now);
  });

  it("KDV özeti (tahakkuk): e-fatura yokken eskiyle aynı; kesilmiş e-fatura komisyon KDV'sini fatura ayına taşır", async () => {
    expect(await vat("tahakkuk")).toEqual(oldVat);
    await sudo();
    await q(`insert into public.einvoices(tenant_id, source_type, source_id, status, issue_date) values ($1, 'commission', $2, 'issued', '2026-05-03')`, [T, C1]);
    const v = await vat("tahakkuk");
    const m = (k: string) => v.find((x) => x.m === k)!;
    const om = (k: string) => oldVat.find((x) => x.m === k)!;
    expect(m("2026-03").o).toBe(r2(om("2026-03").o - 20000));
    expect(m("2026-05").o).toBe(r2(om("2026-05").o + 20000));
    await sudo();
    await q(`delete from public.einvoices where source_id = $1`, [C1]);
  });

  it("nakit esası: komisyon tahsilat ayında KDV hariç; danışman payı yalnız kasadan ödenirse gider", async () => {
    const cash = await pnl("nakit");
    expect(month(cash, "2026-03").ic.komisyon).toBe(50000); // 60.000 KDV dahil → 10.000 KDV
    expect(month(cash, "2026-05").ic.komisyon).toBe(40000);
    expect(month(cash, "2026-03").ec.danisman_hakedis).toBeUndefined();
    expect(month(cash, "2026-06").ic.hizmet_bedeli).toBe(10000);
    expect(month(cash, "2026-05").ic.kira_tahsilat).toBeUndefined();
    const nakitVat = await vat("nakit");
    expect(nakitVat.find((x) => x.m === "2026-03")!.o).toBe(r2(10000 + 1000));
    await asOwner();
    await expect(q(`select * from public.finance_pnl('2026-01-01'::date, '2026-01-31'::date, 'karma')`)).rejects.toThrow(/invalid_input/);
  });

  it("emanet: depozito hareketi K/Z dışı; kilitli ay ters kaydı ilk açık ayda eksi sayılır", async () => {
    await asOwner();
    const before = await pnl("tahakkuk");
    await one(`public.finance_record_entry_v2($1::jsonb)`, [JSON.stringify({ account_id: BANKA, direction: "in", amount: 40000, entry_date: "2026-07-03", category: "depozito", title: "Depozito" })]);
    const income = (await one<Json>(`public.finance_post($1::jsonb)`, [JSON.stringify({ event_type: "expense.paid", posting_key: "expense:8f8f8f8f-1111-4222-8333-444455556666",
      date: "2026-07-10", entries: [{ account_id: BANKA, amount: 1200, category: "ofis" }] })]));
    expect(income.outcome).toBe("posted");
    const mid = await pnl("tahakkuk");
    expect(month(mid, "2026-07").i).toBe(month(before, "2026-07").i);
    expect(month(mid, "2026-07").e).toBe(r2(month(before, "2026-07").e + 1200));
    await one(`public.finance_period_lock('2026-07-01'::date, 'Temmuz kapandı')`);
    const rev = await one<Json>(`public.finance_reverse($1::uuid, 'yanlış kayıt', null)`, [(income.entry_ids as string[])[0]]);
    expect(rev.outcome).toBe("mirrored");
    const after = await pnl("tahakkuk");
    expect(month(after, "2026-07").e).toBe(month(mid, "2026-07").e); // kapalı ay değişmez
    expect(month(after, "2026-08").e).toBe(r2(month(mid, "2026-08").e - 1200));
    await one(`public.finance_period_unlock('2026-07-01'::date)`);
    await sudo();
  });

  it("geri alma: iki parametreli eski gövde döner (komisyon tek satır, net aynı)", async () => {
    await sudo();
    await db.exec(readRepo(WP2_ROLLBACKS.pnl));
    const back = await pnl();
    expect(month(back, "2026-03").ic.komisyon).toBe(40000);
    expect(month(back, "2026-03").n).toBe(month(oldPnl, "2026-03").n);
    await sudo();
    await db.exec(readRepo("supabase/migrations/20261017010400_finance_pnl_v3.sql"));
    expect(nets(await pnl())).toEqual(nets(await pnl("tahakkuk")));
  });
});
