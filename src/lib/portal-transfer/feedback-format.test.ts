import { describe, expect, it } from "vitest";
import { feedbackKey, isPersonalLabel, looksPersonal, sanitizeFeedbackPayload, type FeedbackPayload } from "./feedback-format";

const hex = (c: string) => c.repeat(64);
const field = (sig: string, over: Record<string, unknown> = {}) => ({
  sig, key: "heating", control: "choice", label: "Isıtma", labelSource: "label_for", options: ["Kombi (Doğalgaz)", "Merkezi"], required: true, outcome: "filled", ...over,
});
const payload = (fields: unknown[], over: Record<string, unknown> = {}) => ({
  v: 1, sessionId: "6f0e4b0e-9d6b-4d34-8f0a-9d2c1f6a7a11", portal: "sahibinden", engine: "f1", ruleVersion: 3, ruleSha: "3f9a0c1d22e47b10", phase: "checked",
  formFp: hex("f"), rulesRegressed: false, consentTextVersion: 1, counts: { controls: 10, droppedPii: 0 }, fields, ...over,
});

describe("geri bildirim süzgeci", () => {
  it("geçerli yük katlanır; feedbackKey oturum:faz", () => {
    const r = sanitizeFeedbackPayload(payload([field(hex("a"))]));
    expect(r.dropped).toBe(0);
    expect(r.payload!.fields[0]).toMatchObject({ label: "isitma", options: ["kombi dogalgaz", "merkezi"] });
    expect(feedbackKey(r.payload as FeedbackPayload)).toBe("6f0e4b0e-9d6b-4d34-8f0a-9d2c1f6a7a11:checked");
  });

  it("telefon, @, ≥4 rakam, boşluklu telefon ve yazıyla rakam içeren etiket/seçenek atılır", () => {
    for (const bad of ["Cep 0532 123 45 67", "ali@ornek.com", "No 12345", "532 123 45 67", "www.ornek.com", "bes uc iki sifir", "TR12 0006"]) {
      expect(looksPersonal(bad), bad).toBe(true);
    }
    for (const ok of ["3+1", "21-25", "Kombi (Doğalgaz)", "5 ve üzeri"]) expect(looksPersonal(ok), ok).toBe(false);
    const r = sanitizeFeedbackPayload(payload([field(hex("a"), { label: "Telefon" }), field(hex("b"), { label: "Ad 12345" }), field(hex("c"))]));
    expect(r.payload!.fields.map((f) => f.sig)).toEqual([hex("c")]);
    expect(r.dropped).toBe(2);
    expect(r.payload!.counts.droppedPii).toBe(2);
  });

  it("kişisel etiket sözcükleri denetimi tümden atar (danışman, mağaza, ad soyad ...); 'cephe' cep değildir", () => {
    for (const l of ["Danışman", "Mağaza adı", "Ad Soyad", "İletişim", "Yetkili kişi", "E-posta"]) expect(isPersonalLabel(l), l).toBe(true);
    expect(isPersonalLabel("Cephe")).toBe(false);
  });

  it("%30 kuralı: seçeneklerin %30'undan fazlası atılırsa liste boşalır; altındaysa yalnız kötü seçenek atılır", () => {
    const many = sanitizeFeedbackPayload(payload([field(hex("a"), { options: ["0532 111 22 33", "0533 444 55 66", "Diğer"] })]));
    expect(many.payload!.fields[0]!.options).toEqual([]);
    const few = sanitizeFeedbackPayload(payload([field(hex("a"), { options: ["a1", "b2", "c3", "d4", "0532 111 22 33"] })]));
    expect(few.payload!.fields[0]!.options).toEqual(["a1", "b2", "c3", "d4"]);
  });

  it("komşu metin kaynağı ve değer anahtarları kabul edilmez; düzeltilen seçenek yalnız portal sözlüğünden", () => {
    expect(sanitizeFeedbackPayload(payload([field(hex("a"), { labelSource: "sibling" })])).payload!.fields).toEqual([]);
    expect(sanitizeFeedbackPayload(payload([field(hex("a"), { value: "x" })])).payload!.fields).toEqual([]);
    expect(sanitizeFeedbackPayload(payload([field(hex("a"), { outcome: "corrected", correction: { kind: "other_option", option: "Yerden ısıtma" } })])).payload!.fields).toEqual([]);
    const ok = sanitizeFeedbackPayload(payload([field(hex("a"), { outcome: "corrected", correction: { kind: "other_option", option: "Merkezi", valueKey: "merkezi" } })]));
    expect(ok.payload!.fields[0]!.correction).toEqual({ kind: "other_option", option: "merkezi", valueKey: "merkezi" });
  });

  it("yapısal hata: bilinmeyen kök anahtarı, rızasız yük, yanlış oturum → payload null", () => {
    expect(sanitizeFeedbackPayload({ ...payload([]), current: "x" })).toMatchObject({ payload: null, reason: "unknown_key:current" });
    expect(sanitizeFeedbackPayload(payload([], { consentTextVersion: 0 }))).toMatchObject({ payload: null, reason: "consent" });
    expect(sanitizeFeedbackPayload(payload([], { sessionId: "x" }))).toMatchObject({ payload: null });
  });

  it("alan sayısı 120 ile sınırlı; yinelenen imza atılır", () => {
    const fields = Array.from({ length: 125 }, (_, i) => field(i.toString(16).padStart(64, "0")));
    const r = sanitizeFeedbackPayload(payload([...fields, field(hex("0"))]));
    expect(r.payload!.fields.length).toBe(120);
    expect(r.dropped).toBe(6);
  });
});
