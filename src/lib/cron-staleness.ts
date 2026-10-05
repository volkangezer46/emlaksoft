import { CRON_JOBS } from "@/lib/cron-jobs";

export type HeartbeatRow = { job: string; last_run_at: string | null; last_status: string | null };

export type CronProblem = {
  job: string;
  reason: "never_ran" | "stale" | "error";
  minutesSinceRun: number | null;
  staleAfterMinutes: number;
};

type JobWindow = { job: string; staleAfterMinutes: number };

/**
 * Bayatlık kararı (saf): iş hiç çalışmadıysa, son çalışma pencereyi aştıysa
 * ya da son durum "error" ise sorunlu sayılır. /admin/sistem ile aynı kural.
 */
export function evaluateCronHealth(
  rows: readonly HeartbeatRow[],
  nowMs: number,
  jobs: readonly JobWindow[] = CRON_JOBS,
): CronProblem[] {
  const byJob = new Map(rows.map((r) => [r.job, r]));
  const problems: CronProblem[] = [];
  for (const { job, staleAfterMinutes } of jobs) {
    const hb = byJob.get(job);
    const ts = hb?.last_run_at ? Date.parse(hb.last_run_at) : NaN;
    if (!hb || Number.isNaN(ts)) {
      problems.push({ job, reason: "never_ran", minutesSinceRun: null, staleAfterMinutes });
      continue;
    }
    const minutes = Math.max(0, Math.round((nowMs - ts) / 60_000));
    if (minutes > staleAfterMinutes) problems.push({ job, reason: "stale", minutesSinceRun: minutes, staleAfterMinutes });
    else if (hb.last_status === "error") problems.push({ job, reason: "error", minutesSinceRun: minutes, staleAfterMinutes });
  }
  return problems;
}
