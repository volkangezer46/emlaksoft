import { visibleSections } from "@/lib/nav-config";
import type { AppModule } from "@/lib/permissions";

/**
 * Ürün turları — TEK veri dosyası. Tek uzun tur yerine rol bazlı kısa turlar (her biri 4-6 adım).
 *
 * Her adım bir SAYFA + o sayfadaki bir ÖĞE seçicisidir. Çalıştırıcı (`product-tour.tsx`) gerekirse sayfaya
 * gider, seçiciyi bekler; bulunamazsa adımı sessizce atlar. Ek olarak çalıştırmadan ÖNCE
 * `resolveTourSteps` ile menüde bulunmayan sayfaların adımları elenir:
 *  - kullanıcının yetkisi olmayan sayfa (erişilebilir modül listesi),
 *  - ofisin kapattığı modüle ait sayfa (Ayarlar > Modüller),
 *  - henüz menüye eklenmemiş sayfa (nav-config tek kaynaktır; sayfa eklenince adım kendiliğinden açılır).
 * Seçiciler sıralı denenir: önce özel `data-tour` işareti, yoksa sayfa başlığı (`#main-content h1`).
 */

export type TourId = "ofis-sahibi" | "yonetici" | "muhasebe" | "danisman";

export type TourStepDef = {
  /** Adımın sayfası (`/app` = ana ekran). Menüde yoksa (çekirdek `/app` hariç) adım elenir. */
  path: string;
  /** Sıralı seçiciler; ilk görünür eşleşme vurgulanır. */
  selectors: readonly string[];
  title: string;
  desc: string;
  descMobile?: string;
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
    roles: ["owner"],
    steps: [
      {
        path: "/app",
        selectors: ['[data-tour="kpi"]', '[data-tour="brifing"]'],
        title: "Ofisinizin rakamları",
        desc: "Müşteri, talep ve komisyon sayıları burada. Bir rakama dokunursanız o kayıtların listesi açılır.",
      },
      {
        path: "/app/baslangic",
        selectors: ['[data-tour="kurulum"]', H1],
        title: "Ofis kurulumu",
        desc: "Sekiz kısa adımda ofis bilgilerinizi, ekibinizi, verilerinizi ve vitrininizi hazırlayın. Örnek veriyle başlayıp hazır olunca tek tuşla gerçek kullanıma geçebilirsiniz.",
      },
      {
        path: "/app/ekip",
        selectors: [H1],
        title: "Ekibiniz",
        desc: "Danışmanlarınızı ekleyin; rol, hedef ve uzmanlık alanı verin. Kim ne kadar iş yapıyor buradan izlenir.",
      },
      {
        path: "/app/ilan-havuzu",
        selectors: ['[data-tour="ilan-havuzu"]', H1],
        title: "İlan havuzu",
        desc: "Ofisin tüm ilanları tek havuzda: sahibi, durumu ve yetki süresiyle. Sahipsiz veya bekleyen ilanı kolayca görürsünüz.",
      },
      {
        path: "/app/ofis-kontrol",
        selectors: ['[data-tour="ofis-kontrol"]', H1],
        title: "Ofis kontrol",
        desc: "Geciken işler, eksik bilgiler ve riskler tek ekranda; her satır ilgili kayda götürür.",
      },
      {
        path: "/app/ayarlar",
        selectors: [H1],
        title: "Ayarlar ve modüller",
        desc: "Roller, tanımlar, ofis bilgileri ve örnek veri durumu burada. Kullanmadığınız modülleri kapatıp menüyü sadeleştirebilirsiniz.",
      },
      {
        path: "/app/abonelik",
        selectors: [H1],
        title: "Krediler",
        desc: "Hesap kredisi (TL) faturalarınızdan düşer, kontör bakiyesi ise değerleme ve rapor işlemlerinde harcanır. Hesap kredisi ve Kontör sekmelerinden bakiyenizi görürsünüz.",
      },
    ],
  },
  {
    id: "yonetici",
    label: "Yönetici turu",
    description: "Ekibin performansını, hedefleri ve ofis panosunu izleyin.",
    roles: ["gm", "branch_manager", "team_lead"],
    steps: [
      {
        path: "/app",
        selectors: ['[data-tour="brifing"]', '[data-tour="kpi"]'],
        title: "Bugünkü durum",
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
        title: "Ekip ligi",
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
        desc: "Müzakereden kapanışa tüm fırsatlar. Kapanan anlaşma komisyonu otomatik hesaplar.",
      },
      {
        path: "/app/raporlar",
        selectors: [H1],
        title: "Raporlar ve ofis panosu",
        desc: "Ofis geneli rapor ve grafikler burada. Soldaki menüden Ofis Panosu (TV) ile aynı bilgiyi ofisteki bir ekrana yansıtabilirsiniz; tam ekranda menü görünmez.",
      },
    ],
  },
  {
    id: "muhasebe",
    label: "Muhasebe turu",
    description: "Komisyon defterini, kazançları ve EmlakSoft aboneliği ile faturalarını tanıyın.",
    roles: ["accounting"],
    steps: [
      {
        path: "/app",
        selectors: ['[data-tour="kpi"]', '[data-tour="brifing"]'],
        title: "Ana ekran",
        desc: "Ofisin güncel rakamları burada. Bir rakama dokunursanız o kayıtların listesi açılır.",
      },
      {
        path: "/app/komisyon",
        selectors: [H1],
        title: "Komisyon defteri",
        desc: "Kazanılan anlaşmaların komisyonu, danışman ve ofis payı, tahsilat durumu burada. \"Dışa aktar\" ile listeyi CSV olarak indirirsiniz.",
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
        desc: "Paketiniz, kontör bakiyesi ve kayıtlı kartlar burada. Faturalar sekmesinde EmlakSoft faturalarınızı görür ve yazdırırsınız. Giderler sayfası için ofis sahibinin size \"expenses\" izni vermesi gerekir.",
      },
    ],
  },
  {
    id: "danisman",
    label: "Danışman turu",
    description: "Müşteri, talep, randevu ve ilanlarla günlük işinizi öğrenin.",
    roles: ["advisor", "call_center", "readonly"],
    steps: [
      {
        path: "/app",
        selectors: ['[data-tour="brifing"]', '[data-tour="aksiyonlar"]'],
        title: "Bugünkü işleriniz",
        desc: "Bugün yapmanız gereken randevular, görevler ve aranacak müşteriler burada özetlenir.",
      },
      {
        path: "/app/musteriler",
        selectors: [H1],
        title: "Müşterileriniz",
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
        title: "Portföy ve ilanlar",
        desc: "İlanlarınızı ekleyin, fotoğraf ve fiyat güncelleyin, vitrinde ve portallarda yayınlayın.",
      },
      {
        path: "/app",
        selectors: ['[data-tour="arama"]'],
        title: "Arama kutusu",
        desc: "Müşteri adı, ilan numarası veya görev yazın; hepsi tek kutudan bulunur. Bilgisayarda Ctrl+K kısayolu da açar.",
        descMobile: "Üstteki Arama simgesine dokunun; müşteri adı, ilan numarası veya görev yazın, hepsi tek kutudan bulunur.",
      },
    ],
  },
];

export function getTour(id: string): TourDef | null {
  return TOURS.find((t) => t.id === id) ?? null;
}

/** Rolün varsayılan turu; bilinmeyen rol en kısıtlı olan danışman turunu alır. */
export function tourIdForRole(role: string | null | undefined): TourId {
  const hit = TOURS.find((t) => t.roles.includes(String(role ?? "")));
  return hit?.id ?? "danisman";
}

/**
 * Turun çalıştırılacak adımları: yetkisiz, ofisin kapattığı ve menüde olmayan sayfaların adımları elenir
 * (`/app` ana ekranı her zaman vardır). Saf fonksiyon: istemci ve test aynı kapıyı kullanır.
 */
export function resolveTourSteps(
  id: TourId,
  ctx: { accessible: readonly AppModule[]; closed: readonly string[]; role?: string | null },
): TourStepDef[] {
  const tour = getTour(id);
  if (!tour) return [];
  const sections = visibleSections(ctx.accessible, { mode: "full", role: ctx.role, closed: ctx.closed });
  const allowed = new Set<string>(["/app"]);
  for (const section of sections)
    for (const item of section.items) {
      allowed.add(item.href);
      for (const tab of item.tabs ?? []) allowed.add(tab.href);
    }
  return tour.steps.filter((s) => allowed.has(s.path));
}
