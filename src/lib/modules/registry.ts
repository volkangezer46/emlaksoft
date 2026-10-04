import { findGate, planRank, type PlanGate } from "@/lib/billing/page-gates";

/**
 * Modül kayıt defteri (saf veri; istemciden de import edilir).
 *
 * Yetki = kim, paket = ne satın alındı, modül = ofiste açık mı. `FeatureKey` ürün alanıdır,
 * izin modülü (`AppModule`) ile aynı şey DEĞİLDİR: her anahtar rota ön ekleriyle sayfalara bağlanır.
 * Satır yoksa modül AÇIK; çekirdek/sistem alanlar kapatılamaz (aşağıdaki `CORE_AREAS`).
 */

export type FeatureGroupId = "satis" | "iletisim" | "portfoy" | "finans" | "ekip" | "gelismis";

export const FEATURE_GROUPS: readonly { id: FeatureGroupId; title: string }[] = [
  { id: "satis", title: "Satış süreci" },
  { id: "iletisim", title: "İletişim ve pazarlama" },
  { id: "portfoy", title: "Portföy araçları" },
  { id: "finans", title: "Finans ve raporlar" },
  { id: "ekip", title: "Ekip" },
  { id: "gelismis", title: "Gelişmiş" },
];

export type ModuleDef = {
  key: string;
  label: string;
  /** Sade Türkçe: ne işe yarar. */
  desc: string;
  group: FeatureGroupId;
  /** /app rota ön ekleri (en uzun ön ek eşleşir). Menüde yolu olmayan modülde boş. */
  routes: readonly string[];
  /** Token'lı / herkese açık yollar (kapalıyken "kapalı" sayfası gösterir). */
  publicRoutes: readonly string[];
  /** Bağımlı olduğu kapatılabilir modüller: bunlardan biri kapalıyken bu modül açık kalamaz. */
  dependsOn: readonly string[];
  /** Kapalıyken durdurulan bağlı iş (bilgi metni). */
  stops?: string;
};

export const MODULES = [
  { key: "offers", label: "Teklifler", desc: "Teklif turlarını, karşı teklifi ve kabulü tek yerde yönetin.", group: "satis", routes: ["/app/teklifler"], publicRoutes: [], dependsOn: [], stops: "Malik portalında teklif bölümü ve teklif tetikleyicili otomasyonlar çalışmaz." },
  { key: "contracts", label: "Sözleşmeler ve e-imza", desc: "Şablondan sözleşme hazırlayın, SMS onaylı dijital imzaya gönderin.", group: "satis", routes: ["/app/sozlesmeler"], publicRoutes: ["/imza"], dependsOn: [], stops: "Bekleyen imza bağlantıları \"kapalı\" sayfası gösterir." },
  { key: "approvals", label: "Onay akışları", desc: "Komisyon ve indirim gibi kararlar için çok adımlı onay.", group: "satis", routes: ["/app/onaylar"], publicRoutes: [], dependsOn: [], stops: "Ana ekrandaki onay satırı gizlenir." },
  { key: "lost_sales", label: "Kayıp nedenleri", desc: "Kaybedilen anlaşmaların nedenlerini ve erken uyarıları görün.", group: "satis", routes: ["/app/kayip-satis"], publicRoutes: [], dependsOn: [] },
  { key: "surveys", label: "Anketler ve anketör", desc: "Yayından kalkan, uzayan ve işlem gören işlemler için anketör aramaları, şablonlar ve sonuçlar.", group: "iletisim", routes: ["/app/anketler"], publicRoutes: [], dependsOn: [], stops: "Yeni anket görevi üretilmez; anketör kuyruğu ve görev bağlantıları durur (kayıtlar silinmez)." },
  { key: "campaigns", label: "Kampanyalar", desc: "İYS izinlerine uygun toplu SMS ve mesaj kampanyaları gönderin.", group: "iletisim", routes: ["/app/kampanyalar"], publicRoutes: [], dependsOn: [], stops: "Zamanlanmış gönderimler çalışmaz (silinmez)." },
  { key: "smart_lists", label: "Akıllı Listeler ve Tavsiyeler", desc: "Müşterileri kurala göre listeleyin; tavsiye bağlantılarını yönetin.", group: "iletisim", routes: ["/app/akilli-listeler", "/app/tavsiyeler"], publicRoutes: ["/tavsiye"], dependsOn: [], stops: "Herkese açık tavsiye bağlantıları \"kapalı\" sayfası gösterir." },
  { key: "open_house", label: "Açık Ev", desc: "QR ile ziyaretçi kaydı alın, ziyaretçiyi otomatik talebe çevirin.", group: "portfoy", routes: ["/app/acik-ev"], publicRoutes: ["/acik-ev-kayit"], dependsOn: [], stops: "Herkese açık kayıt sayfası \"kapalı\" gösterir." },
  { key: "rentals", label: "Kiralama ve kira artışı", desc: "Kira sözleşmeleri, aylık tahakkuk, gecikme, depozito ve kira artışı.", group: "portfoy", routes: ["/app/kiralama", "/app/kira-artis"], publicRoutes: [], dependsOn: [], stops: "Aylık kira tahakkuku üretilmez; ana ekran kiralama şeridi gizlenir." },
  { key: "projects", label: "Proje Satışı", desc: "Proje ve daire stoğu, ödeme planı ve proje satış yönetimi.", group: "portfoy", routes: ["/app/projeler"], publicRoutes: [], dependsOn: [], stops: "Proje vade hatırlatmaları çalışmaz." },
  { key: "portals", label: "Portal Kontrol", desc: "Portal ilanlarınızın teyit, yenileme ve kapanış durumunu takip edin.", group: "portfoy", routes: ["/app/portallar"], publicRoutes: [], dependsOn: [], stops: "Portal teyit hatırlatmaları çalışmaz." },
  { key: "keys", label: "Anahtar Takibi", desc: "Anahtarın kimde olduğunu ve gecikmeleri izleyin.", group: "portfoy", routes: ["/app/portfoyler/anahtarlar"], publicRoutes: [], dependsOn: [], stops: "Anahtar gecikme uyarıları çalışmaz." },
  { key: "presentations", label: "Sunumlar", desc: "Müşteriye gönderilecek portföy sunumları ve paylaşım bağlantıları.", group: "portfoy", routes: ["/app/portfoyler/sunumlar"], publicRoutes: ["/sunum", "/paylas"], dependsOn: [], stops: "Aktif sunum bağlantıları \"kapalı\" sayfası gösterir." },
  { key: "network", label: "Ofisler Arası Ağ", desc: "Başka ofislerle ilan ve talep paylaşımı, ortak satış.", group: "portfoy", routes: ["/app/ag"], publicRoutes: [], dependsOn: [] },
  { key: "foreign_sale", label: "Yabancıya Satış", desc: "Yabancı alıcı için vatandaşlık eşiği, belge ve süreç kontrol listesi.", group: "portfoy", routes: ["/app/yabanci-satis"], publicRoutes: [], dependsOn: [] },
  { key: "valuation", label: "Değerleme ve Hesaplayıcılar", desc: "Emsal tabanlı değerleme, alım maliyeti ve yatırım getirisi hesaplayıcıları.", group: "finans", routes: ["/app/degerleme", "/app/hesaplayici"], publicRoutes: ["/degerleme", "/degerleme-raporu"], dependsOn: [], stops: "Herkese açık değerleme sayfaları \"kapalı\" gösterir." },
  { key: "expenses", label: "Giderler ve Aidat", desc: "Ofis giderleri, aidat ve vergi ödemeleri; kâr-zarar tablosu.", group: "finans", routes: ["/app/giderler", "/app/aidat"], publicRoutes: [], dependsOn: [], stops: "Muhasebe rolünün menüsü boşalır." },
  { key: "reports", label: "Raporlar", desc: "Ofis performansı, bölge analizi, talep-arz ve memnuniyet raporları.", group: "finans", routes: ["/app/raporlar", "/app/bolge-analizi"], publicRoutes: [], dependsOn: [], stops: "Bölge anlık görüntüsü ve haftalık özet üretilmez." },
  { key: "leak", label: "Kaçan komisyonlar", desc: "Portal ilanlarından rakibe kapanan satışları ve kaçan komisyonu bulur.", group: "finans", routes: ["/app/kayip-kacak"], publicRoutes: [], dependsOn: ["portals"], stops: "Kaçak SLA uyarıları çalışmaz; ana ekran bloğu gizlenir." },
  { key: "team_perf", label: "Ekip performansı", desc: "Danışman kıyası, KPI, ekip ligi ve hedefler.", group: "ekip", routes: ["/app/ekip/kiyas", "/app/danisman-kpi", "/app/lig", "/app/hedefler"], publicRoutes: [], dependsOn: [], stops: "Lig anlık görüntüsü üretilmez; ana ekran hedef kartı gizlenir." },
  { key: "franchise", label: "Şube ve Franchise", desc: "Şube ve ofis bazlı karşılaştırmalı yönetim raporları.", group: "ekip", routes: ["/app/franchise"], publicRoutes: [], dependsOn: ["team_perf"] },
  { key: "tv_board", label: "Ofis Panosu (TV)", desc: "Ofis ekranı için canlı skor ve günün özeti panosu.", group: "ekip", routes: ["/app/pano-tv"], publicRoutes: [], dependsOn: ["reports"] },
  { key: "automation", label: "Otomasyon ve iş akışları", desc: "Tetikleyicili kurallar, hatırlatmalar ve adım adım iş akışları.", group: "gelismis", routes: ["/app/otomasyonlar", "/app/ayarlar/is-akislari"], publicRoutes: [], dependsOn: [], stops: "Kurallar ve iş akışları çalıştırılmaz (silinmez)." },
  { key: "documents", label: "Belge Merkezi", desc: "Ofis belgeleri ve şablonları tek yerde. Müşteri ve portföy dosya sekmeleri etkilenmez.", group: "gelismis", routes: ["/app/belgeler"], publicRoutes: [], dependsOn: [] },
  { key: "ai_assistant", label: "AI Asistan", desc: "Ofis verilerinizle sohbet eden yardımcı. Kapalıyken yapay zekâ çağrısı yapılmaz.", group: "gelismis", routes: ["/app/asistan"], publicRoutes: [], dependsOn: [], stops: "Yapay zekâ çağrısı yapılmaz." },
  { key: "vitrin", label: "Vitrin ve danışman sayfaları", desc: "Herkese açık ofis vitrini, danışman sayfaları ve randevu al.", group: "gelismis", routes: [], publicRoutes: ["/vitrin", "/danisman", "/randevu-al"], dependsOn: [], stops: "Herkese açık vitrin sayfaları \"kapalı\" gösterir; vitrin alarmları çalışmaz." },
  { key: "client_portals", label: "Müşteri ve malik portalı", desc: "Müşteriye ve ev sahibine özel, bağlantıyla açılan bilgi sayfaları.", group: "gelismis", routes: [], publicRoutes: ["/musteri-portali", "/malik-portali"], dependsOn: [] },
] as const satisfies readonly ModuleDef[];

export type FeatureKey = (typeof MODULES)[number]["key"];

export const FEATURE_KEYS: readonly FeatureKey[] = MODULES.map((m) => m.key);

/** Kapatılamayan çekirdek ve sistem alanları (bilgi amaçlı; Modüller ekranında kilitli gösterilir). */
export const CORE_AREAS: readonly { key: string; label: string; desc: string }[] = [
  { key: "customers", label: "Müşteriler ve Talepler", desc: "Müşteri kartları, talepler ve eşleşme." },
  { key: "properties", label: "Portföyler", desc: "İlan ve portföy kayıtları." },
  { key: "appointments", label: "Randevular", desc: "Randevu takvimi." },
  { key: "tasks", label: "Görevler", desc: "Görev listesi." },
  { key: "deals", label: "Anlaşmalar, Komisyon ve Kazanç", desc: "Satış hattı ve komisyon omurgası." },
  { key: "inbox", label: "Gelen Kutusu", desc: "WhatsApp, SMS ve aday girişleri buraya akar." },
  { key: "dashboard", label: "Ana ekran ve Performansım", desc: "Günlük özet ve kişisel karne." },
  { key: "system", label: "Ayarlar, Uyum, Denetim, Abonelik, Yardım", desc: "KVKK/İYS kaydı ve güvenlik izi kapatılamaz." },
];

const BY_KEY: ReadonlyMap<string, ModuleDef> = new Map(MODULES.map((m) => [m.key, m]));

export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && BY_KEY.has(value);
}

export function getModuleDef(key: FeatureKey): ModuleDef {
  return BY_KEY.get(key)!;
}

/** Çekirdek alan mı (kapatılamaz)? Kayıt defterinde olmayan her anahtar çekirdek/sistem sayılır. */
export function isCoreKey(key: string): boolean {
  return !BY_KEY.has(key);
}

function matches(path: string, prefix: string): boolean {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return p === prefix || p.startsWith(`${prefix}/`);
}

const ROUTE_TABLE: readonly { prefix: string; key: FeatureKey }[] = MODULES.flatMap((m) =>
  m.routes.map((prefix) => ({ prefix, key: m.key })),
).sort((a, b) => b.prefix.length - a.prefix.length);

/**
 * Yolun (sorgu/hash atılır) bağlı olduğu kapatılabilir modül; çekirdek yol için null.
 * En uzun ön ek kazanır (`/app/portfoyler/sunumlar` -> presentations, `/app/portfoyler` -> null).
 */
export function featureForHref(href: string): FeatureKey | null {
  const path = href.split(/[?#]/)[0] ?? href;
  for (const row of ROUTE_TABLE) if (matches(path, row.prefix)) return row.key;
  return null;
}

/** Herkese açık yol için bağlı modül (token sayfaları). */
export function featureForPublicPath(path: string): FeatureKey | null {
  for (const m of MODULES) if (m.publicRoutes.some((r) => matches(path, r))) return m.key;
  return null;
}

/** `key` kapanınca kapanması gereken modüller (ters bağımlılık, geçişli). `key` kendisi dahil değil. */
export function dependentsOf(key: FeatureKey): FeatureKey[] {
  const out = new Set<FeatureKey>();
  const stack: string[] = [key];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const m of MODULES) {
      if ((m.dependsOn as readonly string[]).includes(cur) && !out.has(m.key)) {
        out.add(m.key);
        stack.push(m.key);
      }
    }
  }
  return [...out];
}

/** Açılmak için önce açık olması gereken ama kapalı olan bağımlılıklar (geçişli). */
export function closedDependencies(key: FeatureKey, closed: ReadonlySet<string>): FeatureKey[] {
  const out = new Set<FeatureKey>();
  const stack: FeatureKey[] = [key];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const dep of getModuleDef(cur).dependsOn) {
      if (isFeatureKey(dep) && closed.has(dep) && !out.has(dep)) {
        out.add(dep);
        stack.push(dep);
      }
    }
  }
  return [...out];
}

/** Kapalı kümesini bağımlılıklarla tutarlı hale getirir: kapalı modüle bağlı olan da kapanır. */
export function normalizeClosed(closed: Iterable<string>): FeatureKey[] {
  const set = new Set<FeatureKey>();
  for (const k of closed) {
    if (!isFeatureKey(k)) continue;
    set.add(k);
    for (const d of dependentsOf(k)) set.add(d);
  }
  return FEATURE_KEYS.filter((k) => set.has(k));
}

/**
 * Kartın "pakette var mı" bilgisi yalnız `PLAN_GATES`'ten türetilir (tek fonksiyon):
 * modülün ilk rotasının paket kilidi (yoksa null = her pakette).
 */
export function modulePlanRequirement(key: FeatureKey): PlanGate | null {
  const def = getModuleDef(key);
  let best: PlanGate | null = null;
  for (const route of def.routes) {
    const gate = findGate(route);
    if (gate && (!best || planRank(gate.minPlan) > planRank(best.minPlan))) best = gate;
  }
  return best;
}

/** Herkese açık sayfada gösterilen ortak metin. */
export const MODULE_CLOSED_PUBLIC_MESSAGE = "Bu özellik ofis tarafından kapatılmıştır.";

/** Modül kapalıyken gösterilen yönlendirme adresi. */
export function moduleClosedHref(key: FeatureKey): string {
  return `/app/modul-kapali?modul=${encodeURIComponent(key)}`;
}
