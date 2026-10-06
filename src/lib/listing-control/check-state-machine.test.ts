import { describe, expect, it } from "vitest";
import { applyObservation, INITIAL_SNAPSHOT, isMissingState, policyForRpc, type CheckSnapshot, type Observation } from "./check-state-machine";
import { DEFAULT_LISTING_CONTROL_CONFIG } from "./config";

const T0 = Date.parse("2026-01-01T10:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

function run(prev: CheckSnapshot, obs: Observation) {
  return applyObservation(prev, obs);
}

describe("şüpheli → onaylı kayıp durum makinesi", () => {
  it("TEK 'yok' gözlemi silindi DEĞİL: yalnız şüpheli (0.30), anomali açtırmaz", () => {
    const r = run(INITIAL_SNAPSHOT, { result: "absent", sourceKind: "assisted", clientId: "c1", at: at(0) });
    expect(r.next.state).toBe("suspect");
    expect(r.next.confidence).toBe(0.3);
    expect(isMissingState(r.next.state)).toBe(false);
  });

  it("asistanlı kaynak: 2. gözlem olası kayıp (0.70), 3. gözlem farklı istemciyle ONAYLI (0.95)", () => {
    let s = run(INITIAL_SNAPSHOT, { result: "absent", sourceKind: "assisted", clientId: "c1", at: at(0) }).next;
    s = run(s, { result: "absent", sourceKind: "assisted", clientId: "c1", at: at(15) }).next;
    expect(s.state).toBe("probable_missing");
    expect(s.confidence).toBe(0.7);
    s = run(s, { result: "absent", sourceKind: "assisted", clientId: "c2", at: at(40) }).next;
    expect(s.state).toBe("confirmed_missing");
    expect(s.confidence).toBe(0.95);
  });

  it("tek istemci: 3. gözlem ilk 'yok'tan 6 saat geçmeden olası kayıpta kalır; sonra 0.85 ile onaylanır", () => {
    let s = run(INITIAL_SNAPSHOT, { result: "absent", sourceKind: "assisted", clientId: "c1", at: at(0) }).next;
    s = run(s, { result: "absent", sourceKind: "assisted", clientId: "c1", at: at(15) }).next;
    s = run(s, { result: "absent", sourceKind: "assisted", clientId: "c1", at: at(30) }).next;
    expect(s.state).toBe("probable_missing");
    s = run(s, { result: "absent", sourceKind: "assisted", clientId: "c1", at: at(6 * 60 + 5) }).next;
    expect(s.state).toBe("confirmed_missing");
    expect(s.confidence).toBe(0.85);
  });

  it("asgari ara (10 dk) dolmadan sayaç artmaz", () => {
    const first = run(INITIAL_SNAPSHOT, { result: "absent", sourceKind: "assisted", clientId: "c1", at: at(0) });
    const second = run(first.next, { result: "absent", sourceKind: "assisted", clientId: "c2", at: at(3) });
    expect(second.countedAbsent).toBe(false);
    expect(second.next.consecutiveAbsent).toBe(1);
    expect(second.next.state).toBe("suspect");
  });

  it("resmi kaynak (api/feed/csv): 1. şüpheli, 2. onaylı", () => {
    const a = run(INITIAL_SNAPSHOT, { result: "absent", sourceKind: "feed", at: at(0) });
    expect(a.next.state).toBe("suspect");
    const b = run(a.next, { result: "absent", sourceKind: "feed", at: at(20) });
    expect(b.next.state).toBe("confirmed_missing");
    expect(b.next.confidence).toBe(0.85);
    const api = run(run(INITIAL_SNAPSHOT, { result: "absent", sourceKind: "api", at: at(0) }).next, { result: "absent", sourceKind: "api", at: at(20) });
    expect(api.next.confidence).toBe(0.95);
  });

  it("elle 'portalda yok' → onaylı kayıp, güven 0.90", () => {
    const r = run(INITIAL_SNAPSHOT, { result: "absent", sourceKind: "manual", at: at(0) });
    expect(r.next.state).toBe("confirmed_missing");
    expect(r.next.confidence).toBe(0.9);
  });

  it("blocked/error ASLA kayıp sayılmaz: unverifiable, sayaç değişmez, üstel geri çekilme", () => {
    const b1 = run(INITIAL_SNAPSHOT, { result: "blocked", sourceKind: "assisted", errorCode: "captcha", at: at(0) });
    expect(b1.next.state).toBe("unverifiable");
    expect(b1.next.consecutiveAbsent).toBe(0);
    expect(b1.next.errorCode).toBe("captcha");
    expect(Date.parse(b1.nextCheckAt) - T0).toBe(30 * 60_000);
    const b2 = run(b1.next, { result: "error", sourceKind: "assisted", at: at(30) });
    expect(Date.parse(b2.nextCheckAt) - (T0 + 30 * 60_000)).toBe(60 * 60_000);
    let s = b2.next;
    for (let i = 0; i < 6; i++) s = run(s, { result: "blocked", sourceKind: "assisted", at: at(60 + i * 10) }).next;
    const last = run(s, { result: "blocked", sourceKind: "assisted", at: at(200) });
    expect(Date.parse(last.nextCheckAt) - (T0 + 200 * 60_000)).toBe(240 * 60_000);
  });

  it("şüpheli/olası/onaylı durumda blocked durumu korur (düşürmez)", () => {
    const sus = run(INITIAL_SNAPSHOT, { result: "absent", sourceKind: "assisted", clientId: "c1", at: at(0) }).next;
    const r = run(sus, { result: "blocked", sourceKind: "assisted", at: at(20) });
    expect(r.next.state).toBe("suspect");
    expect(r.next.consecutiveAbsent).toBe(1);
  });

  it("present her durumu verified'a döndürür ve sayaçları sıfırlar", () => {
    let s = run(INITIAL_SNAPSHOT, { result: "absent", sourceKind: "feed", at: at(0) }).next;
    s = run(s, { result: "absent", sourceKind: "feed", at: at(20) }).next;
    expect(s.state).toBe("confirmed_missing");
    const r = run(s, { result: "present", sourceKind: "assisted", price: 2_500_000, at: at(60) });
    expect(r.next.state).toBe("verified");
    expect(r.next.consecutiveAbsent).toBe(0);
    expect(r.next.firstAbsentAt).toBeNull();
    expect(r.next.absentClientIds).toEqual([]);
    expect(r.next.portalPrice).toBe(2_500_000);
    expect(r.stateChanged).toBe(true);
  });

  it("duraklatılmış ilan manual dışı kaynaktan sonuç almaz", () => {
    const paused: CheckSnapshot = { ...INITIAL_SNAPSHOT, state: "paused" };
    const r = run(paused, { result: "absent", sourceKind: "assisted", at: at(0) });
    expect(r.ignored).toBe(true);
    expect(r.next.state).toBe("paused");
  });

  it("policyForRpc yalnız SQL'in okuduğu anahtarları taşır", () => {
    expect(policyForRpc(DEFAULT_LISTING_CONTROL_CONFIG.stateMachine, 24)).toEqual({
      min_gap_minutes: 10,
      single_client_wait_hours: 6,
      normal_hours: 24,
    });
  });
});
