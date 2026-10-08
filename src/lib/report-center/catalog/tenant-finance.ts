/**
 * Ofis raporları — finans: gider, kâr/zarar, kiralama, kira tahakkuku, aidat, sözleşme, uyum defteri, ofis faturaları.
 */
import { now, trMonthKey } from "@/lib/clock";
import { LEDGER_FLAG_LABELS, LEDGER_METHOD_LABELS, LEDGER_PARTY_LABELS, LEDGER_TX_LABELS } from "@/lib/compliance/ledger";
import { DEFAULT_DEFINITIONS } from "@/lib/definition-defaults";
import { buildProfitLoss, lastMonthKeys, type PlCommission, type PlExpense, type PlSplit } from "@/lib/reporting/profit-loss";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { DATE_RANGE_FIELDS } from "../filters";
import { loadDefLabels, memoLabels, STATUS } from "../labels";
import { applyActorScope, applyDateRange, applyTimestampRange, enrichProfiles, label, nameOf, one } from "../query-helpers";
import type { Row } from "../types";
import { defineReport, opts, tid } from "./define";

const CONTRACT_TYPE_OPTIONS = [...DEFAULT_DEFINITIONS.contract_type.map((d) => ({ value: d.value, label: d.label })), { value: "yer_gosterme", label: "Yer gösterme" }, { value: "kapora", label: "Kapora" }];
const EXPENSE_OPTIONS = DEFAULT_DEFINITIONS.expense_category.map((d) => ({ value: d.value, label: d.label }));

export const giderler = defineReport({
  id: "giderler",
  title: "Giderler",
  description: "Ofis giderleri: tarih, kategori, tutar, bağlı portföy, not ve fiş bağlantısı.",
  category: "finans",
  scope: "tenant",
  module: "expenses",
  keywords: ["masraf", "harcama", "fiş"],
  filters: [{ kind: "select", key: "kategori", label: "Kategori", options: EXPENSE_OPTIONS }, ...DATE_RANGE_FIELDS("Gider başlangıcı", "Gider bitişi")],
  columns: [
    { key: "tarih", label: "Gider tarihi", type: "date", get: (r) => r.expense_date },
    { key: "baslik", label: "Başlık", type: "text", width: 32, get: (r) => r.title },
    { key: "kategori", label: "Kategori", type: "text", width: 20, get: (r, c) => label(memoLabels(c, "expense_category"), r.category) },
    { key: "tutar", label: "Tutar", type: "money", total: true, get: (r) => r.amount },
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(r.property)?.property_code },
    { key: "not", label: "Not", type: "text", width: 30, get: (r) => r.notes },
    { key: "fis", label: "Fiş bağlantısı", type: "text", width: 30, get: (r) => r.receipt_url },
    { key: "kayit", label: "Kayıt tarihi", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("expenses")
        .select("id, title, amount, category, expense_date, notes, receipt_url, created_at, property:properties!expenses_property_id_fkey(property_code, tenant_id)", { count: "exact" })
        .eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "created_by" });
      if (f.kategori) q = q.eq("category", f.kategori);
      q = applyDateRange(q, "expense_date", f);
      return q.order("expense_date", { ascending: false }).order("id", { ascending: true });
    },
    enrich: async (_rows, ctx) => {
      await loadDefLabels(ctx, "expense_category");
    },
  },
});

export const karZarar = defineReport({
  id: "kar-zarar",
  title: "Kâr / zarar (aylık)",
  description: "Ay bazında komisyon geliri, KDV, dağıtılan paylar, gider ve net sonuç. Yalnız tüm kazancı görme yetkisi olanlara açıktır; örnek veri hariç.",
  category: "finans",
  scope: "tenant",
  module: "reports",
  earningsAllOnly: true,
  officeWideOnly: true,
  keywords: ["net", "gelir gider", "kar", "zarar"],
  filters: [{ kind: "select", key: "ay", label: "Dönem", options: [{ value: "6", label: "Son 6 ay" }, { value: "12", label: "Son 12 ay" }, { value: "24", label: "Son 24 ay" }] }],
  columns: [
    { key: "ay", label: "Ay", type: "text", width: 12, get: (r) => r.label },
    { key: "adet", label: "Komisyon adedi", type: "number", total: true, get: (r) => r.commissions },
    { key: "gelir", label: "Komisyon (brüt)", type: "money", total: true, get: (r) => r.revenue },
    { key: "kdv", label: "KDV", type: "money", total: true, get: (r) => r.vat },
    { key: "pay", label: "Dağıtılan paylar", type: "money", total: true, get: (r) => r.shares },
    { key: "gider", label: "Gider", type: "money", total: true, get: (r) => r.expenses },
    { key: "net", label: "Net sonuç", type: "money", total: true, get: (r) => r.net },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const months = Number(f.ay ?? 12);
      const keys = lastMonthKeys(trMonthKey(now()), [6, 12, 24].includes(months) ? months : 12);
      const startIso = `${keys[0]}-01T00:00:00+03:00`;
      const [commRes, expRes] = await Promise.all([
        fetchAllRows<Row>((from, to) =>
          ctx.supabase
            .from("commissions")
            .select("id, created_at, gross_amount, vat_amount, status")
            .eq("tenant_id", tid(ctx))
            .eq("is_sample", false)
            .gte("created_at", startIso)
            .order("id", { ascending: true })
            .range(from, to),
        ),
        fetchAllRows<Row>((from, to) =>
          ctx.supabase
            .from("expenses")
            .select("id, expense_date, amount")
            .eq("tenant_id", tid(ctx))
            .eq("is_sample", false)
            .gte("expense_date", `${keys[0]}-01`)
            .order("id", { ascending: true })
            .range(from, to),
        ),
      ]);
      if (commRes.error || expRes.error) throw new Error("kar-zarar okuma hatası");
      const commissions: PlCommission[] = commRes.data.map((c) => ({ id: c.id, createdAt: c.created_at, gross: Number(c.gross_amount) || 0, vat: Number(c.vat_amount) || 0, status: c.status }));
      const splits: PlSplit[] = [];
      const ids = commissions.map((c) => c.id);
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200);
        const res = await fetchAllRows<Row>((from, to) =>
          ctx.supabase
            .from("commission_splits")
            .select("id, commission_id, kind, amount")
            .eq("tenant_id", tid(ctx))
            .in("commission_id", part)
            .order("id", { ascending: true })
            .range(from, to),
        );
        // Eksik pay verisiyle net hesaplanmaz (net olduğundan yüksek görünürdü).
        if (res.error) throw new Error("kar-zarar pay okuma hatası");
        for (const s of res.data) splits.push({ commissionId: s.commission_id, kind: s.kind, amount: Number(s.amount) || 0 });
      }
      const expenses: PlExpense[] = expRes.data.map((e) => ({ date: String(e.expense_date), amount: Number(e.amount) || 0 }));
      const pl = buildProfitLoss(keys, commissions, splits, expenses);
      return pl.months.map((m) => ({ ...m, label: `${m.key.slice(5, 7)}.${m.key.slice(0, 4)}` })).reverse();
    },
  },
});

export const kiralamalar = defineReport({
  id: "kiralamalar",
  title: "Kiralamalar (kira sözleşmeleri)",
  description: "Aktif ve biten kiralamalar: kiracı, aylık kira, vade günü, depozito ve geciken tahakkuklar.",
  category: "finans",
  scope: "tenant",
  module: "rentals",
  personalData: true,
  keywords: ["kira", "kiracı", "depozito"],
  filters: [{ kind: "select", key: "durum", label: "Durum", options: opts(STATUS.rental) }, ...DATE_RANGE_FIELDS("Başlangıç tarihi (en erken)", "Başlangıç tarihi (en geç)")],
  columns: [
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(r.property)?.property_code },
    { key: "portfoy", label: "Portföy", type: "text", width: 30, get: (r) => one(r.property)?.title },
    { key: "kiraci", label: "Kiracı", type: "text", width: 24, get: (r) => one(r.renter)?.full_name },
    { key: "kira", label: "Aylık kira", type: "money", total: true, get: (r) => r.monthly_rent },
    { key: "vade", label: "Vade günü", type: "number", get: (r) => r.due_day },
    { key: "bas", label: "Başlangıç", type: "date", get: (r) => r.start_date },
    { key: "bit", label: "Bitiş", type: "date", get: (r) => r.end_date },
    { key: "depozito", label: "Depozito", type: "money", get: (r) => r.deposit },
    { key: "iade", label: "Depozito iade edildi", type: "bool", get: (r) => r.deposit_returned },
    { key: "durum", label: "Durum", type: "text", width: 12, get: (r) => label(STATUS.rental, r.status) },
    { key: "geciken", label: "Geciken tahakkuk", type: "number", get: (r, c) => (c.memo.get("overdue") as Map<string, { n: number; sum: number }> | undefined)?.get(r.id)?.n ?? 0 },
    { key: "gecikenTutar", label: "Geciken tutar", type: "money", total: true, get: (r, c) => (c.memo.get("overdue") as Map<string, { n: number; sum: number }> | undefined)?.get(r.id)?.sum ?? 0 },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("rentals")
        .select(
          "id, monthly_rent, due_day, start_date, end_date, deposit, deposit_returned, status, created_at, property:properties!rentals_property_id_fkey!inner(property_code, title, tenant_id), renter:customers!rentals_renter_customer_id_fkey!inner(full_name, tenant_id)",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("property.tenant_id", tid(ctx))
        .eq("renter.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "created_by" });
      if (f.durum) q = q.eq("status", f.durum);
      q = applyDateRange(q, "start_date", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: async (rows, ctx) => {
      const overdue = (ctx.memo.get("overdue") as Map<string, { n: number; sum: number }> | undefined) ?? new Map<string, { n: number; sum: number }>();
      ctx.memo.set("overdue", overdue);
      const ids = rows.map((r) => r.id as string);
      if (!ids.length) return;
      const { data } = await ctx.supabase.from("rent_charges").select("rental_id, amount").eq("tenant_id", tid(ctx)).eq("status", "overdue").in("rental_id", ids);
      for (const c of (data ?? []) as Row[]) {
        const cur = overdue.get(c.rental_id) ?? { n: 0, sum: 0 };
        cur.n += 1;
        cur.sum += Number(c.amount) || 0;
        overdue.set(c.rental_id, cur);
      }
    },
  },
});

export const kiraTahakkuklari = defineReport({
  id: "kira-tahakkuklari",
  title: "Kira tahakkukları",
  description: "Aylık kira tahakkukları: dönem, tutar, ödendi / bekliyor / gecikti ve ödeme tarihi (kira takibi).",
  category: "finans",
  scope: "tenant",
  module: "rentals",
  personalData: true,
  keywords: ["tahsilat", "gecikme", "kira takibi"],
  filters: [{ kind: "select", key: "durum", label: "Durum", options: opts(STATUS.rentCharge) }, ...DATE_RANGE_FIELDS("Dönem başlangıcı", "Dönem bitişi")],
  columns: [
    { key: "donem", label: "Dönem", type: "date", get: (r) => r.period },
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(one(r.rental)?.property)?.property_code },
    { key: "portfoy", label: "Portföy", type: "text", width: 30, get: (r) => one(one(r.rental)?.property)?.title },
    { key: "kiraci", label: "Kiracı", type: "text", width: 24, get: (r) => one(one(r.rental)?.renter)?.full_name },
    { key: "tutar", label: "Tutar", type: "money", total: true, get: (r) => r.amount },
    { key: "durum", label: "Durum", type: "text", width: 12, get: (r) => label(STATUS.rentCharge, r.status) },
    { key: "odeme", label: "Ödeme tarihi", type: "date", get: (r) => r.paid_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("rent_charges")
        .select(
          "id, period, amount, status, paid_at, rental:rentals!rent_charges_rental_id_fkey!inner(tenant_id, created_by, property:properties!rentals_property_id_fkey(property_code, title), renter:customers!rentals_renter_customer_id_fkey(full_name))",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("rental.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "rental.created_by" });
      if (f.durum) q = q.eq("status", f.durum);
      q = applyDateRange(q, "period", f);
      return q.order("period", { ascending: false }).order("id", { ascending: true });
    },
  },
});

export const aidatlar = defineReport({
  id: "aidatlar",
  title: "Aidatlar",
  description: "Portföy aidatları: dönem, son ödeme tarihi, tutar ve ödeme durumu.",
  category: "finans",
  scope: "tenant",
  module: "expenses",
  keywords: ["site", "aidat", "ödenmedi"],
  filters: [{ kind: "select", key: "durum", label: "Durum", options: opts(STATUS.due) }, ...DATE_RANGE_FIELDS("Dönem başlangıcı", "Dönem bitişi")],
  columns: [
    { key: "baslik", label: "Başlık", type: "text", width: 30, get: (r) => r.title },
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(r.property)?.property_code },
    { key: "portfoy", label: "Portföy", type: "text", width: 30, get: (r) => one(r.property)?.title },
    { key: "donem", label: "Dönem", type: "date", get: (r) => r.period },
    { key: "vade", label: "Son ödeme", type: "date", get: (r) => r.due_date },
    { key: "tutar", label: "Tutar", type: "money", total: true, get: (r) => r.amount },
    { key: "durum", label: "Durum", type: "text", width: 12, get: (r) => label(STATUS.due, r.status) },
    { key: "odeme", label: "Ödeme tarihi", type: "date", get: (r) => r.paid_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("property_dues")
        .select("id, title, amount, period, due_date, status, paid_at, property:properties!property_dues_property_id_fkey(property_code, title, tenant_id)", { count: "exact" })
        .eq("tenant_id", tid(ctx))
        .eq("property.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "created_by" });
      if (f.durum) q = q.eq("status", f.durum);
      q = applyDateRange(q, "period", f);
      return q.order("period", { ascending: false }).order("id", { ascending: true });
    },
  },
});

export const sozlesmeler = defineReport({
  id: "sozlesmeler",
  title: "Sözleşmeler",
  description: "Sözleşme listesi: tür, durum, taraflar, imza ve bitiş tarihleri.",
  category: "ofis",
  scope: "tenant",
  module: "contracts",
  personalData: true,
  keywords: ["imza", "kira sözleşmesi", "yetki belgesi"],
  filters: [
    { kind: "select", key: "durum", label: "Durum", options: opts(STATUS.contract) },
    { kind: "select", key: "tur", label: "Tür", options: CONTRACT_TYPE_OPTIONS },
    ...DATE_RANGE_FIELDS("Oluşturma başlangıcı", "Oluşturma bitişi"),
  ],
  columns: [
    { key: "baslik", label: "Başlık", type: "text", width: 34, get: (r) => r.title },
    { key: "tur", label: "Tür", type: "text", width: 14, get: (r, c) => label(memoLabels(c, "contract_type"), r.contract_type) },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.contract, r.status) },
    { key: "musteri", label: "Müşteri", type: "text", width: 24, get: (r) => one(r.customer)?.full_name },
    { key: "kod", label: "Portföy kodu", type: "text", width: 14, get: (r) => one(r.property)?.property_code },
    { key: "portfoy", label: "Portföy", type: "text", width: 30, get: (r) => one(r.property)?.title },
    { key: "kayit", label: "Oluşturma", type: "date", get: (r) => r.created_at },
    { key: "imza", label: "İmza tarihi", type: "date", get: (r) => r.signed_at },
    { key: "bitis", label: "Bitiş tarihi", type: "date", get: (r) => r.expires_at },
    { key: "iptal", label: "İptal tarihi", type: "date", get: (r) => r.cancelled_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("contracts")
        .select(
          "id, title, contract_type, status, created_at, signed_at, expires_at, cancelled_at, property:properties!contracts_property_id_fkey(property_code, title, tenant_id), customer:customers!contracts_customer_id_fkey(full_name, tenant_id)",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx))
        .eq("property.tenant_id", tid(ctx))
        .eq("customer.tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { sample: true, actorColumn: "created_by" });
      if (f.durum) q = q.eq("status", f.durum);
      if (f.tur) q = q.eq("contract_type", f.tur);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
    enrich: async (_rows, ctx) => {
      await loadDefLabels(ctx, "contract_type");
    },
  },
});

export const uyumKayitDefteri = defineReport({
  id: "uyum-kayit-defteri",
  title: "Uyum kayıt defteri",
  description: "Yüksek tutarlı / nakit işlem kayıt defteri: taraf, tutar, ödeme yöntemi, kimlik kontrolü ve saklama süresi.",
  category: "ofis",
  scope: "tenant",
  module: "compliance",
  rolesOnly: ["owner", "gm"],
  personalData: true,
  keywords: ["masak", "kayıt defteri", "nakit", "uyum"],
  filters: [
    { kind: "select", key: "tur", label: "İşlem türü", options: opts(LEDGER_TX_LABELS) },
    { kind: "select", key: "odeme", label: "Ödeme yöntemi", options: opts(LEDGER_METHOD_LABELS) },
    ...DATE_RANGE_FIELDS("İşlem başlangıcı", "İşlem bitişi"),
  ],
  columns: [
    { key: "islemTarihi", label: "İşlem tarihi", type: "date", get: (r) => r.transaction_date },
    { key: "kayit", label: "Kayıt türü", type: "text", width: 12, get: (r) => label(STATUS.ledgerKind, r.kind) },
    { key: "tur", label: "İşlem türü", type: "text", width: 16, get: (r) => label(LEDGER_TX_LABELS, r.transaction_type) },
    { key: "taraf", label: "Taraf", type: "text", width: 24, get: (r) => r.party_name },
    { key: "rol", label: "Taraf rolü", type: "text", width: 14, get: (r) => label(LEDGER_PARTY_LABELS, r.party_role) },
    { key: "karsi", label: "Karşı taraf", type: "text", width: 24, get: (r) => r.counterparty_name },
    { key: "kimlik", label: "Kimlik kontrol edildi", type: "bool", get: (r) => r.identity_checked },
    { key: "tutar", label: "Tutar", type: "money", total: true, get: (r) => r.amount_try },
    { key: "odeme", label: "Ödeme yöntemi", type: "text", width: 16, get: (r) => label(LEDGER_METHOD_LABELS, r.payment_method) },
    { key: "bayrak", label: "Uyarılar", type: "text", width: 24, get: (r) => (Array.isArray(r.flags) ? r.flags.map((x: string) => LEDGER_FLAG_LABELS[x as keyof typeof LEDGER_FLAG_LABELS] ?? x).join("; ") : "") },
    { key: "saklama", label: "Saklama bitişi", type: "date", get: (r) => r.retain_until },
    { key: "not", label: "Not", type: "text", width: 30, get: (r) => r.note },
    { key: "kaydeden", label: "Kaydeden", type: "text", width: 20, get: (r, c) => nameOf(c, r.created_by) },
    { key: "olusturma", label: "Kayıt zamanı", type: "datetime", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("compliance_ledger_entries")
        .select(
          "id, kind, transaction_type, transaction_date, party_name, party_role, counterparty_name, identity_checked, amount_try, payment_method, flags, retain_until, note, created_by, created_at",
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx));
      q = ctx.sample.apply(q);
      if (f.tur) q = q.eq("transaction_type", f.tur);
      if (f.odeme) q = q.eq("payment_method", f.odeme);
      q = applyDateRange(q, "transaction_date", f);
      return q.order("transaction_date", { ascending: false }).order("id", { ascending: true });
    },
    enrich: enrichProfiles((r) => [r.created_by]),
  },
});

export const ofisFaturalari = defineReport({
  id: "abonelik-faturalari",
  title: "Abonelik faturaları",
  description: "EmlakSoft abonelik faturalarınız: fatura no, dönem, tutar, KDV, vade ve ödeme tarihi.",
  category: "finans",
  scope: "tenant",
  module: "billing",
  rolesOnly: ["owner", "gm", "accounting"],
  keywords: ["fatura", "ödeme", "abonelik"],
  filters: [{ kind: "select", key: "durum", label: "Durum", options: opts(STATUS.invoice) }, ...DATE_RANGE_FIELDS("Düzenleme başlangıcı", "Düzenleme bitişi")],
  columns: [
    { key: "no", label: "Fatura no", type: "text", width: 18, get: (r) => r.invoice_no },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => label(STATUS.invoice, r.status) },
    { key: "baslangic", label: "Dönem başlangıcı", type: "date", get: (r) => r.period_start },
    { key: "bitis", label: "Dönem bitişi", type: "date", get: (r) => r.period_end },
    { key: "tutar", label: "Tutar", type: "money", total: true, get: (r) => r.amount_try },
    { key: "kdv", label: "KDV", type: "money", total: true, get: (r) => r.tax_try },
    { key: "toplam", label: "Toplam", type: "money", total: true, get: (r) => r.total_try },
    { key: "vade", label: "Vade", type: "date", get: (r) => r.due_at },
    { key: "odeme", label: "Ödeme tarihi", type: "date", get: (r) => r.paid_at },
    { key: "kayit", label: "Düzenleme", type: "date", get: (r) => r.created_at },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("invoices")
        .select("id, invoice_no, status, amount_try, tax_try, total_try, period_start, period_end, due_at, paid_at, created_at", { count: "exact" })
        .eq("tenant_id", tid(ctx));
      if (f.durum) q = q.eq("status", f.durum);
      q = applyTimestampRange(q, "created_at", f);
      return q.order("created_at", { ascending: false }).order("id", { ascending: true });
    },
  },
});

export const FINANCE_REPORTS = [giderler, karZarar, kiralamalar, kiraTahakkuklari, aidatlar, sozlesmeler, uyumKayitDefteri, ofisFaturalari];
