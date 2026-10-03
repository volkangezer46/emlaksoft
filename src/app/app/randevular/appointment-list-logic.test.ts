import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TYPE_LABELS,
  appointmentStatusTone,
  appointmentTypeTone,
  needsFollowUp,
  sumCounts,
} from "./appointment-list-logic";

describe("randevu liste mantığı", () => {
  it("her durum ve türün tonu tanımlı", () => {
    for (const k of Object.keys(APPOINTMENT_STATUS_LABELS)) expect(appointmentStatusTone(k)).toBeTruthy();
    for (const k of Object.keys(APPOINTMENT_TYPE_LABELS)) expect(appointmentTypeTone(k)).toBeTruthy();
    expect(appointmentStatusTone("signature")).toBe("danger");
    expect(appointmentStatusTone("completed")).toBe("success");
    expect(appointmentStatusTone("cancelled")).toBe("neutral");
  });
  it("geçmişte kalan teyit/imza bekleyen randevu takip ister", () => {
    expect(needsFollowUp("pending", 100, 200)).toBe(true);
    expect(needsFollowUp("signature", 100, 200)).toBe(true);
    expect(needsFollowUp("confirmed", 100, 200)).toBe(false);
    expect(needsFollowUp("pending", 300, 200)).toBe(false);
  });
  it("sayaç toplamı", () => {
    expect(sumCounts({ a: 2, b: 3 })).toBe(5);
    expect(sumCounts({})).toBe(0);
  });
});
