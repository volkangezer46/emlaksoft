import "server-only";
import { afterSafe } from "@/lib/after-safe";
import { getPlatformSetting, setPlatformSetting } from "@/lib/platform-settings";
import { captureLiveDigests, runAfterPublish } from "@/lib/publishing/after-publish";
import { SURFACES } from "@/lib/publishing/surfaces";
import { AUTOPILOT_KEY, parseAutopilot, runAutopilot, type AutopilotRun, type AutopilotSettings } from "./autopilot";
import { EXECUTORS } from "./executors";
import { publishDraftsSequential } from "./publish-all";
import { patchIssue, readQueueIssues, recordOptimizerAction } from "./store";

/**
 * Otopilot'un gerçek bağlantıları: ayar `growth.autopilot` (platform_settings, migration'sız), kuyruk ve işlem kaydı
 * (store.ts), yayın Yayın masası yüzeyleri üzerinden. Gece tetikleyicisi: `seo-robot` cron'unun yalıtılmış Kokpit adımı
 * (src/lib/site-issues/nightly.ts).
 */

export async function readAutopilot(): Promise<AutopilotSettings> {
  return parseAutopilot(await getPlatformSetting(AUTOPILOT_KEY));
}

export async function writeAutopilot(value: AutopilotSettings, staffId: string): Promise<boolean> {
  const json = JSON.stringify(value);
  if (!(await setPlatformSetting(AUTOPILOT_KEY, json, staffId))) return false;
  return (await getPlatformSetting(AUTOPILOT_KEY)) === json;
}

export async function runAutopilotNow(): Promise<AutopilotRun> {
  return runAutopilot({
    readSettings: readAutopilot,
    listIssues: async () => (await readQueueIssues()).data,
    executors: EXECUTORS,
    record: (input) => recordOptimizerAction(input),
    patchIssue: (id, patch) => patchIssue(id, patch),
    publishSurfaces: (ids, actor) =>
      publishDraftsSequential(
        SURFACES.filter((s) => ids.includes(s.id)),
        { ...actor, source: "otopilot" },
        {
          label: "Otopilot yayını",
          captureBefore: (paths) => captureLiveDigests(paths),
          onPublished: (ev) => afterSafe(() => runAfterPublish(ev), "yayın sonrası zinciri"),
        },
      ),
  });
}
