/**
 * Kişisel koçluk ve yönetici uyarısı — SAF kurallar (insights kural deseni: olgu girer, kanıtlı öneri çıkar).
 *
 * İLKELER (docs/HAFIZA.md §13 ile uyumlu):
 *  - Veri yoksa kart yok: bekleyen gerçek kayıt bulunamayan eylem listeye girmez.
 *  - Her eylemin `href`'i zorunlu ve kanıt (kayıt adı) taşır; sahte skor / boş vaat yok.
 *  - Puan = ofisin kendi ayarlı kuralından (ruleset) gelir; kural kapalıysa (0) eylem önerilmez.
 */
import type { ScoreRuleKey, ScoreRuleset } from "@/lib/gamification";

export type CoachItem = { id: string; label: string; href: string };

export type CoachFacts = {
  ruleset: ScoreRuleset;
  /** Kullanıcının dönem sırası (hiç satırı yoksa null) */
  myRank: number | null;
  myTotal: number;
  /** Ligin lideri (yarışan yoksa 0) */
  leaderTotal: number;
  /** 2. sıradaki puan (liderlik koruma farkı için); yoksa null */
  runnerUpTotal: number | null;
  /** Gecikmiş açık görevler */
  overdueTasks: readonly CoachItem[];
  /** Yanıt bekleyen yeni müşteriler; `withinSla` = hâlâ SLA içinde (hızlı dönüş puanı kazanılabilir) */
  waitingLeads: readonly (CoachItem & { withinSla: boolean })[];
  /** Teyit bekleyen yayındaki ilanlar */
  unconfirmedListings: readonly CoachItem[];
  /** Saati geçmiş ama tamamlandı işaretlenmemiş randevular */
  pastAppointments: readonly (CoachItem & { isShowing: boolean })[];
};

export type CoachAction = {
  key: string;
  rule: ScoreRuleKey;
  title: string;
  /** Eylem başına kazanılacak puan (ofis kuralından) */
  pointsEach: number;
  /** Bekleyen kayıt adedi (sınırsız) */
  count: number;
  /** Önerilen kayıt sayısı (en çok 5) ve bunun toplam puanı */
  potential: number;
  /** En çok 3 kanıt (kayıt adı + bağlantı) */
  evidence: readonly CoachItem[];
  /** Listeye gidecek ana bağlantı (ilk kanıt değil, o eylemin ilgili listesi) */
  href: string;
};

export type CoachPlan = {
  isLeader: boolean;
  /** Liderliğe gereken puan (liderse: ikinciyle fark; sıralamada yoksa null) */
  gapPoints: number | null;
  headline: string;
  actions: readonly CoachAction[];
};

const PER_ACTION_CAP = 5;

type Candidate = Omit<CoachAction, "potential"> & { eligible: number };

function candidate(
  rule: ScoreRuleKey,
  key: string,
  title: string,
  ruleset: ScoreRuleset,
  items: readonly CoachItem[],
  href: string,
): Candidate | null {
  const pointsEach = ruleset[rule];
  if (!(pointsEach > 0) || items.length === 0) return null;
  return {
    key,
    rule,
    title,
    pointsEach,
    count: items.length,
    eligible: items.length,
    evidence: items.slice(0, 3),
    href,
  };
}

export function buildCoachPlan(f: CoachFacts): CoachPlan {
  const cands: Candidate[] = [];
  const push = (c: Candidate | null) => {
    if (c) cands.push(c);
  };

  push(candidate("task_done", "overdue-task", "Geciken görevi tamamla", f.ruleset, f.overdueTasks, "/app/gorevler"));
  // Yalnız SLA içindeki talepler "hızlı dönüş" puanı getirir; geciken talep için puan vaat edilmez.
  push(
    candidate(
      "fast_response",
      "waiting-lead",
      "Yeni talebe hemen dön",
      f.ruleset,
      f.waitingLeads.filter((l) => l.withinSla),
      "/app/raporlar/lead-hizi",
    ),
  );
  push(candidate("listing_confirmed", "confirm-listing", "İlan teyidini yap", f.ruleset, f.unconfirmedListings, "/app/ilan-kontrol"));
  // Gösterim randevusu gösterim puanı, diğerleri randevu puanı getirir; en değerli türden tek aday.
  const past = f.pastAppointments;
  push(
    candidate(
      "showing_done",
      "past-showing",
      "Yapılan gösterimi tamamlandı işaretle",
      f.ruleset,
      past.filter((a) => a.isShowing),
      "/app/randevular",
    ),
  );
  push(
    candidate(
      "appointment_done",
      "past-appointment",
      "Yapılan randevuyu tamamlandı işaretle",
      f.ruleset,
      past.filter((a) => !a.isShowing),
      "/app/randevular",
    ),
  );

  const actions: CoachAction[] = cands
    .map((c) => ({
      key: c.key,
      rule: c.rule,
      title: c.title,
      pointsEach: c.pointsEach,
      count: c.count,
      potential: c.pointsEach * Math.min(c.eligible, PER_ACTION_CAP),
      evidence: c.evidence,
      href: c.href,
    }))
    .sort((a, b) => (b.potential !== a.potential ? b.potential - a.potential : a.key.localeCompare(b.key)))
    .slice(0, 3);

  const hasRank = f.myRank !== null;
  const isLeader = hasRank && f.myRank === 1 && f.myTotal > 0;
  let gapPoints: number | null = null;
  let headline: string;
  if (!hasRank) {
    gapPoints = null;
    headline = "Bu dönem henüz ligde puanın yok.";
  } else if (isLeader) {
    gapPoints = f.runnerUpTotal !== null ? Math.max(0, f.myTotal - f.runnerUpTotal) : null;
    headline =
      gapPoints !== null
        ? `Liderlik sende: 2. sıradakiyle fark ${gapPoints} puan.`
        : "Liderlik sende.";
  } else {
    gapPoints = Math.max(0, f.leaderTotal - f.myTotal);
    headline =
      gapPoints === 0
        ? "Liderle puan eşitliğindesin; bir adım yeter."
        : `Bu hafta liderliğe ${gapPoints} puan var.`;
  }
  return { isLeader, gapPoints, headline, actions };
}

// ============================================================
// Düşük aktivite uyarısı (yönetici)
// ============================================================

export type LowActivityInput = {
  staffId: string;
  name: string;
  total: number;
  activityCount: number;
};

export type LowActivityFinding = {
  staffId: string;
  name: string;
  total: number;
  medianTotal: number;
  /** Kanıt cümlesi (sayılar girdiden) */
  evidence: string;
  href: string;
};

export const LOW_ACTIVITY_MIN_ELAPSED = 0.3;
export const LOW_ACTIVITY_RATIO = 0.4;
export const LOW_ACTIVITY_MIN_MEDIAN = 20;
export const LOW_ACTIVITY_MAX = 5;

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Dönemin en az %30'u geçtiyse ve ofis medyanı anlamlıysa (>=20 puan), medyanın %40'ının altındaki danışmanı işaretler.
 * Az kişilik ofis (3'ten az yarışan) ya da henüz erken dönem: uyarı YOK (haksız etiketlemeyi önler).
 */
export function lowActivityAdvisors(
  rows: readonly LowActivityInput[],
  elapsedFraction: number,
): LowActivityFinding[] {
  if (rows.length < 3) return [];
  if (!(elapsedFraction >= LOW_ACTIVITY_MIN_ELAPSED)) return [];
  const med = median(rows.map((r) => r.total));
  if (med < LOW_ACTIVITY_MIN_MEDIAN) return [];
  const limit = med * LOW_ACTIVITY_RATIO;
  return rows
    .filter((r) => r.total < limit)
    .sort((a, b) => (a.total !== b.total ? a.total - b.total : a.staffId.localeCompare(b.staffId)))
    .slice(0, LOW_ACTIVITY_MAX)
    .map((r) => ({
      staffId: r.staffId,
      name: r.name,
      total: r.total,
      medianTotal: med,
      evidence: `${r.name}: ${r.total} puan, ${r.activityCount} kayıt; ofis medyanı ${med} puan (dönemin %${Math.round(
        elapsedFraction * 100,
      )}'i geçti).`,
      href: `/app/ekip/${r.staffId}`,
    }));
}
