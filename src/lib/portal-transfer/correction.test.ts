import { describe, expect, it } from "vitest";
import { buildSnapshot, correctionSummary, diffSnapshot, fnv1a32, idxsToRead, mergeSnapshots, releaseOwned, resolveSnapshotIdx, sanitizeSnapshot, untouchedOwnIdxs, type FillSnapshot } from "./correction";
import type { ControlDescriptor, FillAction } from "./fill-plan";
import { formShapes, sigIndex, signShapes } from "./form-signature";
import { readValuesInPage, type ReadValue } from "./page-fns";

function d(p: Partial<ControlDescriptor> & { idx: number; labels: string[] }): ControlDescriptor {
  return { tag: "input", type: "text", options: [], current: "", checked: false, group: "", optionText: "", disabled: false, visible: true, sources: p.labels.map(() => "label_for"), ...p };
}
const text = (idx: number, v: string): ReadValue => {
  const r: ReadValue = { idx, kind: "text" };
  if (v) r.valueHash = fnv1a32(v);
  const digits = v.replace(/[^0-9]/g, "");
  if (digits) r.digitsHash = fnv1a32(digits);
  return r;
};

const FORM = [
  d({ idx: 0, tag: "select", type: "", labels: ["Isıtma"], options: ["Seçiniz", "Merkezi", "Kombi (Doğalgaz)"] }),
  d({ idx: 1, labels: ["Fiyat"] }),
  d({ idx: 2, labels: ["Aidat"] }),
  d({ idx: 3, type: "radio", group: "site", optionText: "Evet", labels: ["Site İçerisinde"] }),
  d({ idx: 4, type: "radio", group: "site", optionText: "Hayır", labels: ["Site İçerisinde"] }),
];
const ACTIONS: FillAction[] = [
  { idx: 0, op: "select", field: "heating", optionIndex: 1 },
  { idx: 1, op: "text", field: "price", value: "1500000" },
  { idx: 2, op: "text", field: "dues", value: "500" },
  { idx: 3, op: "click", field: "in_site" },
];
const AFTER: ReadValue[] = [{ idx: 0, kind: "select", option: "Merkezi" }, text(1, "1500000"), text(2, "500"), { idx: 3, kind: "bool", checked: true }];
const SESSION = "11111111-2222-4333-8444-555555555555";

async function setup(descs = FORM) {
  const signed = await signShapes(formShapes(descs).shapes);
  return { shapes: sigIndex(signed), descs };
}

async function snapshot(): Promise<FillSnapshot> {
  const { shapes } = await setup();
  return buildSnapshot({ sessionId: SESSION, portal: "sahibinden", ruleVersion: 0, at: 1 }, ACTIONS, ACTIONS.map((a) => ({ idx: a.idx, ok: true })), AFTER, shapes, FORM);
}

describe("correction: anlık görüntü ↔ şimdiki okuma", () => {
  it("anlık görüntü ham değer taşımaz: metinde yalnız özet, seçimde portal seçenek metni", async () => {
    const snap = await snapshot();
    expect(snap.items).toHaveLength(4);
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/1500000|"500"/);
    expect(snap.items.find((i) => i.key === "heating")).toMatchObject({ kind: "select", option: "merkezi" });
    expect(snap.items.find((i) => i.key === "in_site")).toMatchObject({ kind: "select", option: "evet", group: [3, 4] });
    expect(sanitizeSnapshot(JSON.parse(json))).toEqual({ ...snap, ruleSha: null });
    expect(sanitizeSnapshot({ ...snap, items: [{ ...snap.items[1], value: "1500000" }] })!.items[0]).not.toHaveProperty("value");
  });

  it("select değişti → other_option + seçenek; '1500000' → '1.500.000' → format; boşaltma → cleared; radyo başka seçenek", async () => {
    const snap = await snapshot();
    const now = await setup();
    const out = diffSnapshot(snap, [{ idx: 0, kind: "select", option: "Kombi (Doğalgaz)" }, text(1, "1.500.000"), text(2, ""), { idx: 3, kind: "bool", checked: false }, { idx: 4, kind: "bool", checked: true }], now);
    const by = Object.fromEntries(out.map((o) => [o.key, o]));
    expect(by.heating).toMatchObject({ outcome: "corrected", correction: { kind: "other_option", option: "kombi dogalgaz" } });
    expect(by.price).toMatchObject({ outcome: "corrected", correction: { kind: "value_edited", category: "format" } });
    expect(by.dues).toMatchObject({ outcome: "cleared" });
    expect(by.in_site).toMatchObject({ outcome: "corrected", correction: { kind: "other_option", option: "hayir" } });
    expect(correctionSummary(out)).toEqual({ changed: 2 + 1, cleared: 1, accepted: 0, missing: 0 });
  });

  it("değişmeyen alan accepted; rakamları değişen metin rewritten; seçim yer tutucuya döndüyse cleared", async () => {
    const snap = await snapshot();
    const out = diffSnapshot(snap, [{ idx: 0, kind: "select", option: "Seçiniz" }, text(1, "2000000"), text(2, "500"), { idx: 3, kind: "bool", checked: true }], await setup());
    const by = Object.fromEntries(out.map((o) => [o.key, o]));
    expect(by.heating!.outcome).toBe("cleared");
    expect(by.price).toMatchObject({ outcome: "corrected", correction: { kind: "value_edited", category: "rewritten" } });
    expect(by.dues!.outcome).toBe("accepted");
    expect(by.in_site!.outcome).toBe("accepted");
  });

  it("sıra numarası kaydıysa (sayfa yeniden çizildi) alan imzasıyla bulunur; imza yoksa not_found", async () => {
    const snap = await snapshot();
    const shifted = [d({ idx: 0, labels: ["Not"] }), ...FORM.map((x) => ({ ...x, idx: x.idx + 1 }))];
    const now = await setup(shifted);
    const resolved = resolveSnapshotIdx(snap, now.shapes);
    expect(idxsToRead(resolved)).toEqual([1, 2, 3, 4, 5]);
    const out = diffSnapshot(snap, [{ idx: 1, kind: "select", option: "Merkezi" }, text(2, "1500000"), text(3, "500"), { idx: 4, kind: "bool", checked: true }], now);
    expect(out.every((o) => o.outcome === "accepted")).toBe(true);
    const gone = await setup([d({ idx: 0, labels: ["Başka alan"] })]);
    expect(diffSnapshot(snap, [], gone).every((o) => o.outcome === "not_found")).toBe(true);
  });

  it("FNV-1a: sayfa içi kopya (readValuesInPage) ile correction.fnv1a32 birebir aynı; ham değer dönmez", () => {
    const els = [
      { tagName: "INPUT", value: " 1.500.000 ", checked: false, getAttribute: (n: string) => (n === "type" ? "text" : null) },
      { tagName: "SELECT", options: [{ textContent: "Seçiniz" }, { textContent: " Kombi  (Doğalgaz) " }], selectedIndex: 1, getAttribute: () => null },
      { tagName: "INPUT", value: "on", checked: true, getAttribute: (n: string) => (n === "type" ? "checkbox" : null) },
    ];
    const doc = { querySelector: (sel: string) => els[Number(/"(\d+)"/.exec(sel)![1])] ?? null } as unknown as Document;
    const isolated = new Function(`return (${readValuesInPage.toString()})`)() as typeof readValuesInPage;
    const out = isolated([0, 1, 2, 9], doc);
    expect(out).toEqual([
      { idx: 0, kind: "text", valueHash: fnv1a32("1.500.000"), digitsHash: fnv1a32("1500000") },
      { idx: 1, kind: "select", option: "Kombi (Doğalgaz)" },
      { idx: 2, kind: "bool", checked: true },
      { idx: 9, kind: "missing" },
    ]);
    expect(JSON.stringify(out)).not.toContain("1.500.000");
    expect(fnv1a32("")).toBe("811c9dc5");
  });
});

describe("correction: yeniden doldurma (K3)", () => {
  it("untouchedOwnIdxs: yalnız eklentinin yazdığı ve el değmemiş metin/seçim alanları; radyo ve düzeltilen alan hariç", async () => {
    const snap = await snapshot();
    const now = await setup();
    const read: ReadValue[] = [{ idx: 0, kind: "select", option: "Merkezi" }, text(1, "1500000"), text(2, "750"), { idx: 3, kind: "bool", checked: true }, { idx: 4, kind: "bool", checked: false }];
    expect(untouchedOwnIdxs(snap, read, now)).toEqual([0, 1]); // aidat (2) düzeltildi, radyo (3) hariç
    const released = releaseOwned(FORM.map((x) => ({ ...x, current: x.idx === 0 ? "Merkezi" : "dolu" })), [0, 1]);
    expect(released.map((x) => x.current)).toEqual(["", "", "dolu", "dolu", "dolu"]);
  });

  it("mergeSnapshots: önceki öğeler korunur; yeni turun dokunduğu denetim/alan yeni öğeyle değişir; başka oturum → yalnız yeni", async () => {
    const prev = await snapshot();
    const { shapes } = await setup();
    const next = buildSnapshot({ sessionId: SESSION, portal: "sahibinden", ruleVersion: 0, at: 2 }, [ACTIONS[0]!], [{ idx: 0, ok: true }], [{ idx: 0, kind: "select", option: "Kombi (Doğalgaz)" }], shapes, FORM);
    const merged = mergeSnapshots(prev, next, shapes);
    expect(merged.at).toBe(2);
    expect(merged.items.map((i) => i.key).sort()).toEqual(["dues", "heating", "in_site", "price"]);
    expect(merged.items.find((i) => i.key === "heating")?.option).toBe("kombi dogalgaz");
    expect(mergeSnapshots({ ...prev, sessionId: "22222222-2222-4333-8444-555555555555" }, next, shapes)).toBe(next);
  });
});
