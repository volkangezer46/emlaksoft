import { describe, expect, it } from "vitest";
import { shouldIgnoreRealtimeEvent } from "./realtime-throttle";

describe("shouldIgnoreRealtimeEvent", () => {
  it("kendi yazımının yankısını yok sayar", () => {
    expect(shouldIgnoreRealtimeEvent({ eventType: "UPDATE", new: { updated_by: "u1" } }, "u1")).toBe(true);
    expect(shouldIgnoreRealtimeEvent({ eventType: "UPDATE", new: { updated_by: "u2" } }, "u1")).toBe(false);
  });
  it("INSERT'te created_by kendi yankısıdır", () => {
    expect(shouldIgnoreRealtimeEvent({ eventType: "INSERT", new: { created_by: "u1" } }, "u1")).toBe(true);
    expect(shouldIgnoreRealtimeEvent({ eventType: "INSERT", new: { actor_id: "u1" } }, "u1")).toBe(true);
  });
  it("UPDATE'te created_by=ben ama updated_by=başkası ise yok SAYILMAZ", () => {
    expect(shouldIgnoreRealtimeEvent({ eventType: "UPDATE", new: { created_by: "u1", updated_by: "u2" } }, "u1")).toBe(false);
  });
  it("UPDATE'te created_by=ben ve updated_by yoksa yok sayılmaz; actor_id de sayılmaz", () => {
    expect(shouldIgnoreRealtimeEvent({ eventType: "UPDATE", new: { created_by: "u1" } }, "u1")).toBe(false);
    expect(shouldIgnoreRealtimeEvent({ eventType: "UPDATE", new: { actor_id: "u1" } }, "u1")).toBe(false);
  });
  it("DELETE ya da bilinmeyen türde aktör kuralı uygulanmaz", () => {
    expect(shouldIgnoreRealtimeEvent({ eventType: "DELETE", new: { updated_by: "u1" } }, "u1")).toBe(false);
    expect(shouldIgnoreRealtimeEvent({ new: { updated_by: "u1" } }, "u1")).toBe(false);
  });
  it("commit zamanı (sunucu saati) olayı yok saydırmaz: saati ileri cihazda değişiklik kaybolmaz", () => {
    expect(shouldIgnoreRealtimeEvent({ eventType: "INSERT", commit_timestamp: "2020-01-01T00:00:00Z", new: { created_by: "u2" } }, "u1")).toBe(false);
  });
  it("odakta olmayan sekme (selfUserId verilmez) kendi kullanıcısının kaydını da görür", () => {
    expect(shouldIgnoreRealtimeEvent({ eventType: "INSERT", new: { created_by: "u1" } }, null)).toBe(false);
  });
});
