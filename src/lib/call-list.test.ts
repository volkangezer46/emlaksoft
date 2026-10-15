import { describe, expect, it } from "vitest";
import { buildCallList, splitCallQueue, type CallListCandidate, type CallListState } from "./call-list";

const state = (over: Partial<CallListState> = {}): CallListState => ({
  temperature: "ilik",
  risk: null,
  nextBestAction: null,
  daysSinceContact: 5,
  reasons: [],
  heatScore: 10,
  ...over,
});

const cand = (id: string, over: Partial<CallListState> | null = {}, extra: Partial<CallListCandidate> = {}): CallListCandidate => ({
  id,
  name: `Müşteri ${id}`,
  phone: "05321234567",
  blacklist: false,
  state: over === null ? null : state(over),
  ...extra,
});

describe("buildCallList", () => {
  it("öncelik > risk > sıcak > takip; kademe içinde ısı puanı", () => {
    const rows = buildCallList(
      [
        cand("takip", { nextBestAction: { key: "dokun", text: "Dokunun", href: "/x" } }),
        cand("sicak-dusuk", { temperature: "sicak", heatScore: 40 }),
        cand("sicak-yuksek", { temperature: "sicak", heatScore: 90 }),
        cand("risk", { risk: "yuksek" }),
        cand("oncelik-2", {}),
        cand("oncelik-1", {}),
      ],
      ["oncelik-1", "oncelik-2"],
    );
    expect(rows.map((r) => r.customerId)).toEqual(["oncelik-1", "oncelik-2", "risk", "sicak-yuksek", "sicak-dusuk", "takip"]);
    expect(rows[5]!.nextAction).toEqual({ text: "Dokunun", href: "/x" });
  });

  it("kara liste, telefonsuz, durumsuz, bugün temas edilmiş ve gerekçesiz müşteriyi dışlar", () => {
    const rows = buildCallList([
      cand("kara", { temperature: "sicak" }, { blacklist: true }),
      cand("telsiz", { temperature: "sicak" }, { phone: "  " }),
      cand("durumsuz", null),
      cand("bugun", { temperature: "sicak", daysSinceContact: 0 }),
      cand("soguk", { temperature: "soguk", nextBestAction: { key: "rutin", text: "Rutin", href: "/y" } }),
      cand("ok", { temperature: "sicak" }),
    ]);
    expect(rows.map((r) => r.customerId)).toEqual(["ok"]);
  });

  it("gerekçe yoksa kademe etiketi, en çok 3 gerekçe; üst sınır ve tekil kayıt", () => {
    const rows = buildCallList(
      [
        cand("a", { risk: "yuksek", reasons: [1, 2, 3, 4].map((n) => ({ label: `N${n}`, evidence: "", href: "" })) }),
        cand("a", { temperature: "sicak" }),
        cand("b", { temperature: "sicak" }),
      ],
      [],
      5,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.reasons).toEqual(["N1", "N2", "N3"]);
    expect(rows[1]!.reasons).toEqual(["Sıcak müşteri"]);
    expect(buildCallList([cand("x", { temperature: "sicak" })], [], 0)).toEqual([]);
  });
});

describe("splitCallQueue", () => {
  it("kaydedilenleri sona ayırır, sırayı korur", () => {
    const entries = [{ customerId: "1" }, { customerId: "2" }, { customerId: "3" }];
    const { pending, done } = splitCallQueue(entries, new Set(["2"]));
    expect(pending.map((e) => e.customerId)).toEqual(["1", "3"]);
    expect(done.map((e) => e.customerId)).toEqual(["2"]);
  });
});
