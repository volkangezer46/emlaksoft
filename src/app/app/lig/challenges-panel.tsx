import Link from "@/components/ui/smart-link";
import { Flag, Gift, Rocket, Trash2, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { SCORE_RULE_LABELS } from "@/lib/gamification";
import { cancelChallenge } from "@/app/actions/league";
import { challengeRemainingMs, remainingLabel } from "@/lib/league/challenge";
import type { ChallengeCard } from "@/lib/league/challenge-load";
import { evidenceHref } from "@/lib/league/evidence";
import { ChallengeForm, type MetricOption } from "./challenge-form";

function dateLabel(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", timeZone: "Europe/Istanbul" }).format(new Date(iso));
}

const STATE_LABEL: Record<ChallengeCard["state"], { text: string; cls: string }> = {
  live: { text: "Sürüyor", cls: "tone-success" },
  upcoming: { text: "Yakında başlıyor", cls: "tone-info" },
  ended: { text: "Süre doldu · sonuç bekleniyor", cls: "tone-warning" },
  finished: { text: "Tamamlandı", cls: "tone-neutral" },
  cancelled: { text: "İptal", cls: "tone-neutral" },
};

/**
 * Meydan okumalar: canlı ilerleme çubuğu + katılımcı sıralaması (her satır o kişinin kanıt listesine gider).
 * Yalnız adet ve ad gösterilir; tutar yok (P12).
 */
export function ChallengesPanel({
  cards,
  names,
  nowMs,
  canCreate,
  canEdit,
  metrics,
  defaultStart,
  defaultEnd,
}: {
  cards: ChallengeCard[];
  names: ReadonlyMap<string, string>;
  nowMs: number;
  canCreate: boolean;
  canEdit: boolean;
  metrics: MetricOption[];
  defaultStart: string;
  defaultEnd: string;
}) {
  return (
    <div className="space-y-6">
      {canCreate ? (
        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <p className="flex items-center gap-2 text-xs font-semibold text-accent-text">
            <Rocket className="h-4 w-4" aria-hidden="true" /> Yeni meydan okuma
          </p>
          <p className="mt-1 mb-4 text-xs text-text-muted">
            Süreli ekip veya bireysel hedef açın; ilerleme mevcut kayıtlardan canlı hesaplanır, bitince sonuç otomatik
            mühürlenir ve ofise kutlama bildirimi gider.
          </p>
          <ChallengeForm metrics={metrics} defaultStart={defaultStart} defaultEnd={defaultEnd} />
        </section>
      ) : null}

      {cards.length === 0 ? (
        <EmptyState
          illustration="ekip"
          icon={Flag}
          title="Henüz meydan okuma yok"
          description={
            canCreate
              ? "Ör. “Bu ay 20 yeni yetkili portföy” gibi süreli bir hedef açarak ekibi birlikte yarıştırın."
              : "Yönetici bir meydan okuma açtığında ilerleme ve sıralama burada canlı görünür."
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map(({ def, state, progress }) => {
            const st = STATE_LABEL[state];
            const showCancel = canEdit && def.status === "active";
            return (
              <article key={def.id} className="surface-card rounded-[var(--radius-panel)] p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-bold text-text">{def.title}</h3>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {SCORE_RULE_LABELS[def.metric]} · {def.scope === "team" ? "ekip hedefi" : "bireysel yarış"} ·{" "}
                      {dateLabel(def.startsAtIso)} – {dateLabel(new Date(Date.parse(def.endsAtIso) - 1).toISOString())}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${st.cls}`}>{st.text}</span>
                </div>

                {def.description ? <p className="mt-2 text-xs text-text-muted">{def.description}</p> : null}
                {def.rewardText ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                    <Gift className="h-3.5 w-3.5" aria-hidden="true" /> Ödül: {def.rewardText}
                  </p>
                ) : null}

                <div className="mt-4">
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-text">
                      <span className="numeric font-display text-lg font-extrabold text-accent-text">{progress.current}</span>
                      <span className="text-text-muted"> / {progress.target}</span>
                    </span>
                    <span className="text-text-muted">
                      {state === "live" || state === "upcoming" ? remainingLabel(challengeRemainingMs(def, nowMs)) : null}
                      {progress.reached ? " · hedefe ulaşıldı" : ""}
                    </span>
                  </div>
                  <Progress
                    value={progress.pct}
                    label={`${def.title}: hedefin yüzde ${progress.pct}'i`}
                    tone={progress.reached ? "success" : "accent"}
                  />
                </div>

                {progress.entries.length > 0 ? (
                  <ol className="mt-4 space-y-1.5">
                    {progress.entries.slice(0, 5).map((e) => {
                      const nm = names.get(e.staffId) ?? "Danışman";
                      return (
                        <li key={e.staffId}>
                          <Link
                            href={evidenceHref(def.metric, e.staffId)}
                            className="focus-ring flex items-center gap-2 rounded-[var(--radius-control)] px-1.5 py-1 text-sm transition hover:bg-surface-2"
                            aria-label={`${nm}: ${e.count} ${SCORE_RULE_LABELS[def.metric]} — kayıtları aç`}
                          >
                            <span className="numeric w-5 text-center text-xs font-bold text-text-faint">{e.rank}</span>
                            <Avatar name={nm} size="sm" />
                            <span className="min-w-0 flex-1 truncate font-semibold text-text">{nm}</span>
                            <span className="numeric font-display font-extrabold text-accent-text">{e.count}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="mt-4 flex items-center gap-1.5 text-xs text-text-faint">
                    <Users className="h-3.5 w-3.5" aria-hidden="true" /> Henüz katkı yok.
                  </p>
                )}

                {showCancel ? (
                  <div className="mt-4 flex justify-end">
                    <ConfirmDialog
                      trigger={
                        <button
                          type="button"
                          aria-label="Meydan okumayı iptal et"
                          className="focus-ring press inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border border-hairline bg-surface px-2.5 text-xs font-semibold text-danger-strong transition hover:border-danger-500/40"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> İptal et
                        </button>
                      }
                      title="Meydan okuma iptal edilsin mi?"
                      description={`“${def.title}” iptal edilir; sonuç mühürlenmez ve kutlama bildirimi gitmez.`}
                      confirmLabel="Meydan okumayı iptal et"
                      formAction={cancelChallenge}
                      hiddenFields={{ id: def.id }}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
