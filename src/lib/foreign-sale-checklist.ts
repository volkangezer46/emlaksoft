/**
 * Yabancıya konut satışı — evrak kontrol listesi ve mevzuat kartları.
 *
 * NEDEN AYRI DOSYA: `src/lib/deal-checklist-templates.ts` satış/kiralama
 * kapanışının genel şablonunu tutuyor ve ona dokunulmadı. Yabancıya satış o
 * listenin üstüne binen AYRI bir akış (pasaport, SPK değerleme raporu, DAB,
 * askeri yasak bölge) — genel şablona karıştırmak Türk alıcıya da bu maddeleri
 * gösterirdi. Tip (`ChecklistTemplateItem`) ortak: aynı `deal_checklist_items`
 * tablosuna yazılıyor.
 *
 * ⚠️ MEVZUAT UYARISI — BURADAKİ HİÇBİR SAYI HUKUKİ TAVSİYE DEĞİLDİR.
 * Eşikler ve oranlar mevzuat değişiklikleriyle sık güncelleniyor. Değerler
 * 2026 ortası itibarıyla yaygın uygulamayı yansıtır; her işlemde Tapu ve
 * Kadastro Genel Müdürlüğü (tkgm.gov.tr), Gelir İdaresi Başkanlığı (gib.gov.tr)
 * ve ilgili Tapu Müdürlüğü'nden TEYİT ALINMALIDIR. Her kartın `verify` alanı
 * ekranda "doğrulanmalı" notu olarak basılır.
 */

import type { ChecklistTemplateItem } from "@/lib/deal-checklist-templates";

/**
 * Yabancıya satış evrak listesi.
 *
 * `required: false` maddeler duruma bağlıdır (vekaletle işlem, vatandaşlık
 * başvurusu, tercüman ihtiyacı) — yüzde hesabına girmez, hatırlatıcı durur.
 * Sıra bilinçli: önce alıcı kimliği, sonra taşınmaz uygunluğu, sonra değerleme
 * ve ödeme, en sonda tapu randevusu — sahadaki iş sırası bu.
 */
export const FOREIGN_SALE_CHECKLIST: ChecklistTemplateItem[] = [
  { label: "Pasaport aslı + noter onaylı Türkçe tercümesi", required: true },
  { label: "Potansiyel vergi kimlik numarası (vergi dairesinden)", required: true },
  { label: "Alıcı fotoğrafı (son 6 ay, 1 adet)", required: true },
  { label: "Askeri yasak/güvenlik bölgesi uygunluk sorgusu", required: true },
  { label: "İlçe bazlı yabancıya satış kotası teyidi", required: true },
  { label: "SPK lisanslı gayrimenkul değerleme raporu (zorunlu)", required: true },
  { label: "Tapu kayıt örneği ve takyidat (ipotek/haciz) belgesi", required: true },
  { label: "Belediye rayiç bedel yazısı", required: true },
  { label: "DASK zorunlu deprem sigortası poliçesi", required: true },
  { label: "İskan belgesi (yapı kullanma izni)", required: true },
  { label: "Tapu harcı ve döner sermaye ödeme dekontları", required: true },
  { label: "Tapu müdürlüğü randevusu (webtapu başvurusu)", required: true },
  { label: "Yeminli tercüman (alıcı Türkçe bilmiyorsa zorunlu)", required: false },
  { label: "Noter onaylı vekaletname (vekaletle işlemde)", required: false },
  { label: "Döviz Alım Belgesi / DAB (bedel yurt dışından döviz geldiyse)", required: false },
  { label: "Vatandaşlık başvurusu: uygunluk belgesi ve 3 yıl satmama taahhüdü şerhi", required: false },
];

/** Bilgilendirme kartı — sayfada mevzuat özeti olarak basılır. */
export type ForeignSaleGuideCard = {
  /** Kart başlığı. */
  title: string;
  /** 1–2 cümlelik özet. */
  body: string;
  /** Öne çıkan eşik/oran (varsa) — kartta rozet olarak görünür. */
  figure?: string;
  /** Hangi kurumdan teyit alınacağı — "doğrulanmalı" notu. */
  verify: string;
};

/**
 * 2026 mevzuat özeti kartları.
 *
 * Her kart tek bir konuyu anlatır ve nereden teyit alınacağını söyler.
 * Danışmanın müşteriye "şunlar gerekiyor" diyebilmesi için yazıldı; hukuki
 * görüş yerine geçmez.
 */
export const FOREIGN_SALE_GUIDE: ForeignSaleGuideCard[] = [
  {
    title: "SPK lisanslı değerleme raporu zorunlu",
    body:
      "Yabancı uyruklu gerçek kişiye yapılan taşınmaz devirlerinde, SPK lisanslı bir " +
      "değerleme kuruluşunca düzenlenmiş taşınmaz değerleme raporu tapu müdürlüğüne " +
      "sunulmak zorundadır. Rapor genellikle 3 ay geçerli sayılır; işlem tarihinde " +
      "güncelliği kontrol edilmelidir.",
    figure: "Zorunlu",
    verify: "Tapu ve Kadastro Genel Müdürlüğü (tkgm.gov.tr) · SPK lisanslı kuruluş listesi (spk.gov.tr)",
  },
  {
    title: "Askeri yasak ve güvenlik bölgesi sorgusu",
    body:
      "Taşınmazın askeri yasak bölge, güvenlik bölgesi veya stratejik bölgede olup " +
      "olmadığı tapu müdürlüğünce resen sorgulanır. Olumsuz sonuç satışı durdurur; " +
      "bu yüzden portföyde 'yabancıya uygun değil' işareti sözleşme öncesi konmalıdır.",
    verify: "İlgili Tapu Müdürlüğü · Milli Savunma Bakanlığı ilgili komutanlık görüşü",
  },
  {
    title: "İlçe kotası ve kişi başı alan sınırı",
    body:
      "Yabancı gerçek kişilere satılabilecek taşınmaz toplamı, ilçe yüzölçümünün " +
      "yaygın uygulamada %10'u ile sınırlıdır; ayrıca kişi başına ülke genelinde " +
      "30 hektar üst sınırı bulunur. Kotası dolu ilçelerde işlem yapılamaz.",
    figure: "İlçe %10 · Kişi 30 ha",
    verify: "İlgili Tapu Müdürlüğü kota sorgusu (ilçe bazlı, dönemsel değişir)",
  },
  {
    title: "Vatandaşlık eşiği: 400.000 USD + 3 yıl taahhüdü",
    body:
      "Taşınmaz yatırımı yoluyla Türk vatandaşlığı başvurusunda alt sınır 400.000 ABD " +
      "doları karşılığıdır ve tapuya '3 yıl satılmayacaktır' şerhi konur. Bedelin " +
      "değerleme raporuyla desteklenmesi ve ödemenin banka üzerinden yapılması aranır.",
    figure: "400.000 USD · 3 yıl",
    verify: "Nüfus ve Vatandaşlık İşleri Genel Müdürlüğü · Çevre, Şehircilik ve İklim Değişikliği Bakanlığı",
  },
  {
    title: "Döviz bozdurma ve DAB belgesi",
    body:
      "Vatandaşlık başvurusuna konu alımlarda, bedelin yurt dışından getirilip " +
      "Merkez Bankası'na satılması ve Döviz Alım Belgesi (DAB) alınması istenir. " +
      "DAB'sız ödeme başvuruyu geçersiz kılabilir; ödeme akışı en baştan planlanmalıdır.",
    figure: "DAB zorunlu",
    verify: "TCMB · aracı banka · başvuruyu alan idare",
  },
  {
    title: "Tapu harcı ve döner sermaye",
    body:
      "Tapu harcı, satış bedeli üzerinden yaygın olarak toplam %4 oranında hesaplanır " +
      "(alıcı ve satıcı arasında paylaşılır; uygulamada çoğu kez alıcıya yüklenir). " +
      "Matrah, belediye rayiç bedelinin altında beyan edilemez. Ayrıca döner sermaye " +
      "ücreti ödenir.",
    figure: "≈ %4 harç",
    verify: "Gelir İdaresi Başkanlığı (gib.gov.tr) · Tapu Müdürlüğü harç tarifesi",
  },
  {
    title: "KDV istisnası — şarta bağlı",
    body:
      "Türkiye'de yerleşik olmayan yabancıya yapılan ilk konut/işyeri tesliminde, " +
      "bedelin yurt dışından döviz olarak getirilmesi ve taşınmazın belirli süre " +
      "elde tutulması şartıyla KDV istisnası uygulanabilir. Kapsam ve süre şartları " +
      "sık değişmiştir; işlem öncesi mutlaka güncel durum sorulmalıdır.",
    figure: "Şartlı istisna",
    verify: "Gelir İdaresi Başkanlığı özelgesi · mali müşavir görüşü (KDV Kanunu 13/i)",
  },
  {
    title: "Kimlik, tercüman ve vekalet",
    body:
      "Alıcının pasaportu ve noter onaylı Türkçe tercümesi, potansiyel vergi kimlik " +
      "numarası ve fotoğrafı gerekir. Alıcı Türkçe bilmiyorsa tapu işleminde yeminli " +
      "tercüman bulundurulması zorunludur. Vekaletle işlemde vekaletnamenin " +
      "yurt dışında düzenlenmişse apostilli ve Türkçe tercümeli olması aranır.",
    verify: "İlgili Tapu Müdürlüğü · noter · vergi dairesi",
  },
];
