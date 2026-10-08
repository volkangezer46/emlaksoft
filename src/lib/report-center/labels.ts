/**
 * Rapor sütunları için Türkçe etiket sözlükleri. DB ham değer tutar; dosyada ham anahtar görünmez.
 * Ofisin özelleştirebildiği sözlükler (müşteri kaynağı, gider kategorisi, aşama adı...) `loadDefLabels` ile
 * ofis tanımlarından okunur (yoksa varsayılan).
 */
import { defaultLabelMap, type DefinitionCategory } from "@/lib/definition-defaults";
import { getDefinitionsOrDefault, toLabelMap } from "@/lib/definitions";
import type { ReportContext } from "./types";

export const STATUS = {
  demand: { new: "Yeni", active: "Aktif", matched: "Eşleşti", closed: "Kapalı" },
  urgency: { low: "Düşük", normal: "Normal", high: "Yüksek", urgent: "Acil" },
  appointment: { pending: "Teyit bekliyor", confirmed: "Onaylandı", signature: "İmza eksik", completed: "Tamamlandı", cancelled: "İptal" },
  offer: { draft: "Taslak", submitted: "Sunuldu", countered: "Karşı teklif", accepted: "Kabul edildi", rejected: "Reddedildi", withdrawn: "Geri çekildi" },
  contract: { draft: "Taslak", sent: "Gönderildi", signed: "İmzalandı", rejected: "Reddedildi", cancelled: "İptal" },
  commission: { calculated: "Hesaplandı", invoiced: "Faturalandı", pending: "Bekliyor", paid: "Tahsil edildi", collected: "Tahsil edildi", cancelled: "İptal" },
  payout: { pending: "Bekliyor", approved: "Onaylandı", paid: "Ödendi", cancelled: "İptal" },
  task: { open: "Açık", done: "Tamamlandı", cancelled: "İptal" },
  taskKind: { followup: "Takip", call: "Arama", visit: "Ziyaret", document: "Evrak", other: "Diğer" },
  priority: { low: "Düşük", normal: "Normal", high: "Yüksek" },
  recurrence: { daily: "Her gün", weekly: "Her hafta", biweekly: "İki haftada bir", monthly: "Her ay" },
  project: { planning: "Planlama", selling: "Satışta", delivered: "Teslim edildi" },
  rental: { active: "Aktif", ended: "Sona erdi" },
  rentCharge: { pending: "Bekliyor", paid: "Ödendi", overdue: "Gecikti" },
  due: { unpaid: "Ödenmedi", paid: "Ödendi" },
  referral: { yeni: "Yeni", iletisim: "İletişimde", musteri: "Müşteri oldu", kazanildi: "Kazanıldı", kayip: "Kayıp" },
  approval: { bekliyor: "Bekliyor", onaylandi: "Onaylandı", reddedildi: "Reddedildi", iptal: "İptal" },
  approvalKind: { komisyon_indirimi: "Komisyon indirimi", gider: "Gider", fiyat_degisikligi: "Fiyat değişikliği", ozel_izin: "Özel izin", diger: "Diğer" },
  campaign: { draft: "Taslak", scheduled: "Zamanlandı", sending: "Gönderiliyor", done: "Tamamlandı", failed: "Başarısız" },
  channel: { sms: "SMS", whatsapp: "WhatsApp" },
  recipient: { pending: "Bekliyor", sent: "Gönderildi", delivered: "Teslim edildi", failed: "Ulaşmadı", opted_out: "İzin yok (gönderilmedi)" },
  survey: { pending: "Yanıt bekliyor", answered: "Yanıtlandı" },
  propertyStatus: { draft: "Taslak", live: "Yayında", reserved: "Rezerve", sold: "Satıldı", rented: "Kiralandı", archived: "Arşiv", active: "Aktif", passive: "Pasif", withdrawn: "Geri çekildi", pending: "Beklemede" },
  portalListing: { live: "Yayında", removed: "Kaldırıldı", superseded: "İlan no değişti (yeni kayıt var)" },
  anomalyStatus: { open: "Açık", acknowledged: "Görüldü", explained: "Açıklandı", resolved: "Çözüldü", false_positive: "Yanlış alarm", auto_closed: "Otomatik kapandı" },
  severity: { info: "Bilgi", low: "Düşük", medium: "Orta", high: "Yüksek", critical: "Kritik" },
  tenantStatus: { trial: "Deneme", active: "Aktif", past_due: "Gecikmiş", suspended: "Askıda", cancelled: "İptal" },
  subscription: { trialing: "Deneme", active: "Aktif", past_due: "Gecikmiş", cancelled: "İptal", paused: "Duraklatıldı" },
  invoice: { draft: "Taslak", open: "Açık", paid: "Ödendi", void: "İptal", uncollectible: "Tahsil edilemez" },
  ticket: { open: "Açık", in_progress: "İşleniyor", waiting: "Yanıt bekliyor", resolved: "Çözüldü", closed: "Kapalı" },
  ticketPriority: { low: "Düşük", normal: "Normal", high: "Yüksek", urgent: "Acil" },
  billingCycle: { monthly: "Aylık", yearly: "Yıllık" },
  captureStatus: {
    captured_pending: "Tahsilat işleniyor",
    retry_pending: "Yeniden denenecek",
    manual_review: "Elle inceleme",
    refund_required: "İade gerekli",
    refunded: "İade edildi",
    fulfilled: "Tamamlandı",
  },
  captureTarget: { subscription: "Abonelik", payment_link: "Ödeme bağlantısı" },
  demoRequest: { new: "Yeni", contacted: "Görüşüldü", qualified: "Nitelikli aday", won: "Kazanıldı", lost: "Kaybedildi" },
  targetPeriod: { monthly: "Aylık", quarterly: "Üç aylık", yearly: "Yıllık" },
  couponKind: { percent: "Yüzde", amount: "Tutar" },
  ledgerKind: { entry: "Kayıt", correction: "Düzeltme" },
  dealType: { sale: "Satış", rent: "Kiralama" },
  leadRef: { referral: "Tavsiye", partner: "Ortak", tool: "Araç", powered_by: "Marka bağlantısı", none: "Doğrudan" },
  closureReason: {},
} satisfies Record<string, Record<string, string>>;

export const TRANSACTION_FALLBACK: Record<string, string> = { sale: "Satılık", rent: "Kiralık" };

/** Ofis tanımından (yoksa varsayılandan) etiket haritası; istek içinde önbelleklenir (`ctx.memo`). */
export async function loadDefLabels(ctx: ReportContext, category: DefinitionCategory): Promise<Record<string, string>> {
  const key = `def:${category}`;
  const hit = ctx.memo.get(key) as Record<string, string> | undefined;
  if (hit) return hit;
  let map: Record<string, string>;
  try {
    map = { ...defaultLabelMap(category), ...toLabelMap(await getDefinitionsOrDefault(category)) };
  } catch {
    map = defaultLabelMap(category);
  }
  ctx.memo.set(key, map);
  return map;
}

export function memoLabels(ctx: ReportContext, category: DefinitionCategory): Record<string, string> {
  return (ctx.memo.get(`def:${category}`) as Record<string, string> | undefined) ?? defaultLabelMap(category);
}
