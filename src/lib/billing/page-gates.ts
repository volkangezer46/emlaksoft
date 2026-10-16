import { financePath } from "@/lib/finance/routes";
import { getPlan, normalizePlanId, planTierOf, type PlanDef, type PlanId } from "@/lib/billing/plans";

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
  { href: "/app/kiralama", title: "Mülk yönetimi", minPlan: "office", pitch: "Kira sözleşmeleri, aylık tahakkuk, gecikme ve depozito takibi tek ekranda." },
  { href: "/app/acik-ev", title: "Açık Ev", minPlan: "office", pitch: "QR ile ziyaretçi kaydı alın, ziyaretçiyi otomatik talebe çevirin." },
  { href: "/app/ilan-kontrol/portallar", title: "Portal Kontrol", minPlan: "office", pitch: "Portal ilanlarınızın teyit, yenileme ve kapanış durumunu takip edin." },
  { href: "/app/ilan-kontrol", title: "İlan Kontrol Merkezi", minPlan: "office", pitch: "Hangi portföy portalda yayında, hangisi kayboldu, kimde açıklama eksik: kayıp ve kaçakları tek ekrandan yakalayın." },
  { href: "/app/kampanyalar", title: "Kampanyalar", minPlan: "office", pitch: "İYS izinlerine uygun toplu SMS ve mesaj kampanyaları gönderin." },
  // Komisyon defteri her pakette açık (Danışman paketinde de kendi komisyonu); Finans'ın geri kalanı Ofis paketinde.
  { href: financePath(), title: "Finans", minPlan: "office", pitch: "Kasa ve banka, cari, tahsilat ve giderleri kaydedin; kâr-zarar tablosunda komisyonla karşılaştırın.", except: [financePath("komisyon")] },
  { href: "/app/aidat", title: "Aidat", minPlan: "office", pitch: "Portföy aidat ve vergi ödemelerini vade ve durumla takip edin." },
  // [id]: kendi profili her pakette açık (Performansım ile ortak gövde); başkasının profili sayfa içinde aynı Ofis kapısından geçer.
  { href: "/app/ekip", title: "Ekip yönetimi", minPlan: "office", pitch: "Danışman ekleyin, rol ve izinleri yönetin, izin takvimini tutun.", except: ["/app/ekip/kartvizitim", "/app/ekip/[id]"] },
  { href: "/app/yabanci-satis", title: "Yabancıya Satış", minPlan: "office", pitch: "Yabancı alıcı için vatandaşlık eşiği, belge ve süreç kontrol listesi." },
  { href: "/app/ofis-kontrol/kayit", title: "Denetim kaydı", minPlan: "office", pitch: "Kim ne zaman neyi değiştirdi veya indirdi, tam denetim izi." },
  { href: "/app/anketler", title: "Anketler ve anketör", minPlan: "office", pitch: "Yayından kalkan, uzayan ve işlem gören işlemler için anketör aramaları, şablonlar ve neden analizi." },
  { href: "/app/raporlar", title: "Raporlar", minPlan: "office", pitch: "Ofis performansı, kaynak ROI'si ve komisyon raporları." },
  // Profesyonel
  { href: "/app/ilan-kontrol/kapanis", title: "Kayıp-kaçak kalkanı", minPlan: "professional", pitch: "Portal ilanlarınızdan rakibe kapanan satışları otomatik bulur ve kaçan komisyonu tahmin eder." },
  { href: "/app/danisman-kpi", title: "Danışman KPI", minPlan: "professional", pitch: "Her danışmanın arama, randevu, teklif ve anlaşma performansı." },
  { href: "/app/lig", title: "Ekip Ligi", minPlan: "professional", pitch: "Danışmanlar arası sıralama, rozetler ve motivasyon panosu." },
  { href: "/app/hedefler", title: "Hedefler", minPlan: "professional", pitch: "Ofis ve danışman bazlı aylık ciro ve anlaşma hedefleri, gerçekleşme takibi." },
  { href: "/app/bolge-analizi", title: "Bölge Analizi", minPlan: "professional", pitch: "Bölge bazlı fiyat trendi, satış süresi ve talep-arz dengesi." },
  { href: "/app/pano-tv", title: "Ofis Panosu (TV)", minPlan: "professional", pitch: "Ofis ekranı için canlı skor ve günün özeti panosu." },
  { href: "/app/otomasyonlar", title: "Otomasyonlar", minPlan: "professional", pitch: "Tetikleyici ve şablonlarla takip, hatırlatma ve görev otomasyonu." },
  { href: "/app/ofis-kontrol/kurallar", title: "Ofis Kontrol kuralları", minPlan: "professional", pitch: "Hangi işlemlerin uyarı üreteceğini ve yönetici onayı gerektireceğini ofisinize göre belirleyin." },
  { href: "/app/ayarlar/is-akislari", title: "İş Akışları", minPlan: "professional", pitch: "Satış sürecinize özel adım adım iş akışı senaryoları." },
  { href: "/app/uyum", title: "KVKK ve Uyum", minPlan: "professional", pitch: "İYS onayları, KVKK silme talepleri ve denetim dosyası." },
  { href: "/app/onaylar", title: "Onay Akışları", minPlan: "professional", pitch: "Komisyon ve indirim gibi kararlar için çok adımlı onay." },
  { href: "/app/ag", title: "Ofisler Arası Ağ", minPlan: "professional", pitch: "Başka ofislerle ilan ve talep paylaşımı, ortak satış." },
  // Kurumsal
  { href: "/app/projeler", title: "Proje Satışı", minPlan: "enterprise", pitch: "Proje ve daire stoğu, ödeme planı ve proje satış yönetimi." },
  { href: "/app/franchise", title: "Şube karşılaştırma", minPlan: "enterprise", pitch: "Şube ve ofis bazlı karşılaştırmalı yönetim raporları." },
];

const PLAN_ORDER: readonly PlanId[] = ["advisor", "office", "professional", "business", "enterprise"];

export function planRank(plan: PlanId): number {
  return PLAN_ORDER.indexOf(plan);
}

export type GateContext = {
  plan: string | null | undefined;
  /**
   * Paketin modül kademesi (adminden eklenen pakette katalogdaki `tier`; `getPlanTier`). Yoksa `plan` taban kimlik
   * olarak okunur (eski davranış: bilinmeyen kimlik Ofis kademesi).
   */
  tier?: PlanId | null;
  /** tenants.status === "trial": deneme boyunca her şey açık. */
  trial: boolean;
  /** tenants.created_at; kesim tarihinden önce açılmış tenant kilitlenmez. */
  tenantCreatedAt: string | null | undefined;
};

/** Kapı hesabında kullanılan kademe: verilmişse `tier`, değilse taban kimlik (bilinmeyen -> Ofis). */
export function gateTierOf(ctx: Pick<GateContext, "plan" | "tier">): PlanId {
  return ctx.tier ?? normalizePlanId(ctx.plan, "office");
}

/**
 * MODÜL-PLAN EŞLEMESİNİN TEK KAYNAĞI: paket (taban ya da eklenen) bu kilidi açıyor mu? Fiyat sayfası karşılaştırması,
 * admin "dahil modüller" listesi ve sayfa kapısı aynı kuralı kullanır.
 */
export function planIncludesGate(def: Pick<PlanDef, "id" | "tier">, gate: Pick<PlanGate, "minPlan">): boolean {
  return planRank(planTierOf(def)) >= planRank(gate.minPlan);
}

/** Paketin açtığı (dahil) kilitli sayfalar; PLAN_GATES sırasıyla. */
export function gatesIncludedIn(def: Pick<PlanDef, "id" | "tier">): PlanGate[] {
  return PLAN_GATES.filter((g) => planIncludesGate(def, g));
}

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
  return planRank(gateTierOf(ctx)) >= planRank(gate.minPlan) ? null : gate;
}

/**
 * Deneme bittiğinde bu paket/tenant için kilitlenecek sayfalar (PLAN_GATES'ten üretilir, sabit liste yok).
 * Kilit hiç uygulanmayan tenant'ta (kesim tarihinden eski) boş döner.
 */
export function gatesLockedAfterTrial(ctx: {
  plan: string | null | undefined;
  tier?: PlanId | null;
  tenantCreatedAt: string | null | undefined;
}): PlanGate[] {
  if (!planGatingApplies({ plan: ctx.plan, trial: false, tenantCreatedAt: ctx.tenantCreatedAt })) return [];
  const rank = planRank(gateTierOf(ctx));
  return PLAN_GATES.filter((g) => rank < planRank(g.minPlan));
}

/** Menüde kilit simgesi göstermek için kilitli yolların listesi. */
export function lockedHrefs(ctx: GateContext): string[] {
  if (!planGatingApplies(ctx)) return [];
  // Kilidin istisna alt yolları `!` önekiyle eklenir (isHrefLocked, src/lib/billing/locked-href.ts).
  return PLAN_GATES.filter((g) => lockedGate(g.href, ctx) !== null).flatMap((g) => [g.href, ...(g.except ?? []).filter((e) => !e.includes("[")).map((e) => `!${e}`)]);
}

export function requiredPlanName(gate: PlanGate): string {
  return getPlan(gate.minPlan).name;
}
