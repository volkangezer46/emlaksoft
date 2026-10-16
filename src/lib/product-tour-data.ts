import { earningsPath, financePath } from "@/lib/finance/routes";
import { visibleSections } from "@/lib/nav-config";
import type { AppAction, AppModule } from "@/lib/permissions";
import { TOUR_ROLES, tourIdForRole, type TourId } from "@/lib/product-tour-roles";

/**
 * Ürün turları — VARSAYILAN içerik (kodda yedek). Tek uzun tur yerine rol bazlı kısa turlar (her biri en çok 5 adım).
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

/** Tur başına en çok adım (sadeleştirme planı C29: "tur en fazla 5 adım"; product-tour-data.test kilitler). */
export const MAX_TOUR_STEPS = 5;

export const TOURS: readonly TourDef[] = [
  {
    id: "ofis-sahibi",
    label: "Ofis sahibi turu",
    description: "Ana sayfayı, müşteri ve portföy listelerini, ekibinizi ve arama kutusunu tanıyın.",
    roles: TOUR_ROLES["ofis-sahibi"],
    steps: [
      {
        path: "/app",
        // Yalnız brifing paneli: anlatım ona göre yazıldı; panel yoksa çalıştırıcı adımı atlar (başka öğeye düşmez).
        selectors: ['[data-tour="dikkat"]', '[data-tour="brifing"]'],
        title: "Ana Sayfa",
        desc: "Dikkat gerektirenler (geciken kira ve görev, onay bekleyenler) ve bugünün programı burada sıralanır. Bir satıra dokunursanız ilgili kayıt açılır.",
      },
      {
        path: "/app/musteriler",
        selectors: [H1],
        title: "Müşteriler",
        desc: "Alıcı, satıcı ve kiracılarınız. Bir kayda girince talep, görüşme ve randevular bir arada görünür.",
      },
      {
        path: "/app/portfoyler",
        selectors: [H1],
        title: "Portföyler",
        desc: "Ofisin tüm portföyleri: fiyat, fotoğraf ve sahibiyle. Yeni portföyü üstteki düğmeyle eklersiniz.",
      },
      {
        path: "/app/ekip",
        selectors: [H1],
        title: "Ekibim",
        desc: "Danışmanlarınızı ekleyin ve kimin ne kadar iş yaptığını buradan izleyin.",
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
  {
    id: "yonetici",
    label: "Yönetici turu",
    description: "Ekibin işini, hedefleri ve raporları izleyin.",
    roles: TOUR_ROLES.yonetici,
    steps: [
      {
        path: "/app",
        selectors: ['[data-tour="dikkat"]', '[data-tour="brifing"]', '[data-tour="kpi"]'],
        title: "Ana Sayfa",
        desc: "Karar bekleyenler, bugünün randevuları ve görevleri bu ekranda toplanır.",
      },
      {
        path: "/app/ekip",
        selectors: [H1],
        title: "Ekibim",
        desc: "Danışmanların yükünü, hedeflerini ve uzmanlıklarını görün; iş devri ve atama buradan yönetilir.",
      },
      {
        path: "/app/hedefler",
        selectors: [H1],
        title: "Hedefler",
        desc: "Ay ve danışman bazlı hedefleri belirleyin; ilerleme ana ekranda canlı görünür.",
      },
      {
        path: "/app/anlasmalar",
        selectors: [H1],
        title: "Anlaşmalar",
        desc: "Görüşmeden kapanışa tüm anlaşmalar. Kapanan anlaşma komisyonu kendiliğinden hesaplar.",
      },
      {
        path: "/app/raporlar",
        selectors: [H1],
        title: "Raporlar",
        desc: "Ofis geneli rapor ve grafikler burada; her rakam ilgili kayıtlara götürür.",
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
        title: "Ana Sayfa",
        desc: "Ofisin güncel rakamları burada. Bir rakama dokunursanız o kayıtların listesi açılır.",
      },
      {
        path: financePath("komisyon"),
        selectors: [H1],
        title: "Komisyon & ödemeler",
        desc: "Kazanılan anlaşmaların komisyonu, danışman ve ofis payı, tahsilat durumu burada. Dosya çıktısı Raporlar > Rapor merkezi'nden alınır.",
      },
      {
        path: earningsPath(),
        selectors: [H1],
        title: "Kazancım",
        desc: "Danışman ve ofis kazançları; danışman ödemesi ve tahsilat takibi tek yerde.",
      },
      {
        path: "/app/abonelik",
        selectors: [H1],
        title: "Abonelik ve faturalar",
        desc: "Paketiniz, analiz bakiyesi ve kayıtlı kartlar burada. Faturalar sekmesinde EmlakSoft faturalarınızı görür ve yazdırırsınız. Finans sayfası için ofis sahibinin size Muhasebe izni vermesi gerekir.",
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
        title: "Ana Sayfa",
        desc: "Bugün yapmanız gereken randevular, görevler ve aranacak müşteriler burada özetlenir.",
      },
      {
        path: "/app/musteriler",
        selectors: [H1],
        title: "Müşteriler",
        desc: "Alıcı, satıcı, kiracı; sıcak ve soğuk tüm müşteriler. Bir kayda girince talep, görüşme ve randevular bir arada.",
      },
      {
        path: "/app/randevular",
        selectors: [H1],
        title: "Ajandam",
        desc: "Randevu ve görevleriniz aynı programda: yer gösterme ve görüşmelerinizi planlayın; bugünkü program ana sayfada da görünür.",
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
