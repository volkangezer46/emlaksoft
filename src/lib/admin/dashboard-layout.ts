/**
 * /admin ana ekran mantığı (saf, yan etkisiz, testli):
 *  - rol bazlı yerleşim (hangi bölüm, hangi sırayla),
 *  - "Dikkat gerektirenler" kuyruğu (rol filtresi, gizleme, sıralama),
 *  - churn riski satırları (yalnız mevcut veriden: durum, deneme bitişi, 14 gün aktivite).
 *
 * Sahte içgörü ÜRETİLMEZ: her satır gerçek bir sayımdan gelir ve filtrelenmiş bir hedefe bağlanır.
 * Platform içgörüleri ayrı okunur (`src/lib/insights/platform-read.ts`); bkz. `ATTENTION_INSIGHT_SLOT` (page.tsx). Üretici kural henüz yok: veri yoksa boş kalır.
 */
import { platformCanAccess, type PlatformModule, type PlatformRole } from "@/lib/platform-access";

export type HomeVariant = "platform" | "billing" | "support";

/** billing/support kendi paneline sahiptir; super_admin ve ops platform panelini görür. */
export function homeVariantFor(role: PlatformRole): HomeVariant {
  if (role === "billing") return "billing";
  if (role === "support") return "support";
  return "platform";
}

export type HomeSection = "attention" | "mrr" | "churn" | "health" | "growth" | "composition" | "activity" | "geo";

/**
 * Platform panelinin bölüm sırası. super_admin gelir odaklıdır (MRR en üstte, kompozisyon var);
 * ops gelire erişemez (billing modülü yok): MRR/kompozisyon yoktur, sağlık ve churn öne çıkar.
 */
export function platformHomeSections(role: PlatformRole): HomeSection[] {
  const base: HomeSection[] =
    role === "super_admin"
      ? ["attention", "mrr", "churn", "health", "growth", "composition", "activity"]
      : ["attention", "health", "churn", "growth", "activity"];
  if (platformCanAccess(role, "geo")) base.push("geo");
  // Bir bölüm yalnız bir kez ve tanımlı modül kapısıyla çıkar.
  return base.filter((s, i) => base.indexOf(s) === i && (s !== "mrr" && s !== "composition" ? true : platformCanAccess(role, "billing")));
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
  /** Dönemde açılan yeni ofisler (self-servis kurulum; hepsi denemeyle başlar). Demo talebi formu kaldırıldı. */
  newTrials: number | null;
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
    { id: "risk", label: "Riskli ofis", hint: "Gecikmiş veya askıda; inceleyin", count: input.risk, href: "/admin/tenants?durum=past_due", tone: "warn", severity: 70, module: "tenants" },
    { id: "ef-drift", label: "EmlakFiyati mutabakat sapması", hint: input.efReconciliation === "error" ? "Son mutabakat yapılamadı" : "Son mutabakatta fark var", count: efCount, href: "/admin/ef-kontor", tone: "warn", severity: 65, module: "billing" },
    { id: "open-ticket", label: "Açık destek talebi", hint: "Acil olmayanlar", count: nonUrgentOpen, href: "/admin/tickets?durum=acik", tone: "warn", severity: 50, module: "tickets" },
    { id: "trial-ending", label: "Deneme 7 gün içinde bitiyor", hint: "Dönüşüm fırsatı", count: input.trialsEnding, href: "/admin/tenants?durum=trial", tone: "brand", severity: 45, module: "tenants" },
    { id: "new-trial", label: "Yeni deneme başlatan ofis", hint: "Kurulum sihirbazından geldi; ilk hafta karşılayın", count: input.newTrials, href: "/admin/tenants?durum=trial", tone: "brand", severity: 40, module: "tenants" },
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

export type ChurnSignal = { key: "past_due" | "trial_ending" | "inactive" | "quiet"; label: string; weight: number };

export type ChurnRow = {
  id: string;
  name: string;
  href: string;
  score: number;
  signals: ChurnSignal[];
  /** Son 14 gün denetim kaydı sayısı (tenant listesindeki "sağlık" rozetiyle aynı kaynak). */
  activity14d: number;
};

const DAY_MS = 86_400_000;

/**
 * Churn riski: yeni hesap UYDURULMAZ; mevcut üç gerçek veriden sinyal çıkarılır
 * (abonelik durumu, deneme bitişi, 14 gün aktivite) ve aynı eşikler tenant listesiyle tutarlıdır
 * (>=10 aktif, 1-9 sessiz, 0 hareketsiz). Sinyali olmayan ofis listelenmez; veri yoksa boş döner.
 */
export function buildChurnRows(
  tenants: readonly ChurnTenant[],
  activityByTenant: ReadonlyMap<string, number>,
  nowMs: number,
  limit = 8,
): ChurnRow[] {
  const rows: ChurnRow[] = [];
  for (const t of tenants) {
    if (t.status !== "active" && t.status !== "trial" && t.status !== "past_due") continue;
    const act = activityByTenant.get(t.id) ?? 0;
    const signals: ChurnSignal[] = [];
    if (t.status === "past_due") signals.push({ key: "past_due", label: "Ödeme gecikmiş", weight: 3 });
    if (t.status === "trial" && t.trial_ends_at) {
      const left = new Date(t.trial_ends_at).getTime() - nowMs;
      if (left >= 0 && left <= 7 * DAY_MS) signals.push({ key: "trial_ending", label: "Deneme 7 gün içinde bitiyor", weight: 2 });
    }
    if (act === 0) signals.push({ key: "inactive", label: "14 gündür hareket yok", weight: 3 });
    else if (act < 10) signals.push({ key: "quiet", label: `Sessiz (${act} hareket)`, weight: 1 });
    if (signals.length === 0) continue;
    // Yeni açılmış, henüz hareketi olmayan deneme tek başına risk sayılmaz.
    if (signals.length === 1 && signals[0]!.key === "inactive" && t.status === "trial") continue;
    rows.push({
      id: t.id,
      name: t.name,
      href: `/admin/tenants/${t.id}`,
      score: signals.reduce((n, s) => n + s.weight, 0),
      signals,
      activity14d: act,
    });
  }
  return rows.sort((a, b) => b.score - a.score || a.activity14d - b.activity14d || a.name.localeCompare(b.name, "tr")).slice(0, limit);
}
