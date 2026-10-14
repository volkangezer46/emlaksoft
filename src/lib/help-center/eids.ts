import type { Guide } from "@/lib/help-content";
import type { FaqItem } from "@/lib/help-faq";
import type { LegalValues } from "@/lib/legal-constants";
import { EIDS_CALL_CENTER, EIDS_SENDER_ADDRESS, EIDS_TAKEDOWN_DAYS, eidsPenaltyRangeText } from "@/lib/eids/legal-text";
import { EIDS_AUTHORITY_HREF, EIDS_HELP_HREF, EIDS_HELP_SLUG } from "@/lib/eids/links";

/**
 * EİDS (Bakanlık yetki e-postaları) YARDIM İÇERİĞİ — koddaki taban (SAF).
 *
 * `help-content.ts` GUIDES ve `help-faq.ts` FAQ bu maddeleri ekler; yardım merkezi CMS'i (`help_articles`) aynı slug ile
 * geçersiz kılabilir ("koddan düzenle"). Ceza tutarı metne `legal-text.ts` üzerinden girer (tek yer); koddaki taban
 * tutarı okuyucuya gitmeden `applyEffectiveEidsPenalty` ile o gün yürürlükteki değerle değiştirilir (store.ts). Doğrulanmamış
 * bilgiler metinde "[Doğrulanmadı]" etiketiyle durur; teyit edilince yalnız etiket kalkar.
 * Uzun kılavuz: docs/eids/KILAVUZ.md. Sağlayıcı adımları: src/lib/eids/forwarding.ts.
 */

export { EIDS_HELP_SLUG };
export const EIDS_UNVERIFIED_TAG = "[Doğrulanmadı]";

export const EIDS_GUIDE: Guide = {
  slug: EIDS_HELP_SLUG,
  title: "Bakanlık (EİDS) yetki e-postası: nereye gelir, EmlakSoft'a nasıl iletilir?",
  intro: `Malik e-Devlet'te ofisinize ilan yetkisi verince ya da iptal edince Bakanlık ${EIDS_SENDER_ADDRESS} adresinden bir yetki e-postası gönderebilir. EmlakSoft bu e-postayı portföyle eşleştirir ve görev açar; e-posta her işlemde gelmeyebileceği için tek kaynak değil, denetim sinyalidir.`,
  steps: [
    `${EIDS_UNVERIFIED_TAG} Yetki e-postası büyük olasılıkla işletmenizin MERSİS'te (şirket ve şahıs tacir) ya da ESBİS'te (esnaf) kayıtlı e-posta adresine gelir. Bakanlık bunu yazılı olarak belirtmiyor; kesin bilgi için ${EIDS_CALL_CENTER} numaralı çağrı merkezini arayın.`,
    "Kayıtlı adresi görmek için TTBS'ye (ttbs.gtb.gov.tr) e-Devlet ile girin ve işletme detay bilgilerindeki E-Posta alanına bakın. Bu adres TTBS'de değiştirilemez. [Doğrulanmadı] Menü adları 2018 tarihli TTBS rehberine göredir.",
    `Adresi değiştirmek için: ticari işletmeyseniz Ticaret Sicil Müdürlüğüne başvurun ya da MERSİS'ten güncelleyin ${EIDS_UNVERIFIED_TAG} (MERSİS menü yolu doğrulanmadı); esnafsanız esnaf odası ya da Esnaf Sicil Müdürlüğü üzerinden güncelleyin.`,
    "Yetki belge numaranızı Ayarlar > Marka ve kimlik > Yetki belgesi no alanına girin. Malikler e-Devlet'te yetki verirken bu numarayı kullanır; numarayı TTBS BelgeSorgula ekranından kontrol edebilirsiniz.",
    "Alma adresinizi Ayarlar > Entegrasyonlar > Bakanlık (EİDS) e-postaları kartından alın (yetki-…@eids.emlaksoft.com.tr). Adresi kimseyle paylaşmayın; sızarsa kartta \"Adresi yenile\"ye basın.",
    `Posta kutunuzda yalnız ${EIDS_SENDER_ADDRESS} adresinden gelenleri bu adrese ileten bir kural kurun. Gmail, Google Workspace, Outlook/Hotmail, Microsoft 365, Yandex ve cPanel için adımlar kartta sekmeler halinde yazılıdır. Tüm gelen kutusunu iletmeyin.`,
    "Eski ya da kuralla gelmeyen e-postaları İlan Kontrol > Yetki > \"Bakanlık e-postası ekle\" ekranından .eml dosyası olarak yükleyin. Telefondan metni yapıştırabilirsiniz; yapıştırılan metin doğrulanmamış sayılır ve ofis sahibi ya da müdür onayı ister.",
    "İşletmenin kendi yetki listesini görebildiği resmî bir ekran bulunamadı [Doğrulanmadı]; yetkiyi malik e-Devlet'te \"EİDS Taşınmaz İlanı Yetkilendirme İşlemleri\" hizmetinde görür. Danışman portföy ekranından malikten ekran görüntüsü isteyerek ya da portalda EİDS doğrulamasıyla teyit eder.",
    `İptal e-postası gelirse ilan kendiliğinden kalkmaz: ilanı ${EIDS_TAKEDOWN_DAYS} gün içinde üye olduğunuz portallardan, vitrinden ve sosyal medyadan kaldırın (Yönetmelik md. 14/2-h, 14/2-j). İhlal başına idari para cezası ${eidsPenaltyRangeText()}.`,
  ],
  href: EIDS_AUTHORITY_HREF,
  cta: "İlan Kontrol > Yetki",
};

export const EIDS_FAQ: readonly FaqItem[] = [
  {
    id: "eids-iptal-ilan-duser-mi",
    category: "kayitlar",
    q: "EİDS yetkisi iptal edilince ilan kendiliğinden yayından düşer mi?",
    a: `Hayır. Bakanlık rehberine göre iptal, yalnız yeni ilan girmeyi ve ilanın yenilenmesini engeller; yayındaki ilan kendiliğinden kalkmaz. Yetki bittiğinde ya da iptal edildiğinde ilanı ${EIDS_TAKEDOWN_DAYS} gün içinde tüm portallardan, vitrinden ve sosyal medyadan kaldırmanız gerekir (Yönetmelik md. 14/2-h ve 14/2-j). İhlal başına idari para cezası ${eidsPenaltyRangeText()}; tekrarında yetki belgesi iptal edilebilir. EmlakSoft iptal yetki e-postası gelince acil kaldırma görevi açar.`,
    href: EIDS_AUTHORITY_HREF,
    hrefLabel: "Yetki kuyruğu",
  },
  {
    id: "eids-eposta-gelmezse",
    category: "kayitlar",
    q: "Bakanlık yetki e-postası gelmezse ne yapmalıyım?",
    a: `Bakanlık her işlemde e-posta göndermeyebilir; bu yüzden EmlakSoft e-postayı tek kaynak saymaz. Önce iletme kuralınızı kontrol edin: kural yalnız ${EIDS_SENDER_ADDRESS} göndericisini EmlakSoft alma adresinize iletmeli. E-postanın hangi adrese gittiği doğrulanmadı [Doğrulanmadı]: büyük olasılıkla MERSİS ya da ESBİS'te kayıtlı işletme e-postasına gider, ${EIDS_CALL_CENTER} numarasından teyit edebilirsiniz. Yetkiyi portföy ekranından elle girin; malikten e-Devlet ekran görüntüsü isteyin ya da portalda EİDS doğrulamasıyla teyit edin. Elinizdeki e-postayı .eml olarak İlan Kontrol > Yetki ekranından yükleyebilirsiniz.`,
    href: EIDS_HELP_HREF,
    hrefLabel: "EİDS rehberi",
  },
  {
    id: "eids-tasinmaz-no-nerede",
    category: "kayitlar",
    q: "Taşınmaz no nerede yazar, maliğe nasıl sorarım?",
    a: "Taşınmaz numarası EİDS yetkisinin ve portal ilanının anahtarıdır; yeni tip tapu senedinin üzerinde yazar. Malik e-Devlet'te \"Tapu Bilgileri Sorgulama\" > \"Taşınmaz Bilgileri\" ekranından da görebilir. Portföy formunun İlan sahibi sekmesinde \"Taşınmaz no nerede?\" ipucu ve maliğe gönderebileceğiniz hazır mesaj vardır; mesajda e-Devlet yetkilendirme adımları ve ofisinizin yetki belge numarası yazar.",
    href: "/app/portfoyler/yeni",
    hrefLabel: "Yeni portföy",
  },
];

/**
 * Birleşik yardım içeriğinde (kod + DB) koddaki taban ceza aralığını o gün yürürlükteki değerle değiştirir (SAF). Mevzuat
 * panelinden yılbaşında girilen yeni tutar böylece rehber, SSS ve AI SSS bağlamına da yansır; değer aynıysa nesne aynen döner.
 */
export function applyEffectiveEidsPenalty<C extends { guides: Guide[]; faq: FaqItem[] }>(content: C, values?: LegalValues | null): C {
  const base = eidsPenaltyRangeText();
  const effective = eidsPenaltyRangeText(values);
  if (base === effective) return content;
  const swap = (t: string) => (t.includes(base) ? t.split(base).join(effective) : t);
  return {
    ...content,
    guides: content.guides.map((g) => ({ ...g, intro: swap(g.intro), steps: g.steps.map(swap) })),
    faq: content.faq.map((f) => ({ ...f, a: swap(f.a) })),
  };
}
