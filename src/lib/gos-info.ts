/**
 * Güvenli Ödeme Sistemi (GÖS) — TEK KAYNAK.
 *
 * Satış kapanış listesi (`deal-checklist-templates.ts`), yabancıya satış listesi
 * (`foreign-sale-checklist.ts`), Uyum sayfası bilgi kartı ve sözleşme yazma ekranındaki isteğe bağlı madde
 * aynı metni BURADAN alır.
 *
 * DÜRÜSTLÜK KURALLARI (bilgi kartında ve testte korunur):
 *  - Zorunluluk tarihi TEK SABİTTİR (`GOS_EFFECTIVE_DATE` = 1 Aralık 2026; Resmî Gazete 01.10.2026 tarihli değişiklik,
 *    önceki 1 Temmuz ve 1 Ekim tarihleri ertelenmişti). Metinler tarihi bu sabitten üretir; yeni bir erteleme olursa
 *    yalnız burası değişir. Kart yine "resmî metni doğrulayın" der (hukuki danışmanlık değildir).
 *  - Para ürünün içinden GEÇMEZ: ürün ödeme almaz, tutmaz, aktarmaz. GÖS bankalar/tapu süreci üzerinden
 *    yürür; burası yalnız hazırlık adımlarını ve bilgiyi taşır.
 *  - Hukuki danışmanlık değildir; sözleşme maddesi isteğe bağlıdır ve ofis sorumluluğundadır.
 */

import type { ChecklistTemplateItem } from "@/lib/deal-checklist-templates";

export type GosSource = { label: string; url: string };

/** Kaynaklar: üçü de ikincil (hukuk bürosu/haber); Resmî Gazete/Bakanlık metni bu çalışmada açılamadı. */
export const GOS_SOURCES: GosSource[] = [
  {
    label: "Paksoy Hukuk — Taşınmaz satışlarında güvenli ödeme sistemi zorunlu hale geliyor",
    url: "https://paksoy.av.tr/2026/05/tasinmaz-satislarinda-guvenli-odeme-sistemi-zorunlu-hale-geliyor/",
  },
  {
    label: "GZT — Güvenli ödeme sistemi 1 Aralık 2026'ya ertelendi",
    url: "https://www.gzt.com/ekonomi/tasinmaz-satislarinda-guvenli-odeme-sistemi-1-aralik-2026ya-ertelendi-4264876",
  },
  {
    label: "Gayrimenkul Haber — Tapuda önce para mı önce imza mı dönemi sona eriyor",
    url: "https://www.gayrimenkulhaber.com/guncel/tapuda-once-para-mi-once-imza-mi-donemi-sona-eriyor/",
  },
];

/** Zorunluluk başlangıcı (TR günü, `YYYY-MM-DD`). Tek kaynak: kart, geri sayım ve kontrol listesi bundan okur. */
export const GOS_EFFECTIVE_DATE = "2026-12-01";
/** Tarihin dayanağı (ürün sahibi bildirimi; resmî metin bu depoda açılmadı). */
export const GOS_EFFECTIVE_SOURCE = "Resmî Gazete, 01.10.2026 tarihli değişiklik";
/** Görünür tarih metni ("1 Aralık 2026"). */
export const GOS_EFFECTIVE_LABEL = "1 Aralık 2026";

/** Tarih notu — kartta ve testte birebir aranır. */
export const GOS_DATE_NOTE =
  `Zorunluluk başlangıcı ${GOS_EFFECTIVE_LABEL} (${GOS_EFFECTIVE_SOURCE}; daha önce duyurulan 1 Temmuz ve 1 Ekim tarihleri ertelendi). ` +
  "Uygulama ayrıntıları için güncel resmi duyuruyu doğrulayın.";

/** GÖS başlangıcına kalan gün (bugün dahil değil; geçmişse negatif). `todayKey` = `trDayKey()` (clock.ts); saf. */
export function gosDaysLeft(todayKey: string): number {
  const a = Date.parse(`${todayKey}T00:00:00Z`);
  const b = Date.parse(`${GOS_EFFECTIVE_DATE}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Kart rozeti: başlamadan önce geri sayım, sonra "yürürlükte". */
export function gosStatusLabel(todayKey: string): { label: string; active: boolean } {
  const left = gosDaysLeft(todayKey);
  if (left <= 0) return { label: `${GOS_EFFECTIVE_LABEL} itibarıyla yürürlükte`, active: true };
  return { label: `${GOS_EFFECTIVE_LABEL} başlangıcına ${left} gün`, active: false };
}

export const GOS_SUMMARY =
  "Nakit, havale veya EFT ile ödenen taşınmaz satışlarında bedelin satıcıya doğrudan değil, tescille eş zamanlı olarak " +
  "güvenli ödeme sistemi üzerinden aktarılması öngörülüyor: alıcı, tapu randevusundan önce bedeli bloke hesaba yatırır; " +
  "tescilde satıcıya geçer. Kredili kısım kapsam dışı, danışman hizmet bedeli sistem dışı olarak anlatılıyor " +
  "(ikincil kaynaklara göre; ayrıntı ve istisnalar için resmî metne bakın).";

export const GOS_NO_MONEY_NOTE =
  "Para EmlakSoft'tan geçmez: ürün ödeme almaz, saklamaz, aktarmaz. Burası yalnız hazırlık listesi ve bilgilendirmedir; hukuki danışmanlık değildir.";

export const GOS_CHECKLIST_PREFIX = "GÖS — ";

/**
 * Kapanış kontrol listesi maddeleri. `required: false`: GÖS yalnız nakit/havale/EFT ile ödenen kısma uygulanır
 * (kredili kısım ve bazı işlemler kapsam dışı); bu yüzden "duruma bağlı" hatırlatıcı olarak durur ve kapanış
 * yüzdesini düşürmez. Anlaşmada GÖS referans no ve tapu randevu tarihi ayrıca kaydedilir (`deal-gos.ts`).
 */
export const GOS_CHECKLIST_ITEMS: ChecklistTemplateItem[] = [
  { label: `${GOS_CHECKLIST_PREFIX}Alıcı ve satıcının kişisel TL IBAN'ı güvenli ödeme sistemine tanımlandı`, required: false },
  { label: `${GOS_CHECKLIST_PREFIX}Satış bedeli güvenli hesapta bloke edildi (tapu randevusundan önce)`, required: false },
  { label: `${GOS_CHECKLIST_PREFIX}Kredili kısım ayrı yürütülüyor (varsa; banka kredisi sistem dışında)`, required: false },
  { label: `${GOS_CHECKLIST_PREFIX}Hizmet bedeli (komisyon) sistem dışında, ayrıca tahsil edilecek`, required: false },
  { label: `${GOS_CHECKLIST_PREFIX}Tapu randevusu bloke onayından sonra alındı`, required: false },
];

/** İsteğe bağlı satış sözleşmesi maddesi. Başlık, tekrar eklemeyi engellemek için işaretçidir. */
export const GOS_CLAUSE_MARKER = "GÜVENLİ ÖDEME SİSTEMİ (İSTEĞE BAĞLI MADDE)";

export const GOS_CLAUSE_TEXT = `${GOS_CLAUSE_MARKER}
Taraflar, satış bedelinin ödemesinin yürürlükteki mevzuatın gerektirdiği ölçüde ve kapsamda, tapuda tescille eş zamanlı olarak
güvenli ödeme sistemi aracılığıyla yapılacağını kabul eder. Alıcı, bedeli (kredi ile ödenecek kısım hariç) tapu randevusundan önce
bu sistemdeki hesaba yatırır; satıcı, bedelin kendi adına tanımlı TL IBAN'ına tescille birlikte aktarılacağını kabul eder.
Aracı emlak ofisi satış bedelini tahsil etmez, saklamaz veya devretmez; hizmet bedeli bu sistemin dışında, ayrıca ödenir.
Bu madde mevzuatta değişiklik olması hâlinde güncel mevzuata uygun şekilde uygulanır.`;

/** Gövdede madde yoksa sonuna ekler; varsa aynen döndürür (idempotent). */
export function appendGosClause(body: string): string {
  if (body.includes(GOS_CLAUSE_MARKER)) return body;
  const trimmed = body.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${GOS_CLAUSE_TEXT}\n` : `${GOS_CLAUSE_TEXT}\n`;
}

/** Madde yalnız satış/kapora türlerinde sunulur. */
export function gosClauseApplies(contractType: string): boolean {
  return contractType === "satis" || contractType === "kapora";
}
