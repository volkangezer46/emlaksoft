/**
 * Dashboard batch query test — RPC'ler mevcut değilken graceful fallback
 */

import { describe, it, expect } from "vitest";
import { loadDashboardSnapshot } from "./data-batch";

describe("loadDashboardSnapshot", () => {
  it("gracefully handles missing RPC (migration not applied)", async () => {
    // RPC'ler yoksa (canlı DB henüz migration almadıysa) boş snapshot döner
    const snap = await loadDashboardSnapshot("test-tenant", "test-user");

    expect(snap).toEqual({
      briefingReady: false,
      metricsReady: false,
      tasksReady: false,
      programReady: false,
    });
  });
});
