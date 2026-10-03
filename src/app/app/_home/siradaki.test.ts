import { describe, expect, it } from "vitest";
import {
  FALLBACK_ACTION_KEY,
  buildNextActions,
  parseSkipCookie,
  pickNextAction,
  serializeSkipCookie,
  type NextActionInput,
} from "./siradaki";

const EMPTY: NextActionInput = {
  appointmentsToday: 0,
  firstAppointment: null,
  tasksOverdue: 0,
  hotLeads: 0,
  expiringAuthority: 0,
  unconfirmedListings: 0,
  pendingCommissionText: null,
  onboardingNext: null,
};

describe("sıradaki en iyi eylem", () => {
  it("hiçbir veri yoksa yalnız Müşteri ekle yedeği döner", () => {
    const a = buildNextActions(EMPTY);
    expect(a.map((x) => x.key)).toEqual([FALLBACK_ACTION_KEY]);
    expect(a[0].href).toBe("/app/hizli?sekme=musteri");
  });

  it("öncelik: randevu > gecikmiş görev > sıcak müşteri > yetki > teyitsiz ilan > komisyon > kurulum", () => {
    const a = buildNextActions({
      appointmentsToday: 2,
      firstAppointment: { time: "10:30", type: "Gösterim" },
      tasksOverdue: 3,
      hotLeads: 4,
      expiringAuthority: 1,
      unconfirmedListings: 5,
      pendingCommissionText: "₺10.000",
      onboardingNext: { title: "Logo", href: "/app/baslangic?adim=logo" },
    });
    expect(a.map((x) => x.key)).toEqual(["randevu", "gorev", "sicak", "yetki", "teyit", "komisyon", "kurulum", FALLBACK_ACTION_KEY]);
    expect(a[0].reason).toContain("10:30");
  });

  it("'Bugün için geç' atlananları geçer ama yedeği asla atlamaz", () => {
    const a = buildNextActions({ ...EMPTY, tasksOverdue: 1, hotLeads: 2 });
    expect(pickNextAction(a, []).key).toBe("gorev");
    expect(pickNextAction(a, ["gorev"]).key).toBe("sicak");
    expect(pickNextAction(a, ["gorev", "sicak", FALLBACK_ACTION_KEY]).key).toBe(FALLBACK_ACTION_KEY);
  });

  it("çerez yalnız bugünkü günde geçerli; bozuk anahtarlar atılır", () => {
    expect(parseSkipCookie(serializeSkipCookie("2026-10-03", ["gorev", "sicak", "gorev"]), "2026-10-03")).toEqual(["gorev", "sicak"]);
    expect(parseSkipCookie("2026-10-02|gorev", "2026-10-03")).toEqual([]);
    expect(parseSkipCookie("2026-10-03|GOREV,x y,sicak", "2026-10-03")).toEqual(["sicak"]);
    expect(parseSkipCookie(undefined, "2026-10-03")).toEqual([]);
  });
});
