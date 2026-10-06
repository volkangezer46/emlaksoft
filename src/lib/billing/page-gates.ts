import { getPlan, normalizePlanId, type PlanId } from "@/lib/billing/plans";

/**
 * Paket → sayfa kilidi. Paket kartlarındaki özellikler bugüne kadar yalnız satış
 * metniydi; burada gerçekten uygulanır. Kural SAYFA yolu bazlıdır (modül bazlı
 * değil): "Ayarlar" tüm paketlerde açıkken "Otomasyonlar" yalnız Profesyonel'de
 * açılır, oysa ikisi de aynı `settings` modülündedir.
 *
 * Kapsam: yeni tenant'lar (PLAN_GATING_START sonrası kayıt) ve deneme dışı
 * hesaplar. Mevcut tenant'lar kilitsizdir (canlıda bozulma riski sıfır). Deneme
 * süresince (status = "trial") tüm özellikler açıktır.
 *
 * Not: kilit sayfa katmanındadır. Sunucu aksiyonları rol/izin kapısından geçmeye
 * devam eder; paket kilidi ticari bir sınırdır, güvenlik sınırı değildir.
 */
export const PLAN_GATING_START = "2026-10-03T00:00:00.000Z";

export type PlanGate = {
  /** Kilitlenen sayfa yolu (ön ek eşleşir; alt sayfalar dahil). */
  href: string;
  title: string;
  minPlan: PlanId;
  /** Yükseltme sayfasında gösterilen tek cümlelik fayda. */
  pitch: string;
  /** Ön ek altında paketten bağımsız açık kalan yollar. */
  except?: readonly string[];
};

export const PLAN_GATES: readonly PlanGate[] = [
  // Ofis
  { href: "/app/teklifler", title: "Teklifler", minPlan: "office", pitch: "Teklif turlarını, karşı teklifi ve kabulü tek yerde yönetin; kabul edilen teklif tek tıkla anlaşmaya dönüşür." },
  { href: "/app/sozlesmeler", title: "Sözleşmeler", minPlan: "office", pitch: "Şablondan sözleşme hazırlayın, SMS onaylı dijital imzaya gönderin, imza sonrası dosya otomatik saklansın." },
  { href: "/app/kiralama", title: "Kiralama", minPlan: "office", pitch: "Kira sözleşmeleri, aylık tahakkuk, gecikme ve depozito takibi tek ekranda." },
  { href: "/app/acik-ev", title: "Açık Ev", minPlan: "office", pitch: "QR ile ziyaretçi kaydı alın, ziyaretçiyi otomatik talebe çevirin." },
  { href: "/app/portallar", title: "Portal Kontrol", minPlan: "office", pitch: "Portal ilanlarınızın teyit, yenileme ve kapanış durumunu takip edin." },
  { href: "/app/ilan-kontrol", title: "İlan Kontrol Merkezi", minPlan: "office", pitch: "Hangi portföy portalda yayında, hangisi kayboldu, kimde açıklama eksik: kayıp ve kaçakları tek ekrandan yakalayın." },
  { href: "/app/kampanyalar", title: "Kampanyalar", minPlan: "office", pitch: "İYS izinlerine uygun toplu SMS ve mesaj kampanyaları gönderin." },
  { href: "/app/giderler", title: "Giderler", minPlan: "office", pitch: "Ofis giderlerini kaydedin, kâr-zarar tablosunda komisyonla karşılaştırın." },
  { href: "/app/aidat", title: "Aidat", minPlan: "office", pitch: "Portföy aidat ve vergi ödemelerini vade ve durumla takip edin." },
  // kazanc: eski yol, yalnız /app/cuzdan?sekme=ofis yönlendirmesi (Kazanç tek sayfa, Danışman paketinde de açık).
  // [id]: kendi profili her pakette açık (Performansım ile ortak gövde); başkasının profili sayfa içinde aynı Ofis kapısından geçer.
  { href: "/app/ekip", title: "Ekip yönetimi", minPlan: "office", pitch: "Danışman ekleyin, rol ve izinleri yönetin, izin takvimini tutun.", except: ["/app/ekip/kartvizitim", "/app/ekip/kazanc", "/app/ekip/[id]"] },
  { href: "/app/yabanci-satis", title: "Yabancıya Satış", minPlan: "office", pitch: "Yabancı alıcı için vatandaşlık eşiği, belge ve süreç kontrol listesi." },
  { href: "/app/denetim", title: "Denetim kaydı", minPlan: "office", pitch: "Kim ne zaman neyi değiştirdi veya indirdi, tam denetim izi." },
  { href: "/app/anketler", title: "Anketler ve anketör", minPlan: "office", pitch: "Yayından kalkan, uzayan ve işlem gören işlemler için anketör aramaları, şablonlar ve neden analizi." },
  { href: "/app/raporlar", title: "Raporlar", minPlan: "office", pitch: "Ofis performansı, kaynak ROI'si ve komisyon raporları." },
  // Profesyonel
  { href: "/app/kayip-kacak", title: "Kayıp-kaçak kalkanı", minPlan: "professional", pitch: "Portal ilanlarınızdan rakibe kapanan satışları otomatik bulur ve kaçan komisyonu tahmin eder." },
  { href: "/app/danisman-kpi", title: "Danışman KPI", minPlan: "professional", pitch: "Her danışmanın arama, randevu, teklif ve anlaşma performansı." },
  { href: "/app/ekip/kiyas", title: "Danışman kıyası", minPlan: "professional", pitch: "Danışman karnesi: dönüşüm, aktif iş yükü, randevu ve hedef gerçekleşmesi tek tabloda." },
  { href: "/app/lig", title: "Ekip Ligi", minPlan: "professional", pitch: "Danışmanlar arası sıralama, rozetler ve motivasyon panosu." },
  { href: "/app/hedefler", title: "Hedefler", minPlan: "professional", pitch: "Ofis ve danışman bazlı aylık ciro ve anlaşma hedefleri, gerçekleşme takibi." },
  { href: "/app/bolge-analizi", title: "Bölge Analizi", minPlan: "professional", pitch: "Bölge bazlı fiyat trendi, satış süresi ve talep-arz dengesi." },
  { href: "/app/kayip-satis", title: "Risk altındaki müşteriler", minPlan: "professional", pitch: "Kaybedilme riski taşıyan müşteri ve talepleri erken yakalayın." },
  { href: "/app/pano-tv", title: "Ofis Panosu (TV)", minPlan: "professional", pitch: "Ofis ekranı için canlı skor ve günün özeti panosu." },
  { href: "/app/otomasyonlar", title: "Otomasyonlar", minPlan: "professional", pitch: "Tetikleyici ve şablonlarla takip, hatırlatma ve görev otomasyonu." },
  { href: "/app/ofis-kontrol/kurallar", title: "Ofis Kontrol kuralları", minPlan: "professional", pitch: "Hangi işlemlerin uyarı üreteceğini ve yönetici onayı gerektireceğini ofisinize göre belirleyin." },
  { href: "/app/ayarlar/is-akislari", title: "İş Akışları", minPlan: "professional", pitch: "Satış sürecinize özel adım adım iş akışı senaryoları." },
  { href: "/app/uyum", title: "KVKK ve Uyum", minPlan: "professional", pitch: "İYS onayları, KVKK silme talepleri ve denetim dosyası." },
  { href: "/app/onaylar", title: "Onay Akışları", minPlan: "professional", pitch: "Komisyon ve indirim gibi kararlar için çok adımlı onay." },
  { href: "/app/ag", title: "Ofisler Arası Ağ", minPlan: "professional", pitch: "Başka ofislerle ilan ve talep paylaşımı, ortak satış." },
  // Kurumsal
  { href: "/app/projeler", title: "Proje Satışı", minPlan: "enterprise", pitch: "Proje ve daire stoğu, ödeme planı ve proje satış yönetimi." },
  { href: "/app/franchise", title: "Franchise BI", minPlan: "enterprise", pitch: "Şube ve ofis bazlı karşılaştırmalı yönetim raporları." },
];

const PLAN_ORDER: readonly PlanId[] = ["advisor", "office", "professional", "business", "enterprise"];

export function planRank(plan: PlanId): number {
  return PLAN_ORDER.indexOf(plan);
}

export type GateContext = {
  plan: string | null | undefined;
  /** tenants.status === "trial": deneme boyunca her şey açık. */
  trial: boolean;
  /** tenants.created_at; kesim tarihinden önce açılmış tenant kilitlenmez. */
  tenantCreatedAt: string | null | undefined;
};

/** Bu tenant için paket kilidi uygulanır mı? */
export function planGatingApplies(ctx: GateContext): boolean {
  if (ctx.trial) return false;
  if (!ctx.tenantCreatedAt) return false;
  const created = Date.parse(ctx.tenantCreatedAt);
  if (!Number.isFinite(created)) return false;
  return created >= Date.parse(PLAN_GATING_START);
}

function matches(path: string, prefix: string): boolean {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return p === prefix || p.startsWith(`${prefix}/`);
}

/** Yola uyan en uzun kilit tanımı (yoksa null). */
export function findGate(path: string): PlanGate | null {
  let best: PlanGate | null = null;
  for (const gate of PLAN_GATES) {
    if (!matches(path, gate.href)) continue;
    if (gate.except?.some((e) => matches(path, e))) continue;
    if (!best || gate.href.length > best.href.length) best = gate;
  }
  return best;
}

/** Yol bu tenant için kilitliyse kilit tanımını, değilse null döner. */
export function lockedGate(path: string, ctx: GateContext): PlanGate | null {
  if (!planGatingApplies(ctx)) return null;
  const gate = findGate(path);
  if (!gate) return null;
  const plan = normalizePlanId(ctx.plan, "office");
  return planRank(plan) >= planRank(gate.minPlan) ? null : gate;
}

/**
 * Deneme bittiğinde bu paket/tenant için kilitlenecek sayfalar (PLAN_GATES'ten üretilir, sabit liste yok).
 * Kilit hiç uygulanmayan tenant'ta (kesim tarihinden eski) boş döner.
 */
export function gatesLockedAfterTrial(ctx: { plan: string | null | undefined; tenantCreatedAt: string | null | undefined }): PlanGate[] {
  if (!planGatingApplies({ plan: ctx.plan, trial: false, tenantCreatedAt: ctx.tenantCreatedAt })) return [];
  const rank = planRank(normalizePlanId(ctx.plan, "office"));
  return PLAN_GATES.filter((g) => rank < planRank(g.minPlan));
}

/** Menüde kilit simgesi göstermek için kilitli yolların listesi. */
export function lockedHrefs(ctx: GateContext): string[] {
  if (!planGatingApplies(ctx)) return [];
  return PLAN_GATES.filter((g) => lockedGate(g.href, ctx) !== null).map((g) => g.href);
}

export function requiredPlanName(gate: PlanGate): string {
  return getPlan(gate.minPlan).name;
}
