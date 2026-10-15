import { describe, expect, it } from "vitest";
import {
  departureReminderKey,
  minutesLabel,
  planDepartureReminders,
  previousLeg,
  twoHourReminderKey,
  type DepartureAppointment,
} from "@/lib/appointment-departure";

// 2026-10-15 12:00 TR = 09:00Z
const NOW = Date.parse("2026-10-15T09:00:00.000Z");
const at = (minFromNow: number) => new Date(NOW + minFromNow * 60_000).toISOString();

const base: DepartureAppointment = {
  id: "a1",
  tenant_id: "t1",
  scheduled_at: at(120),
  duration_min: 60,
  appointment_type: "showing",
  status: "pending",
  assigned_to: "u1",
  created_by: null,
  customerName: "Ayşe Yılmaz",
  lat: null,
  lng: null,
};

describe("2 saat kala hatırlatması", () => {
  it("60-150 dk penceresinde bir kez yazılır, kişiye ve tek randevuya", () => {
    const plan = planDepartureReminders([base], { nowMs: NOW, isAlreadyNotified: () => false });
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ user_id: "u1", href: "/app/randevular?randevu=a1", dedupe_key: twoHourReminderKey(base) });
    expect(plan.rows[0]!.title).toBe("Randevunuza ~2 saat kaldı");
    expect(plan.rows[0]!.body).toContain("14:00–15:00");
  });

  it("pencere dışı, zaten bildirilen, iptal ve sahipsiz atlanır", () => {
    const rows = planDepartureReminders(
      [
        { ...base, id: "far", scheduled_at: at(200) },
        { ...base, id: "near", scheduled_at: at(30) },
        { ...base, id: "done" },
        { ...base, id: "x", status: "cancelled" },
        { ...base, id: "y", assigned_to: null },
      ],
      { nowMs: NOW, isAlreadyNotified: (k) => k.includes(":done:") },
    ).rows;
    expect(rows).toHaveLength(0);
  });
});

describe("yola çıkma zamanı", () => {
  // Önceki durak Kadıköy, hedef Ataşehir (~6 km → ~9 dk)
  const prev: DepartureAppointment = { ...base, id: "p", scheduled_at: at(-60), lat: 40.99, lng: 29.03 };
  const target: DepartureAppointment = { ...base, id: "t", scheduled_at: at(35), lat: 40.99, lng: 29.1 };

  it("önceki aynı gün koordinatlı durak varsa tahmini yol hesaplanır", () => {
    const leg = previousLeg(target, [prev, target]);
    expect(leg?.travelMin).toBeGreaterThan(0);
    expect(previousLeg(target, [target])).toBeNull();
    expect(previousLeg({ ...target, lat: null }, [prev, target])).toBeNull();
    // Başka danışmanın randevusu başlangıç noktası sayılmaz
    expect(previousLeg(target, [{ ...prev, assigned_to: "u2" }, target])).toBeNull();
  });

  it("çıkış anı 30 dk içindeyse 'Yola çıkma zamanı' yazılır ve tahmini etiketlidir", () => {
    const rows = planDepartureReminders([prev, target], { nowMs: NOW, isAlreadyNotified: () => false }).rows;
    const leave = rows.find((r) => r.dedupe_key === departureReminderKey(target));
    expect(leave?.title).toMatch(/^Yola çıkma zamanı: \d\d:\d\d$/);
    expect(leave?.body).toContain("~");
    expect(leave?.body).toContain("tahmini");
  });

  it("çıkış anı geçtiyse 'Hemen yola çıkın'", () => {
    const soon = { ...target, scheduled_at: at(5) };
    const rows = planDepartureReminders([prev, soon], { nowMs: NOW, isAlreadyNotified: () => false }).rows;
    expect(rows[0]?.title).toContain("Hemen yola çıkın");
  });
});

it("minutesLabel", () => {
  expect(minutesLabel(45)).toBe("45 dk");
  expect(minutesLabel(120)).toBe("2 saat");
  expect(minutesLabel(100)).toBe("1 sa 40 dk");
});
