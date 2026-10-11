import type { SupabaseClient } from "@supabase/supabase-js";
import { now, trDayKey } from "@/lib/clock";
import { compareUnits, distributeAmount, unitLabel, type DistributionUnit } from "@/lib/building-management/distribution";
import { buildDemoCommissionRow } from "@/lib/demo-seed-invariants";
import { analysisInputKey, computeListingAnalysis, type AnalysisConfidence, type AnalysisInput } from "@/lib/listing-analysis";
import { isMissingSampleSchema } from "@/lib/sample-clear";
import { SAMPLE_MARKER } from "@/lib/sample-data/markers";
import { seedListingPool } from "@/lib/sample-data/pool-seed";

/**
 * Son eklenen modüllerin (mülk yönetimi, bina/site, Lig 2.0, tapu süreci, EİDS durumu, ilan analizi, gider bütçesi/tekrarlayan/
 * portal gideri, hazır avatar) örnek verisi — TEK kaynak. İKİ çağıranı vardır:
 *  - `scripts/seed-demo.ts` (demo-ofis; `sample:false`),
 *  - `insertSampleRecords` (yeni ofis "Demo veriyle başla"; `sample:true`, `is_sample` işaretli, "Gerçek kullanıma geç" ile temizlenir).
 *
 * KURALLAR
 *  - `db` service_role istemcisidir (çağıran kapıdan çıkarmıştır). Bu modül kendi yönetici istemcisini AÇMAZ: istemci dışarıdan gelir.
 *  - Yazma RPC'leri (record_rent_payment vb.) `auth.uid()` ister; service_role ile çalışmaz. Bu yüzden tahsilat satırları doğrudan
 *    yazılır, durum/ücret türetimi için service_role'e açık `pm_recompute_charge` / `bm_recompute_charge` çağrılır.
 *  - İDEMPOTENT: her grup kendi işaretini (portföy kodu, bina adı, başlık, anlaşma+adım) kontrol eder; ikinci çalıştırma çoğaltmaz.
 *  - Tablo/sütun yoksa grup "etkin değil" diye atlanır (hata sayılmaz); bir grubun hatası diğerlerini bozmaz.
 *  - İl/ilçe: yalnız İstanbul büyük ilçeleri (ürün kararı).
 *  - Bina/site ve Lig meydan okumasında `is_sample` sütunu YOKTUR: örnek modda bunlar not/açıklama işaretiyle ayırt edilir ve
 *    `purge-extras.ts` temizler (RPC bu tabloları bilmez).
 */

type Dict = Record<string, unknown>;

export { SAMPLE_MARKER };

export type ModuleSeedContext = {
  db: SupabaseClient;
  tenantId: string;
  ownerId: string;
  advisorId: string;
  /** true: `is_sample` işareti + örnek işaretleri; false: demo-ofis. */
  sample: boolean;
  /** Coğrafya kimlikleri çağıranda çözülür (geo tek merkezi: bu modül geo_* tablolarına dokunmaz). `districts`: ilçe adı → id. */
  place: { provinceId: string | null; districtId: string | null; city: string; district: string; districts: Record<string, string | null> };
  /** Portföy kodu öneki: "DEMO" | "ORNEK". Yeni portföyler `${önek}-Y01..Y05`. */
  codePrefix: string;
  /** EİDS/yetki çeşitliliği verilecek mevcut portföy kodları (sırayla 6 profil döner). */
  authorityPropertyCodes: string[];
  /** İlan analizi örneği yazılacak mevcut portföy kodları (ilk 2). */
  analysisPropertyCodes: string[];
  /** Tapu süreci adımları yazılacak anlaşmalar (portföy koduna göre). */
  processDeals: { propertyCode: string; profile: "in_transfer" | "delayed" }[];
  /** Hazır avatar atanacak profiller (yalnız avatarı boş olanlara). Örnek modda verilmez. */
  avatarAssignments?: { profileId: string; preset: string }[];
  /** İlan havuzu örneği için uzmanlık/bölge verilecek MEVCUT profiller (hesap açılmaz); verilmezse yalnız advisorId. */
  poolProfileIds?: string[];
};

export type ModuleSeedReport = {
  counts: Record<string, number>;
  skipped: { group: string; reason: string }[];
  failed: { group: string; message: string }[];
};

// ---------------------------------------------------------------------------
// Tarih yardımcıları (TR gün anahtarı; saat yalnız clock.ts üzerinden)
// ---------------------------------------------------------------------------
const todayKey = () => trDayKey(now());

function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Bulunulan ayın başından `offset` ay ötesi (`YYYY-MM-01`). */
export function monthStartKey(offset: number): string {
  const [y, m] = todayKey().split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
}

const minKey = (a: string, b: string) => (a < b ? a : b);

/** Verilen TR gününün saatindeki an (ISO); gelecekteyse şimdiye kırpılır (created_at gelecekte olamaz). */
function isoAt(key: string, hour = 11): string {
  const t = Date.parse(`${key}T${String(hour).padStart(2, "0")}:00:00+03:00`);
  return new Date(Math.min(now(), t)).toISOString();
}

function isoPlanned(key: string, hour = 10): string {
  return new Date(Date.parse(`${key}T${String(hour).padStart(2, "0")}:00:00+03:00`)).toISOString();
}

const money = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Veritabanı yardımcıları
// ---------------------------------------------------------------------------
class DbFail extends Error {
  code?: string;
  constructor(label: string, e: { message?: string; code?: string }) {
    super(`${label}: ${e.message ?? "hata"}`);
    this.code = e.code;
  }
}

function must<T>(label: string, res: { data: T | null; error: { message?: string; code?: string } | null }): T {
  if (res.error) throw new DbFail(label, res.error);
  return res.data as T;
}

async function insertRows(db: SupabaseClient, table: string, rows: Dict[]): Promise<Dict[]> {
  if (rows.length === 0) return [];
  return must(table, await db.from(table).insert(rows).select()) ?? [];
}

/** Makbuz sıra tahsisi: kira + bina ortak ofis sayacı. Bölüm sonunda sayaç kalıcılaştırılır. */
class ReceiptCounter {
  private last = 0;
  constructor(private readonly db: SupabaseClient, private readonly tenantId: string) {}

  async load(): Promise<void> {
    const [counter, rent, bld] = await Promise.all([
      this.db.from("rent_receipt_counters").select("last_no").eq("tenant_id", this.tenantId).maybeSingle(),
      this.db.from("rent_payments").select("receipt_no").eq("tenant_id", this.tenantId).order("receipt_no", { ascending: false }).limit(1),
      this.db.from("building_payments").select("receipt_no").eq("tenant_id", this.tenantId).order("receipt_no", { ascending: false }).limit(1),
    ]);
    if (counter.error) throw new DbFail("rent_receipt_counters", counter.error);
    const a = Number((counter.data as { last_no?: number } | null)?.last_no ?? 0);
    const b = Number((rent.data as { receipt_no?: number }[] | null)?.[0]?.receipt_no ?? 0);
    const c = Number((bld.error ? 0 : (bld.data as { receipt_no?: number }[] | null)?.[0]?.receipt_no) ?? 0);
    this.last = Math.max(a, b, c);
  }

  next(): number {
    this.last += 1;
    return this.last;
  }

  async persist(): Promise<void> {
    const { error } = await this.db.from("rent_receipt_counters").upsert({ tenant_id: this.tenantId, last_no: this.last }, { onConflict: "tenant_id" });
    if (error) throw new DbFail("rent_receipt_counters", error);
  }
}

type PersonDef = { name: string; phone: string; type: "Mülk sahibi" | "Kiracı"; portal?: "sahibinden" | "hepsiemlak" | "zingat" };

/** Telefon (kurgusal 0532 3xx) üzerinden bul-ya-da-oluştur: ikinci çalıştırma çoğaltmaz. */
async function ensureCustomers(ctx: ModuleSeedContext, people: PersonDef[]): Promise<Map<string, string>> {
  const { db, tenantId } = ctx;
  const phones = people.map((p) => p.phone);
  const found = must("customers", await db.from("customers").select("id, phone").eq("tenant_id", tenantId).in("phone", phones)) ?? [];
  const byPhone = new Map<string, string>((found as { id: string; phone: string }[]).map((c) => [c.phone, c.id]));
  const missing = people.filter((p) => !byPhone.has(p.phone));
  if (missing.length > 0) {
    const created = await insertRows(
      db,
      "customers",
      missing.map((p) => ({
        tenant_id: tenantId,
        full_name: p.name,
        phone: p.phone,
        customer_types: [p.type],
        tags: ctx.sample ? ["örnek"] : [],
        source: p.portal ? (ctx.sample ? "portal" : `portal_${p.portal}`) : ctx.sample ? "referral" : "tavsiye",
        lead_source: p.portal ? `portal_${p.portal}` : ctx.sample ? "referral" : "tavsiye",
        province_id: ctx.place.provinceId,
        district_id: ctx.place.districtId,
        assigned_to: ctx.advisorId,
        created_by: ctx.ownerId,
        ...(ctx.sample ? { is_sample: true } : {}),
      })),
    );
    for (const c of created) byPhone.set(String(c.phone), String(c.id));
  }
  return byPhone;
}

/** İstanbul ilçe adı → id (çağıranın geo merkezinden çözdüğü harita); bulunamazsa bağlam ilçesine düşer. */
function districtResolver(ctx: ModuleSeedContext): (name: string) => string | null {
  return (name) => ctx.place.districts[name] ?? ctx.place.districtId;
}

// ---------------------------------------------------------------------------
// 1) Mülk yönetimi
// ---------------------------------------------------------------------------
type MonthPlan = "paid" | "partial" | "none";

type RentalDef = {
  suffix: string;
  title: string;
  district: string;
  type: string;
  rooms: string | null;
  sqm: number;
  rent: number;
  owner: PersonDef;
  renter: PersonDef;
  fee: { type: "percent" | "fixed"; value: number };
  payoutDay: number;
  iban: string;
  /** Vade günü: sayı sabit; "dyn" = bugünden 2 gün önce (ay içi vadesi geçmemiş, "bekliyor/kısmi" görünsün). */
  dueDay: number | "dyn";
  plan: [MonthPlan, MonthPlan, MonthPlan]; // -2, -1, 0 ay
  payouts: number[]; // hakedişi ödenmiş aylar (ofset)
  portalRenter?: boolean;
};

export const RENTAL_DEFS: readonly RentalDef[] = [
  {
    suffix: "Y01", title: "Kadıköy Caferağa'da kiradaki 2+1 (yönetimli)", district: "Kadıköy", type: "Daire", rooms: "2+1", sqm: 100, rent: 38000,
    owner: { name: "Nermin Aksoy", phone: "05323000101", type: "Mülk sahibi" },
    renter: { name: "Tolga Erdem", phone: "05323000111", type: "Kiracı", portal: "sahibinden" },
    fee: { type: "percent", value: 8 }, payoutDay: 5, iban: "TR330006100519786457841326", dueDay: 5,
    plan: ["paid", "paid", "paid"], payouts: [-2, -1],
  },
  {
    suffix: "Y02", title: "Moda'da kiradaki 1+1 (yönetimli)", district: "Kadıköy", type: "Daire", rooms: "1+1", sqm: 68, rent: 26000,
    owner: { name: "Orhan Bulut", phone: "05323000102", type: "Mülk sahibi" },
    renter: { name: "Pınar Sezer", phone: "05323000112", type: "Kiracı", portal: "hepsiemlak" },
    fee: { type: "percent", value: 10 }, payoutDay: 10, iban: "TR640001500158007294873126", dueDay: "dyn",
    plan: ["paid", "paid", "partial"], payouts: [-2],
  },
  {
    suffix: "Y03", title: "Ataşehir'de kiradaki 3+1 (yönetimli)", district: "Ataşehir", type: "Daire", rooms: "3+1", sqm: 145, rent: 48000,
    owner: { name: "Leyla Tunç", phone: "05323000103", type: "Mülk sahibi" },
    renter: { name: "Barış Kaplan", phone: "05323000113", type: "Kiracı", portal: "zingat" },
    fee: { type: "fixed", value: 3500 }, payoutDay: 5, iban: "TR970006400000211001234567", dueDay: "dyn",
    plan: ["paid", "paid", "none"], payouts: [],
  },
  {
    suffix: "Y04", title: "Beşiktaş Barbaros'ta kiradaki stüdyo (yönetimli)", district: "Beşiktaş", type: "Daire", rooms: "1+0", sqm: 45, rent: 32000,
    owner: { name: "Kemal Işık", phone: "05323000104", type: "Mülk sahibi" },
    renter: { name: "Duygu Yalçın", phone: "05323000114", type: "Kiracı" },
    fee: { type: "fixed", value: 2000 }, payoutDay: 12, iban: "TR760001200000000012345678", dueDay: 5,
    plan: ["paid", "none", "none"], payouts: [-2],
  },
  {
    suffix: "Y05", title: "Şişli Nişantaşı'nda kiradaki dükkan (yönetimli)", district: "Şişli", type: "Dükkan", rooms: null, sqm: 85, rent: 85000,
    owner: { name: "Hasan Aydoğan", phone: "05323000105", type: "Mülk sahibi" },
    renter: { name: "Yıldız Kurt", phone: "05323000115", type: "Kiracı" },
    fee: { type: "percent", value: 6 }, payoutDay: 5, iban: "TR430013400000123456789012", dueDay: 5,
    plan: ["paid", "paid", "paid"], payouts: [-2, -1],
  },
];

/** Yönetim ücreti (rent_payments.management_fee ile aynı formül): % ya da ilk tahsilattan sabit. */
export function feeOf(fee: { type: "percent" | "fixed"; value: number }, amount: number, priorFee: number): number {
  if (fee.type === "percent") return money((amount * fee.value) / 100);
  return Math.max(0, Math.min(fee.value - priorFee, amount));
}

const PAY_METHODS = ["bank_transfer", "bank_transfer", "cash"] as const;

async function seedPropertyManagement(ctx: ModuleSeedContext, receipts: ReceiptCounter): Promise<number> {
  const { db, tenantId } = ctx;
  const firstCode = `${ctx.codePrefix}-${RENTAL_DEFS[0]!.suffix}`;
  const existing = must("properties", await db.from("properties").select("id").eq("tenant_id", tenantId).eq("property_code", firstCode).limit(1));
  if ((existing as unknown[]).length > 0) return 0; // zaten yüklü

  const districtOf = districtResolver(ctx);
  const today = todayKey();
  const todayDay = Number(today.slice(8, 10));
  const dynDue = Math.min(28, Math.max(1, todayDay - 2));

  const people = RENTAL_DEFS.flatMap((d) => [d.owner, d.renter]);
  const custIds = await ensureCustomers(ctx, people);

  const createdPropIds: string[] = [];
  try {
    const props = await insertRows(
      db,
      "properties",
      RENTAL_DEFS.map((d) => ({
        tenant_id: tenantId,
        property_code: `${ctx.codePrefix}-${d.suffix}`,
        title: d.title,
        transaction_type: "Kiralık",
        property_type: d.type,
        status: "rented",
        published_at: isoAt(addDays(today, -120), 10),
        list_price: d.rent,
        commission_rate: 10,
        province_id: ctx.place.provinceId,
        district_id: districtOf(d.district),
        address_line: `${d.district}, İstanbul`,
        features: d.rooms ? { rooms: d.rooms, sqm: d.sqm, net_sqm: Math.round(d.sqm * 0.88) } : { sqm: d.sqm },
        owner_customer_id: custIds.get(d.owner.phone) ?? null,
        assigned_to: ctx.advisorId,
        created_by: ctx.ownerId,
        ...(ctx.sample ? { is_sample: true } : {}),
      })),
    );
    for (const p of props) createdPropIds.push(String(p.id));
    const propId = (suffix: string) => String(props.find((p) => p.property_code === `${ctx.codePrefix}-${suffix}`)!.id);

    const startKey = monthStartKey(-3);
    // Kazanılmış kira anlaşması + komisyon (çekirdek iş akışı değişmezleri: aktif kira = won rent deal + komisyon)
    const deals = await insertRows(
      db,
      "deals",
      RENTAL_DEFS.map((d) => ({
        tenant_id: tenantId,
        customer_id: custIds.get(d.renter.phone),
        property_id: propId(d.suffix),
        deal_type: "rent",
        stage: "won",
        deal_value: d.rent,
        probability: 100,
        closure_active: true,
        prev_property_status: "live",
        assigned_to: ctx.advisorId,
        created_at: isoAt(startKey, 10),
        updated_at: isoAt(startKey, 10),
        ...(ctx.sample ? { is_sample: true } : {}),
      })),
    );
    await insertRows(
      db,
      "commissions",
      deals.map((deal, i) =>
        ({
          ...buildDemoCommissionRow({
            tenantId,
            deal: { id: String(deal.id), stage: "won", deal_value: Number(deal.deal_value), deal_type: "rent", property_id: String(deal.property_id) },
            property: { id: String(deal.property_id), status: "rented", list_price: RENTAL_DEFS[i]!.rent, commission_rate: 10 },
            status: "paid",
            createdAt: isoAt(startKey, 12),
          }),
          ...(ctx.sample ? { is_sample: true } : {}),
        }) as Dict,
      ),
    );

    const rentals = await insertRows(
      db,
      "rentals",
      RENTAL_DEFS.map((d, i) => ({
        tenant_id: tenantId,
        property_id: propId(d.suffix),
        renter_customer_id: custIds.get(d.renter.phone),
        monthly_rent: d.rent,
        due_day: d.dueDay === "dyn" ? dynDue : d.dueDay,
        start_date: startKey,
        end_date: addDays(startKey, 365 - 1),
        deposit: d.rent * 2,
        status: "active",
        notes: `${ctx.sample ? "Örnek" : "Demo"} yönetimli kira — ${d.district}`,
        deal_id: deals[i]!.id,
        prev_property_status: "live",
        created_by: ctx.ownerId,
        created_at: isoAt(startKey, 10),
        ...(ctx.sample ? { is_sample: true } : {}),
      })),
    );

    // Yönetim sözleşmeleri (yarısı %, yarısı sabit)
    await insertRows(
      db,
      "rental_management_agreements",
      RENTAL_DEFS.map((d, i) => ({
        tenant_id: tenantId,
        rental_id: rentals[i]!.id,
        managed: true,
        fee_type: d.fee.type,
        fee_value: d.fee.value,
        payout_day: d.payoutDay,
        owner_iban: d.iban,
        owner_account_holder: d.owner.name,
        notes: d.fee.type === "percent" ? `Aylık tahsilatın %${d.fee.value}'i yönetim ücreti.` : `Aylık sabit ${d.fee.value} TL yönetim ücreti.`,
        created_by: ctx.ownerId,
        updated_by: ctx.ownerId,
      })),
    );

    // Son 3 ay tahakkuk
    const chargeRows: Dict[] = [];
    for (let i = 0; i < RENTAL_DEFS.length; i += 1) {
      for (const m of [-2, -1, 0]) {
        chargeRows.push({ tenant_id: tenantId, rental_id: rentals[i]!.id, period: monthStartKey(m), amount: RENTAL_DEFS[i]!.rent, status: "pending" });
      }
    }
    const charges = await insertRows(db, "rent_charges", chargeRows);
    const chargeOf = (ri: number, m: number) =>
      charges.find((c) => c.rental_id === rentals[ri]!.id && c.period === monthStartKey(m))!;

    // Tahsilatlar (makbuz sırası ofis sayacından)
    const payRows: Dict[] = [];
    const netByMonth = new Map<string, number>(); // `${ri}|${m}` → mülk sahibine borçlu net
    for (let ri = 0; ri < RENTAL_DEFS.length; ri += 1) {
      const d = RENTAL_DEFS[ri]!;
      const dueDay = d.dueDay === "dyn" ? dynDue : d.dueDay;
      [-2, -1, 0].forEach((m, mi) => {
        const plan = d.plan[mi]!;
        if (plan === "none") return;
        const amount = plan === "partial" ? Math.round((d.rent * 0.55) / 100) * 100 : d.rent;
        const due = addDays(monthStartKey(m), dueDay - 1);
        const paidOn = minKey(today, addDays(due, (ri + mi) % 3));
        const fee = feeOf(d.fee, amount, 0);
        netByMonth.set(`${ri}|${m}`, money(amount - fee));
        payRows.push({
          tenant_id: tenantId,
          rental_id: rentals[ri]!.id,
          charge_id: chargeOf(ri, m).id,
          amount,
          paid_on: paidOn,
          method: PAY_METHODS[(ri + mi) % 3],
          bank_note: plan === "partial" ? "Kalan tutar hafta içi ödenecek (kiracı bildirdi)" : PAY_METHODS[(ri + mi) % 3] === "bank_transfer" ? `Havale — ${d.renter.name}` : null,
          receipt_no: receipts.next(),
          fee_type: d.fee.type,
          fee_value: d.fee.value,
          recorded_by: ctx.ownerId,
          created_at: isoAt(paidOn, 11),
        });
      });
    }
    await insertRows(db, "rent_payments", payRows);
    // Durum (ödendi/kısmi/gecikmiş) ve yönetim ücreti: DB'nin kendi hesabı
    for (const c of charges) {
      const { error } = await db.rpc("pm_recompute_charge", { p_charge_id: c.id });
      if (error) throw new DbFail("pm_recompute_charge", error);
    }

    // Mülk sahibine yapılan ödemeler (hakediş günü geçmiş aylar)
    const payoutRows: Dict[] = [];
    for (let ri = 0; ri < RENTAL_DEFS.length; ri += 1) {
      const d = RENTAL_DEFS[ri]!;
      for (const m of d.payouts) {
        const net = netByMonth.get(`${ri}|${m}`);
        const on = addDays(monthStartKey(m + 1), d.payoutDay - 1);
        if (!net || on > today) continue;
        payoutRows.push({
          tenant_id: tenantId,
          rental_id: rentals[ri]!.id,
          amount: net,
          paid_on: on,
          method: "bank_transfer",
          reference: `DKN-${on.replaceAll("-", "")}-${ri + 1}`,
          note: "Aylık kira hakedişi",
          created_by: ctx.ownerId,
          created_at: isoAt(on, 15),
        });
      }
    }
    await insertRows(db, "owner_payouts", payoutRows);

    // Mülke yansıtılmış giderler (hakedişten düşer)
    const expenseDefs = [
      { ri: 4, title: "Dükkan kepenk motoru bakım-onarımı", amount: 2800, days: -20, label: "Kepenk motoru bakım-onarımı" },
      { ri: 0, title: "Kombi yıllık bakım ve filtre değişimi", amount: 1950, days: -9, label: "Kombi yıllık bakım" },
    ];
    const expenses = await insertRows(
      db,
      "expenses",
      expenseDefs.map((e) => ({
        tenant_id: tenantId,
        created_by: ctx.ownerId,
        property_id: propId(RENTAL_DEFS[e.ri]!.suffix),
        category: "diger",
        title: `${e.title} (mülk sahibine yansıtıldı)`,
        amount: e.amount,
        expense_date: addDays(today, e.days),
        notes: "Hakedişten düşülür; ofis gideri sayılmaz.",
        ...(ctx.sample ? { is_sample: true } : {}),
      })),
    );
    await insertRows(
      db,
      "owner_charge_links",
      expenses.map((x, i) => ({
        tenant_id: tenantId,
        rental_id: rentals[expenseDefs[i]!.ri]!.id,
        kind: "expense",
        ref_id: x.id,
        amount: expenseDefs[i]!.amount,
        entry_date: addDays(today, expenseDefs[i]!.days),
        label: expenseDefs[i]!.label,
        created_by: ctx.ownerId,
      })),
    );
    await receipts.persist();
    return rentals.length;
  } catch (e) {
    // Yarım kalmasın (tekrar denenebilsin): önce kira (deal_id RESTRICT), sonra komisyon/anlaşma, en son portföy. En iyi çaba.
    if (createdPropIds.length > 0) {
      const { data: dealRows } = await db.from("deals").select("id").eq("tenant_id", tenantId).in("property_id", createdPropIds);
      const dealIds = ((dealRows ?? []) as { id: string }[]).map((d) => d.id);
      await db.from("rentals").delete().eq("tenant_id", tenantId).in("property_id", createdPropIds);
      if (dealIds.length > 0) {
        await db.from("commissions").delete().eq("tenant_id", tenantId).in("deal_id", dealIds);
        await db.from("deals").delete().eq("tenant_id", tenantId).in("id", dealIds);
      }
      await db.from("properties").delete().eq("tenant_id", tenantId).in("id", createdPropIds);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 2) Bina / site
// ---------------------------------------------------------------------------
type UnitDef = {
  block: string;
  floor: number;
  no: string;
  m2: number;
  landShare: number;
  owner: PersonDef | "Y01" | "Y02";
  tenant?: PersonDef;
  payer: "owner" | "tenant";
};

export const BUILDING_NAME = "Caferağa Güneş Apartmanı";

export const UNIT_DEFS: readonly UnitDef[] = [
  { block: "A", floor: 1, no: "1", m2: 92, landShare: 88, owner: { name: "Selim Güler", phone: "05323000201", type: "Mülk sahibi" }, payer: "owner" },
  { block: "A", floor: 2, no: "2", m2: 92, landShare: 90, owner: { name: "Aysel Tekin", phone: "05323000202", type: "Mülk sahibi" }, tenant: { name: "Cenk Aras", phone: "05323000211", type: "Kiracı" }, payer: "tenant" },
  { block: "A", floor: 3, no: "3", m2: 100, landShare: 100, owner: "Y01", payer: "owner" },
  { block: "A", floor: 4, no: "4", m2: 105, landShare: 102, owner: { name: "Rıza Ersoy", phone: "05323000203", type: "Mülk sahibi" }, payer: "owner" },
  { block: "A", floor: 5, no: "5", m2: 118, landShare: 112, owner: { name: "Gülsüm Acar", phone: "05323000204", type: "Mülk sahibi" }, tenant: { name: "Murat Özdemir", phone: "05323000212", type: "Kiracı" }, payer: "tenant" },
  { block: "B", floor: 1, no: "1", m2: 88, landShare: 84, owner: { name: "Taner Bilgin", phone: "05323000205", type: "Mülk sahibi" }, payer: "owner" },
  { block: "B", floor: 2, no: "2", m2: 68, landShare: 70, owner: "Y02", payer: "owner" },
  { block: "B", floor: 3, no: "3", m2: 98, landShare: 97, owner: { name: "Sevgi Korkut", phone: "05323000206", type: "Mülk sahibi" }, payer: "owner" },
  { block: "B", floor: 4, no: "4", m2: 110, landShare: 106, owner: { name: "Ender Yurt", phone: "05323000207", type: "Mülk sahibi" }, payer: "owner" },
  { block: "B", floor: 5, no: "5", m2: 125, landShare: 118, owner: { name: "Hülya Çakır", phone: "05323000208", type: "Mülk sahibi" }, payer: "owner" },
];

async function seedBuilding(ctx: ModuleSeedContext, receipts: ReceiptCounter): Promise<number> {
  const { db, tenantId } = ctx;
  const dup = must("buildings", await db.from("buildings").select("id").eq("tenant_id", tenantId).eq("name", BUILDING_NAME).limit(1));
  if ((dup as unknown[]).length > 0) return 0;

  // Kiralama bağlantısı (Y01, Y02): mahsup için yönetimli kira gerekir.
  const managed = new Map<string, { propertyId: string; rentalId: string; ownerId: string | null }>();
  for (const key of ["Y01", "Y02"] as const) {
    const code = `${ctx.codePrefix}-${key}`;
    const { data: p } = await db.from("properties").select("id, owner_customer_id").eq("tenant_id", tenantId).eq("property_code", code).maybeSingle();
    if (!p) continue;
    const { data: r } = await db.from("rentals").select("id").eq("tenant_id", tenantId).eq("property_id", (p as { id: string }).id).limit(1).maybeSingle();
    if (!r) continue;
    managed.set(key, { propertyId: (p as { id: string }).id, rentalId: (r as { id: string }).id, ownerId: (p as { owner_customer_id: string | null }).owner_customer_id });
  }

  const people: PersonDef[] = [];
  for (const u of UNIT_DEFS) {
    if (typeof u.owner !== "string") people.push(u.owner);
    if (u.tenant) people.push(u.tenant);
  }
  const custIds = await ensureCustomers(ctx, people);

  const [building] = await insertRows(db, "buildings", [
    {
      tenant_id: tenantId,
      name: BUILDING_NAME,
      address: "Caferağa Mah. Moda Cad. No: 41, Kadıköy / İstanbul",
      province_id: ctx.place.provinceId,
      district_id: ctx.place.districtId,
      city: ctx.place.city,
      district: ctx.place.district,
      managed_by_office: true,
      fee_type: "percent",
      fee_value: 6,
      due_day: 5,
      default_distribution: "land_share",
      notes: `${ctx.sample ? `${SAMPLE_MARKER} ` : ""}2 bloklu, 10 daireli apartman; aidat arsa payına göre, ortak gider m²'ye göre paylaştırılır.`,
      created_by: ctx.ownerId,
    },
  ]);
  const buildingId = String(building!.id);

  try {
    const units = await insertRows(
      db,
      "building_units",
      UNIT_DEFS.map((u) => {
        const link = typeof u.owner === "string" ? managed.get(u.owner) : undefined;
        return {
          tenant_id: tenantId,
          building_id: buildingId,
          block: u.block,
          floor: u.floor,
          unit_no: u.no,
          area_m2: u.m2,
          land_share: u.landShare,
          owner_customer_id: typeof u.owner === "string" ? (link?.ownerId ?? null) : (custIds.get(u.owner.phone) ?? null),
          tenant_customer_id: u.tenant ? (custIds.get(u.tenant.phone) ?? null) : null,
          rental_id: link?.rentalId ?? null,
          property_id: link?.propertyId ?? null,
          payer: u.payer,
          active: true,
          created_by: ctx.ownerId,
        };
      }),
    );
    const sorted = units
      .map((u) => ({ id: String(u.id), block: u.block as string, floor: u.floor as number, unitNo: String(u.unit_no), areaM2: Number(u.area_m2), landShare: Number(u.land_share), row: u }))
      .sort(compareUnits);
    const distUnits: DistributionUnit[] = sorted.map((u) => ({ id: u.id, label: unitLabel(u), areaM2: u.areaM2, landShare: u.landShare }));
    const today = todayKey();
    const payerOf = (u: (typeof sorted)[number]) =>
      (u.row.payer === "tenant" ? u.row.tenant_customer_id : u.row.owner_customer_id) as string | null;

    const makeBatch = async (input: { kind: "aidat" | "expense_share"; period: string; title: string; category: string | null; total: number; method: "land_share" | "area"; due: string }) => {
      const dist = distributeAmount({ method: input.method, total: input.total, units: distUnits });
      if (!dist.ok) throw new Error(dist.error);
      const [batch] = await insertRows(db, "building_charge_batches", [
        {
          tenant_id: tenantId, building_id: buildingId, kind: input.kind, period: input.period, title: input.title, category: input.category,
          total_amount: dist.total, distribution: input.method, due_date: input.due, created_by: ctx.ownerId, created_at: isoAt(input.period, 10),
        },
      ]);
      const charges = await insertRows(
        db,
        "building_charges",
        dist.shares.map((s) => {
          const u = sorted.find((x) => x.id === s.unitId)!;
          return {
            tenant_id: tenantId, batch_id: batch!.id, building_id: buildingId, unit_id: s.unitId, amount: s.amount, due_date: input.due,
            payer_role: u.row.payer, payer_customer_id: payerOf(u), created_at: isoAt(input.period, 10),
          };
        }),
      );
      return sorted.map((u) => charges.find((c) => c.unit_id === u.id)!);
    };

    const prevPeriod = monthStartKey(-1);
    const curPeriod = monthStartKey(0);
    const aidatPrev = await makeBatch({ kind: "aidat", period: prevPeriod, title: "Aidat", category: "aidat", total: 21500, method: "land_share", due: addDays(prevPeriod, 4) });
    const aidatCur = await makeBatch({ kind: "aidat", period: curPeriod, title: "Aidat", category: "aidat", total: 22800, method: "land_share", due: addDays(curPeriod, 4) });
    const shareCur = await makeBatch({
      kind: "expense_share", period: curPeriod, title: "Asansör revizyonu ve bakım sözleşmesi", category: "bakim", total: 24000, method: "area", due: addDays(today, 14),
    });

    const METHODS = ["bank_transfer", "cash", "bank_transfer", "card"] as const;
    const feeType = "percent";
    const feeValue = 6;
    const payRows: Dict[] = [];
    let seq = 0;
    const pay = (charge: Dict, amount: number, paidOn: string, method: string, note: string | null): Dict => ({
      tenant_id: tenantId, charge_id: charge.id, unit_id: charge.unit_id, building_id: buildingId, amount, paid_on: paidOn, method,
      bank_note: note, receipt_no: receipts.next(), fee_type: feeType, fee_value: feeValue, recorded_by: ctx.ownerId, created_at: isoAt(paidOn, 12 + (seq % 4)),
    });
    const full = (charge: Dict, dueKey: string, offset: number) => {
      const on = minKey(today, addDays(dueKey, offset));
      const method = METHODS[seq % METHODS.length]!;
      seq += 1;
      payRows.push(pay(charge, Number(charge.amount), on, method, method === "bank_transfer" ? "Havale ile ödendi" : null));
    };

    // Geçen ay: 7 daire tam, B-1 kısmi, A-3 mahsup (aşağıda), B-3 ödenmedi (gecikmiş)
    const prevDue = addDays(prevPeriod, 4);
    [0, 1, 3, 4, 6, 8, 9].forEach((i, k) => full(aidatPrev[i]!, prevDue, k % 4));
    payRows.push(pay(aidatPrev[5]!, money(Number(aidatPrev[5]!.amount) / 2), minKey(today, addDays(prevDue, 6)), "cash", "Yarısı peşin, kalanı sonraki hafta"));
    // Bu ay: 6 daire tam
    const curDue = addDays(curPeriod, 4);
    [0, 1, 3, 6, 8, 9].forEach((i, k) => full(aidatCur[i]!, curDue, k % 3));
    // Ortak gider: iki daire ödedi
    [0, 9].forEach((i) => full(shareCur[i]!, curPeriod, 1));

    // Malik mahsubu: A-3 (kira Y01 yönetimli) geçen ay aidatının bir kısmı hakedişten düşülür
    const offsetCharge = aidatPrev[2]!;
    const offsetAmount = 1000;
    const offsetOn = minKey(today, addDays(prevPeriod, 14));
    const offsetPayRow = pay(offsetCharge, offsetAmount, offsetOn, "owner_offset", "Kira hakedişinden mahsup");
    const inserted = await insertRows(db, "building_payments", [...payRows, offsetPayRow]);
    const offsetPay = inserted.find((p) => p.method === "owner_offset")!;

    const y01 = managed.get("Y01");
    if (y01) {
      await insertRows(db, "owner_charge_links", [
        {
          tenant_id: tenantId, rental_id: y01.rentalId, kind: "unit_charge", ref_id: offsetPay.id, amount: offsetAmount, entry_date: offsetOn,
          label: `Bina aidatı: ${BUILDING_NAME} · Daire 3`, created_by: ctx.ownerId,
        },
      ]);
    }
    for (const c of [...aidatPrev, ...aidatCur, ...shareCur]) {
      const { error } = await db.rpc("bm_recompute_charge", { p_charge_id: c.id });
      if (error) throw new DbFail("bm_recompute_charge", error);
    }
    await receipts.persist();
    return units.length;
  } catch (e) {
    await db.from("buildings").delete().eq("tenant_id", tenantId).eq("id", buildingId); // kaskat
    throw e;
  }
}

// ---------------------------------------------------------------------------
// 3) Lig 2.0
// ---------------------------------------------------------------------------
async function seedLeague(ctx: ModuleSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  must("league_settings", await db.from("league_settings").upsert({ tenant_id: tenantId, rules: {}, show_amounts: false, updated_by: ctx.ownerId }, { onConflict: "tenant_id", ignoreDuplicates: true }));
  const prefix = ctx.sample ? `${SAMPLE_MARKER} ` : "";
  const existing = (must("league_challenges", await db.from("league_challenges").select("title").eq("tenant_id", tenantId)) as { title: string }[]).map((r) => r.title);
  const ms = (key: string) => Date.parse(`${key}T00:00:00+03:00`);

  const entries =
    ctx.advisorId === ctx.ownerId
      ? [{ staffId: ctx.ownerId, count: 19, rank: 1 }]
      : [{ staffId: ctx.advisorId, count: 19, rank: 1 }, { staffId: ctx.ownerId, count: 12, rank: 2 }];
  const rows: Dict[] = [];
  if (!existing.includes("Bu ay 10 yetkili portföy")) {
    rows.push({
      tenant_id: tenantId, title: "Bu ay 10 yetkili portföy", description: `${prefix}Ekip olarak ay sonuna kadar 10 tek yetkili portföy alalım. İlerleme lig kayıtlarından hesaplanır.`,
      reward_text: "Ay sonunda ekibe ofis yemeği", metric: "listing_authorized", scope: "team", target_value: 10,
      starts_at: new Date(ms(monthStartKey(0))).toISOString(), ends_at: new Date(ms(monthStartKey(1)) - 60_000).toISOString(), status: "active", created_by: ctx.ownerId,
    });
  }
  if (!existing.includes("Geçen ayın gösterim yarışı")) {
    rows.push({
      tenant_id: tenantId, title: "Geçen ayın gösterim yarışı", description: `${prefix}Kişi başı 15 yer gösterme hedefiydi.`, reward_text: "Hafta sonu izni",
      metric: "showing_done", scope: "individual", target_value: 15,
      starts_at: new Date(ms(monthStartKey(-1))).toISOString(), ends_at: new Date(ms(monthStartKey(0)) - 60_000).toISOString(), status: "finished",
      finished_at: new Date(Math.min(now(), ms(monthStartKey(0)) + 2 * 3_600_000)).toISOString(),
      result: { reached: true, current: 19, target: 15, scope: "individual", entries, winners: [entries[0]] }, created_by: ctx.ownerId,
    });
  }
  const created = await insertRows(db, "league_challenges", rows);
  return created.length;
}

// ---------------------------------------------------------------------------
// 4) Tapu süreci
// ---------------------------------------------------------------------------
type StepPlan = { key: string; planned?: number; done?: number; note?: string };

const PROCESS_PROFILES: Record<"in_transfer" | "delayed", StepPlan[]> = {
  in_transfer: [
    { key: "offer_accepted", done: -40 },
    { key: "deposit", done: -35, note: "Kapora sözleşmeyle alındı." },
    { key: "appraisal_credit", done: -24, note: "Ekspertiz uygun, kredi onaylandı." },
    { key: "dask", done: -12 },
    { key: "tkgm_appointment", done: -6, note: "Randevu alındı." },
    { key: "fees", done: -3 },
    { key: "title_transfer", planned: 2, note: "Tapu müdürlüğü randevusu." },
    { key: "key_handover", planned: 5 },
  ],
  delayed: [
    { key: "offer_accepted", done: -20 },
    { key: "deposit", done: -16, note: "Kapora alındı." },
    { key: "appraisal_credit", planned: -5, note: "Banka ekspertiz raporu bekleniyor." },
    { key: "dask", planned: 4 },
    { key: "tkgm_appointment", planned: 10 },
  ],
};

async function seedDealProcess(ctx: ModuleSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  const today = todayKey();
  let total = 0;
  for (const target of ctx.processDeals) {
    const { data: prop } = await db.from("properties").select("id").eq("tenant_id", tenantId).eq("property_code", target.propertyCode).maybeSingle();
    if (!prop) continue;
    const { data: deal } = await db
      .from("deals").select("id").eq("tenant_id", tenantId).eq("property_id", (prop as { id: string }).id).neq("stage", "lost")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!deal) continue;
    const rows = PROCESS_PROFILES[target.profile].map((s) => ({
      tenant_id: tenantId, deal_id: (deal as { id: string }).id, step_key: s.key,
      planned_at: s.planned !== undefined ? isoPlanned(addDays(today, s.planned)) : null,
      done_at: s.done !== undefined ? isoAt(addDays(today, s.done), 14) : null,
      assigned_to: ctx.advisorId, note: s.note ?? null, updated_by: ctx.ownerId,
    }));
    const { data, error } = await db.from("deal_process_steps").upsert(rows, { onConflict: "deal_id,step_key", ignoreDuplicates: true }).select("id");
    if (error) throw new DbFail("deal_process_steps", error);
    total += (data ?? []).length;
  }
  return total;
}

// ---------------------------------------------------------------------------
// 5) EİDS / yetki durumu
// ---------------------------------------------------------------------------
type AuthorityProfile = Dict;

function authorityProfiles(): AuthorityProfile[] {
  const today = todayKey();
  const at = (days: number) => isoAt(addDays(today, days), 10);
  return [
    // onaylı
    { authorization_type: "exclusive", authorization_start: addDays(today, -90), authorization_end: addDays(today, 150), authority_doc_no: "YB-2026-0141", authority_eids_status: "approved", authority_owner_approved_at: at(-85), eids_property_no: "EIDS-34-4410-0141", authority_reminder_count: 0 },
    // onay bekliyor (hatırlatma gönderildi)
    { authorization_type: "exclusive", authorization_start: addDays(today, -20), authorization_end: addDays(today, 160), authority_doc_no: "YB-2026-0188", authority_eids_status: "pending", authority_owner_approved_at: null, authority_reminder_sent_at: at(-3), authority_reminder_count: 1, authority_reminder_channel: "whatsapp" },
    // süresi dolmuş
    { authorization_type: "open", authorization_start: addDays(today, -400), authorization_end: addDays(today, -12), authority_doc_no: "YB-2025-0092", authority_eids_status: "approved", authority_owner_approved_at: at(-395), eids_property_no: "EIDS-34-3320-0092", authority_reminder_count: 0 },
    // belgesi eksik
    { authority_doc_no: null, authority_eids_status: "pending", authority_owner_approved_at: null, authority_reminder_count: 0 },
    // yakında bitecek + bekliyor
    { authorization_type: "exclusive", authorization_start: addDays(today, -160), authorization_end: addDays(today, 18), authority_doc_no: "YB-2026-0057", authority_eids_status: "pending", authority_owner_approved_at: null, authority_reminder_sent_at: at(-6), authority_reminder_count: 2, authority_reminder_channel: "sms" },
    // reddedildi
    { authorization_type: "open", authorization_start: addDays(today, -30), authorization_end: addDays(today, 60), authority_doc_no: "YB-2026-0203", authority_eids_status: "rejected", authority_owner_approved_at: null, authority_reminder_sent_at: at(-10), authority_reminder_count: 1, authority_reminder_channel: "sms" },
  ];
}

async function seedAuthority(ctx: ModuleSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  const profiles = authorityProfiles();
  let n = 0;
  for (let i = 0; i < ctx.authorityPropertyCodes.length; i += 1) {
    const { data, error } = await db
      .from("properties").update(profiles[i % profiles.length]!).eq("tenant_id", tenantId).eq("property_code", ctx.authorityPropertyCodes[i]!).select("id");
    if (error) throw new DbFail("properties(yetki)", error);
    n += (data ?? []).length;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 6) İlan analizi (bakiye düşmez: units_charged = 0)
// ---------------------------------------------------------------------------
async function seedListingAnalyses(ctx: ModuleSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  let n = 0;
  const variants: { factor: number; confidence: Exclude<AnalysisConfidence, "yetersiz">; comps: number; won: number; days: number }[] = [
    { factor: 1.12, confidence: "orta", comps: 7, won: 3, days: 31 }, // ilan piyasa üstü → revizyon önerisi
    { factor: 0.98, confidence: "yüksek", comps: 12, won: 5, days: 14 }, // piyasa seviyesinde
  ];
  for (let i = 0; i < Math.min(2, ctx.analysisPropertyCodes.length); i += 1) {
    const { data: p } = await db
      .from("properties")
      .select("id, title, transaction_type, property_type, list_price, district_id, address_line, lat, lng, features")
      .eq("tenant_id", tenantId).eq("property_code", ctx.analysisPropertyCodes[i]!).maybeSingle();
    if (!p) continue;
    const prop = p as { id: string; title: string; transaction_type: string | null; property_type: string | null; list_price: number | null; district_id: string | null; address_line: string | null; lat: number | null; lng: number | null; features: Record<string, unknown> | null };
    const { data: ex } = await db.from("listing_analyses").select("id").eq("tenant_id", tenantId).eq("property_id", prop.id).limit(1);
    if ((ex ?? []).length > 0) continue;
    const listPrice = Number(prop.list_price);
    const sqm = Number((prop.features ?? {}).sqm);
    if (!(listPrice > 0)) continue;
    const v = variants[i]!;
    const est = Math.round(listPrice / v.factor / 1000) * 1000;
    const median = sqm > 0 ? Math.round(est / sqm) : null;
    const input: AnalysisInput = {
      listPrice,
      sqm: sqm > 0 ? sqm : null,
      estimate: {
        estimatedValue: est, lowValue: Math.round(est * 0.95), highValue: Math.round(est * 1.05), medianSqmPrice: median,
        compCount: v.comps, wonCount: v.won, activeCount: v.comps - v.won, confidence: v.confidence,
      },
      efIndex: median ? { ad: ctx.place.district, donem: trDayKey(now()).slice(0, 7), n: 38, medianM2: Math.round(median * 1.03), guven: "orta" } : null,
      regionAvgDaysListed: 46,
      daysOnMarket: v.days,
      isRent: /kira/i.test(prop.transaction_type ?? ""),
      quality: {
        title: prop.title, description: null, features: prop.features,
        hasLocation: Boolean(prop.address_line) || (prop.lat != null && prop.lng != null), hasVirtualTour: false,
        photo: { photoCount: 12, warned: 2, passed: 10, warnings: ["2 fotoğraf düşük çözünürlüklü"] },
      },
    };
    const result = computeListingAnalysis(input);
    if (!result) continue;
    const key = analysisInputKey({
      listPrice, sqm: sqm > 0 ? sqm : null, districtId: prop.district_id, propertyType: prop.property_type, transactionType: prop.transaction_type,
    });
    must("listing_analyses", await db.from("listing_analyses").insert({
      tenant_id: tenantId, property_id: prop.id, user_id: ctx.ownerId, input_key: key, result, units_charged: 0,
      created_at: new Date(now() - 6 * 3_600_000).toISOString(),
    }));
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 7) Gider bütçesi + tekrarlayan gider + portal gideri
// ---------------------------------------------------------------------------
const BUDGETS: { category: string; amount: number }[] = [
  { category: "reklam", amount: 30000 },
  { category: "ofis", amount: 40000 },
  { category: "ulasim", amount: 3000 },
  { category: "egitim", amount: 6000 },
];

/** Düzenli ödeme kuralları (kasa/banka hesabına bağlı) — gider ve kasa hareketleri aynı tutar/vade gününden türer. */
const SAHIBINDEN_RULE_DAY = 5;
const BANK_NAME = "İş Bankası Kadıköy";
const KASA_NAME = "Ofis kasası";
type RuleDef = {
  title: string;
  category: string;
  amount: number;
  day: number;
  mode: "auto" | "approve";
  expenseCategory: string;
  portal: "sahibinden" | null;
  /** true: son vadesi ödenmiş (gider + banka hareketi + işlenmiş dönem) yazılır. */
  history: boolean;
};
const RULES: RuleDef[] = [
  { title: "Kadıköy ofis kirası", category: "kira", amount: 45000, day: 1, mode: "auto", expenseCategory: "ofis", portal: null, history: true },
  { title: "Sahibinden.com mağaza paketi", category: "portal", amount: 9500, day: SAHIBINDEN_RULE_DAY, mode: "auto", expenseCategory: "reklam", portal: "sahibinden", history: true },
  { title: "Muhasebe ücreti", category: "muhasebe", amount: 3500, day: 28, mode: "approve", expenseCategory: "ofis", portal: null, history: false },
];

/** `YYYY-MM-DD` anahtarının ayına `n` ay ekler; gün kısa ayda ayın son gününe kırpılır. */
function shiftMonthKey(key: string, n: number, day = Number(key.slice(8, 10))): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(y, m - 1 + n, Math.min(day, last)));
  return d.toISOString().slice(0, 10);
}

/** Ayın `day`. gününe göre bugüne eşit/önceki en son vade (kısa ay kırpılır). */
function lastDueOnOrBefore(today: string, day: number): string {
  const thisMonth = shiftMonthKey(today, 0, day);
  return thisMonth <= today ? thisMonth : shiftMonthKey(today, -1, day);
}

type RecurringDef = {
  title: string;
  category: string;
  amount: number;
  recurrence: "monthly" | "quarterly" | "yearly";
  portal?: "sahibinden" | "hepsiemlak" | "zingat" | "emlakjet";
  days: number[];
  /** Verilirse giderler SON üç ayın bu günü yazılır (düzenli ödeme kuralının vade günüyle AYNI kaynak; `days` yok sayılır). */
  dueDay?: number;
};

const RECURRING: RecurringDef[] = [
  { title: "Ofis interneti ve telefon hatları", category: "ofis", amount: 1450, recurrence: "monthly", days: [-12] },
  { title: "Mesleki sorumluluk sigortası", category: "ofis", amount: 4200, recurrence: "quarterly", days: [-35] },
  { title: "Alan adı ve e-posta barındırma", category: "ofis", amount: 3600, recurrence: "yearly", days: [-200] },
  { title: "Sahibinden.com mağaza paketi", category: "reklam", amount: 9500, recurrence: "monthly", portal: "sahibinden", days: [], dueDay: SAHIBINDEN_RULE_DAY },
  { title: "Hepsiemlak kurumsal paket", category: "reklam", amount: 7800, recurrence: "quarterly", portal: "hepsiemlak", days: [-80] },
  { title: "Zingat ilan paketi", category: "reklam", amount: 2900, recurrence: "monthly", portal: "zingat", days: [-50, -20] },
  { title: "Emlak Jet yıllık abonelik", category: "reklam", amount: 14000, recurrence: "yearly", portal: "emlakjet", days: [-100] },
];

async function seedFinance(ctx: ModuleSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  let n = 0;
  // Bütçe: örnek modda is_sample işaretiyle yazılır (20261012000400); "Gerçek kullanıma geç" temizler. Gerçek bütçe satırı varsa
  // (tenant+kategori çakışması) ona dokunulmaz.
  {
    const rows = BUDGETS.map((b) => ({
      tenant_id: tenantId, category: b.category, monthly_amount: b.amount, created_by: ctx.ownerId,
      ...(ctx.sample ? { is_sample: true } : {}),
    }));
    const { data, error } = await db.from("expense_budgets").upsert(rows, { onConflict: "tenant_id,category", ignoreDuplicates: true }).select("id");
    // Örnek modda is_sample kolonu (20261012000400) henüz uygulanmadıysa yalnız bütçe atlanır; giderler yazılmaya devam eder.
    if (error && !(ctx.sample && isMissingSampleSchema(error))) throw new DbFail("expense_budgets", error);
    n += (data ?? []).length;
  }
  const today = todayKey();
  const existing = must("expenses", await db.from("expenses").select("title, expense_date").eq("tenant_id", tenantId).not("recurrence", "is", null)) as { title: string; expense_date: string }[];
  const seen = new Set(existing.map((e) => `${e.title}|${e.expense_date}`));
  const rows: Dict[] = [];
  for (const r of RECURRING) {
    const dates = r.dueDay
      ? (() => {
          const last = lastDueOnOrBefore(today, r.dueDay);
          return [shiftMonthKey(last, -2, r.dueDay), shiftMonthKey(last, -1, r.dueDay), last];
        })()
      : r.days.map((d) => addDays(today, d));
    for (const date of dates) {
      if (seen.has(`${r.title}|${date}`)) continue;
      rows.push({
        tenant_id: tenantId, created_by: ctx.ownerId, category: r.category, title: r.title, amount: r.amount, expense_date: date,
        recurrence: r.recurrence, portal_key: r.portal ?? null, notes: r.portal ? "Portal aboneliği — yatırım getirisi kartında görünür." : "Tekrarlayan gider",
        ...(ctx.sample ? { is_sample: true } : {}),
      });
    }
  }
  n += (await insertRows(db, "expenses", rows)).length;
  return n;
}

// ---------------------------------------------------------------------------
// 7b) Kasa / banka (Finans Paket A) + düzenli ödemeler (Paket B) — TEK TUTARLI HİKÂYE (İstanbul örnekleri)
//  * Bakiye = açılış + girişler − çıkışlar: DB hesaplar; burada yalnız satırlar tutarlı yazılır.
//  * Tahsilat hareketleri GERÇEK kaynaklara bağlıdır: tahsil edilmiş komisyonlar ('commission'), kira tahsilatları ('rent').
//    Mülk sahibi hakedişleri bankadan çıkar. Hiçbir tutar uydurma değildir; kaynak yoksa hareket yazılmaz.
//  * Düzenli ödeme kuralları AYNI banka hesabına bağlıdır; son vadesi işlenmiş dönem + gider + banka hareketi birbirine bağlıdır.
//  * Gider-bağlı hareketler giderin kendi tutarını/tarihini kullanır (iki ayrı rakam yok).
//  * Örnek modda her satır is_sample=true taşır ve "Gerçek kullanıma geç" ile (purge-extras) silinir.
// ---------------------------------------------------------------------------
const OPENING_DAYS = -120;
const CASH_ACCOUNTS = [
  { kind: "cash", name: KASA_NAME, iban_last4: null, opening: 15000 },
  { kind: "bank", name: BANK_NAME, iban_last4: "4821", opening: 240000 },
] as const;

/** Elle girilen (kaynağa bağlı olmayan) hareketler. */
const MANUAL_ENTRIES: { account: string; direction: "in" | "out"; amount: number; category: string; title: string; counterparty: string; day: number }[] = [
  { account: BANK_NAME, direction: "in", amount: 18500, category: "hizmet_bedeli", title: "Beşiktaş değerleme raporu bedeli", counterparty: "Beşiktaş mülk sahibi", day: -14 },
  { account: KASA_NAME, direction: "out", amount: 1850, category: "ofis", title: "Kırtasiye ve ikram", counterparty: "Çarşı Kırtasiye", day: -8 },
  { account: KASA_NAME, direction: "in", amount: 6500, category: "diger_gelir", title: "Üsküdar kapora nakit teslimi", counterparty: "Üsküdar müşterisi", day: -3 },
];

/** Var olan giderlerden ödenmiş sayılanlar: başlığa göre bulunur, hareket giderin tutar/tarihini taşır. */
const EXPENSE_PAID_FROM: { title: string; account: string }[] = [
  { title: "Gösterim yakıt gideri", account: KASA_NAME },
  { title: "Sahibinden doping paketi", account: BANK_NAME },
  { title: "Danışman satış eğitimi", account: BANK_NAME },
];

async function seedCash(ctx: ModuleSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  const flag = ctx.sample ? { is_sample: true } : {};
  const today = todayKey();
  const openingDate = addDays(today, OPENING_DAYS);
  const clampDate = (d: string) => (d > today ? today : d < openingDate ? openingDate : d);
  let n = 0;
  const existing = must("finance_accounts", await db.from("finance_accounts").select("id, name").eq("tenant_id", tenantId).eq("owner_scope", "office").is("archived_at", null)) as { id: string; name: string }[];
  const byName = new Map(existing.map((a) => [a.name, a.id]));
  for (const a of CASH_ACCOUNTS) {
    if (byName.has(a.name)) continue;
    const [row] = await insertRows(db, "finance_accounts", [{
      tenant_id: tenantId, owner_scope: "office", kind: a.kind, name: a.name, iban_last4: a.iban_last4, currency: "TRY",
      opening_balance: a.opening, opening_date: openingDate, created_by: ctx.ownerId, ...flag,
    }]);
    byName.set(a.name, row!.id as string);
    n += 1;
  }
  const bankId = byName.get(BANK_NAME);
  const kasaId = byName.get(KASA_NAME);

  const have = must("cash_entries", await db.from("cash_entries").select("title, entry_date, account_id, source_type, source_id, expense_id").eq("tenant_id", tenantId).is("voided_at", null)) as {
    title: string; entry_date: string; account_id: string; source_type: string; source_id: string | null; expense_id: string | null;
  }[];
  const seen = new Set(have.map((e) => `${e.account_id}|${e.title}|${e.entry_date}`));
  const seenSource = new Set(have.filter((e) => e.source_id).map((e) => `${e.source_type}|${e.source_id}`));
  const seenExpense = new Set(have.filter((e) => e.expense_id).map((e) => e.expense_id as string));
  const rows: Dict[] = [];
  const push = (accountId: string | undefined, e: { direction: "in" | "out"; amount: number; category: string; title: string; counterparty?: string | null; date: string; source_type?: string; source_id?: string | null; expense_id?: string | null }) => {
    if (!accountId) return;
    const date = clampDate(e.date);
    if (seen.has(`${accountId}|${e.title}|${date}`)) return;
    if (e.source_id && seenSource.has(`${e.source_type}|${e.source_id}`)) return;
    if (e.expense_id && seenExpense.has(e.expense_id)) return;
    seen.add(`${accountId}|${e.title}|${date}`);
    if (e.source_id) seenSource.add(`${e.source_type}|${e.source_id}`);
    if (e.expense_id) seenExpense.add(e.expense_id);
    rows.push({
      tenant_id: tenantId, account_id: accountId, direction: e.direction, amount: money(e.amount), currency: "TRY", entry_date: date,
      kind: e.direction === "in" ? "income" : "expense", category: e.category, title: e.title, counterparty: e.counterparty || null,
      source_type: e.source_type ?? "manual", source_id: e.source_id ?? null, expense_id: e.expense_id ?? null, created_by: ctx.ownerId, ...flag,
    });
  };

  // 1) Elle girilen hareketler
  for (const e of MANUAL_ENTRIES) push(byName.get(e.account), { ...e, date: addDays(today, e.day) });

  // 2) Ödenmiş giderler: hareket giderin tutarını/tarihini taşır (gider yoksa hareket yazılmaz)
  const titles = EXPENSE_PAID_FROM.map((e) => e.title);
  const exps = must("expenses", await db.from("expenses").select("id, title, amount, category, expense_date").eq("tenant_id", tenantId).in("title", titles)) as { id: string; title: string; amount: number; category: string; expense_date: string }[];
  for (const def of EXPENSE_PAID_FROM) {
    const x = exps.find((e) => e.title === def.title);
    if (!x) continue;
    const cat = x.category === "reklam" || x.category === "ofis" || x.category === "ulasim" ? x.category : "diger_gider";
    push(byName.get(def.account), { direction: "out", amount: Number(x.amount), category: cat, title: x.title, date: x.expense_date, expense_id: x.id });
  }

  // 3) Tahsil edilmiş komisyonlar → bankaya giriş (kaynak: commission)
  let comQ = db.from("commissions").select("id, gross_amount, vat_amount, created_at").eq("tenant_id", tenantId).eq("status", "paid").order("created_at", { ascending: true }).limit(3);
  if (ctx.sample) comQ = comQ.eq("is_sample", true);
  const commissions = must("commissions", await comQ) as { id: string; gross_amount: number; vat_amount: number | null; created_at: string }[];
  for (const c of commissions) {
    const amount = Number(c.gross_amount) + Number(c.vat_amount ?? 0);
    if (!(amount > 0)) continue;
    push(bankId, { direction: "in", amount, category: "komisyon", title: `Komisyon tahsilatı (${c.id.slice(0, 8)})`, date: c.created_at.slice(0, 10), source_type: "commission", source_id: c.id });
  }

  // 4) Kira tahsilatları (kaynak: rent) ve mülk sahibi hakedişleri (bankadan çıkış)
  let rentalQ = db.from("rentals").select("id").eq("tenant_id", tenantId).limit(200);
  if (ctx.sample) rentalQ = rentalQ.eq("is_sample", true);
  const rentalIds = (must("rentals", await rentalQ) as { id: string }[]).map((r) => r.id);
  if (rentalIds.length > 0) {
    const pays = must("rent_payments", await db.from("rent_payments").select("id, amount, paid_on, method, receipt_no").eq("tenant_id", tenantId).in("rental_id", rentalIds).is("voided_at", null).order("paid_on")) as {
      id: string; amount: number; paid_on: string; method: string; receipt_no: number;
    }[];
    for (const p of pays) {
      push(p.method === "cash" ? kasaId : bankId, { direction: "in", amount: Number(p.amount), category: "kira_tahsilat", title: `Kira tahsilatı (makbuz ${p.receipt_no})`, date: p.paid_on, source_type: "rent", source_id: p.id });
    }
    const payouts = must("owner_payouts", await db.from("owner_payouts").select("amount, paid_on, reference").eq("tenant_id", tenantId).in("rental_id", rentalIds).order("paid_on")) as {
      amount: number; paid_on: string; reference: string | null;
    }[];
    for (const o of payouts) {
      push(bankId, { direction: "out", amount: Number(o.amount), category: "diger_gider", title: `Mülk sahibi hakedişi${o.reference ? ` (${o.reference})` : ""}`, date: o.paid_on });
    }
  }

  n += (await insertRows(db, "cash_entries", rows)).length;
  return n;
}

/** Düzenli ödeme kuralları: banka hesabına bağlı; son vadesi işlenmiş dönem + gider + banka hareketi birbirine bağlı. */
async function seedRecurring(ctx: ModuleSeedContext): Promise<number> {
  const { db, tenantId } = ctx;
  const flag = ctx.sample ? { is_sample: true } : {};
  const today = todayKey();
  const acc = must("finance_accounts", await db.from("finance_accounts").select("id").eq("tenant_id", tenantId).eq("owner_scope", "office").eq("name", BANK_NAME).is("archived_at", null).limit(1)) as { id: string }[];
  const accountId = acc[0]?.id;
  if (!accountId) return 0;
  const have = new Set((must("recurring_rules", await db.from("recurring_rules").select("title").eq("tenant_id", tenantId)) as { title: string }[]).map((r) => r.title));
  let n = 0;
  for (const def of RULES) {
    if (have.has(def.title)) continue;
    const lastDue = lastDueOnOrBefore(today, def.day);
    const lastPeriod = `${lastDue.slice(0, 7)}-01`;
    const nextPeriod = def.history || lastDue < today ? shiftMonthKey(lastPeriod, 1, 1) : lastPeriod;
    const [rule] = await insertRows(db, "recurring_rules", [{
      tenant_id: tenantId, scope: "office", direction: "out", category: def.category, title: def.title, amount: def.amount,
      account_id: accountId, frequency: "monthly", pay_day: def.day,
      start_date: def.history ? lastPeriod : today, anchor: def.history ? lastPeriod : `${today.slice(0, 7)}-01`,
      mode: def.mode, portal_key: def.portal, expense_category: def.expenseCategory, create_expense: true,
      next_period: nextPeriod, next_due: shiftMonthKey(nextPeriod, 0, def.day), last_period: def.history ? lastPeriod : null,
      created_by: ctx.ownerId, ...flag,
    }]);
    n += 1;
    if (!def.history || !rule) continue;

    // İşlenmiş dönem: gider (var olan portal gideri yeniden kullanılır) + banka hareketi + oluşum — üçü aynı tutar/tarih.
    let expenseId: string | null = null;
    let createdExpense = false;
    const exp = must("expenses", await db.from("expenses").select("id").eq("tenant_id", tenantId).eq("title", def.title).eq("expense_date", lastDue).limit(1)) as { id: string }[];
    if (exp[0]) expenseId = exp[0].id;
    else {
      const [x] = await insertRows(db, "expenses", [{
        tenant_id: tenantId, created_by: ctx.ownerId, category: def.expenseCategory, title: def.title, amount: def.amount, expense_date: lastDue,
        portal_key: def.portal, notes: "Düzenli ödeme", ...flag,
      }]);
      expenseId = (x?.id as string | undefined) ?? null;
      createdExpense = true;
    }
    const [occ] = await insertRows(db, "recurring_occurrences", [{
      tenant_id: tenantId, rule_id: rule.id, period: lastPeriod, due_date: lastDue, amount: def.amount, status: "posted", decided_by: ctx.ownerId, decided_at: isoAt(lastDue, 9),
    }]);
    const usedExpense = expenseId
      ? (must("cash_entries", await db.from("cash_entries").select("id").eq("tenant_id", tenantId).eq("expense_id", expenseId).is("voided_at", null).limit(1)) as unknown[]).length > 0
      : false;
    const [entry] = await insertRows(db, "cash_entries", [{
      tenant_id: tenantId, account_id: accountId, direction: "out", amount: def.amount, currency: "TRY", entry_date: lastDue, kind: "expense",
      category: def.category, title: def.title, expense_id: usedExpense ? null : expenseId, created_expense: createdExpense && !usedExpense,
      source_type: "recurring", source_id: occ?.id ?? null, created_by: ctx.ownerId, ...flag,
    }]);
    if (occ && entry) {
      const { error } = await db.from("recurring_occurrences").update({ entry_id: entry.id }).eq("id", occ.id as string).eq("tenant_id", tenantId);
      if (error) throw new DbFail("recurring_occurrences", error);
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// 8) Hazır avatar
// ---------------------------------------------------------------------------
async function seedAvatars(ctx: ModuleSeedContext): Promise<number> {
  let n = 0;
  for (const a of ctx.avatarAssignments ?? []) {
    const { data, error } = await ctx.db
      .from("profiles").update({ avatar_preset: a.preset }).eq("id", a.profileId).eq("tenant_id", ctx.tenantId).is("avatar_preset", null).is("avatar_url", null).select("id");
    if (error) throw new DbFail("profiles(avatar)", error);
    n += (data ?? []).length;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Giriş noktası
// ---------------------------------------------------------------------------
export async function seedModuleData(ctx: ModuleSeedContext): Promise<ModuleSeedReport> {
  const report: ModuleSeedReport = { counts: {}, skipped: [], failed: [] };
  const run = async (name: string, fn: () => Promise<number>) => {
    try {
      report.counts[name] = await fn();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (isMissingSampleSchema(err)) report.skipped.push({ group: name, reason: "tablo/sütun yok (migration uygulanmamış): etkin değil" });
      else {
        console.error(`seedModuleData:${name}`, e);
        report.failed.push({ group: name, message: err.message ?? "bilinmeyen hata" });
      }
    }
  };

  const receipts = new ReceiptCounter(ctx.db, ctx.tenantId);
  let receiptsReady = true;
  try {
    await receipts.load();
  } catch (e) {
    receiptsReady = false;
    report.skipped.push({ group: "property_management", reason: `makbuz sayacı okunamadı: ${(e as Error).message}` });
    report.skipped.push({ group: "building", reason: "makbuz sayacı okunamadı" });
  }
  if (receiptsReady) {
    await run("property_management", () => seedPropertyManagement(ctx, receipts));
    await run("building", () => seedBuilding(ctx, receipts));
  }
  await run("league", () => seedLeague(ctx));
  await run("deal_process", () => seedDealProcess(ctx));
  await run("authority", () => seedAuthority(ctx));
  await run("listing_analyses", () => seedListingAnalyses(ctx));
  await run("finance", () => seedFinance(ctx));
  await run("cash", () => seedCash(ctx));
  await run("recurring", () => seedRecurring(ctx));
  await run("listing_pool", () => seedListingPool(ctx));
  if (!ctx.sample) await run("avatars", () => seedAvatars(ctx));
  else report.skipped.push({ group: "avatars", reason: "gerçek kullanıcı profiline hazır avatar yazılmaz: etkin değil" });
  return report;
}
