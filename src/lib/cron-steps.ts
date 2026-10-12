/**
 * Bir cron içindeki bağımsız adımları ayrı ayrı çalıştırır: biri hata verirse öbürleri durmaz.
 * Hatalar adım adıyla toplanır; çağıran heartbeat'e 'error' + özet yazar ve 500 döner.
 */
export type CronStepOutcome = {
  results: Record<string, unknown>;
  errors: Record<string, string>;
};

export async function runCronSteps(
  steps: Record<string, () => Promise<unknown>>,
): Promise<CronStepOutcome> {
  const results: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const [name, run] of Object.entries(steps)) {
    try {
      results[name] = await run();
    } catch (error) {
      errors[name] = error instanceof Error ? error.message : String(error);
      console.error("cron adımı başarısız", { step: name, error: errors[name] });
    }
  }
  return { results, errors };
}

export function cronStepsFailed(outcome: CronStepOutcome): boolean {
  return Object.keys(outcome.errors).length > 0;
}
