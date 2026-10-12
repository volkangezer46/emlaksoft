import { describe, expect, it } from "vitest";
import { shouldIgnoreRealtimeEvent } from "./realtime-throttle";

describe("shouldIgnoreRealtimeEvent", () => {
  it("kendi yazımının yankısını yok sayar", () => {
    expect(shouldIgnoreRealtimeEvent({ new: { updated_by: "u1" } }, "u1", null)).toBe(true);
    expect(shouldIgnoreRealtimeEvent({ new: { updated_by: "u2" } }, "u1", null)).toBe(false);
  });
  it("son yenilemeden önceki değişikliği yok sayar", () => {
    const t = Date.parse("2026-10-12T10:00:00Z");
    expect(shouldIgnoreRealtimeEvent({ commit_timestamp: "2026-10-12T09:59:59Z" }, null, t)).toBe(true);
    expect(shouldIgnoreRealtimeEvent({ commit_timestamp: "2026-10-12T10:00:05Z" }, null, t)).toBe(false);
  });
});
