import { describe, expect, it } from "vitest";
import { buildFeedback } from "./feedback-build";
import type { FieldOutcome } from "./correction";
import { planFill, type ControlDescriptor } from "./fill-plan";
import { formFingerprint, formShapes, signShapes } from "./form-signature";
import { buildPortalPayload, type PortalPropertyInput } from "./payload";

function d(p: Partial<ControlDescriptor> & { idx: number; labels: string[] }): ControlDescriptor {
  return { tag: "input", type: "text", options: [], current: "", checked: false, group: "", optionText: "", disabled: false, visible: true, sources: p.labels.slice(0, 1).map(() => "label_for"), ...p };
}

const property: PortalPropertyInput = {
  id: "p",
  propertyCode: "ES-1",
  title: "Moda 3+1",
  transactionType: "Satılık",
  propertyType: "Daire",
  listPrice: 6_000_000,
  provinceName: null,
  districtName: "Kadıköy",
  neighborhoodName: null,
  addressLine: null,
  features: { rooms: "3+1", sqm: 120, heating: "Merkezi", description: "Güneş alan, deniz manzaralı daire" },
  parcelBlock: null,
  parcelLot: null,
  swapOk: null,
  eidsPropertyNo: null,
  authorityDocNo: null,
  authorityEidsStatus: null,
  authorizationStart: null,
  authorizationEnd: null,
  deedStatus: null,
  photos: [],
};
const payload = buildPortalPayload(property, "sahibinden", Date.parse("2026-10-14T00:00:00Z"));
const SESSION = "11111111-2222-4333-8444-555555555555";

const FORM = [
  d({ idx: 0, labels: ["İlan Başlığı"], current: "Elle yazılmış başlık" }),
  d({ idx: 1, labels: ["Fiyat"], type: "number" }),
  d({ idx: 2, tag: "textarea", type: "", labels: ["Açıklama"] }),
  d({ idx: 3, tag: "select", type: "", labels: ["Isıtma"], options: ["Seçiniz", "Merkezi", "Kombi (Doğalgaz)"], current: "Seçiniz" }),
  d({ idx: 4, tag: "select", type: "", labels: ["Kimden"], options: ["Seçiniz", "Emlak Ofisinden", "Sahibinden"], current: "Seçiniz", required: true }),
  d({ idx: 5, labels: ["Yetkili Ad Soyad"], current: "Ahmet Yılmaz" }),
  d({ idx: 6, tag: "select", type: "", labels: ["Danışman"], options: ["Ahmet Yılmaz 0532 111 22 33", "Ayşe Kaya"] }),
  d({ idx: 7, labels: ["Not"], current: "ofis notu 05321112233" }),
];

async function build(phase: "filled" | "checked", outcomes?: FieldOutcome[]) {
  const plan = planFill(FORM, payload);
  const signed = await signShapes(formShapes(FORM).shapes);
  const fp = await formFingerprint(signed);
  return { plan, signed, res: buildFeedback({ sessionId: SESSION, portal: "sahibinden", phase, plan, descs: FORM, signed, formFp: fp, outcomes, values: { ...payload.fields, heating: "Merkezi" } }) };
}

describe("feedback-build", () => {
  it("çıktıda value/current/checked/text anahtarı ve kullanıcı değeri YOK; kişisel etiketli denetim yok", async () => {
    const { res } = await build("filled");
    expect(res.payload).not.toBeNull();
    const json = JSON.stringify(res.payload);
    expect(json).not.toMatch(/"(value|current|checked|text|title|description)"\s*:/);
    expect(json).not.toMatch(/Elle yazılmış|Ahmet|Yılmaz|0532|05321112233|ofis notu|Güneş alan|6000000|Moda/i);
    expect(json).not.toMatch(/yetkili|danisman|ad soyad/);
    const p = res.payload!;
    expect(p).toMatchObject({ v: 1, sessionId: SESSION, portal: "sahibinden", engine: "f1", phase: "filled", ruleVersion: 0, rulesRegressed: false });
    expect(p.counts.droppedPii).toBeGreaterThanOrEqual(2);
    expect(p.counts.controls).toBe(FORM.length);
  });

  it("sonuçlar: doldurulan 'filled', dolu 'already_filled', eşleşmeyen denetim yalnız şemasıyla 'unmatched' (key null)", async () => {
    const { res } = await build("filled");
    const by = new Map(res.payload!.fields.map((f) => [f.label, f]));
    expect(by.get("ilan basligi")).toMatchObject({ key: "title", outcome: "already_filled", labelSource: "label_for" });
    expect(by.get("fiyat")).toMatchObject({ key: "price", outcome: "filled", control: "number" });
    expect(by.get("isitma")).toMatchObject({ key: "heating", outcome: "filled", control: "choice", options: ["merkezi", "kombi dogalgaz"] });
    expect(by.get("kimden")).toMatchObject({ key: null, outcome: "unmatched", required: true, options: ["emlak ofisinden", "sahibinden"] });
    expect(by.has("not")).toBe(true); // etiket kişisel değil; DEĞERİ (ofis notu) hiç okunmaz/gönderilmez
  });

  it("kontrol fazı: düzeltme türü ve portal seçeneği gider, değer gitmez; seçim düzeltmesinde EmlakSoft değer anahtarı eklenir", async () => {
    const { signed } = await build("filled");
    const sig = (label: string) => signed.find((s) => s.label === label)!.sig;
    const outcomes: FieldOutcome[] = [
      { sig: sig("isitma"), key: "heating", outcome: "corrected", correction: { kind: "other_option", option: "kombi dogalgaz" } },
      { sig: sig("fiyat"), key: "price", outcome: "corrected", correction: { kind: "value_edited", category: "format" } },
      { sig: sig("aciklama"), key: "description", outcome: "cleared" },
    ];
    const { res } = await build("checked", outcomes);
    const by = new Map(res.payload!.fields.map((f) => [f.key, f]));
    expect(by.get("heating")).toMatchObject({ outcome: "corrected", correction: { kind: "other_option", option: "kombi dogalgaz", valueKey: "merkezi" } });
    expect(by.get("price")).toMatchObject({ outcome: "corrected", correction: { kind: "value_edited", category: "format" } });
    expect(by.get("description")).toMatchObject({ outcome: "cleared", correction: { kind: "cleared" } });
    expect(res.payload!.phase).toBe("checked");
  });

  it("portal sözlüğünde olmayan düzeltme seçeneği süzgeçte düşer (uydurma metin gönderilemez)", async () => {
    const { signed } = await build("filled");
    const s = signed.find((x) => x.label === "isitma")!;
    const { res } = await build("checked", [{ sig: s.sig, key: "heating", outcome: "corrected", correction: { kind: "other_option", option: "ahmet bey" } }]);
    expect(res.payload!.fields.find((f) => f.key === "heating")).toBeUndefined();
    expect(res.dropped).toBeGreaterThan(0);
  });
});
