import { describe, expect, it } from "vitest";
import { buildFieldChoices, customerNoteLines, overridesFromSelection, sanitizeOverrides } from "@/lib/merge-plan";
import { CUSTOMER_MERGE_REF_LABELS, summarizeMergeRefs } from "@/lib/merge-labels";

const SPECS = [
  { field: "full_name", label: "Ad soyad" },
  { field: "phone", label: "Telefon" },
  { field: "assigned_to", label: "Danışman" },
];

describe("buildFieldChoices", () => {
  it("yalnız farklı (en az iki dolu değer) alanları, ana kayıt önce ve varsayılan olarak döndürür", () => {
    const out = buildFieldChoices(
      "a",
      [
        { id: "b", values: { full_name: "Ali Veli", phone: "05321", assigned_to: "u2" }, display: { assigned_to: "Ayşe" } },
        { id: "a", values: { full_name: "ali veli ", phone: null, assigned_to: "u1" }, display: { assigned_to: "Mehmet" } },
      ],
      SPECS,
    );
    expect(out.map((c) => c.field)).toEqual(["assigned_to"]);
    expect(out[0]!.defaultSourceId).toBe("a");
    expect(out[0]!.options.map((o) => o.display)).toEqual(["Mehmet", "Ayşe"]);
  });

  it("ana kayıt boşsa ilk dolu değer varsayılan olur", () => {
    const out = buildFieldChoices(
      "a",
      [
        { id: "a", values: { full_name: "", phone: null, assigned_to: null } },
        { id: "b", values: { full_name: "B", phone: "1", assigned_to: null } },
        { id: "c", values: { full_name: "C", phone: "1", assigned_to: null } },
      ],
      SPECS,
    );
    expect(out.map((c) => [c.field, c.defaultSourceId])).toEqual([["full_name", "b"]]);
  });
});

describe("sanitizeOverrides", () => {
  const allowed = ["phone", "email"];
  it("ana kaydı gösteren seçimi düşürür, kopyadan olanı tutar", () => {
    expect(sanitizeOverrides({ phone: "b", email: "a" }, allowed, "a", ["b"])).toEqual({ ok: true, overrides: { phone: "b" } });
  });
  it("bilinmeyen alan ve yabancı kimlik reddedilir", () => {
    expect(sanitizeOverrides({ notes: "b" }, allowed, "a", ["b"]).ok).toBe(false);
    expect(sanitizeOverrides({ phone: "x" }, allowed, "a", ["b"]).ok).toBe(false);
    expect(sanitizeOverrides(["phone"], allowed, "a", ["b"]).ok).toBe(false);
    expect(sanitizeOverrides(undefined, allowed, "a", ["b"])).toEqual({ ok: true, overrides: {} });
  });
  it("overridesFromSelection yalnız ana kayıttan farklı kaynakları bırakır", () => {
    expect(overridesFromSelection("a", { phone: "a", email: "b" })).toEqual({ email: "b" });
  });
});

describe("customerNoteLines", () => {
  it("son değerden farklı telefon/e-postaları ve ana notta olmayan kopya notlarını ekler", () => {
    const lines = customerNoteLines({
      primary: { phone: "0532", email: "a@x.com", notes: "Ana not. Bütçe 5M" },
      dups: [
        { full_name: "Ali", phone: "0533", email: "A@x.com", notes: "Bütçe 5M" },
        { full_name: "", phone: "0533", email: "b@x.com", notes: "Yeni bilgi" },
      ],
      finalPhone: "0533",
      finalEmail: "a@x.com",
      stamp: "15.10.2026",
    });
    expect(lines).toEqual([
      "[birleştirme] ek telefon: 0532",
      "[birleştirme] ek e-posta: b@x.com",
      "[birleştirme 15.10.2026 — kopya kayıt] Yeni bilgi",
    ]);
  });
});

describe("summarizeMergeRefs", () => {
  it("aynı etiketleri toplar, bilinmeyen anahtarı 'diğer kayıt' sayar, geçersizleri atlar", () => {
    const s = summarizeMergeRefs(CUSTOMER_MERGE_REF_LABELS, {
      "referrals.created_customer_id": 1,
      "referrals.referrer_customer_id": 2,
      "calls.customer_id": 5,
      "yeni_tablo.customer_id": 1,
      "bozuk.x": "abc",
    });
    expect(s.total).toBe(9);
    expect(s.counts).toEqual([
      { label: "çağrı", count: 5 },
      { label: "tavsiye", count: 3 },
      { label: "diğer kayıt", count: 1 },
    ]);
    expect(summarizeMergeRefs(CUSTOMER_MERGE_REF_LABELS, null)).toEqual({ counts: [], total: 0 });
  });
});
