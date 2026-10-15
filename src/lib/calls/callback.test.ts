import { describe, expect, it } from "vitest";
import {
  callbackMarker,
  callbackMarkerPattern,
  callbackTaskNotes,
  callbackTaskTitle,
  pickCallbackAssignee,
  unreturnedMissedCalls,
} from "./callback";

describe("geri arama döngüsü — saf kurallar", () => {
  it("işaret numaraya bağlıdır ve not işaretle başlar", () => {
    expect(callbackMarker("05321234567")).toBe("[geri-ara:05321234567]");
    expect(callbackMarkerPattern("05321234567")).toBe("[geri-ara:05321234567]%");
    expect(callbackTaskNotes("05321234567").startsWith("[geri-ara:05321234567]")).toBe(true);
  });

  it("başlık müşteri adı varsa onu, yoksa numarayı taşır", () => {
    expect(callbackTaskTitle("Ayşe Yılmaz", "0532 123 45 67")).toBe("Geri ara: Ayşe Yılmaz (0532 123 45 67)");
    expect(callbackTaskTitle("  ", "0532 123 45 67")).toBe("Geri ara: 0532 123 45 67");
    expect(callbackTaskTitle(null, "0532 123 45 67")).toBe("Geri ara: 0532 123 45 67");
  });

  it("atanan: müşteri danışmanı → kaydı giren → ofis varsayılanı", () => {
    expect(pickCallbackAssignee({ customerAdvisorId: "adv", actorId: "me", officeDefaultId: "def" })).toBe("adv");
    expect(pickCallbackAssignee({ customerAdvisorId: null, actorId: "me", officeDefaultId: "def" })).toBe("me");
    expect(pickCallbackAssignee({ customerAdvisorId: null, actorId: null, officeDefaultId: "def" })).toBe("def");
    expect(pickCallbackAssignee({})).toBeNull();
  });

  it("geri aranmayan: sonrasında aynı numaraya giden arama yoksa listelenir", () => {
    const calls = [
      { id: "m1", direction: "missed", phone: "05321111111", started_at: "2026-10-10T09:00:00Z" },
      { id: "o1", direction: "outbound", phone: "05321111111", started_at: "2026-10-10T10:00:00Z" },
      { id: "m2", direction: "missed", phone: "05321111111", started_at: "2026-10-11T09:00:00Z" },
      { id: "m3", direction: "missed", phone: "05322222222", started_at: "2026-10-11T09:00:00Z" },
      // Önce yapılan giden arama, sonraki cevapsızı kapatmaz.
      { id: "o2", direction: "outbound", phone: "05322222222", started_at: "2026-10-11T08:00:00Z" },
      // Başka numaraya giden arama etkisizdir; gelen (cevaplanmış) arama giden sayılmaz.
      { id: "i1", direction: "inbound", phone: "05323333333", started_at: "2026-10-12T08:00:00Z" },
      { id: "m4", direction: "missed", phone: "05323333333", started_at: "2026-10-12T07:00:00Z" },
    ];
    expect(unreturnedMissedCalls(calls).map((c) => c.id)).toEqual(["m2", "m3", "m4"]);
  });

  it("tek giden arama kendisinden önceki tüm cevapsızları kapatır", () => {
    const calls = [
      { id: "m1", direction: "missed", phone: "05321111111", started_at: "2026-10-10T09:00:00Z" },
      { id: "m2", direction: "missed", phone: "05321111111", started_at: "2026-10-10T09:30:00Z" },
      { id: "o1", direction: "outbound", phone: "05321111111", started_at: "2026-10-10T10:00:00Z" },
    ];
    expect(unreturnedMissedCalls(calls)).toEqual([]);
  });
});
