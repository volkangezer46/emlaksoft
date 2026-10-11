import { describe, expect, it } from "vitest";
import {
  buildSnapshot,
  changePct,
  effectiveStatus,
  parsePriceInput,
  parseSnapshot,
  positionInRange,
  PROPOSAL_STATUS_LABEL,
  proposalMessage,
} from "./model";

const EST = { estimatedValue: 8_000_000, lowValue: 7_400_000, highValue: 8_600_000, compCount: 9, wonCount: 3, activeCount: 6, confidence: "orta" as const };
const COMPS = Array.from({ length: 8 }, (_, i) => ({ source: "active_listing" as const, price: 7_500_000 + i * 100_000, sqm: 120, rooms: "3+1" }));

describe("buildSnapshot", () => {
  it("emsal yetersizse snapshot YOK (öneri aralığı gösterilmez)", () => {
    expect(buildSnapshot({ ...EST, confidence: "yetersiz" }, COMPS, "2026-10-12T00:00:00Z")).toBeNull();
    expect(buildSnapshot({ ...EST, estimatedValue: null }, COMPS, "x")).toBeNull();
    expect(buildSnapshot({ ...EST, compCount: 0 }, COMPS, "x")).toBeNull();
  });

  it("en çok 5 anonim satır taşır (kod/başlık/id yok)", () => {
    const s = buildSnapshot(EST, COMPS, "2026-10-12T00:00:00Z")!;
    expect(s.rows).toHaveLength(5);
    expect(Object.keys(s.rows[0]!).sort()).toEqual(["price", "rooms", "source", "sqm"]);
    expect(s).toMatchObject({ low: 7_400_000, high: 8_600_000, median: 8_000_000, compCount: 9, confidence: "orta" });
  });

  it("parseSnapshot gidiş-dönüş yapar; bozuk jsonb null döner", () => {
    const s = buildSnapshot(EST, COMPS, "2026-10-12T00:00:00Z")!;
    expect(parseSnapshot(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot({ v: 2 })).toBeNull();
    expect(parseSnapshot({ v: 1, low: 1, high: 2, median: 1, compCount: 1, confidence: "kesin" })).toBeNull();
  });
});

describe("yardımcılar", () => {
  it("parsePriceInput: noktalı/TL'li girdiyi sayıya çevirir, saçma girdiyi reddeder", () => {
    expect(parsePriceInput("8.250.000")).toBe(8_250_000);
    expect(parsePriceInput("8250000 TL")).toBe(8_250_000);
    expect(parsePriceInput("")).toBeNull();
    expect(parsePriceInput("abc")).toBeNull();
    expect(parsePriceInput("0")).toBeNull();
    expect(parsePriceInput("1".repeat(14))).toBeNull();
  });

  it("changePct ve positionInRange", () => {
    expect(changePct(1_000_000, 900_000)).toBe(-10);
    expect(changePct(0, 5)).toBeNull();
    const s = buildSnapshot(EST, COMPS, "x");
    expect(positionInRange(7_000_000, s)).toBe("alt");
    expect(positionInRange(8_000_000, s)).toBe("icinde");
    expect(positionInRange(9_000_000, s)).toBe("ust");
    expect(positionInRange(9_000_000, null)).toBeNull();
  });

  it("effectiveStatus: süresi geçen bekleyen öneri expired sayılır; karar verilmiş olan değişmez", () => {
    expect(effectiveStatus("pending", 1000, 2000)).toBe("expired");
    expect(effectiveStatus("pending", 3000, 2000)).toBe("pending");
    expect(effectiveStatus("approved", 1000, 2000)).toBe("approved");
  });

  it("proposalMessage: bilinen kod Türkçe, bilinmeyen genel hata; ham metin yok", () => {
    expect(proposalMessage("ok").ok).toBe(true);
    expect(proposalMessage("expired").text).toMatch(/süresi dolmuş/);
    expect(proposalMessage("???").ok).toBe(false);
  });
});

describe("yönetici onayı bekleyen öneri (GUVENLIK-1)", () => {
  it("durum etiketi mülk sahibi onayını ve yönetici beklentisini söyler; süre dolumu yalnız pending'i etkiler", () => {
    expect(PROPOSAL_STATUS_LABEL.awaiting_manager).toBe("Mülk sahibi onayladı, yönetici onayı bekleniyor");
    expect(effectiveStatus("awaiting_manager", 0, 1_000)).toBe("awaiting_manager");
  });

  it("apply/ret RPC kodları Türkçe cümleye eşlenir", () => {
    for (const code of ["not_awaiting", "no_approval", "no_denial"]) {
      const m = proposalMessage(code);
      expect(m.ok).toBe(false);
      expect(m.text).not.toBe(proposalMessage("bilinmeyen").text);
    }
  });
});
