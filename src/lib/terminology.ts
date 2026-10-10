/**
 * Terim sözlüğü, TEK kaynak (docs/design/BIRLESIK_YOL_HARITASI.md §5.1, 15 çelişki kararı).
 *
 * Kullanıcıya görünen metinde kanonik ad kullanılır; `forbidden` desenleri kullanıcıya
 * görünmeyecek varyantlardır ve `terminology-contract.test.ts` ile taranır. Yol adları ve
 * kod tanımlayıcıları (ör. `/app/ayarlar/lead`, `customer-state/lead.ts`) değişmez; yalnız METİN düzelir.
 * İstemciden de import edilebilir (sunucu modülü içermez).
 */

export type Term = {
  /** Kullanıcıya görünen kanonik ad. */
  canonical: string;
  /** Tek cümle tanım. */
  definition: string;
  /** Kullanıcıya görünen metinde geçmemesi gereken varyantlar (büyük/küçük harf duyarsız). */
  forbidden?: RegExp[];
};

export const TERMS = {
  talep: {
    canonical: "Talep",
    definition: "Müşterinin aradığı gayrimenkul isteği (customer_demands).",
  },
  aday: {
    canonical: "Aday",
    definition: "Henüz müşteri olmamış, ofise ulaşan kişi (aday yakalama, başvuru).",
    forbidden: [/\blead(?:s|'\w+|’\w+)?\b/i],
  },
  portfoy: {
    canonical: "Portföy",
    definition: "Ofisin kaydı (iç dil). Vitrinde veya portalda yayındaki hali 'ilan'dır.",
  },
  anlasma: {
    canonical: "Anlaşma",
    definition: "Müşteri ile ofis arasındaki satış/kiralama süreci. 'Fırsat' kullanıcıya görünmez.",
  },
  kazanc: {
    canonical: "Kazanç",
    definition: "Danışmanın komisyon payı toplamı (kişisel sayfa adı). Menüde ve başlıkta 'Cüzdan' değil 'Kazanç'.",
    forbidden: [/\bkişisel hakediş\b/i],
  },
  hakedis: {
    canonical: "Hakediş",
    definition: "Payın ÖDEME süreci (hesaplandı, onaylandı, ödendi); yalnız hakediş ekranında.",
  },
  ornekVeri: {
    canonical: "Örnek veri",
    definition: "Ofisin içine yüklenen is_sample kayıtlar. Demo talebi akışı yoktur (self-servis kayıt; eski /admin/satis ve public /demo yönlendirilir).",
    forbidden: [/demo modundasınız/i, /demo verileriyle/i, /dolu demo/i, /demo ofisle/i],
  },
  hesapKredisi: {
    canonical: "Hesap kredisi",
    definition: "Ofisin TL bakiyesi (davet ödülü, kampanya, iade); paket, ek kullanıcı ve kontör faturalarından düşer. Kontörle karıştırılmaz.",
    forbidden: [/kredi cüzdan/i, /hesap cüzdan/i],
  },
  kontor: {
    canonical: "Kontör bakiyesi",
    definition: "EmlakFiyati değerleme ve PDF rapor işlemlerinde harcanan işlem hakkı; aylık hak ve ek paketlerle yüklenir.",
    forbidden: [/kontör cüzdan/i],
  },
  davet: {
    canonical: "Davet et ve kazan",
    definition: "Ofisin başka ofisleri davet edip hesap kredisi kazandığı program (/app/buyume). Eski adlar kullanıcıya görünmez.",
    forbidden: [/arkadaşını getir/i, /tavsiye ödül/i],
  },
  satisHatti: {
    canonical: "Satış hattı",
    definition: "Anlaşmaların aşama aşama ilerleyişi (eski adı 'pipeline'); basit kullanıcıya İngilizce terim gösterilmez.",
    forbidden: [/\bpipeline\b(?!-)/i],
  },
  gecikme: {
    canonical: "Gecikme",
    definition: "Bir işin söz verilen sürede yapılmaması (eski adı 'SLA'). Süre ayarı 'yanıt süresi' diye anılır.",
    forbidden: [/\bSLA\b/],
  },
  karsilastir: {
    canonical: "Karşılaştır",
    definition: "İki dönemi ya da kişiyi yan yana koymak (eski adı 'Kıyas').",
    forbidden: [/\bKıyas\b/],
  },
  erkenIsaretler: {
    canonical: "Erken işaretler",
    definition: "Sonuçtan önce görünen davranış göstergeleri (eski adı 'öncül göstergeler').",
    forbidden: [/öncül gösterge/i],
  },
  gelisimOnerileri: {
    canonical: "Gelişim önerileri",
    definition: "Danışmana verilen somut gelişim adımları (eski adı 'koçluk').",
    forbidden: [/\bkoçluk\b/i],
  },
  yanitHizi: {
    canonical: "Yanıt hızı",
    definition: "Yeni gelen talebe ilk dönüşün ne kadar sürdüğü (eski adı 'aday hızı').",
    forbidden: [/aday hızı/i],
  },
  akilliEslestirme: {
    canonical: "Akıllı eşleştirme",
    definition: "Talebe uygun portföyleri bulan eşleştirme (eski adı 'eşleştirme motoru').",
    forbidden: [/eşleştirme motoru/i],
  },
  yetkiBelgesi: {
    canonical: "Yetki belgesi",
    definition: "Gayrimenkul satış yetki belgesi numarası (EİDS kısaltması yalnız 'Yetki belgesi' açıklamasıyla birlikte yazılır).",
  },
} as const satisfies Record<string, Term>;

/**
 * "Kayıp" kelimesinin ÜÇ AYRI kavramı: arayüzde birbirine karışmaması için sabit adlar.
 *  - Kaçan komisyon (kayıp-kaçak kalkanı): portal teyidi gecikince kaçan ilanın tahmini para kaybı.
 *  - Kaybedilen anlaşma: kapanışta "kayıp" aşamasına alınan anlaşma ve seçilen kayıp nedeni.
 *  - Risk altındaki müşteri (eski "kayıp talep"): ilgisi azalan, kaybedilme riski taşıyan müşteri/talep.
 */
export const LOSS_TERMS = {
  leak: {
    canonical: "Kaçan komisyon",
    shield: "Kayıp-kaçak kalkanı",
    definition: "Portal teyidiyle kaçan ilanın tahmini komisyon kaybı (para). Sayfa: /app/kayip-kacak.",
  },
  lostDeal: {
    canonical: "Kaybedilen anlaşma",
    reason: "Kayıp nedeni",
    definition: "Anlaşma kapanışında 'kayıp' seçilen kayıt ve seçilen sebep. Yalnız anlaşma bağlamında.",
  },
  atRisk: {
    canonical: "Risk altındaki müşteriler",
    definition: "Uzun süredir ilgilenilmeyen, kaybedilme riski taşıyan müşteri ve talepler. Sayfa: /app/kayip-satis.",
  },
} as const;

/** Rol etiketi tek kaynak `@/lib/role-labels`'tır; terim sabiti burada tekrar edilmez. */
export const TERMINOLOGY_FORBIDDEN: { term: string; pattern: RegExp; use: string }[] = Object.entries(TERMS).flatMap(
  ([key, t]) =>
    ((t as Term).forbidden ?? []).map((pattern) => ({
      term: key,
      pattern,
      use: (t as Term).canonical,
    })),
);
