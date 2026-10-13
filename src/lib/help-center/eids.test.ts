import { describe, expect, it } from "vitest";
import { matchesQuery } from "@/lib/help-content";
import { LEGAL_CONSTANTS } from "@/lib/legal-constants";
import { eidsLegalNote, eidsLegalNoteText, eidsPenaltyRangeText } from "@/lib/eids/legal-text";
import {
  EIDS_ADDRESS_TOKEN,
  FORWARDING_PROVIDERS,
  fillForwardingText,
  guessForwardingProvider,
} from "@/lib/eids/forwarding";
import { EIDS_FAQ, EIDS_GUIDE, EIDS_HELP_SLUG, EIDS_UNVERIFIED_TAG } from "./eids";
import { helpGuideHref, mergeHelpContent } from "./core";

const content = mergeHelpContent([]);
const guideHits = (q: string) => content.guides.filter((g) => matchesQuery([g.title, g.intro, ...g.steps], q)).map((g) => g.slug);
const faqHits = (q: string) => content.faq.filter((f) => matchesQuery([f.q, f.a], q)).map((f) => f.id);

describe("EİDS yardım içeriği", () => {
  it("yardım merkezinde 'EİDS', 'yetki e-postası' ve 'MERSİS' aramaları rehberi bulur", () => {
    for (const q of ["EİDS", "yetki e-postası", "MERSİS", "eids", "EIDS", "mersis", "Yetki E-postası"]) {
      expect(guideHits(q), q).toContain(EIDS_HELP_SLUG);
    }
    expect(faqHits("EİDS")).toEqual(expect.arrayContaining(EIDS_FAQ.map((f) => f.id)));
  });

  it("istenen üç SSS var ve doğru kategoride", () => {
    expect(EIDS_FAQ.map((f) => f.q)).toEqual([
      expect.stringContaining("ilan kendiliğinden yayından düşer mi"),
      expect.stringContaining("e-postası gelmezse"),
      expect.stringContaining("Taşınmaz no nerede"),
    ]);
    for (const f of EIDS_FAQ) expect(content.faq.some((x) => x.id === f.id), f.id).toBe(true);
  });

  it("doğrulanmamış bilgiler etiketli: e-postanın adresi, MERSİS menü yolu, Yandex menü adları", () => {
    const text = EIDS_GUIDE.steps.join("\n");
    const mailStep = EIDS_GUIDE.steps.find((s) => s.includes("MERSİS'te"));
    expect(mailStep).toContain(EIDS_UNVERIFIED_TAG);
    const mersisStep = EIDS_GUIDE.steps.find((s) => s.includes("MERSİS'ten güncelleyin"));
    expect(mersisStep).toContain(EIDS_UNVERIFIED_TAG);
    expect(text).toContain("444 8 482");
    const yandex = FORWARDING_PROVIDERS.find((p) => p.id === "yandex")!;
    expect(yandex.steps.filter((s) => s.unverified).length).toBeGreaterThanOrEqual(3);
    expect(yandex.warning?.unverified).toBe(true);
    expect(EIDS_FAQ.find((f) => f.id === "eids-eposta-gelmezse")!.a).toContain(EIDS_UNVERIFIED_TAG);
  });

  it("derin bağlantı Rehberler sekmesindeki çapaya gider", () => {
    expect(helpGuideHref(EIDS_HELP_SLUG)).toBe("/app/yardim?sekme=rehberler#eids-bakanlik-epostalari");
  });
});

describe("EİDS ceza metni tek kaynak", () => {
  it("tutar legal-constants'tan gelir ve yürürlükteki değerle değişir", () => {
    expect(eidsPenaltyRangeText()).toBe("28.620 – 858.620 TL");
    expect(LEGAL_CONSTANTS.eidsPenaltyMinTry.value).toBe(28_620);
    expect(eidsPenaltyRangeText({ eidsPenaltyMinTry: 30_000, eidsPenaltyMaxTry: 900_000 })).toBe("30.000 – 900.000 TL");
    expect(eidsLegalNote({ eidsPenaltyMaxTry: 900_000 }).headline).toContain("900.000 TL");
  });

  it("rehber, SSS ve görev metni aynı aralığı yazar; madde dayanakları var", () => {
    const range = eidsPenaltyRangeText();
    expect(EIDS_GUIDE.steps.join(" ")).toContain(range);
    expect(EIDS_FAQ[0].a).toContain(range);
    const text = eidsLegalNoteText();
    expect(text).toContain(range);
    expect(text).toContain("14/2-h");
    expect(text).toContain("14/2-j");
    expect(text).toContain("3 gün");
  });
});

describe("iletme kılavuzu (sağlayıcı sekmeleri)", () => {
  it("altı sağlayıcı, her birinde alma adresi geçen en az bir adım", () => {
    expect(FORWARDING_PROVIDERS.map((p) => p.id)).toEqual(["gmail", "workspace", "outlook", "m365", "yandex", "cpanel"]);
    for (const p of FORWARDING_PROVIDERS) {
      expect(p.steps.some((s) => s.text.includes(EIDS_ADDRESS_TOKEN)), p.id).toBe(true);
    }
    // Kurumsal kısıtlar uyarı olarak durur.
    expect(FORWARDING_PROVIDERS.find((p) => p.id === "workspace")?.warning).toBeTruthy();
    expect(FORWARDING_PROVIDERS.find((p) => p.id === "m365")?.warning).toBeTruthy();
  });

  it("adres yer tutucusu ofisin gerçek adresiyle dolar; adres değişince metin de değişir", () => {
    const step = FORWARDING_PROVIDERS[0].steps[1].text;
    const a1 = "yetki-aaaaaaaaaaaaaaaa@eids.emlaksoft.com.tr";
    const a2 = "yetki-bbbbbbbbbbbbbbbb@eids.emlaksoft.com.tr";
    expect(fillForwardingText(step, a1)).toContain(a1);
    expect(fillForwardingText(step, a2)).toContain(a2);
    expect(fillForwardingText(step, a2)).not.toContain(a1);
    expect(fillForwardingText(step, null)).toContain("EmlakSoft alma adresiniz");
    expect(fillForwardingText(FORWARDING_PROVIDERS[0].steps[4].text, a1)).toContain("eids.yetki@ticaret.gov.tr");
  });

  it("sağlayıcı önerisi alan adından", () => {
    expect(guessForwardingProvider("ofis@gmail.com")).toBe("gmail");
    expect(guessForwardingProvider("ofis@hotmail.com")).toBe("outlook");
    expect(guessForwardingProvider("ofis@yandex.com.tr")).toBe("yandex");
    expect(guessForwardingProvider(null)).toBe("gmail");
  });
});
