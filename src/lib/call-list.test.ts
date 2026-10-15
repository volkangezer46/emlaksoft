import { describe, expect, it } from "vitest";
import { buildCallList, mergeCallTasks, splitCallQueue, type CallListCandidate, type CallListState, type CallTaskInput } from "./call-list";

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

describe("mergeCallTasks (GA-05 tek kuyruk)", () => {
  const NOW = Date.parse("2026-10-15T09:00:00.000Z"); // 12:00 TR
  const task = (id: string, over: Partial<CallTaskInput> = {}): CallTaskInput => ({
    id,
    title: `Görev ${id}`,
    dueAt: "2026-10-15T11:00:00.000Z",
    customerId: null,
    customerName: null,
    phone: null,
    blacklist: false,
    ...over,
  });

  it("müşterili görev satırı en üste çıkarır; listede olmayan müşteri görevden eklenir; müşteri başına tek görev", () => {
    const base = buildCallList([cand("a", { temperature: "sicak" }), cand("b", { risk: "yuksek" })]);
    const rows = mergeCallTasks(
      base,
      [
        task("t1", { customerId: "a", phone: "05321234567", dueAt: "2026-10-15T08:00:00.000Z" }),
        task("t2", { customerId: "a", phone: "05321234567" }),
        task("t3", { customerId: "z", customerName: "Zeynep", phone: "05329999999" }),
      ],
      NOW,
    );
    expect(rows.map((r) => [r.key, r.tier])).toEqual([
      ["a", "gorev"],
      ["z", "gorev"],
      ["b", "risk"],
    ]);
    expect(rows[0]!.reasons[0]).toBe("Görev: Görev t1 · gecikti");
    expect(rows[0]!.task?.overdue).toBe(true);
    expect(rows[1]!.reasons[0]).toBe("Görev: Görev t3 · bugün 14:00");
  });

  it("müşterisiz görev ayrı satır; kara liste dışarıda; kaydedilen anahtar 'Arandı'ya iner", () => {
    const rows = mergeCallTasks([], [task("t9", { title: "Tapu müdürlüğünü ara" }), task("k", { customerId: "x", phone: "0532", blacklist: true })], NOW);
    expect(rows.map((r) => r.key)).toEqual(["gorev:t9"]);
    expect(rows[0]!.customerId).toBe("");
    const { done } = splitCallQueue(rows, new Set(["gorev:t9"]));
    expect(done).toHaveLength(1);
  });
});
