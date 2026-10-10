/**
 * Ofis raporları — kasa / banka (Finans Paket A): hesap ekstresi ve gelir-gider dökümü.
 * Kiracı sınırı sorguda; aktör kapsamı `applyActorScope` (created_by). Kişisel hesap hareketlerini veritabanı (RLS) yalnız
 * sahibine verir; maaş kategorisi ofis hesaplarında yalnız owner/gm'ye gelir. Modül `reports`: danışman kendi kişisel
 * hesabının ekstresini alabilir; ofis hesapları RLS ile `expenses` yetkisine bağlı kalır.
 */
import { cashCategoryLabel } from "@/lib/finance/cash/categories";
import { DATE_RANGE_FIELDS } from "../filters";
import { applyActorScope, applyDateRange, one } from "../query-helpers";
import { defineReport, opts, tid } from "./define";

const KIND_LABEL: Record<string, string> = { income: "Gelir", expense: "Gider", transfer: "Transfer", adjust: "Düzeltme" };
const SOURCE_LABEL: Record<string, string> = {
  manual: "Elle girildi",
  commission: "Komisyon tahsilatı",
  rent: "Kira tahsilatı",
  building: "Aidat tahsilatı",
  due: "Aidat",
  recurring: "Düzenli ödeme",
  import: "Ekstreden",
};

const SELECT =
  "id, entry_date, direction, amount, currency, kind, category, title, counterparty, document_url, source_type, created_at, account:finance_accounts!cash_entries_account_fk!inner(name, owner_scope, currency)";

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
      let q = ctx.supabase.from("cash_entries").select(SELECT, { count: "exact" }).eq("tenant_id", tid(ctx)).is("voided_at", null);
      q = applyActorScope(ctx, q, { actorColumn: "created_by" });
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
      let q = ctx.supabase.from("cash_entries").select(SELECT, { count: "exact" }).eq("tenant_id", tid(ctx)).is("voided_at", null).in("kind", ["income", "expense"]);
      q = applyActorScope(ctx, q, { actorColumn: "created_by" });
      q = q.eq("account.owner_scope", f.kapsam === "kisisel" ? "user" : "office");
      if (f.tur) q = q.eq("kind", f.tur);
      q = applyDateRange(q, "entry_date", f);
      return q.order("entry_date", { ascending: false }).order("id", { ascending: true });
    },
  },
});

export const CASH_REPORTS = [hesapEkstresi, gelirGiderDokumu];
