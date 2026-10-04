/**
 * Public ücretsiz araçlar kaydı (/araclar). Tek kaynak: liste sayfası, [slug] sayfası, sitemap.
 *
 * Kira artış aracı (tufe.ts verisi doğrulanmadığı için) BİLEREK kayıtta YOKTUR: listede, sitemap'te
 * görünmez, doğrudan URL 404 verir. Veri doğrulanınca buraya eklenir.
 */
export type ToolSlug =
  | "komisyon-hesaplama"
  | "tapu-masrafi-hesaplama"
  | "kira-getirisi-hesaplama"
  | "konut-kredisi-taksit-hesaplama";

export type ToolDef = {
  slug: ToolSlug;
  /** Liste kartı ve sekme başlığı. */
  title: string;
  h1: string;
  description: string;
  /** Sayfada "nasıl hesaplanır" bölümü. */
  how: string[];
  faq: { q: string; a: string }[];
  published: boolean;
};

export const TOOLS: ToolDef[] = [
  {
    slug: "komisyon-hesaplama",
    title: "Emlak komisyonu hesaplama",
    h1: "Emlak komisyonu hesaplama",
    description:
      "Satış bedeli ve komisyon oranını girin; KDV hariç komisyon, KDV tutarı ve toplam tahsilatı görün. KDV dahil/hariç ayrımı dahildir.",
    how: [
      "Komisyon = satış bedeli × komisyon oranı.",
      "KDV hariç anlaşıldıysa bu tutar matrahtır; KDV = matrah × KDV oranı; toplam = matrah + KDV.",
      "KDV dahil anlaşıldıysa hesaplanan tutar toplamdır; matrah = tutar ÷ (1 + KDV oranı).",
      "Komisyon ve KDV oranları sizin girdinizdir. Araç yasal ya da ortalama bir oran önermez.",
    ],
    faq: [
      { q: "KDV dahil ile KDV hariç farkı nedir?", a: "Aynı komisyon tutarı KDV dahilse matrah daha düşüktür. Örneğin 24.000 TL KDV dahil, %20 KDV ile 20.000 TL matrah ve 4.000 TL KDV demektir." },
      { q: "Oranı neden ben giriyorum?", a: "Komisyon oranı taraflar arasındaki sözleşmeye bağlıdır. Geçerli üst sınır ve KDV oranını resmi kaynaklardan teyit edin." },
    ],
    published: true,
  },
  {
    slug: "tapu-masrafi-hesaplama",
    title: "Tapu masrafı hesaplama",
    h1: "Tapu masrafı ve alım masrafı hesaplama",
    description:
      "Satış bedeline göre alıcı payı tapu harcı, hizmet bedeli ve komisyonu içeren yaklaşık alım masrafını hesaplayın. Oranları kendiniz düzenleyin.",
    how: [
      "Tapu harcı = satış bedeli × toplam harç oranı. Kanuni paylaşımda yarısı alıcıdadır; taraflar anlaşırsa tamamı alıcıya yazılabilir.",
      "Komisyon = satış bedeli × komisyon oranı × (1 + KDV oranı). Komisyon ve hizmet bedeli boş bırakılırsa hesaba katılmaz.",
      "DASK, konut sigortası, ekspertiz, kredi masrafları ve yeni bina KDV'si bu araçta HESAPLANMAZ.",
      "Tüm oranları ve tapu döner sermaye hizmet bedelini güncel resmi kaynaktan teyit edin; alanlar düzenlenebilir.",
    ],
    faq: [
      { q: "Harç oranı güncel mi?", a: "Alan %4 toplam oranla başlar ve düzenlenebilir. Mevzuat değişebilir; Tapu ve Kadastro Genel Müdürlüğü ve Gelir İdaresi duyurularından teyit edin." },
      { q: "Neden DASK ve ekspertiz yok?", a: "Bu kalemlerin tutarları yıla, şirkete ve konuta göre değişir; doğrulanmamış bir tutarı gerçekmiş gibi göstermiyoruz." },
    ],
    published: true,
  },
  {
    slug: "kira-getirisi-hesaplama",
    title: "Kira getirisi ve amortisman süresi",
    h1: "Kira getirisi ve amortisman süresi hesaplama",
    description:
      "Konut fiyatı ve aylık kiradan brüt kira getirisini ve kaç yılda geri döneceğini hesaplayın; isteğe bağlı yıllık giderle net getiriyi görün.",
    how: [
      "Brüt getiri (%) = yıllık kira ÷ fiyat × 100; yıllık kira = aylık kira × 12.",
      "Amortisman süresi (yıl) = fiyat ÷ yıllık kira.",
      "Net getiri = (yıllık kira − yıllık giderler) ÷ fiyat × 100. Giderleri (aidat, vergi, bakım, boş kalma) siz tahmin edersiniz.",
      "Fiyat artışı, kira artışı, enflasyon ve finansman maliyeti hesaba katılmaz.",
    ],
    faq: [
      { q: "Brüt ile net getiri farkı nedir?", a: "Brüt getiri giderleri dikkate almaz. Net getiri, girdiğiniz yıllık giderleri kiradan düşer." },
      { q: "Bu bir yatırım tavsiyesi mi?", a: "Hayır. Girdiğiniz sayılarla yapılan basit bir aritmetiktir." },
    ],
    published: true,
  },
  {
    slug: "konut-kredisi-taksit-hesaplama",
    title: "Konut kredisi taksit hesaplama",
    h1: "Konut kredisi taksit hesaplama",
    description:
      "Kredi tutarı, aylık faiz ve vadeyi girin; eşit taksitli (anüite) aylık taksiti, toplam geri ödemeyi ve ilk 12 ayın ödeme planını görün.",
    how: [
      "Aylık taksit = K × i ÷ (1 − (1 + i)^−n); K kredi tutarı, i aylık faiz oranı (ondalık), n vade (ay).",
      "Faiz 0 ise taksit = K ÷ n.",
      "Toplam geri ödeme = taksitlerin toplamı; toplam faiz = toplam geri ödeme − kredi tutarı.",
      "Faiz oranını bankanızın teklifinden girin; araç hazır bir oran önermez. Dosya masrafı, sigorta ve vergiler taksite dahil edilmez.",
    ],
    faq: [
      { q: "Faiz oranını nereden bulurum?", a: "Bankaların güncel konut kredisi tekliflerinden. Araç güncel olmayan bir oran göstermemek için alanı boş bırakır." },
      { q: "Sonuç banka teklifi midir?", a: "Hayır. Tahmini bir hesaptır; gerçek taksit bankanın koşullarına göre değişir." },
    ],
    published: true,
  },
];

export function publishedTools(): ToolDef[] {
  return TOOLS.filter((t) => t.published);
}

export function getPublishedTool(slug: string): ToolDef | undefined {
  return publishedTools().find((t) => t.slug === slug);
}
