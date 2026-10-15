import { visibleSections } from "@/lib/nav-config";
import type { AppAction, AppModule } from "@/lib/permissions";
import { TOUR_ROLES, tourIdForRole, type TourId } from "@/lib/product-tour-roles";

/**
 * Ürün turları — VARSAYILAN içerik (kodda yedek). Tek uzun tur yerine rol bazlı kısa turlar (her biri 4-6 adım).
 * Adminden düzenlenen metin/sıra/açık-kapalı/hedefleme `src/lib/onboarding-content.ts` (ayar `onboarding.content`) ile bunun
 * üstüne biner; çalıştırıcı turları `loadProductTours` eyleminden alır, alamazsa bu dosyadaki turlarla çalışır.
 *
 * Her adım bir SAYFA + o sayfadaki bir ÖĞE seçicisidir. Çalıştırıcı (`product-tour.tsx`) gerekirse sayfaya
 * gider, seçiciyi bekler; bulunamazsa adımı sessizce atlar. Ek olarak çalıştırmadan ÖNCE
 * `resolveTourSteps` ile menüde bulunmayan sayfaların adımları elenir:
 *  - kullanıcının yetkisi olmayan sayfa (erişilebilir modül listesi),
 *  - ofisin kapattığı modüle ait sayfa (Ayarlar > Modüller),
 *  - henüz menüye eklenmemiş sayfa (nav-config tek kaynaktır; sayfa eklenince adım kendiliğinden açılır).
 * Seçiciler sıralı denenir: önce özel `data-tour` işareti, yoksa sayfa başlığı (`#main-content h1`).
 */

export { tourIdForRole };
export type { TourId };

export type TourStepDef = {
  /** Adımın sayfası (`/app` = ana ekran). Menüde yoksa (çekirdek `/app` hariç) adım elenir. */
  path: string;
  /** Sıralı seçiciler; ilk görünür eşleşme vurgulanır. */
  selectors: readonly string[];
  title: string;
  desc: string;
  descMobile?: string;
  /**
   * Adımın sayfası menüde olmayan bir EYLEM akışıysa (`TOURABLE_FLOWS`) gereken izin. Menüdeki sayfalar için gerekmez
   * (menü zaten yetkiye göre süzülür); akış adımı bu izin yoksa elenir.
   */
  requires?: { module: AppModule; action: AppAction };
};

/**
 * Menüde bilerek bulunmayan (nav-config `HIDDEN_APP_PAGES`) ama tura girebilen eylem akışları ve izin şartı.
 * Örn. Kurulum sihirbazı ofis ayarı düzenleyebilene (settings:edit) gösterilir; danışmanın turunda elenir.
 */
export const TOURABLE_FLOWS: Readonly<Record<string, { module: AppModule; action: AppAction }>> = {
  "/app/baslangic": { module: "settings", action: "edit" },
};

/** Tur adımı süzgecinin bağlamı. `can` verilmezse akış adımları yalnız modül görünürlüğüyle (accessible) denetlenir. */
export type TourResolveCtx = {
  accessible: readonly AppModule[];
  closed: readonly string[];
  role?: string | null;
  can?: (module: AppModule, action: AppAction) => boolean;
};

export type TourDef = {
  id: TourId;
  label: string;
  description: string;
  /** Bu turu varsayılan sayan roller. */
  roles: readonly string[];
  steps: readonly TourStepDef[];
};

const H1 = "#main-content h1";

export const TOURS: readonly TourDef[] = [
  {
    id: "ofis-sahibi",
    label: "Ofis sahibi turu",
    description: "Ofisi kurun, ekibi ekleyin, ilan havuzunu ve ofis kontrolünü tanıyın.",
    roles: TOUR_ROLES["ofis-sahibi"],
    steps: [
      {
        path: "/app",
        // Yalnız brifing paneli: anlatım ona göre yazıldı; panel yoksa çalıştırıcı adımı atlar (başka öğeye düşmez).
        selectors: ['[data-tour="brifing"]'],
        title: "Bugün",
        desc: "Karar bekleyenler, bugünün randevuları, geciken görevler ve aranacak müşteriler burada sıralanır. Bir satıra dokunursanız ilgili kayıt açılır.",
      },
      {
        path: "/app/baslangic",
        selectors: ['[data-tour="kurulum"]', H1],
        title: "Ofis kurulumu",
        desc: "Kısa adımlarla ofis bilgilerinizi, ekibinizi, verilerinizi ve vitrininizi hazırlayın; her adımı sonraya bırakabilirsiniz. Örnek veriyle başlayıp hazır olunca tek tuşla gerçek kullanıma geçebilirsiniz.",
        requires: TOURABLE_FLOWS["/app/baslangic"],
      },
      {
        path: "/app/ekip",
        selectors: [H1],
        title: "Ekip",
        desc: "Danışmanlarınızı ekleyin; rol, hedef ve uzmanlık alanı verin. Kim ne kadar iş yapıyor buradan izlenir.",
      },
      {
        path: "/app/ilan-havuzu",
        selectors: ['[data-tour="ilan-havuzu"]', H1],
        title: "Havuz ve atama",
        desc: "Ofisin tüm ilanları tek havuzda: sahibi, durumu ve yetki süresiyle. Sahipsiz veya bekleyen ilanı kolayca görürsünüz.",
      },
      {
        path: "/app/ofis-kontrol",
        selectors: ['[data-tour="ofis-kontrol"]', H1],
        title: "Ofis kontrolü",
        desc: "Geciken işler, eksik bilgiler ve riskler tek ekranda; her satır ilgili kayda götürür.",
      },
      {
        path: "/app/ayarlar",
        selectors: [H1],
        title: "Ayarlar",
        desc: "Ofis kimliği ve eşleştirme ayarları burada; üstteki şeritten Yetkiler, Güvenlik, Entegrasyonlar ve Modüller'e geçersiniz. Kullanmadığınız modülleri kapatıp menüyü sadeleştirebilirsiniz.",
      },
      {
        path: "/app/abonelik",
        selectors: [H1],
        title: "Abonelik",
        desc: "Paketiniz, kullanıcı sayınız ve faturalarınız burada. Hesap kredisi (TL) faturalarınızdan düşer, analiz bakiyesi değerleme ve rapor işlemlerinde harcanır; ikisini de kendi sekmesinden görürsünüz.",
      },
    ],
  },
  {
    id: "yonetici",
    label: "Yönetici turu",
    description: "Ekibin performansını, hedefleri ve ofis panosunu izleyin.",
    roles: TOUR_ROLES.yonetici,
    steps: [
      {
        path: "/app",
        selectors: ['[data-tour="brifing"]', '[data-tour="kpi"]'],
        title: "Bugün",
        desc: "Karar bekleyenler, bugünün randevuları ve görevleri bu ekranda toplanır.",
      },
      {
        path: "/app/ekip",
        selectors: [H1],
        title: "Ekip",
        desc: "Danışmanların yükünü, hedeflerini ve uzmanlıklarını görün; iş devri ve atama buradan yönetilir.",
      },
      {
        path: "/app/lig",
        selectors: [H1],
        title: "Lig",
        desc: "Bu ayın sıralaması. Danışman satırına tıklayınca o danışmanın kayıtlarına inersiniz.",
      },
      {
        path: "/app/hedefler",
        selectors: [H1],
        title: "Hedefler",
        desc: "Ay ve danışman bazlı hedefleri belirleyin; ilerleme ana ekranda ve TV panosunda canlı görünür.",
      },
      {
        path: "/app/anlasmalar",
        selectors: [H1],
        title: "Anlaşmalar",
        desc: "Müzakereden kapanışa tüm anlaşmalar. Kapanan anlaşma komisyonu otomatik hesaplar.",
      },
      {
        path: "/app/raporlar",
        selectors: [H1],
        title: "Raporlar",
        desc: "Ofis geneli rapor ve grafikler burada. Ekibim şeridindeki TV ekranı ile aynı bilgiyi ofisteki bir ekrana yansıtabilirsiniz; tam ekranda menü görünmez.",
      },
    ],
  },
  {
    id: "muhasebe",
    label: "Muhasebe turu",
    description: "Komisyon defterini, kazançları ve EmlakSoft aboneliği ile faturalarını tanıyın.",
    roles: TOUR_ROLES.muhasebe,
    steps: [
      {
        path: "/app",
        selectors: ['[data-tour="kpi"]', '[data-tour="brifing"]'],
        title: "Bugün",
        desc: "Ofisin güncel rakamları burada. Bir rakama dokunursanız o kayıtların listesi açılır.",
      },
      {
        path: "/app/komisyon",
        selectors: [H1],
        title: "Komisyon",
        desc: "Kazanılan anlaşmaların komisyonu, danışman ve ofis payı, tahsilat durumu burada. Dosya çıktısı Raporlar > Rapor merkezi'nden alınır.",
      },
      {
        path: "/app/cuzdan",
        selectors: [H1],
        title: "Kazanç",
        desc: "Danışman ve ofis kazançları; hakediş ve tahsilat takibi tek yerde.",
      },
      {
        path: "/app/abonelik",
        selectors: [H1],
        title: "Abonelik ve faturalar",
        desc: "Paketiniz, analiz bakiyesi ve kayıtlı kartlar burada. Faturalar sekmesinde EmlakSoft faturalarınızı görür ve yazdırırsınız. Muhasebe sayfası için ofis sahibinin size Muhasebe izni vermesi gerekir.",
      },
    ],
  },
  {
    id: "danisman",
    label: "Danışman turu",
    description: "Müşteri, talep, randevu ve ilanlarla günlük işinizi öğrenin.",
    roles: TOUR_ROLES.danisman,
    steps: [
      {
        path: "/app",
        selectors: ['[data-tour="brifing"]', '[data-tour="aksiyonlar"]'],
        title: "Bugün",
        desc: "Bugün yapmanız gereken randevular, görevler ve aranacak müşteriler burada özetlenir.",
      },
      {
        path: "/app/musteriler",
        selectors: [H1],
        title: "Müşteriler",
        desc: "Alıcı, satıcı, kiracı; sıcak ve soğuk tüm müşteriler. Bir kayda girince talep, görüşme ve randevular bir arada.",
      },
      {
        path: "/app/talepler",
        selectors: [H1],
        title: "Talepler",
        desc: "Müşterinin aradığı ev: bütçe, bölge, oda. Uygun portföyler otomatik eşleşir.",
      },
      {
        path: "/app/randevular",
        selectors: [H1],
        title: "Randevular",
        desc: "Yer gösterme ve görüşmelerinizi planlayın; bugünkü randevular ana ekranda da görünür.",
      },
      {
        path: "/app/portfoyler",
        selectors: [H1],
        title: "Portföyler",
        desc: "Portföylerinizi ekleyin, fotoğraf ve fiyat güncelleyin, vitrinde ve portallarda ilan olarak yayınlayın.",
      },
      {
        path: "/app",
        selectors: ['[data-tour="arama"]'],
        title: "Arama kutusu",
        desc: "Müşteri adı, portföy kodu veya görev yazın; hepsi tek kutudan bulunur. Bilgisayarda Ctrl+K kısayolu da açar.",
        descMobile: "Üstteki Arama simgesine dokunun; müşteri adı, portföy kodu veya görev yazın, hepsi tek kutudan bulunur.",
      },
    ],
  },
];

/** `tours`: adminden düzenlenmiş turlar (`loadProductTours`); verilmezse koddaki varsayılanlar. */
export function getTour(id: string, tours: readonly TourDef[] = TOURS): TourDef | null {
  return tours.find((t) => t.id === id) ?? null;
}


/**
 * Turun çalıştırılacak adımları: yetkisiz, ofisin kapattığı ve menüde olmayan sayfaların adımları elenir
 * (`/app` ana ekranı her zaman vardır). Menüde olmayan sayfa yalnız `TOURABLE_FLOWS` listesindeyse ve izin şartı
 * (`requires` ya da akışın kendi şartı) sağlanıyorsa kalır. Saf fonksiyon: istemci ve test aynı kapıyı kullanır.
 */
export function resolveTourSteps(id: TourId, ctx: TourResolveCtx, tours: readonly TourDef[] = TOURS): TourStepDef[] {
  const tour = getTour(id, tours);
  if (!tour) return [];
  const sections = visibleSections(ctx.accessible, { closed: ctx.closed });
  const allowed = new Set<string>(["/app"]);
  for (const section of sections)
    for (const item of section.items) {
      allowed.add(item.href);
      for (const tab of item.tabs ?? []) allowed.add(tab.href);
    }
  const permits = (req: { module: AppModule; action: AppAction }) =>
    ctx.accessible.includes(req.module) && (ctx.can ? ctx.can(req.module, req.action) : true);
  return tour.steps.filter((s) => {
    if (s.requires && !permits(s.requires)) return false;
    if (allowed.has(s.path)) return true;
    const flow = TOURABLE_FLOWS[s.path];
    return Boolean(flow && permits(flow));
  });
}

/** En az bu kadar erişilebilir adımı kalan tur listelenir (Yardım ve tur bitişi); daha kısası boş vaattir. */
export const MIN_LISTED_TOUR_STEPS = 3;

/**
 * Yardım ve tur bitişinde listelenecek turlar: rolün kendi turu önde, kalanlar tanım sırasıyla; erişilebilir adımı
 * `MIN_LISTED_TOUR_STEPS`'ten az kalan turlar gizlenir.
 */
export function listableTours(ctx: TourResolveCtx, tours: readonly TourDef[] = TOURS): TourDef[] {
  const own = tourIdForRole(ctx.role ?? null);
  return tours
    .filter((t) => resolveTourSteps(t.id, ctx, tours).length >= MIN_LISTED_TOUR_STEPS)
    .sort((a, b) => Number(b.id === own) - Number(a.id === own));
}
