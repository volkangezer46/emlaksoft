/**
 * Ofis raporları — kasa / banka (Finans Paket A): hesap ekstresi ve gelir-gider dökümü.
 * Kiracı sınırı sorguda; aktör kapsamı `applyActorScope` (created_by). Kişisel hesap hareketlerini veritabanı (RLS) yalnız
 * sahibine verir; maaş kategorisi ofis hesaplarında yalnız owner/gm'ye gelir. Modül `reports`: danışman kendi kişisel
 * hesabının ekstresini alabilir; ofis hesapları RLS ile `expenses` yetkisine bağlı kalır.
 */
import { now, trDayKey, trMonthKey } from "@/lib/clock";
import { cashCategoryLabel } from "@/lib/finance/cash/categories";
import { isUuid } from "@/lib/finance/cash/input";
import {
  addMonths,
  budgetVsActualRows,
  countByMonth,
  vatSummaryRows,
  type BudgetVsActualRaw,
  type VatSummaryRaw,
} from "@/lib/finance/expense-budget";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { DATE_RANGE_FIELDS } from "../filters";
import { memoLabels } from "../labels";
import { applyActorScope, applyDateRange, nameOf, one } from "../query-helpers";
import type { ReportContext, Row } from "../types";
import { defineReport, opts, tid } from "./define";

const KIND_LABEL: Record<string, string> = { income: "Gelir", expense: "Gider", transfer: "Transfer", adjust: "Düzeltme" };
const SOURCE_LABEL: Record<string, string> = {
  manual: "Elle girildi",
  commission: "Komisyon tahsilatı",
  rent: "Kira tahsilatı",
  building: "Aidat tahsilatı",
  owner_payout: "Mülk sahibi ödemesi",
  due: "Aidat",
  recurring: "Düzenli ödeme",
  import: "Ekstreden",
};

const SELECT =
  "id, entry_date, direction, amount, currency, kind, category, title, counterparty, document_url, source_type, created_at, account:finance_accounts!cash_entries_account_fk!inner(name, owner_scope, currency)";

/**
 * Kazanç gizliliği (P12, SN1): `earnings_all` yoksa başka danışmanın carisine bağlı hareket / kalem rapora girmez. Kullanıcı
 * istemcisinde RLS (cash_entries / finance_open_items SELECT) zaten süzer; zamanlanmış teslim servis istemcisiyle çalıştığı için
 * aynı kural sorguda da uygulanır: yalnız "gizli cari" (danışman türünde, kullanıcıya ait olmayan) gömmesi boş kalan satırlar
 * döner (PostgREST anti-join). Kullanıcıya bağlanmamış danışman carisi de gizlidir (DB kuralıyla aynı).
 */
const HIDDEN_PARTY = "gizli_cari";
const hiddenPartyEmbed = (ctx: ReportContext, fk: string): string => (ctx.seeAllEarnings ? "" : `, ${HIDDEN_PARTY}:finance_parties!${fk}(id)`);
function hideForeignAdvisorRows<Q>(ctx: ReportContext, query: Q): Q {
  if (ctx.seeAllEarnings) return query;
  const q = query as unknown as {
    eq: (c: string, v: unknown) => unknown;
    or: (f: string, o: { referencedTable: string }) => unknown;
    is: (c: string, v: null) => unknown;
  };
  const step1 = q.eq(`${HIDDEN_PARTY}.kind`, "danisman") as typeof q;
  const step2 = step1.or(`user_id.is.null,user_id.neq.${ctx.userId}`, { referencedTable: HIDDEN_PARTY }) as typeof q;
  return step2.is(HIDDEN_PARTY, null) as unknown as Q;
}

/** Bellekte süzülen (hesaplanan) raporlar için gizli danışman carilerinin kimlikleri; `earnings_all` varsa boş küme. */
async function hiddenAdvisorPartyIds(ctx: ReportContext): Promise<Set<string>> {
  if (ctx.seeAllEarnings) return new Set();
  const hit = ctx.memo.get("finance:hiddenAdvisorParties") as Set<string> | undefined;
  if (hit) return hit;
  const { data } = await ctx.supabase
    .from("finance_parties")
    .select("id")
    .eq("tenant_id", tid(ctx))
    .eq("kind", "danisman")
    .or(`user_id.is.null,user_id.neq.${ctx.userId}`);
  const ids = new Set(((data ?? []) as Row[]).map((r) => String(r.id)));
  ctx.memo.set("finance:hiddenAdvisorParties", ids);
  return ids;
}

export const hesapEkstresi = defineReport({
  id: "hesap-ekstresi",
  title: "Hesap ekstresi (kasa / banka)",
  description: "Kasa ve banka hesaplarının hareket dökümü: giriş, çıkış, transfer ve tahsilat bağları. İptal edilen hareketler hariçtir; kişisel hesapları yalnız sahibi görür.",
  category: "finans",
  scope: "tenant",
  module: "reports",
  personalData: true,
  keywords: ["kasa", "banka", "ekstre", "hareket", "bakiye"],
  filters: [
    { kind: "text", key: "hesap", label: "Hesap adı", placeholder: "ör. Ofis kasası" },
    { kind: "select", key: "tur", label: "Tür", options: opts({ income: "Gelir", expense: "Gider", transfer: "Transfer" }) },
    ...DATE_RANGE_FIELDS("Hareket başlangıcı", "Hareket bitişi"),
  ],
  columns: [
    { key: "tarih", label: "Tarih", type: "date", get: (r) => r.entry_date },
    { key: "hesap", label: "Hesap", type: "text", width: 24, get: (r) => one(r.account)?.name },
    { key: "tur", label: "Tür", type: "text", width: 12, get: (r) => KIND_LABEL[String(r.kind)] ?? r.kind },
    { key: "baslik", label: "Açıklama", type: "text", width: 32, get: (r) => r.title },
    { key: "kategori", label: "Ne için", type: "text", width: 18, get: (r) => cashCategoryLabel(r.category) },
    { key: "karsi", label: "Karşı taraf", type: "text", width: 22, get: (r) => r.counterparty },
    { key: "giris", label: "Giriş", type: "money", total: true, get: (r) => (r.direction === "in" ? r.amount : null) },
    { key: "cikis", label: "Çıkış", type: "money", total: true, get: (r) => (r.direction === "out" ? r.amount : null) },
    { key: "kaynak", label: "Kaynak", type: "text", width: 20, get: (r) => SOURCE_LABEL[String(r.source_type)] ?? r.source_type },
    { key: "belge", label: "Belge bağlantısı", type: "text", width: 30, get: (r) => r.document_url },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase.from("cash_entries").select(SELECT + hiddenPartyEmbed(ctx, "cash_entries_party_id_fkey"), { count: "exact" }).eq("tenant_id", tid(ctx)).is("voided_at", null);
      q = applyActorScope(ctx, q, { actorColumn: "created_by" });
      q = hideForeignAdvisorRows(ctx, q);
      if (f.hesap) q = q.ilike("account.name", `%${f.hesap.replace(/[%,()*\\]/g, " ").trim()}%`);
      if (f.tur) q = q.eq("kind", f.tur);
      q = applyDateRange(q, "entry_date", f);
      return q.order("entry_date", { ascending: false }).order("id", { ascending: true });
    },
  },
});

export const gelirGiderDokumu = defineReport({
  id: "gelir-gider-dokumu",
  title: "Gelir-gider dökümü (kasa)",
  description: "Hesaplara işlenen gelir ve giderlerin dökümü (transfer ve düzeltme hariç). Varsayılan ofis hesaplarıdır; kişisel hesaplar ofis sonucuna girmez ve ayrı seçilir.",
  category: "finans",
  scope: "tenant",
  module: "reports",
  personalData: true,
  keywords: ["gelir", "gider", "kasa", "nakit"],
  filters: [
    { kind: "select", key: "kapsam", label: "Hesap kapsamı", options: opts({ ofis: "Ofis hesapları", kisisel: "Kişisel hesaplarım" }) },
    { kind: "select", key: "tur", label: "Tür", options: opts({ income: "Gelir", expense: "Gider" }) },
    ...DATE_RANGE_FIELDS("Başlangıç", "Bitiş"),
  ],
  columns: [
    { key: "tarih", label: "Tarih", type: "date", get: (r) => r.entry_date },
    { key: "hesap", label: "Hesap", type: "text", width: 24, get: (r) => one(r.account)?.name },
    { key: "baslik", label: "Açıklama", type: "text", width: 32, get: (r) => r.title },
    { key: "kategori", label: "Ne için", type: "text", width: 18, get: (r) => cashCategoryLabel(r.category) },
    { key: "karsi", label: "Karşı taraf", type: "text", width: 22, get: (r) => r.counterparty },
    { key: "gelir", label: "Gelir", type: "money", total: true, get: (r) => (r.kind === "income" ? r.amount : null) },
    { key: "gider", label: "Gider", type: "money", total: true, get: (r) => (r.kind === "expense" ? r.amount : null) },
    { key: "para", label: "Para birimi", type: "text", width: 10, get: (r) => r.currency },
    { key: "kaynak", label: "Kaynak", type: "text", width: 20, get: (r) => SOURCE_LABEL[String(r.source_type)] ?? r.source_type },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("cash_entries")
        .select(SELECT + hiddenPartyEmbed(ctx, "cash_entries_party_id_fkey"), { count: "exact" })
        .eq("tenant_id", tid(ctx))
        .is("voided_at", null)
        .in("kind", ["income", "expense"]);
      q = applyActorScope(ctx, q, { actorColumn: "created_by" });
      q = hideForeignAdvisorRows(ctx, q);
      q = q.eq("account.owner_scope", f.kapsam === "kisisel" ? "user" : "office");
      if (f.tur) q = q.eq("kind", f.tur);
      q = applyDateRange(q, "entry_date", f);
      return q.order("entry_date", { ascending: false }).order("id", { ascending: true });
    },
  },
});

/* ================================================================================================
 * Muhasebe v2 (FN6) raporları: cari ekstresi, açık kalemler, KDV özeti, nakit akışı tahmini, bütçe ↔ gerçekleşen,
 * muhasebeci paketi. Modül `expenses` (Muhasebe). Ofis geneli finans verisi oldukları için hesaplanan raporlar
 * `officeWideOnly`; RPC'ler (security definer) kiracıyı `current_tenant_id()` ile ayrıca sınırlar. Dokunulan her
 * tabloda `tenant_id` süzgeci vardır (kapsam sözleşmesi). Şema (FN1) yoksa rapor boş döner, hata vermez.
 * ============================================================================================== */

type DbErr = { message?: string; code?: string } | null;
type RpcOut = { data: unknown; error: DbErr };

/** RPC çağrısı: hata ya da şema yoksa boş satır (rapor kırılmaz). */
async function rpcRows(ctx: ReportContext, fn: string, args: Record<string, unknown>): Promise<Row[]> {
  const res = (await Promise.resolve(ctx.supabase.rpc(fn, args)).catch(() => ({ data: null, error: { message: "rpc" } }))) as RpcOut;
  if (res.error || !Array.isArray(res.data)) return [];
  return res.data as Row[];
}

const todayKey = () => trDayKey(now());
const yearStart = () => `${todayKey().slice(0, 4)}-01-01`;
const n2 = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);

const PARTY_KIND: Record<string, string> = { musteri: "Müşteri", malik: "Mülk sahibi", kiraci: "Kiracı", tedarikci: "Tedarikçi", danisman: "Danışman", diger: "Diğer" };
const DOC_TYPE: Record<string, string> = {
  entry: "Hareket",
  cash_entry: "Hareket",
  open_item: "Vade kaydı",
  receivable: "Alacak kaydı",
  payable: "Borç kaydı",
  settlement: "Tahsilat / ödeme",
  rent: "Kira tahakkuku",
  commission: "Komisyon",
};
const OPEN_DIR: Record<string, string> = { receivable: "Alacak", payable: "Borç" };
const OPEN_STATUS: Record<string, string> = { open: "Açık", partial: "Kısmi ödendi", paid: "Ödendi", cancelled: "İptal" };
const OPEN_SOURCE: Record<string, string> = { manual: "Elle", rent: "Kira", commission: "Komisyon", recurring: "Düzenli ödeme", owner_payout: "Mülk sahibi ödemesi", invoice: "Fatura" };

/** Ofis carilerinin adlarını tek sorguda `ctx.names`'e yazar (kiracı süzgeçli). */
async function fillPartyNames(ctx: ReportContext, ids: Iterable<string | null | undefined>): Promise<void> {
  const need = [...new Set([...ids].filter((v): v is string => !!v && !ctx.names.has(v)))];
  for (let i = 0; i < need.length; i += 150) {
    const { data } = await ctx.supabase.from("finance_parties").select("id, name").eq("tenant_id", tid(ctx)).in("id", need.slice(i, i + 150));
    for (const r of (data ?? []) as Row[]) ctx.names.set(String(r.id), String(r.name ?? ""));
  }
}

/** Kategori etiketleri: sistem hareket kategorileri + gider tanımları + ofis kategorileri (kiracı süzgeçli). */
async function categoryLabels(ctx: ReportContext): Promise<(v: unknown) => string> {
  const hit = ctx.memo.get("finance:catLabels") as Map<string, string> | undefined;
  const map = hit ?? new Map<string, string>(Object.entries(memoLabels(ctx, "expense_category")));
  if (!hit) {
    const { data } = await ctx.supabase.from("finance_categories").select("key, label").eq("tenant_id", tid(ctx));
    for (const r of (data ?? []) as Row[]) map.set(String(r.key), String(r.label ?? r.key));
    ctx.memo.set("finance:catLabels", map);
  }
  return (v: unknown) => {
    const key = String(v ?? "");
    if (!key) return "";
    const cash = cashCategoryLabel(key);
    return cash !== key ? cash : (map.get(key) ?? key);
  };
}

export const cariEkstresi = defineReport({
  id: "cari-ekstresi",
  title: "Cari ekstresi",
  description: "Kişi ve firma (cari) bazında borç, alacak ve yürüyen bakiye: hareketler, vade kayıtları ve tahsilat/ödemeler. Cari adı ya da cari sayfasından gelen kimlikle süzülür.",
  category: "finans",
  scope: "tenant",
  module: "expenses",
  officeWideOnly: true,
  personalData: true,
  keywords: ["cari", "ekstre", "bakiye", "borç", "alacak", "müşteri", "tedarikçi"],
  filters: [{ kind: "text", key: "cari", label: "Cari adı", placeholder: "ör. Yılmaz Emlak" }, ...DATE_RANGE_FIELDS("Ekstre başlangıcı", "Ekstre bitişi")],
  columns: [
    { key: "cari", label: "Cari", type: "text", width: 26, get: (r) => r.party_name },
    { key: "tur", label: "Cari türü", type: "text", width: 14, get: (r) => PARTY_KIND[String(r.party_kind)] ?? r.party_kind },
    { key: "tarih", label: "Tarih", type: "date", get: (r) => r.d },
    { key: "belge", label: "Belge", type: "text", width: 16, get: (r) => DOC_TYPE[String(r.doc_type)] ?? r.doc_type },
    { key: "aciklama", label: "Açıklama", type: "text", width: 32, get: (r) => r.title },
    { key: "borc", label: "Borç", type: "money", total: true, get: (r) => n2(r.debit) },
    { key: "alacak", label: "Alacak", type: "money", total: true, get: (r) => n2(r.credit) },
    { key: "bakiye", label: "Bakiye", type: "money", get: (r) => n2(r.running_balance) },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      let q = ctx.supabase.from("finance_parties").select("id, name, kind").eq("tenant_id", tid(ctx)).is("archived_at", null);
      const term = (f.cari ?? "").trim();
      const byId: boolean = isUuid(term);
      if (byId) q = q.eq("id", term);
      else if (term) q = q.ilike("name", `%${term.replace(/[%,()*\\]/g, " ").trim()}%`);
      const { data, error } = await q.order("name", { ascending: true }).limit(50);
      if (error) return [];
      const from = f.from ?? yearStart();
      const to = f.to ?? todayKey();
      const parties = (data ?? []) as Row[];
      const out: Row[] = [];
      // Sınırlı eşzamanlılık (5'erli): 50 cariyi sırayla beklemek yerine; sıra (cari adı) korunur.
      for (let i = 0; i < parties.length; i += 5) {
        const chunk = parties.slice(i, i + 5);
        const results = await Promise.all(chunk.map((p) => rpcRows(ctx, "finance_party_statement", { p_party_id: p.id, p_from: from, p_to: to })));
        chunk.forEach((p, j) => {
          for (const l of results[j]) out.push({ ...l, party_name: p.name, party_kind: p.kind });
        });
      }
      return out;
    },
  },
});

export const acikKalemler = defineReport({
  id: "acik-kalemler",
  title: "Açık kalemler (alacak / borç)",
  description: "Vadeli alacak ve borç kayıtları: vade, tutar, ödenen, kalan ve gecikme günü. Varsayılan açık ve kısmi ödenmiş kalemlerdir; kira tahakkukları kendi raporundadır.",
  category: "finans",
  scope: "tenant",
  module: "expenses",
  personalData: true,
  keywords: ["vade", "alacak", "borç", "tahsilat", "yaşlandırma", "açık kalem"],
  filters: [
    { kind: "select", key: "yon", label: "Yön", options: opts({ receivable: "Alacak", payable: "Borç" }) },
    { kind: "select", key: "durum", label: "Durum", options: opts({ acik: "Açık + kısmi", paid: "Ödendi", cancelled: "İptal", tumu: "Tümü" }) },
    ...DATE_RANGE_FIELDS("Vade başlangıcı", "Vade bitişi"),
  ],
  columns: [
    { key: "vade", label: "Vade", type: "date", get: (r) => r.due_date },
    { key: "yon", label: "Yön", type: "text", width: 10, get: (r) => OPEN_DIR[String(r.direction)] ?? r.direction },
    { key: "baslik", label: "Açıklama", type: "text", width: 32, get: (r) => r.title },
    { key: "cari", label: "Cari", type: "text", width: 24, get: (r, c) => nameOf(c, r.party_id) },
    { key: "tutar", label: "Tutar", type: "money", total: true, get: (r) => n2(r.amount) },
    { key: "odenen", label: "Ödenen", type: "money", total: true, get: (r) => n2(r.paid_amount) },
    { key: "kalan", label: "Kalan", type: "money", total: true, get: (r) => (n2(r.amount) ?? 0) - (n2(r.paid_amount) ?? 0) },
    { key: "gecikme", label: "Gecikme (gün)", type: "number", get: (r) => overdueDays(r) },
    { key: "durum", label: "Durum", type: "text", width: 14, get: (r) => OPEN_STATUS[String(r.status)] ?? r.status },
    { key: "kaynak", label: "Kaynak", type: "text", width: 16, get: (r) => OPEN_SOURCE[String(r.source_type ?? "manual")] ?? r.source_type },
    { key: "para", label: "Para birimi", type: "text", width: 10, get: (r) => r.currency },
  ],
  source: {
    kind: "query",
    build: (ctx, f) => {
      let q = ctx.supabase
        .from("finance_open_items")
        .select(
          `id, direction, party_id, title, amount, currency, due_date, paid_amount, status, source_type, created_by${hiddenPartyEmbed(ctx, "finance_open_items_party_id_fkey")}`,
          { count: "exact" },
        )
        .eq("tenant_id", tid(ctx));
      q = applyActorScope(ctx, q, { actorColumn: "created_by", sample: true });
      q = hideForeignAdvisorRows(ctx, q);
      if (f.yon) q = q.eq("direction", f.yon);
      if (!f.durum || f.durum === "acik") q = q.in("status", ["open", "partial"]);
      else if (f.durum !== "tumu") q = q.eq("status", f.durum);
      q = applyDateRange(q, "due_date", f);
      return q.order("due_date", { ascending: true }).order("id", { ascending: true });
    },
    enrich: async (rows, ctx) => {
      await fillPartyNames(ctx, rows.map((r) => r.party_id as string | null));
    },
  },
});

function overdueDays(r: Row): number | null {
  if (r.status !== "open" && r.status !== "partial") return null;
  const due = String(r.due_date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const diff = Math.floor((Date.parse(`${todayKey()}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
  return diff > 0 ? diff : 0;
}

export const kdvOzeti = defineReport({
  id: "kdv-ozeti",
  title: "KDV özeti (aylık)",
  description: "Ay bazında hesaplanan KDV, indirilecek KDV, ödenecek KDV (hesaplanan − indirilecek), kesilen ve ödenen stopaj ile KDV bilgisi olmayan hareket sayısı. Bilgi amaçlıdır.",
  category: "finans",
  scope: "tenant",
  module: "expenses",
  officeWideOnly: true,
  keywords: ["kdv", "vergi", "stopaj", "beyanname", "muhtasar"],
  filters: [...DATE_RANGE_FIELDS("Başlangıç", "Bitiş")],
  columns: [
    { key: "ay", label: "Ay", type: "text", width: 10, get: (r) => r.label },
    { key: "hesaplanan", label: "Hesaplanan KDV", type: "money", total: true, get: (r) => r.outputVat },
    { key: "indirilecek", label: "İndirilecek KDV", type: "money", total: true, get: (r) => r.inputVat },
    { key: "odenecek", label: "Ödenecek KDV", type: "money", total: true, get: (r) => r.payable },
    { key: "kesilen", label: "Kesilen stopaj", type: "money", total: true, get: (r) => r.withholdingCollected },
    { key: "odenen", label: "Ödenen stopaj", type: "money", total: true, get: (r) => r.withholdingPaid },
    { key: "kdvsiz", label: "KDV bilgisi yok (hareket)", type: "number", total: true, get: (r) => r.noVat },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const from = f.from ?? yearStart();
      const to = f.to ?? todayKey();
      const [vat, noVat] = await Promise.all([
        rpcRows(ctx, "finance_vat_summary", { p_from: from, p_to: to }),
        fetchAllRows<Row>((a, b) =>
          ctx.supabase
            .from("cash_entries")
            .select("id, entry_date, account:finance_accounts!cash_entries_account_fk!inner(owner_scope)")
            .eq("tenant_id", tid(ctx))
            .eq("account.owner_scope", "office")
            .eq("currency", "TRY")
            .eq("is_sample", false)
            .is("vat_rate", null)
            .is("voided_at", null)
            .in("kind", ["income", "expense"])
            .gte("entry_date", from)
            .lte("entry_date", to)
            .order("id", { ascending: true })
            .range(a, b),
        ),
      ]);
      const rows = vatSummaryRows(vat as VatSummaryRaw[]);
      const counts = noVat.error ? new Map<string, number>() : countByMonth(noVat.data.map((r) => r.entry_date as string));
      const months = [...new Set([...rows.map((r) => r.month), ...counts.keys()])].sort();
      const byMonth = new Map(rows.map((r) => [r.month, r]));
      return months.map((m) => {
        const r = byMonth.get(m);
        return {
          label: `${m.slice(5, 7)}.${m.slice(0, 4)}`,
          outputVat: r?.outputVat ?? 0,
          inputVat: r?.inputVat ?? 0,
          payable: r?.payable ?? 0,
          withholdingCollected: r?.withholdingCollected ?? 0,
          withholdingPaid: r?.withholdingPaid ?? 0,
          noVat: counts.get(m) ?? 0,
        };
      });
    },
  },
});

export const nakitAkisTahmini = defineReport({
  id: "nakit-akis-tahmini",
  title: "Nakit akışı tahmini",
  description: "Önümüzdeki 30 ya da 90 gün için günlük beklenen giriş, çıkış ve bakiye: hesap bakiyeleri, açık alacak/borçlar, kira tahakkukları, komisyonlar ve düzenli ödemeler. Yalnız TL hesaplar; tahmindir.",
  category: "finans",
  scope: "tenant",
  module: "expenses",
  officeWideOnly: true,
  keywords: ["nakit", "tahmin", "bakiye", "likidite", "forecast"],
  filters: [{ kind: "select", key: "gun", label: "Süre", options: opts({ "30": "30 gün", "90": "90 gün" }) }],
  columns: [
    { key: "tarih", label: "Tarih", type: "date", get: (r) => r.d },
    { key: "giris", label: "Beklenen giriş", type: "money", total: true, get: (r) => n2(r.inflow) },
    { key: "cikis", label: "Beklenen çıkış", type: "money", total: true, get: (r) => n2(r.outflow) },
    { key: "bakiye", label: "Bakiye", type: "money", get: (r) => n2(r.balance) },
    { key: "tur", label: "Tür", type: "text", width: 12, get: (r) => (r.is_actual ? "Gerçekleşen" : "Tahmin") },
    { key: "esik", label: "Uyarı eşiğinin altında", type: "bool", get: (r) => r.below },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const days = f.gun === "90" ? 90 : 30;
      const [settings, points] = await Promise.all([
        ctx.supabase.from("finance_settings").select("forecast_min_balance").eq("tenant_id", tid(ctx)).maybeSingle(),
        rpcRows(ctx, "finance_cashflow_forecast", { p_days: days, p_rates: null }),
      ]);
      const min = n2((settings?.data as Row | null)?.forecast_min_balance);
      return points.map((p) => ({ ...p, below: min != null && Number(p.balance) < min }));
    },
  },
});

export const butceGerceklesen = defineReport({
  id: "butce-gerceklesen",
  title: "Bütçe ↔ gerçekleşen",
  description: "Aylık gelir hedefi ve gider bütçesi ile gerçekleşen tutarlar: fark ve gerçekleşme oranı. Bütçesi olmayan ama harcama yapılan kategoriler de listelenir.",
  category: "finans",
  scope: "tenant",
  module: "expenses",
  officeWideOnly: true,
  keywords: ["bütçe", "hedef", "gerçekleşen", "sapma"],
  filters: [{ kind: "select", key: "donem", label: "Dönem", options: opts({ "1": "Bu ay", "3": "Son 3 ay", "6": "Son 6 ay", "12": "Son 12 ay" }) }],
  columns: [
    { key: "ay", label: "Ay", type: "text", width: 10, get: (r) => r.label },
    { key: "yon", label: "Tür", type: "text", width: 14, get: (r) => (r.direction === "in" ? "Gelir hedefi" : "Gider bütçesi") },
    { key: "kategori", label: "Kategori", type: "text", width: 22, get: (r) => r.categoryLabel },
    { key: "butce", label: "Bütçe / hedef", type: "money", total: true, get: (r) => r.budget },
    { key: "gercek", label: "Gerçekleşen", type: "money", total: true, get: (r) => r.actual },
    { key: "fark", label: "Fark", type: "money", total: true, get: (r) => r.remaining },
    { key: "oran", label: "Gerçekleşme", type: "percent", decimals: 0, get: (r) => (r.budget > 0 ? Math.round(r.ratio * 1000) / 10 : null) },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const span = [1, 3, 6, 12].includes(Number(f.donem)) ? Number(f.donem) : 1;
      const current = trMonthKey(now());
      const first = addMonths(current, -(span - 1));
      const [labelOf, budgets] = await Promise.all([
        categoryLabels(ctx),
        ctx.supabase.from("finance_budgets").select("period_month").eq("tenant_id", tid(ctx)).gte("period_month", `${first}-01`),
      ]);
      const months = new Set<string>([current]);
      for (const b of ((budgets?.data ?? []) as Row[])) months.add(String(b.period_month).slice(0, 7));
      const out: Row[] = [];
      for (const m of [...months].filter((k) => k >= first && k <= current).sort().reverse()) {
        const rows = budgetVsActualRows((await rpcRows(ctx, "finance_budget_vs_actual", { p_month: `${m}-01` })) as BudgetVsActualRaw[]);
        for (const r of rows) out.push({ ...r, label: `${m.slice(5, 7)}.${m.slice(0, 4)}`, categoryLabel: labelOf(r.category) });
      }
      return out;
    },
  },
});

const LEDGER_COLS = "id, entry_date, kind, category, title, counterparty, direction, amount, currency";
const LEDGER_TERM_COLS = ", party_id, vat_rate, vat_amount, withholding_amount";

/**
 * Muhasebeci paketinin defteri: ofis hesaplarının hareketleri + deftere bağlanmamış eski giderler ("Hesapsız").
 * Önce birleşik defter görünümü (finance_ledger_v, FN1) okunur; yoksa cash_entries + bağsız `expenses` satırlarına dönülür.
 * Örnek (demo) kayıtlar ve iptal edilen hareketler pakete girmez.
 */
async function readOfficeLedger(ctx: ReportContext, from: string, to: string): Promise<Row[]> {
  const accounts = await ctx.supabase.from("finance_accounts").select("id, name, owner_scope").eq("tenant_id", tid(ctx));
  const office = new Map<string, string>();
  for (const a of ((accounts.data ?? []) as Row[])) if (a.owner_scope === "office") office.set(String(a.id), String(a.name ?? ""));

  const view = await fetchAllRows<Row>((a, b) =>
    ctx.supabase
      .from("finance_ledger_v")
      .select(`origin, account_id, ${LEDGER_COLS}${LEDGER_TERM_COLS}`)
      .eq("tenant_id", tid(ctx))
      .eq("is_sample", false)
      .is("voided_at", null)
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: true })
      .order("id", { ascending: true })
      .range(a, b),
  );
  let rows: Row[];
  if (!view.error) {
    rows = view.data
      .filter((r) => r.origin === "legacy_expense" || office.has(String(r.account_id)))
      .map((r) => ({ ...r, account_name: r.account_id ? office.get(String(r.account_id)) : null }));
  } else {
    // Görünüm yok (FN1 uygulanmadı): hareketler + bağsız eski giderler ayrı okunur.
    const readEntries = (cols: string) =>
      fetchAllRows<Row>((a, b) =>
        ctx.supabase
          .from("cash_entries")
          .select(`${LEDGER_COLS}${cols}, account:finance_accounts!cash_entries_account_fk!inner(name, owner_scope)`)
          .eq("tenant_id", tid(ctx))
          .eq("account.owner_scope", "office")
          .eq("is_sample", false)
          .is("voided_at", null)
          .gte("entry_date", from)
          .lte("entry_date", to)
          .order("entry_date", { ascending: true })
          .order("id", { ascending: true })
          .range(a, b),
      );
    let entries = await readEntries(LEDGER_TERM_COLS);
    if (entries.error) entries = await readEntries("");
    rows = entries.error ? [] : entries.data.map((r) => ({ ...r, origin: "entry", account_name: one(r.account)?.name ?? null }));
    rows.push(...(await readLegacyExpenses(ctx, from, to)));
    rows.sort((x, y) => String(x.entry_date).localeCompare(String(y.entry_date)) || String(x.id).localeCompare(String(y.id)));
  }
  const hidden = await hiddenAdvisorPartyIds(ctx);
  if (hidden.size > 0) rows = rows.filter((r) => !r.party_id || !hidden.has(String(r.party_id)));
  await fillPartyNames(ctx, rows.map((r) => r.party_id as string | null));
  return rows;
}

/** Hiçbir (iptal edilmemiş) harekete bağlanmamış eski ofis giderleri — finance_ledger_v'nin 'legacy_expense' kolu. */
async function readLegacyExpenses(ctx: ReportContext, from: string, to: string): Promise<Row[]> {
  const res = await fetchAllRows<Row>((a, b) =>
    ctx.supabase
      .from("expenses")
      .select("id, expense_date, category, title, amount, currency")
      .eq("tenant_id", tid(ctx))
      .eq("is_sample", false)
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("id", { ascending: true })
      .range(a, b),
  );
  if (res.error || res.data.length === 0) return [];
  const linked = new Set<string>();
  const ids = res.data.map((r) => String(r.id));
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await ctx.supabase.from("cash_entries").select("expense_id").eq("tenant_id", tid(ctx)).is("voided_at", null).in("expense_id", ids.slice(i, i + 150));
    for (const r of (data ?? []) as Row[]) linked.add(String(r.expense_id));
  }
  return res.data
    .filter((r) => !linked.has(String(r.id)))
    .map((r) => ({ ...r, origin: "legacy_expense", entry_date: r.expense_date, kind: "expense", direction: "out", account_name: null }));
}

export const muhasebeciPaketi = defineReport({
  id: "muhasebeci-paketi",
  title: "Muhasebeci paketi",
  description: "Mali müşavire teslim dosyası: dönemin defteri (ofis hesapları), cari bakiyeler, aylık KDV özeti ve açık alacak/borç kalemleri. Excel dosyasında her bölüm ayrı sayfadır (Defter, Cari, KDV, Açık kalemler); bilgi amaçlıdır.",
  category: "finans",
  scope: "tenant",
  module: "expenses",
  officeWideOnly: true,
  personalData: true,
  keywords: ["muhasebeci", "mali müşavir", "defter", "teslim", "kdv", "cari", "excel"],
  xlsxSheetBy: "bolum",
  filters: [{ kind: "select", key: "bolum", label: "Bölüm", options: opts({ defter: "Defter", cari: "Cari bakiyeler", kdv: "KDV özeti", acik: "Açık kalemler" }) }, ...DATE_RANGE_FIELDS("Dönem başlangıcı", "Dönem bitişi")],
  columns: [
    { key: "bolum", label: "Bölüm", type: "text", width: 14, get: (r) => r.section },
    { key: "tarih", label: "Tarih / vade", type: "date", get: (r) => r.date },
    { key: "tur", label: "Tür", type: "text", width: 14, get: (r) => r.kind },
    { key: "aciklama", label: "Açıklama", type: "text", width: 32, get: (r) => r.title },
    { key: "cari", label: "Cari / karşı taraf", type: "text", width: 24, get: (r) => r.party },
    { key: "kategori", label: "Kategori", type: "text", width: 18, get: (r) => r.category },
    { key: "hesap", label: "Hesap", type: "text", width: 18, get: (r) => r.account },
    { key: "giris", label: "Giriş / alacak", type: "money", get: (r) => r.debit },
    { key: "cikis", label: "Çıkış / borç", type: "money", get: (r) => r.credit },
    { key: "kdvoran", label: "KDV oranı", type: "percent", decimals: 0, get: (r) => r.vatRate },
    { key: "kdv", label: "KDV", type: "money", get: (r) => r.vat },
    { key: "stopaj", label: "Stopaj (KDV satırında: ödenen)", type: "money", get: (r) => r.withholding },
    { key: "bakiye", label: "Bakiye / kalan", type: "money", get: (r) => r.balance },
    { key: "para", label: "Para birimi", type: "text", width: 10, get: (r) => r.currency },
  ],
  source: {
    kind: "compute",
    run: async (ctx, f) => {
      const from = f.from ?? `${todayKey().slice(0, 7)}-01`;
      const to = f.to ?? todayKey();
      const want = (s: string) => !f.bolum || f.bolum === s;
      const labelOf = await categoryLabels(ctx);
      const out: Row[] = [];

      if (want("defter")) {
        for (const r of await readOfficeLedger(ctx, from, to)) {
          out.push({
            section: "Defter",
            date: r.entry_date,
            kind: r.origin === "legacy_expense" ? "Gider (hesapsız)" : (KIND_LABEL[String(r.kind)] ?? r.kind),
            title: r.title,
            party: nameOf(ctx, r.party_id) || r.counterparty,
            category: labelOf(r.category),
            account: r.account_name ?? (r.origin === "legacy_expense" ? "Hesapsız" : null),
            debit: r.direction === "in" ? n2(r.amount) : null,
            credit: r.direction === "out" ? n2(r.amount) : null,
            vatRate: n2(r.vat_rate),
            vat: n2(r.vat_amount),
            withholding: n2(r.withholding_amount),
            balance: null,
            currency: r.currency,
          });
        }
      }

      if (want("cari")) {
        for (const p of await rpcRows(ctx, "finance_party_balances", { p_kind: null, p_q: null })) {
          out.push({
            section: "Cari",
            date: p.last_activity,
            kind: PARTY_KIND[String(p.kind)] ?? p.kind,
            title: "Cari bakiye",
            party: p.name,
            category: null,
            account: null,
            debit: n2(p.receivable_open),
            credit: n2(p.payable_open),
            vatRate: null,
            vat: null,
            withholding: null,
            balance: n2(p.balance),
            currency: "TRY",
          });
        }
      }

      if (want("kdv")) {
        for (const v of vatSummaryRows((await rpcRows(ctx, "finance_vat_summary", { p_from: from, p_to: to })) as VatSummaryRaw[])) {
          out.push({
            section: "KDV",
            date: `${v.month}-01`,
            kind: v.payable >= 0 ? "Ödenecek KDV" : "Devreden KDV",
            title: `Hesaplanan ${v.outputVat.toFixed(2)} − indirilecek ${v.inputVat.toFixed(2)}`,
            party: null,
            category: null,
            account: null,
            debit: v.outputVat,
            credit: v.inputVat,
            vatRate: null,
            vat: v.payable,
            // Ödenen stopaj (sizin kestiğiniz, örn. kira) bu satırda; müşterinin kestiği stopaj aşağıda ayrı satırdır.
            withholding: v.withholdingPaid,
            balance: v.payable,
            currency: "TRY",
          });
          if (v.withholdingCollected > 0) {
            out.push({
              section: "KDV",
              date: `${v.month}-01`,
              kind: "Kesilen stopaj",
              title: "Müşterinin tahsilatınızdan kestiği stopaj (mahsup edilebilir)",
              party: null,
              category: null,
              account: null,
              debit: null,
              credit: null,
              vatRate: null,
              vat: null,
              withholding: v.withholdingCollected,
              balance: null,
              currency: "TRY",
            });
          }
        }
      }

      if (want("acik")) {
        const items = await fetchAllRows<Row>((a, b) =>
          ctx.supabase
            .from("finance_open_items")
            .select("id, direction, party_id, title, category, amount, paid_amount, currency, due_date, status, vat_rate, vat_amount, withholding_amount")
            .eq("tenant_id", tid(ctx))
            .eq("is_sample", false)
            .in("status", ["open", "partial"])
            .order("due_date", { ascending: true })
            .order("id", { ascending: true })
            .range(a, b),
        );
        if (!items.error) {
          const hidden = await hiddenAdvisorPartyIds(ctx);
          const visible = items.data.filter((r) => !r.party_id || !hidden.has(String(r.party_id)));
          await fillPartyNames(ctx, visible.map((r) => r.party_id as string | null));
          for (const r of visible) {
            const open = (n2(r.amount) ?? 0) - (n2(r.paid_amount) ?? 0);
            out.push({
              section: "Açık kalem",
              date: r.due_date,
              kind: OPEN_DIR[String(r.direction)] ?? r.direction,
              title: r.title,
              party: nameOf(ctx, r.party_id),
              category: labelOf(r.category),
              account: null,
              debit: r.direction === "receivable" ? n2(r.amount) : null,
              credit: r.direction === "payable" ? n2(r.amount) : null,
              vatRate: n2(r.vat_rate),
              vat: n2(r.vat_amount),
              withholding: n2(r.withholding_amount),
              balance: Math.round(open * 100) / 100,
              currency: r.currency,
            });
          }
        }
      }
      return out;
    },
  },
});

export const CASH_REPORTS = [hesapEkstresi, gelirGiderDokumu, cariEkstresi, acikKalemler, kdvOzeti, nakitAkisTahmini, butceGerceklesen, muhasebeciPaketi];
