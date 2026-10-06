/**
 * /admin ana ekran mantığı (saf, yan etkisiz, testli):
 *  - rol bazlı yerleşim (hangi bölüm, hangi sırayla),
 *  - "Dikkat gerektirenler" kuyruğu (rol filtresi, gizleme, sıralama),
 *  - churn riski satırları (yalnız mevcut veriden: durum, deneme bitişi, 14 gün aktivite).
 *
 * Sahte içgörü ÜRETİLMEZ: her satır gerçek bir sayımdan gelir ve filtrelenmiş bir hedefe bağlanır.
 * Platform içgörüleri ayrı okunur (`src/lib/insights/platform-read.ts`, üretici `insights/platform-engine.ts`
 * insight-engine cron'unda); bkz. `ATTENTION_INSIGHT_SLOT` (page.tsx). Okunamaz/boşsa hiçbir şey çizilmez.
 * Büyüme/gelir metriklerinin saf hesabı ayrı modüldedir: `platform-metrics.ts`.
 */
import { platformCanAccess, type PlatformModule, type PlatformRole } from "@/lib/platform-access";

export type HomeVariant = "platform" | "billing" | "support";

/** billing/support kendi paneline sahiptir; super_admin ve ops platform panelini görür. */
export function homeVariantFor(role: PlatformRole): HomeVariant {
  if (role === "billing") return "billing";
  if (role === "support") return "support";
  return "platform";
}

export type HomeSection =
  | "attention"
  | "mrr"
  | "churn"
  | "health"
  | "activation"
  | "modules"
  | "unitEconomics"
  | "usage"
  | "churnReasons"
  | "growth"
  | "composition"
  | "activity"
  | "geo";

/** Gelir/fatura verisi taşıyan bölümler: yalnız `billing` modülü olan rol görür. */
const BILLING_SECTIONS: ReadonlySet<HomeSection> = new Set(["mrr", "composition", "unitEconomics", "usage", "churnReasons"]);

/**
 * Platform panelinin bölüm sırası. super_admin gelir odaklıdır (MRR en üstte; birim ekonomisi,
 * tüketim, churn nedenleri, kompozisyon); ops gelire erişemez (billing modülü yok): sağlık, churn,
 * aktivasyon ve modül kullanımı öne çıkar.
 */
export function platformHomeSections(role: PlatformRole): HomeSection[] {
  const base: HomeSection[] =
    role === "super_admin"
      ? ["attention", "mrr", "churn", "health", "activation", "modules", "unitEconomics", "usage", "churnReasons", "composition", "growth", "activity"]
      : ["attention", "health", "churn", "activation", "modules", "growth", "activity"];
  if (platformCanAccess(role, "geo")) base.push("geo");
  // Bir bölüm yalnız bir kez ve tanımlı modül kapısıyla çıkar.
  return base.filter((s, i) => base.indexOf(s) === i && (!BILLING_SECTIONS.has(s) || platformCanAccess(role, "billing")));
}

export type AttentionInput = {
  /** null = okunamadı (satır gizlenir; sıfır gibi gösterilmez). */
  refundRequired: number | null;
  manualReview: number | null;
  cronErrors: number | null;
  efReconciliation: "ok" | "drift" | "error" | null;
  urgentTickets: number | null;
  /** Açık (open/in_progress/waiting) destek talebi toplamı. */
  openTickets: number | null;
  risk: number | null;
  trialsEnding: number | null;
  demoRequests: number | null;
};

export type AttentionTone = "danger" | "warn" | "brand";

export type AttentionRow = {
  id: string;
  label: string;
  hint: string;
  count: number;
  href: string;
  tone: AttentionTone;
  severity: number;
  module: PlatformModule;
};

type Candidate = Omit<AttentionRow, "count"> & { count: number | null };

export const ATTENTION_LIMIT = 7;

/**
 * Kuyruk: sayısı 0/null olan satır yoktur, role kapalı modülün satırı yoktur,
 * şiddete (ardından sayıya) göre azalan sıralanır ve ATTENTION_LIMIT ile sınırlanır.
 */
export function buildAttentionQueue(input: AttentionInput, role: PlatformRole): AttentionRow[] {
  const efCount = input.efReconciliation === "drift" || input.efReconciliation === "error" ? 1 : null;
  const nonUrgentOpen =
    input.openTickets === null ? null : Math.max(0, input.openTickets - Math.max(0, input.urgentTickets ?? 0));
  const candidates: Candidate[] = [
    { id: "refund", label: "İade gerekiyor", hint: "Tahsil edilmiş ödeme, elle karar bekliyor", count: input.refundRequired, href: "/admin/billing?odeme=refund_required#mutabakat", tone: "danger", severity: 100, module: "billing" },
    { id: "manual-review", label: "Manuel ödeme incelemesi", hint: "Mutabakat kuyruğunda bekliyor", count: input.manualReview, href: "/admin/billing?odeme=manual_review#mutabakat", tone: "danger", severity: 90, module: "billing" },
    { id: "cron", label: "Hatalı biten zamanlanmış iş", hint: "Son çalışması hata verdi", count: input.cronErrors, href: "/admin/sistem", tone: "danger", severity: 85, module: "sistem" },
    { id: "urgent-ticket", label: "Acil destek talebi", hint: "Yanıt bekliyor", count: input.urgentTickets, href: "/admin/tickets?oncelik=urgent&durum=acik", tone: "danger", severity: 80, module: "tickets" },
    { id: "risk", label: "Riskli ofis", hint: "Gecikmiş veya askıda; inceleyin", count: input.risk, href: "/admin/tenants?durum=risk", tone: "warn", severity: 70, module: "tenants" },
    { id: "ef-drift", label: "EmlakFiyati mutabakat sapması", hint: input.efReconciliation === "error" ? "Son mutabakat yapılamadı" : "Son mutabakatta fark var", count: efCount, href: "/admin/ef-kontor", tone: "warn", severity: 65, module: "billing" },
    { id: "open-ticket", label: "Açık destek talebi", hint: "Acil olmayanlar", count: nonUrgentOpen, href: "/admin/tickets?durum=acik", tone: "warn", severity: 50, module: "tickets" },
    { id: "trial-ending", label: "Deneme 7 gün içinde bitiyor", hint: "Dönüşüm fırsatı", count: input.trialsEnding, href: "/admin/tenants?deneme=bitiyor", tone: "brand", severity: 45, module: "tenants" },
    { id: "demo", label: "Yeni demo talebi", hint: "Satış fırsatı, yanıt bekliyor", count: input.demoRequests, href: "/admin/satis", tone: "brand", severity: 40, module: "sales" },
  ];
  return candidates
    .filter((c): c is AttentionRow => typeof c.count === "number" && Number.isFinite(c.count) && c.count > 0)
    .filter((c) => platformCanAccess(role, c.module))
    .sort((a, b) => b.severity - a.severity || b.count - a.count)
    .slice(0, ATTENTION_LIMIT);
}

export type ChurnTenant = {
  id: string;
  name: string;
  status: string;
  trial_ends_at: string | null;
};

export type ChurnSignal = { key: "past_due" | "suspended" | "inactive" | "quiet"; label: string; weight: number };

export type ChurnRow = {
  id: string;
  name: string;
  href: string;
  score: number;
  signals: ChurnSignal[];
  /** Son 14 gün denetim kaydı sayısı (tenant listesindeki "sağlık" rozetiyle aynı kaynak). */
  activity14d: number;
  /** Son 14 gündeki son denetim kaydının zamanı; yoksa null ("14+ gün"). */
  lastActivityAt: string | null;
  level: ChurnLevel;
};

export type ChurnLevel = "yuksek" | "orta" | "dusuk";

/** Risk skoru → düzey: ≥5 yüksek, ≥3 orta, aksi düşük (sinyal ağırlıkları toplamı). */
export function churnLevel(score: number): ChurnLevel {
  if (score >= 5) return "yuksek";
  if (score >= 3) return "orta";
  return "dusuk";
}

/** Dikkat satırı şiddeti → önem düzeyi (AttentionList hapı): ≥85 acil, ≥70 yüksek, ≥50 orta, aksi düşük. */
export function attentionLevel(severity: number): "acil" | "yuksek" | "orta" | "dusuk" {
  if (severity >= 85) return "acil";
  if (severity >= 70) return "yuksek";
  if (severity >= 50) return "orta";
  return "dusuk";
}


/**
 * Riskli ofisler + churn sinyalleri (TEK liste; "Riskli ofis" sayımı ve churn tablosu birleşti):
 * yeni hesap UYDURULMAZ; mevcut gerçek veriden sinyal çıkarılır (abonelik durumu: gecikmiş/askıda,
 * 14 gün aktivite) ve eşikler tenant listesiyle tutarlıdır (>=10 aktif, 1-9 sessiz, 0 hareketsiz).
 * Deneme bitişi churn DEĞİL dönüşüm fırsatıdır: yalnız dikkat kuyruğunda ("Deneme 7 gün içinde
 * bitiyor") görünür, burada tekrarlanmaz. Sinyali olmayan ofis listelenmez; veri yoksa boş döner.
 */
export function buildChurnRows(
  tenants: readonly ChurnTenant[],
  activityByTenant: ReadonlyMap<string, number>,
  nowMs: number,
  limit = 8,
  lastActivityByTenant: ReadonlyMap<string, string> = new Map(),
): ChurnRow[] {
  void nowMs;
  const rows: ChurnRow[] = [];
  for (const t of tenants) {
    if (t.status !== "active" && t.status !== "trial" && t.status !== "past_due" && t.status !== "suspended") continue;
    const act = activityByTenant.get(t.id) ?? 0;
    const signals: ChurnSignal[] = [];
    if (t.status === "past_due") signals.push({ key: "past_due", label: "Ödeme gecikmesi", weight: 3 });
    if (t.status === "suspended") signals.push({ key: "suspended", label: "Askıda", weight: 3 });
    if (act === 0) signals.push({ key: "inactive", label: "14 gündür hareket yok", weight: 3 });
    else if (act < 10) signals.push({ key: "quiet", label: "Düşük kullanım", weight: 1 });
    if (signals.length === 0) continue;
    // Deneme ofisinin hareketsizliği/sessizliği tek başına churn sayılmaz (henüz kurulumda).
    if (t.status === "trial" && signals.every((s) => s.key === "inactive" || s.key === "quiet")) continue;
    const score = signals.reduce((n, s) => n + s.weight, 0);
    rows.push({
      id: t.id,
      name: t.name,
      href: `/admin/tenants/${t.id}`,
      score,
      signals,
      activity14d: act,
      lastActivityAt: lastActivityByTenant.get(t.id) ?? null,
      level: churnLevel(score),
    });
  }
  return rows.sort((a, b) => b.score - a.score || a.activity14d - b.activity14d || a.name.localeCompare(b.name, "tr")).slice(0, limit);
}
