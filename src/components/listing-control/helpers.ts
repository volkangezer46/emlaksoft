import { bandFromScore, RISK_BAND_LABEL } from "@/lib/listing-control/risk-language";
import { KPI_KEYS, KPI_LABELS, type KpiKey, type ScopeKind } from "@/lib/listing-control/types";

/**
 * İlan Kontrol Merkezi SAF yardımcıları (DB/React yok; testli). Motor (`src/lib/listing-control/**`) değiştirilmez:
 * burada yalnız ekran mantığı (KPI -> adres, gruplama, kural tabanlı özet cümle, SLA geri sayımı) bulunur.
 */

export const CONTROL_BASE = "/app/ilan-kontrol";

/** Gruplama seçenekleri (URL: ?gruplama=ofis|sube|takim|danisman). Rol kapsamı RLS'te uygulanır. */
export const GROUP_OPTIONS = [
  { value: "ofis", scope: "tenant", label: "Ofis" },
  { value: "sube", scope: "branch", label: "Şube" },
  { value: "takim", scope: "team", label: "Takım" },
  { value: "danisman", scope: "advisor", label: "Danışman" },
] as const;
export type GroupParam = (typeof GROUP_OPTIONS)[number]["value"];

export function parseGroupParam(raw: string | string[] | undefined): GroupParam {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return GROUP_OPTIONS.find((g) => g.value === v)?.value ?? "ofis";
}

export function scopeOfGroup(g: GroupParam): ScopeKind {
  return GROUP_OPTIONS.find((o) => o.value === g)?.scope ?? "tenant";
}

export function groupParamOfScope(s: ScopeKind): GroupParam {
  return GROUP_OPTIONS.find((o) => o.scope === s)?.value ?? "ofis";
}

export function isKpiKey(v: unknown): v is KpiKey {
  return typeof v === "string" && (KPI_KEYS as readonly string[]).includes(v);
}

/** KPI kartı -> filtreli liste adresi (sayı ile liste AYNI k_* kolonundan okunur: sıfır çıkmaz metrik). */
export function kpiHref(kpi: KpiKey, group: GroupParam = "ofis", groupId: string | null = null): string {
  const q = new URLSearchParams({ kpi });
  if (group !== "ofis") q.set("gruplama", group);
  if (groupId) q.set("grup", groupId);
  return `${CONTROL_BASE}/liste?${q.toString()}`;
}

export type KpiVisual = "healthy" | "pending" | "mismatch" | "critical" | "unverifiable" | "neutral";

/** Renk tek başına anlam taşımaz: her görsel durumun ikon adı + etiketi vardır. */
export const KPI_VISUAL: Record<KpiKey, { visual: KpiVisual; hint: string }> = {
  active: { visual: "neutral", hint: "Kontrol kapsamındaki aktif portföyler" },
  in_portals: { visual: "healthy", hint: "En az bir portalda yayında" },
  awaiting_publish: { visual: "pending", hint: "Danışmana verildi, yayınlanmadı" },
  portal_missing: { visual: "critical", hint: "Portalda bulunamayan ilan" },
  price_mismatch: { visual: "mismatch", hint: "Portal fiyatı CRM'den farklı" },
  in_review: { visual: "mismatch", hint: "Açıklama bekleyen uyarılar" },
  unverifiable: { visual: "unverifiable", hint: "Portal kontrolü yapılamadı" },
  healthy: { visual: "healthy", hint: "Sorunsuz ve güncel" },
};

export const VISUAL_LABEL: Record<KpiVisual, string> = {
  healthy: "Sağlıklı",
  pending: "Kontrol bekliyor",
  mismatch: "Uyuşmazlık",
  critical: "Kritik",
  unverifiable: "Kontrol edilemiyor",
  neutral: "Genel",
};

export type SummaryNumbers = {
  total_active: number;
  in_portals: number;
  awaiting_publish: number;
  portal_missing: number;
  price_mismatch: number;
  in_review: number;
  unverifiable: number;
  healthy: number;
};

export function emptySummary(): SummaryNumbers {
  return { total_active: 0, in_portals: 0, awaiting_publish: 0, portal_missing: 0, price_mismatch: 0, in_review: 0, unverifiable: 0, healthy: 0 };
}

/** Grup satırlarını tek özet satırına toplar (sağlıklı oran toplamlardan yeniden hesaplanır; satır oranları ortalanmaz). */
export function sumSummaryRows(rows: readonly SummaryNumbers[]): SummaryNumbers {
  const acc = emptySummary();
  for (const r of rows) {
    acc.total_active += r.total_active;
    acc.in_portals += r.in_portals;
    acc.awaiting_publish += r.awaiting_publish;
    acc.portal_missing += r.portal_missing;
    acc.price_mismatch += r.price_mismatch;
    acc.in_review += r.in_review;
    acc.unverifiable += r.unverifiable;
    acc.healthy += r.healthy;
  }
  return acc;
}

/** Sağlıklı oran % (yuvarlak). Aktif portföy yoksa null: sahte yüzde gösterilmez. */
export function healthyPercent(s: Pick<SummaryNumbers, "total_active" | "healthy">): number | null {
  if (s.total_active <= 0) return null;
  return Math.round((s.healthy / s.total_active) * 100);
}

export type KpiCardModel = { key: KpiKey; label: string; value: number; href: string; visual: KpiVisual; hint: string };

const KPI_CARD_ORDER: readonly KpiKey[] = ["active", "in_portals", "awaiting_publish", "portal_missing", "price_mismatch", "in_review", "unverifiable"];

export function buildKpiCards(s: SummaryNumbers, group: GroupParam = "ofis", groupId: string | null = null): KpiCardModel[] {
  const valueOf: Record<KpiKey, number> = {
    active: s.total_active,
    in_portals: s.in_portals,
    awaiting_publish: s.awaiting_publish,
    portal_missing: s.portal_missing,
    price_mismatch: s.price_mismatch,
    in_review: s.in_review,
    unverifiable: s.unverifiable,
    healthy: s.healthy,
  };
  return KPI_CARD_ORDER.map((key) => ({
    key,
    label: KPI_LABELS[key],
    value: valueOf[key],
    href: kpiHref(key, group, groupId),
    visual: KPI_VISUAL[key].visual,
    hint: KPI_VISUAL[key].hint,
  }));
}

// ---------------------------------------------------------------- anomali türleri

export const ANOMALY_TYPE_LABELS: Record<string, string> = {
  portal_missing: "Portal ilanı kayıp",
  not_published: "Yayınlanmamış",
  unregistered_listing: "Kayıtsız ilan",
  bulk_mismatch: "Toplu uyuşmazlık",
  price_mismatch: "Fiyat uyuşmazlığı",
  advisor_mismatch: "Danışman uyuşmazlığı",
  duplicate: "Kopya ilan",
  potential_lost_deal: "Olası kayıp işlem",
  sold_still_listed: "Satılmış, portalda hâlâ yayında",
  incomplete_closure: "Eksik kapanış",
  authority_expiring: "Yetki bitiyor/bitmiş",
};

/** Kuyruk filtre çipleri (URL: ?tur=). */
export const ANOMALY_FILTERS: readonly { value: string; label: string }[] = [
  { value: "portal_missing", label: "Portal kayıp" },
  { value: "not_published", label: "Yayınlanmayan" },
  { value: "unregistered_listing", label: "Kayıtsız ilan" },
  { value: "price_mismatch", label: "Fiyat" },
  { value: "advisor_mismatch", label: "Danışman" },
  { value: "duplicate", label: "Kopya" },
  { value: "potential_lost_deal", label: "Olası kayıp işlem" },
  { value: "sold_still_listed", label: "Satılmış, hâlâ portalda" },
  { value: "authority_expiring", label: "Yetki" },
  { value: "incomplete_closure", label: "Eksik kapanış" },
];

export function parseAnomalyType(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && ANOMALY_FILTERS.some((f) => f.value === v) ? v : null;
}

export function anomalyTypeLabel(type: string): string {
  return ANOMALY_TYPE_LABELS[type] ?? "Diğer uyarı";
}

export function riskLabel(score: number | null): { label: string; level: "critical" | "high" | "medium" | "low" | "none" } {
  // TEK risk dili: eşikler ve etiketler `risk-language.ts` (Kayıp-Kaçak Kalkanı ile ortak).
  const level = bandFromScore(score);
  return { label: RISK_BAND_LABEL[level], level };
}

/** SLA geri sayımı: vade geçtiyse "gecikti". Vade yoksa null (gösterilmez). */
export function slaCountdown(dueIso: string | null, nowMs: number): { label: string; overdue: boolean } | null {
  if (!dueIso) return null;
  const due = Date.parse(dueIso);
  if (!Number.isFinite(due)) return null;
  const diff = due - nowMs;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const text = h >= 48 ? `${Math.floor(h / 24)} gün` : h >= 1 ? `${h} sa ${m} dk` : `${m} dk`;
  return diff < 0 ? { label: `${text} gecikti`, overdue: true } : { label: `${text} kaldı`, overdue: false };
}

/** Anomalinin açık kaldığı süre (gün/saat). */
export function ageLabel(firstSeenIso: string, nowMs: number): string {
  const t = Date.parse(firstSeenIso);
  if (!Number.isFinite(t)) return "-";
  const h = Math.max(0, Math.floor((nowMs - t) / 3_600_000));
  return h >= 48 ? `${Math.floor(h / 24)} gün` : `${h} saat`;
}

// ---------------------------------------------------------------- kritik işler

export type TypeCounts = Partial<Record<string, number>>;
export type CriticalJob = { key: string; label: string; count: number; href: string };

const JOB_DEFS: readonly { key: string; type: string; one: string; many: (n: number) => string }[] = [
  { key: "portal_missing", type: "portal_missing", one: "portal ilanı kayıp", many: (n) => `${n} portal ilanı kayıp` },
  { key: "not_published", type: "not_published", one: "", many: (n) => `${n} aktif portföy yayınlanmamış` },
  { key: "price_mismatch", type: "price_mismatch", one: "", many: (n) => `${n} fiyat uyuşmazlığı` },
  { key: "authority", type: "authority_expiring", one: "", many: (n) => `${n} yetkisiz veya yetkisi bitiyor` },
  { key: "sold_still_listed", type: "sold_still_listed", one: "", many: (n) => `${n} satılmış ilan hâlâ portalda` },
  { key: "potential_lost_deal", type: "potential_lost_deal", one: "", many: (n) => `${n} olası kayıp işlem` },
  { key: "advisor_mismatch", type: "advisor_mismatch", one: "", many: (n) => `${n} danışman uyuşmazlığı` },
  { key: "unregistered", type: "unregistered_listing", one: "", many: (n) => `${n} kayıtsız portal ilanı` },
  { key: "duplicate", type: "duplicate", one: "", many: (n) => `${n} kopya ilan şüphesi` },
  { key: "incomplete_closure", type: "incomplete_closure", one: "", many: (n) => `${n} eksik kapanış` },
];

/** Gerçek açık anomali sayılarından "Kritik işler" listesi; yalnız 0'dan büyükler, hepsi filtreli kuyruğa gider. */
export function buildCriticalJobs(counts: TypeCounts, inReview: number): CriticalJob[] {
  const jobs: CriticalJob[] = [];
  for (const d of JOB_DEFS) {
    const n = counts[d.type] ?? 0;
    if (n > 0) jobs.push({ key: d.key, label: d.many(n), count: n, href: `${CONTROL_BASE}/anomaliler?tur=${d.type}` });
  }
  if (inReview > 0) jobs.push({ key: "in_review", label: `${inReview} portföyde açıklama bekleniyor`, count: inReview, href: kpiHref("in_review") });
  return jobs;
}

/**
 * KURAL TABANLI yönetici özeti (LLM YOK, deterministik). Yalnız gerçek sayılardan cümle üretir; hesaplanamayan
 * (aktif portföy yok / şema kapalı) durumda tek dürüst cümle döner.
 */
export function buildExecutiveSummary(s: SummaryNumbers | null, opts: { openCritical?: number; overdueSla?: number } = {}): string[] {
  if (!s) return ["İlan kontrol verisi henüz etkin değil; sayı üretilemedi."];
  if (s.total_active === 0) return ["Kontrol kapsamında aktif portföy yok."];
  const out: string[] = [];
  const critical = s.portal_missing;
  const head = `Bugün ${s.total_active} aktif portföy var`;
  if (critical > 0) out.push(`${head}, ${critical} tanesinde portal ilanı kayıp (kritik).`);
  else out.push(`${head}; portal ilanı kayıp görünen portföy yok.`);
  const pct = healthyPercent(s);
  if (pct !== null) out.push(`Portföy sağlığı %${pct} (${s.healthy} sağlıklı).`);
  if (s.awaiting_publish > 0) out.push(`${s.awaiting_publish} portföy danışmana verildi ancak yayınlanmadı.`);
  if (s.price_mismatch > 0) out.push(`${s.price_mismatch} portföyde portal fiyatı CRM'den farklı.`);
  if (s.in_review > 0) out.push(`${s.in_review} portföyde açıklama bekleniyor; önce bunların danışmanlarını uyarın.`);
  if (s.unverifiable > 0) out.push(`${s.unverifiable} portföy kontrol edilemedi (sağlıklı sayılmadı).`);
  if ((opts.overdueSla ?? 0) > 0) out.push(`${opts.overdueSla} uyarının süresi geçti; bir üst kademeye yükseltilmiş olabilir.`);
  if (out.length === 2 && critical === 0 && s.healthy === s.total_active) out.push("Bugün müdahale gerektiren sorun görünmüyor.");
  return out;
}

// ---------------------------------------------------------------- toplu uyuşmazlık kırılımı

export type MismatchBreakdown = {
  active: number;
  inPortals: number;
  difference: number;
  parts: { key: string; label: string; count: number; href: string }[];
  /** Fark kalemlerinin dışında kalan, açıklanamayan kısım (başka durumda: örn. hazırlanıyor). */
  other: number;
};

/**
 * "100 aktif, 92 portalda: 8 fark" kırılımı. Portal envanteri karşılaştırması (bulk-mismatch) ofis geneli bir cron/CSV
 * çıktısıdır ve kalıcı saklanmadığı için burada portföy durum bayraklarından türetilir: yayın bekleyen + kayıp = açıklanan fark.
 * İlan no hatalı / farklı danışman hesabı sayıları anomali sayımlarından gelir ve ayrı ek sinyal olarak gösterilir.
 */
export function buildMismatchBreakdown(s: SummaryNumbers, counts: TypeCounts): MismatchBreakdown {
  const difference = Math.max(0, s.total_active - s.in_portals);
  const explained = Math.min(difference, s.awaiting_publish + s.portal_missing);
  const parts = [
    { key: "awaiting_publish", label: "Hiç yayınlanmamış", count: s.awaiting_publish, href: kpiHref("awaiting_publish") },
    { key: "portal_missing", label: "Portaldan kaldırılmış / kayıp", count: s.portal_missing, href: kpiHref("portal_missing") },
    { key: "unverifiable", label: "Kontrol edilemedi", count: s.unverifiable, href: kpiHref("unverifiable") },
    { key: "advisor_mismatch", label: "Farklı danışman hesabında", count: counts.advisor_mismatch ?? 0, href: `${CONTROL_BASE}/anomaliler?tur=advisor_mismatch` },
    { key: "unregistered", label: "CRM'de kayıtsız portal ilanı", count: counts.unregistered_listing ?? 0, href: `${CONTROL_BASE}/anomaliler?tur=unregistered_listing` },
  ];
  return { active: s.total_active, inPortals: s.in_portals, difference, parts, other: Math.max(0, difference - explained) };
}

// ---------------------------------------------------------------- değişenler

export type ChangeLine = { key: string; label: string; value: number; href: string };

export function buildChangeLines(c: { anomalies_opened: number; anomalies_closed: number; newly_missing: number; recovered: number; checks_total: number; checks_unverifiable: number }): ChangeLine[] {
  return [
    { key: "opened", label: "Yeni tespit edilen sorun", value: c.anomalies_opened, href: `${CONTROL_BASE}/anomaliler` },
    { key: "newly_missing", label: "Portalda yeni kaybolan ilan", value: c.newly_missing, href: `${CONTROL_BASE}/anomaliler?tur=portal_missing` },
    { key: "recovered", label: "Yeniden görünür olan ilan", value: c.recovered, href: kpiHref("in_portals") },
    { key: "closed", label: "Çözülen sorun", value: c.anomalies_closed, href: `${CONTROL_BASE}/rapor` },
    { key: "checks", label: "Yapılan kontrol", value: c.checks_total, href: `${CONTROL_BASE}/rapor` },
    { key: "unverifiable", label: "Kontrol edilemeyen deneme", value: c.checks_unverifiable, href: kpiHref("unverifiable") },
  ];
}

// ---------------------------------------------------------------- imleç (keyset)

export function encodeCursor(c: { riskScore: number; propertyId: string } | null): string | null {
  return c ? `${c.riskScore}~${c.propertyId}` : null;
}

export function decodeCursor(raw: string | string[] | undefined): { riskScore: number; propertyId: string } | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  const [r, id] = v.split("~");
  const n = Number(r);
  if (!id || !Number.isFinite(n) || n < 0 || n > 100 || !/^[0-9a-fA-F-]{8,40}$/.test(id)) return null;
  return { riskScore: n, propertyId: id };
}

/** Ortalama süre etiketi (saat) -> "X gün" / "Y saat". */
export function durationLabel(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return "-";
  if (hours >= 48) return `${Math.round((hours / 24) * 10) / 10} gün`;
  return `${Math.round(hours * 10) / 10} saat`;
}

/** Danışman yönetim kademesi mi (rol kapsamlı ekranlarda başlık metni için). */
export function scopeCaption(role: string | null | undefined): string {
  switch (role) {
    case "owner":
    case "gm":
      return "Tüm ofis";
    case "branch_manager":
      return "Şubeniz";
    case "team_lead":
      return "Takımınız";
    default:
      return "Kendi portföyleriniz";
  }
}
