import { describe, expect, it } from "vitest";
import {
  isAppointmentTransitionAllowed,
  isContractTransitionAllowed,
  isDealTransitionAllowed,
  isDemandStatus,
  isIsoDate,
  isOfferTransitionAllowed,
  toIsoDateTime,
} from "./workflow-state";

describe("professional workflow state machines", () => {
  it("keeps accepted/rejected/withdrawn offers terminal and replay-safe", () => {
    expect(isOfferTransitionAllowed("submitted", "countered")).toBe(true);
    expect(isOfferTransitionAllowed("countered", "accepted")).toBe(true);
    expect(isOfferTransitionAllowed("accepted", "accepted")).toBe(true);
    expect(isOfferTransitionAllowed("accepted", "countered")).toBe(false);
    expect(isOfferTransitionAllowed("rejected", "accepted")).toBe(false);
    expect(isOfferTransitionAllowed("withdrawn", "submitted")).toBe(false);
  });

  it("allows only the pipeline transitions exposed by the product", () => {
    expect(isDealTransitionAllowed("new", "qualified")).toBe(true);
    expect(isDealTransitionAllowed("qualified", "won")).toBe(false);
    expect(isDealTransitionAllowed("negotiation", "won")).toBe(true);
    expect(isDealTransitionAllowed("won", "negotiation")).toBe(true);
    expect(isDealTransitionAllowed("won", "lost")).toBe(false);
  });

  it("does not resurrect signed/cancelled contracts", () => {
    expect(isContractTransitionAllowed("draft", "sent")).toBe(true);
    expect(isContractTransitionAllowed("sent", "signed")).toBe(true);
    expect(isContractTransitionAllowed("signed", "cancelled")).toBe(false);
    expect(isContractTransitionAllowed("cancelled", "sent")).toBe(false);
  });

  it("permits explicit appointment correction without arbitrary jumps", () => {
    expect(isAppointmentTransitionAllowed("pending", "completed")).toBe(false);
    expect(isAppointmentTransitionAllowed("confirmed", "completed")).toBe(true);
    expect(isAppointmentTransitionAllowed("completed", "confirmed")).toBe(true);
    expect(isAppointmentTransitionAllowed("cancelled", "completed")).toBe(false);
  });

  it("validates demand states and dates without throwing", () => {
    expect(isDemandStatus("matched")).toBe(true);
    expect(isDemandStatus("deleted")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(toIsoDateTime("not-a-date")).toBeNull();
    expect(toIsoDateTime("2026-08-13T10:30")).toMatch(/^2026-08-13T/);
  });
});
