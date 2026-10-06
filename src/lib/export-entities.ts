/**
 * CSV dışa aktarma ortak çekirdeği — hem hızlı server action'lar
 * (`src/app/actions/export.ts`, 2000 satır sınırı) hem tam akış route'u
 * (`/api/export/[entity]`) aynı yetki modülünü, aynı kolon eşlemesini ve aynı
 * CSV kaçışını buradan kullanır. Saf modül: sunucu/istemci bağımlılığı yok.
 */
import { APPOINTMENT_TYPE_LABELS } from "@/lib/appointment-labels";
import { escapeCsvCell } from "@/lib/csv";
import type { AppModule } from "@/lib/permissions";
import { defaultStageLabels, stageLabelMap } from "@/lib/deal-stage-labels";

/** supabase-js gömülü ilişkiyi obje ya da dizi tipler — tek kayda indirge. */
export function relOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** CSV formül enjeksiyonuna dayanıklı tek hücre (tab/CR/=/@/+/- önekleri). */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Excel/Sheets, = @ + - (ve tab/CR) ile başlayan hücreyi FORMÜL sanır. Tehlikeli
  // önekli hücrenin başına ' eklenir. Saf sayılar (negatif tutar dâhil) bozulmasın
  // diye +/- yalnız sayı-olmayan değerlerde korunur.
  const dangerous =
    /^[\t\r\n]/.test(s) || /^\s*[=@]/.test(s) || (/^\s*[+-]/.test(s) && !/^\s*[+-]?[\d.,\s]+$/.test(s));
  if (dangerous) s = `'${s}`;
  return escapeCsvCell(s);
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]!);
  return [keys.join(","), ...rows.map((r) => csvLine(keys.map((k) => r[k])))].join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawRow = Record<string, any>;
export type NameMap = Map<string, string>;

export type ExportEntityDef = {
  /** URL/audit anahtarı (ExportResult.entity ile aynı). */
  slug: string;
  /** requirePermission(module, "view") — export.ts'teki kapıyla aynı. */
  module: AppModule;
  filenameBase: string;
  /** Satırdan danışman/aktör profil kimliği toplamak için (isim çözümü). */
  nameId?: (r: RawRow) => string | null | undefined;
  map: (r: RawRow, names: NameMap) => Record<string, unknown>;
};

const first = (p: { title?: string | null; property_code?: string | null } | null) => p?.title ?? p?.property_code ?? "";

const DEMAND_STATUS_TR: Record<string, string> = { new: "Yeni", active: "Aktif", matched: "Eşleşti", closed: "Kapalı" };
const DEMAND_URGENCY_TR: Record<string, string> = { low: "Düşük", normal: "Normal", high: "Yüksek", urgent: "Acil" };
const APPT_TYPE_TR = APPOINTMENT_TYPE_LABELS;
const APPT_STATUS_TR: Record<string, string> = { pending: "Teyit bekliyor", confirmed: "Onaylandı", signature: "İmza eksik", completed: "Tamamlandı", cancelled: "İptal" };
const PROJECT_STATUS_TR: Record<string, string> = { planning: "Planlama", selling: "Satışta", delivered: "Teslim edildi" };
const REFERRAL_STATUS_TR: Record<string, string> = { yeni: "Yeni", iletisim: "İletişimde", musteri: "Müşteri oldu", kazanildi: "Kazanıldı", kayip: "Kayıp" };

export const mapCustomer = (c: RawRow) => ({
  ad: c.full_name,
  telefon: c.phone,
  email: c.email,
  tur: (c.customer_types ?? []).join("|"),
  etiketler: (c.tags ?? []).join("|"),
  kaynak: c.source,
  kayit: c.created_at,
});
const COMMISSION_STATUS_TR: Record<string, string> = {
  calculated: "Hesaplandı",
  invoiced: "Faturalandı",
  pending: "Bekliyor",
  paid: "Tahsil edildi",
  collected: "Tahsil edildi",
  cancelled: "İptal",
};

type SplitRow = { label?: string; amount?: number | string | null };

/** splits: "Ofis" etiketli satırlar ofis payı, kalanlar danışman payı (kuruşa yuvarlı). Boş/bozuksa null. */
export function commissionShares(splits: unknown): { advisor: number | null; office: number | null } {
  if (!Array.isArray(splits) || splits.length === 0) return { advisor: null, office: null };
  let advisor = 0;
  let office = 0;
  for (const s of splits as SplitRow[]) {
    const amount = Number(s?.amount ?? 0);
    if (!Number.isFinite(amount)) continue;
    if (String(s?.label ?? "").trim().toLocaleLowerCase("tr-TR").startsWith("ofis")) office += amount;
    else advisor += amount;
  }
  return { advisor: Math.round(advisor * 100) / 100, office: Math.round(office * 100) / 100 };
}

/**
 * Komisyon CSV'si (başlık satırı Türkçe). Tahsilat tarihi ve vade sütunları YOK: commissions tablosunda bu alanlar
 * tutulmuyor (yalnız status + created_at); olmayan veriyi boş sütunla vaat etmemek için eklenmedi. Fatura no da yok.
 * "Kayıt Tarihi" = komisyonun oluşturulma tarihi (tahsilat tarihi DEĞİL).
 */
export const mapCommission = (c: RawRow, names?: NameMap) => {
  const deal = relOne(c.deal);
  const property = relOne(deal?.property);
  const shares = commissionShares(c.splits);
  const advisorId = deal?.assigned_to as string | null | undefined;
  return {
    "Portföy Kodu": property?.property_code ?? "",
    "Portföy Başlığı": property?.title ?? "",
    "Danışman": advisorId ? (names?.get(advisorId) ?? "") : "",
    "Brüt Tutar": c.gross_amount,
    "KDV": c.vat_amount,
    "Danışman Payı": shares.advisor ?? "",
    "Ofis Payı": shares.office ?? "",
    "Ödeme Durumu": COMMISSION_STATUS_TR[String(c.status)] ?? c.status ?? "",
    "Kayıt Tarihi": c.created_at,
  };
};
export const mapAudit = (r: RawRow, names: NameMap) => ({
  aksiyon: r.action,
  entity: r.entity_type,
  entity_id: r.entity_id,
  aktor: r.actor_id ? (names.get(r.actor_id) ?? String(r.actor_id).slice(0, 8)) : "",
  eski: r.old_value ? JSON.stringify(r.old_value) : "",
  yeni: r.new_value ? JSON.stringify(r.new_value) : "",
  tarih: r.created_at,
});
export const mapProperty = (p: RawRow, names: NameMap) => ({
  kod: p.property_code,
  baslik: p.title,
  islem: p.transaction_type,
  tip: p.property_type,
  durum: p.status,
  fiyat: p.list_price,
  il: relOne(p.province)?.name ?? "",
  ilce: relOne(p.district)?.name ?? "",
  danisman: p.assigned_to ? (names.get(p.assigned_to) ?? String(p.assigned_to).slice(0, 8)) : "",
  olusturma: p.created_at,
});
export const mapExpense = (e: RawRow) => ({
  baslik: e.title,
  tutar: e.amount,
  kategori: e.category,
  tarih: e.expense_date,
  not: e.notes,
  kayit: e.created_at,
});
export const mapOffer = (o: RawRow) => {
  const property = relOne(o.property);
  const customer = relOne(o.customer);
  return {
    portfoy: first(property),
    portfoy_kodu: property?.property_code ?? "",
    musteri: customer?.full_name ?? "",
    teklif: o.amount,
    karsi_teklif: o.counter_amount,
    durum: o.status,
    tarih: o.created_at,
  };
};
export const mapPortalListing = (l: RawRow) => ({
  portal: l.portal_name,
  ilan_no: l.portal_listing_id,
  portfoy_kodu: relOne(l.property)?.property_code ?? "",
  durum: l.status,
  son_teyit: l.last_confirmed_at,
});
export const mapDemand = (d: RawRow) => ({
  musteri: relOne(d.customer)?.full_name ?? "",
  islem: d.transaction_type,
  tip: d.property_type ?? "",
  butce_min: d.budget_min ?? "",
  butce_max: d.budget_max ?? "",
  oda: d.rooms ?? "",
  min_m2: d.min_sqm ?? "",
  il: relOne(d.province)?.name ?? "",
  aciliyet: d.urgency ? (DEMAND_URGENCY_TR[d.urgency] ?? d.urgency) : "",
  durum: DEMAND_STATUS_TR[d.status] ?? d.status,
  kayit: d.created_at,
});
export const mapAppointment = (a: RawRow) => ({
  tur: APPT_TYPE_TR[a.appointment_type] ?? a.appointment_type,
  tarih: a.scheduled_at,
  sure_dk: a.duration_min ?? "",
  musteri: relOne(a.customer)?.full_name ?? "",
  portfoy: first(relOne(a.property)),
  konum: a.location ?? "",
  durum: APPT_STATUS_TR[a.status] ?? a.status,
});
/** Aşama sütunu: ofisin görünen aşama adları verilirse onlar, yoksa varsayılan adlar (aşama anahtarları sabittir). */
export const mapDealWith = (stageNames: Record<string, string> = stageLabelMap(defaultStageLabels())) => (d: RawRow) => {
  const property = relOne(d.property);
  return {
    asama: stageNames[d.stage] ?? d.stage,
    tur: d.deal_type ?? "",
    deger: d.deal_value ?? "",
    olasilik: d.probability ?? "",
    musteri: relOne(d.customer)?.full_name ?? "",
    portfoy: first(property),
    portfoy_kodu: property?.property_code ?? "",
    guncelleme: d.updated_at,
  };
};
export const mapDeal = mapDealWith();
export const mapProject = (p: RawRow) => {
  const units = (p.units ?? []) as { status: string }[];
  return {
    proje: p.name,
    muteahhit: p.developer_name ?? "",
    konum: p.location ?? "",
    durum: PROJECT_STATUS_TR[p.status] ?? p.status,
    teslim: p.delivery_date ?? "",
    toplam_daire: units.length,
    satilan: units.filter((u) => u.status === "sold").length,
    rezerve: units.filter((u) => u.status === "reserved" || u.status === "deposit").length,
    kayit: p.created_at,
  };
};
export const mapDue = (d: RawRow) => ({
  baslik: d.title,
  portfoy: first(relOne(d.property)),
  tutar: d.amount,
  donem: d.period,
  son_odeme: d.due_date ?? "",
  durum: d.status === "paid" ? "Ödendi" : "Ödenmedi",
  odendi_tarih: d.paid_at ?? "",
});
export const mapContract = (k: RawRow) => ({
  baslik: k.title,
  tur: k.contract_type,
  durum: k.status,
  musteri: relOne(k.customer)?.full_name ?? "",
  portfoy: first(relOne(k.property)),
  olusturuldu: k.created_at,
  imzalandi: k.signed_at ?? "",
  bitis: k.expires_at ?? "",
});
export const mapReferral = (r: RawRow) => ({
  tavsiye_edilen: r.referred_name,
  telefon: r.referred_phone,
  tavsiye_eden: relOne(r.referrer)?.full_name ?? "",
  durum: REFERRAL_STATUS_TR[r.status as string] ?? r.status,
  not: r.referred_note ?? "",
  ofis_notu: r.staff_note ?? "",
  tarih: r.created_at,
});

/**
 * Tam akış dışa aktarmasının desteklediği varlıklar. Kiralama (türetilmiş evre/gecikme
 * hesabı için çapraz tablo gerektirir) yalnız hızlı dışa aktarmada kalır.
 */
export const EXPORT_ENTITIES: Record<string, ExportEntityDef> = {
  musteriler: { slug: "musteriler", module: "customers", filenameBase: "musteriler", map: mapCustomer },
  komisyonlar: { slug: "komisyonlar", module: "commissions", filenameBase: "komisyonlar", nameId: (r) => relOne(r.deal)?.assigned_to, map: mapCommission },
  denetim: { slug: "denetim", module: "settings", filenameBase: "denetim", nameId: (r) => r.actor_id, map: mapAudit },
  portfoyler: { slug: "portfoyler", module: "properties", filenameBase: "portfoyler", nameId: (r) => r.assigned_to, map: mapProperty },
  giderler: { slug: "giderler", module: "expenses", filenameBase: "giderler", map: mapExpense },
  teklifler: { slug: "teklifler", module: "offers", filenameBase: "teklifler", map: mapOffer },
  "portal-ilanlari": { slug: "portal-ilanlari", module: "portals", filenameBase: "portal-ilanlari", map: mapPortalListing },
  talepler: { slug: "talepler", module: "demands", filenameBase: "talepler", map: mapDemand },
  randevular: { slug: "randevular", module: "appointments", filenameBase: "randevular", map: mapAppointment },
  anlasmalar: { slug: "anlasmalar", module: "commissions", filenameBase: "anlasmalar", map: mapDeal },
  projeler: { slug: "projeler", module: "projects", filenameBase: "projeler", map: mapProject },
  aidatlar: { slug: "aidatlar", module: "expenses", filenameBase: "aidatlar", map: mapDue },
  sozlesmeler: { slug: "sozlesmeler", module: "contracts", filenameBase: "sozlesmeler", map: mapContract },
  tavsiyeler: { slug: "tavsiyeler", module: "customers", filenameBase: "tavsiyeler", map: mapReferral },
};

export function isFullExportEntity(slug: string | undefined | null): boolean {
  return !!slug && Object.prototype.hasOwnProperty.call(EXPORT_ENTITIES, slug);
}
