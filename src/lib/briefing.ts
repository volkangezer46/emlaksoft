/**
 * Günaydın brifingi — kural tabanlı, saf (pure) madde üretimi.
 *
 * Dashboard'un ZATEN çektiği sayıları parametre olarak alır; supabase çağrısı
 * yapmaz. Amaç: danışmanın güne başlarken tek bakışta "bugün ne yapmalıyım"
 * sorusuna yanıt veren 3-5 tıklanabilir madde. AI şart değil — opsiyonel özet
 * için bkz. `src/lib/ai/briefing-summary.ts`.
 */

import { moneyTry } from "@/lib/leak-shield";

export type BriefingTone = "danger" | "warn" | "amber" | "mint" | "brand";

export type BriefingItem = {
  icon: string;
  text: string;
  href: string;
  tone: BriefingTone;
};

export type BriefingInput = {
  /** Bugünkü randevu sayısı. */
  todayAppointments: number;
  /** İlk randevu (saat + tür) — yoksa null. */
  firstAppointment: { time: string; type: string } | null;
  /** 15 gün içinde yetki belgesi dolacak portföy sayısı. */
  expiringAuthority: number;
  /** Bugün vadesi gelen açık görev sayısı. */
  tasksDueToday: number;
  /** Vadesi geçmiş (bugünden önce) açık görev sayısı. */
  tasksOverdue: number;
  /** 7+ gündür teyit edilmemiş canlı ilan sayısı. */
  unconfirmedListings: number;
  /** Sıcak (hot) lead sayısı — bkz. lib/lead-score. */
  hotLeads: number;
  /** Bekleyen komisyon toplamı (TL). */
  pendingCommission: number;
};

const MAX_ITEMS = 5;

/**
 * Kural tabanlı brifing: sıfır olan metrikler atlanır, kalanlar önem
 * sırasına dizilir ve en önemli 3-5 madde döner. Hiç madde yoksa boş dizi
 * döner — kart bu durumda gizlenmelidir.
 */
export function buildDailyBriefing(input: BriefingInput): BriefingItem[] {
  // priority: küçük sayı = daha önemli
  const candidates: (BriefingItem & { priority: number })[] = [];

  // 1) Geciken görevler — günün ilk düzeltilmesi gereken işi
  if (input.tasksOverdue > 0) {
    const extra = input.tasksDueToday > 0 ? `, ${input.tasksDueToday} görevin de bugün vadeli` : "";
    candidates.push({
      priority: 0,
      icon: "⏰",
      text: `${input.tasksOverdue} görevin gecikmiş${extra} — önce bunları kapat`,
      href: "/app/gorevler?filter=overdue",
      tone: "danger",
    });
  }

  // 2) Bugünün planı — randevular
  if (input.todayAppointments > 0) {
    const first = input.firstAppointment;
    candidates.push({
      priority: 1,
      icon: "📅",
      text:
        input.todayAppointments === 1
          ? `1 randevun var${first ? `: ${first.time} ${first.type}` : ""}`
          : `${input.todayAppointments} randevun var${first ? `, ilki ${first.time} ${first.type}` : ""}`,
      href: "/app/randevular",
      tone: "brand",
    });
  }

  // 3) Bugün vadesi gelen görevler (gecikme yoksa ayrı madde)
  if (input.tasksOverdue === 0 && input.tasksDueToday > 0) {
    candidates.push({
      priority: 2,
      icon: "✅",
      text: `${input.tasksDueToday} görevin bugün vadesi doluyor`,
      href: "/app/gorevler?filter=today",
      tone: "warn",
    });
  }

  // 4) Yetki belgesi bitişleri — portföy kaybı riski
  if (input.expiringAuthority > 0) {
    candidates.push({
      priority: 3,
      icon: "📜",
      text:
        input.expiringAuthority === 1
          ? "1 portföyün yetkisi 15 gün içinde doluyor"
          : `${input.expiringAuthority} portföyün yetkisi 15 gün içinde doluyor`,
      href: "/app/portfoyler",
      tone: "warn",
    });
  }

  // 5) Teyitsiz ilanlar — portal görünürlüğü riski
  if (input.unconfirmedListings > 0) {
    candidates.push({
      priority: 4,
      icon: "📣",
      text: `${input.unconfirmedListings} ilan 7+ gündür teyitsiz — portalları kontrol et`,
      href: "/app/portallar?durum=teyit",
      tone: "amber",
    });
  }

  // 6) Sıcak leadler — fırsat
  if (input.hotLeads > 0) {
    candidates.push({
      priority: 5,
      icon: "🔥",
      text: `${input.hotLeads} sıcak müşteri dönüş bekliyor`,
      href: "/app/musteriler?sort=hot",
      tone: "mint",
    });
  }

  // 7) Bekleyen komisyon — tahsilat hatırlatması
  if (input.pendingCommission > 0) {
    candidates.push({
      priority: 6,
      icon: "💰",
      text: `${moneyTry(input.pendingCommission)} komisyon tahsilat bekliyor`,
      href: "/app/komisyon?durum=bekleyen",
      tone: "amber",
    });
  }

  return candidates
    .sort((a, b) => a.priority - b.priority)
    .slice(0, MAX_ITEMS)
    .map(({ priority: _priority, ...item }) => item);
}
