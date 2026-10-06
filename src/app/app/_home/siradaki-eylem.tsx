import { cookies } from "next/headers";
import { ArrowRight } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTrTime, trDayKey } from "@/lib/clock";
import { moneyTry } from "@/lib/leak-shield";
import {
  loadCommissionSummary,
  loadExpiringAuthority,
  loadHotLeadCount,
  loadLiveListings,
  loadOnboardingState,
  loadTaskSummary,
  loadTodayAppointments,
  type HomeCtx,
} from "./data";
import { appointmentTypeLabel } from "@/lib/appointment-labels";
import { overdueListingsOf } from "./helpers";
import { SKIP_COOKIE, buildNextActions, parseSkipCookie, pickNextAction, type NextActionTone } from "./siradaki";
import { SiradakiGec } from "./siradaki-gec";

/** Ton → premium ton sınıfı (odak kartının sol şeridi `--t` ile boyanır). */
const TONE_CLS: Record<NextActionTone, string> = {
  brand: "pm-t-brand",
  danger: "pm-t-danger",
  warn: "pm-t-warn",
  success: "pm-t-success",
};

/** Kart yüksekliği iskelet ve gerçek kartta aynı (CLS yok). */
const CARD_MIN = "min-h-[16rem]";

export function SiradakiEylemIskelet() {
  return (
    <div role="status" aria-busy="true" className={`${CARD_MIN} pm-focus p-5 sm:p-6`}>
      <span className="sr-only">Yükleniyor</span>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-7 w-2/3" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <Skeleton className="mt-5 h-11 w-44" />
    </div>
  );
}

/**
 * Danışmanın ana ekranının en üstü: TEK "Sıradaki en iyi eylem" — tek büyük düğme.
 * Yalnız kullanıcının KENDİ kayıtlarından beslenir (ctx.scopeMine). Sıra ve kurallar `siradaki.ts`.
 * Komisyon adımı yalnız kullanıcının görebildiği komisyondan (earnings kuralı: loadCommissionSummary).
 */
export async function SiradakiEylem({ ctx }: { ctx: HomeCtx }) {
  const [tasks, appts, hot, listings, expiring, commission, onboarding, jar] = await Promise.all([
    loadTaskSummary(ctx),
    loadTodayAppointments(ctx),
    loadHotLeadCount(ctx),
    loadLiveListings(ctx),
    loadExpiringAuthority(ctx),
    ctx.canSeeCommissions ? loadCommissionSummary(ctx) : Promise.resolve(null),
    loadOnboardingState(ctx),
    cookies(),
  ]);
  const first = appts.rows[0];
  const nextStep = onboarding && !onboarding.complete && !onboarding.settled
    ? (onboarding.steps.find((s) => s.id === onboarding.nextId) ?? onboarding.steps.find((s) => !s.done))
    : undefined;
  const actions = buildNextActions({
    appointmentsToday: appts.total || appts.rows.length,
    firstAppointment: first
      ? { time: formatTrTime(first.scheduled_at), type: appointmentTypeLabel(first.appointment_type) }
      : null,
    tasksOverdue: tasks.overdue,
    hotLeads: hot,
    expiringAuthority: expiring.data.length,
    unconfirmedListings: overdueListingsOf(listings).length,
    pendingCommissionText: commission && commission.pending > 0 ? moneyTry(commission.pending) : null,
    onboardingNext: nextStep && onboarding ? { title: nextStep.title, href: `/app/baslangic?adim=${onboarding.nextId}` } : null,
  });
  const todayKey = trDayKey();
  const dismissed = parseSkipCookie(jar.get(SKIP_COOKIE)?.value ? decodeURIComponent(jar.get(SKIP_COOKIE)!.value) : undefined, todayKey);
  const action = pickNextAction(actions, dismissed);
  const canSkip = action.key !== "musteri-ekle" && actions.some((a) => a.key !== action.key && !dismissed.includes(a.key));

  return (
    <section
      aria-labelledby="siradaki-eylem-baslik"
      className={`pm-focus ${TONE_CLS[action.tone]} flex h-full flex-col justify-between gap-5 p-5 pl-6 sm:p-6 sm:pl-7`}
    >
      <div className="min-w-0">
        <p className="pm-bx-eyebrow">Sıradaki en iyi eylem</p>
        <h2 id="siradaki-eylem-baslik" className="mt-1 font-display text-2xl font-bold leading-tight text-ink-950">
          {action.title}
        </h2>
        <p className="mt-2 max-w-[68ch] text-sm leading-relaxed text-text-muted">
          <span className="font-semibold text-ink-950">Neden? </span>
          {action.reason}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <ButtonLink href={action.href} size="lg" iconRight={ArrowRight}>
          {action.label}
        </ButtonLink>
        {canSkip ? <SiradakiGec actionKey={action.key} dismissed={dismissed} todayKey={todayKey} /> : null}
      </div>
    </section>
  );
}
