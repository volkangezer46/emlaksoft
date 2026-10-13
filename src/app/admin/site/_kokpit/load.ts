import "server-only";
import { daysAgoIso } from "@/lib/clock";
import { readAutopilot } from "@/lib/site-issues/autopilot-server";
import { readActions, readQueueIssues } from "@/lib/site-issues/store";
import type { IssueArea } from "@/lib/site-issues/types";
import { buildKokpitModel, lastAutopilotRun } from "./model";

/** Kokpit verisi: yalnız toplanmış tablolar ve ayar, hepsi paralel (dış çağrı yok). */
export async function loadKokpit(filter: IssueArea | null) {
  const [queue, syncs, autopilot, nightly] = await Promise.all([
    readQueueIssues(),
    readActions({ kinds: ["sync"], limit: 30 }),
    readAutopilot(),
    readActions({ kinds: ["autopilot_run"], source: "otopilot", sinceIso: daysAgoIso(1), limit: 1 }),
  ]);
  return {
    model: buildKokpitModel({ available: queue.available, issues: queue.data, syncs: syncs.data, filter }),
    autopilot,
    autopilotRun: lastAutopilotRun(nightly.data),
  };
}
