import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PLANS, yearlyOfferLabel, type PlanDef } from "@/lib/billing/plans";
import { buildFaq, lostCommissionPlanName, trialPhrase, yearlyDiscountPercent } from "@/lib/pricing-page-model";
import { pricingCopy, resolvePricingFaq, resolvePricingText } from "./copy";
import { defaultPricingPage } from "./defaults";
import { validatePricingPage } from "./schema";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const plans = PLANS as unknown as PlanDef[];
const ctx14: { trialDays?: number; plans: PlanDef[] } = { trialDays: 14, plans };
const ctxNone: { trialDays?: number; plans: PlanDef[] } = { plans };

/** Eski sayfadaki gibi çocuk listesi → renderToString (metin düğümü ayırıcıları dahil). */
const html = (children: unknown[]) => renderToString(createElement("p", null, ...(children as never[])));
const parts = (p: string[]) => (p.length === 1 ? p[0] : p);

describe("/fiyatlar varsayılan metinleri = bugünkü sabitler ve buildFaq", () => {
  it("varsayılan şemadan hatasız geçer", () => {
    const r = validatePricingPage(defaultPricingPage());
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it.each([ctx14, ctxNone])("SSS değişkenli varsayılandan çözülünce buildFaq ile birebir aynı (deneme %#)", (ctx) => {
    expect(yearlyDiscountPercent(plans)).toBeGreaterThan(0);
    expect(resolvePricingFaq(defaultPricingPage().faq, ctx)).toEqual(buildFaq(ctx));
    // Yayın yokken sayfa SSS'yi doğrudan buildFaq'tan alır (indirim tanımsızken de birebir).
    expect(pricingCopy(defaultPricingPage(), ctx, { faqFromCode: true }).faq).toEqual(buildFaq(ctx));
  });

  it("üst bant, kartlar ve son çağrı metinleri eski JSX ile aynı HTML'i üretir", () => {
    for (const ctx of [ctx14, ctxNone]) {
      const copy = pricingCopy(defaultPricingPage(), ctx);
      const discount = yearlyDiscountPercent(plans);
      const trial = trialPhrase(ctx.trialDays);
      const lost = lostCommissionPlanName();
      const startLabel = ctx.trialDays ? `${ctx.trialDays} gün ücretsiz başla` : "Ücretsiz başla";
      expect(copy.hero.eyebrow).toBe("Fiyatlar");
      expect(copy.hero.title).toBe("Açık fiyat, paket paket net kapsam");
      expect(html([parts(copy.hero.lead)])).toBe(
        html(["Deneme boyunca tüm özellikler açık, kredi kartı gerekmez. Tutarlar KDV hariçtir", `; yıllık ödemede %${discount} indirim uygulanır (${yearlyOfferLabel(plans[0]!)}).`]),
      );
      expect(html([parts(copy.ctaPrimaryLabel), " ", createElement("svg")])).toBe(html([startLabel, " ", createElement("svg")]));
      expect(html([parts(copy.notes[0]!.text)])).toBe(html([trial, "; tüm paketlerin özellikleri açıktır ve kredi kartı gerekmez."]));
      expect(html([parts(copy.notes[1]!.text)])).toBe(html(["Sözleşmeler SMS onayıyla imzalanır. Bu, nitelikli elektronik imza (e-imza) değildir."]));
      expect(html([parts(copy.notes[2]!.text)])).toBe(html(["Yalnızca ", lost, " ve üzeri paketlerde açıktır."]));
      expect(html([parts(copy.sections.final.text)])).toBe(html([trial, ", kredi kartı gerekmez."]));
      expect(copy.notes.map((n) => n.title)).toEqual(["Deneme boyunca her şey açık", "SMS onaylı dijital imza", "Kayıp-kaçak komisyon motoru"]);
      expect(copy.compareLabel).toBe("Paketleri karşılaştır");
      expect(copy.sections.compare.title).toBe("Paketleri yan yana karşılaştırın");
      expect(copy.sections.faq.title).toBe("Fiyatlarla ilgili sık sorulanlar");
      expect(copy.sections.final.primaryLabel).toBe("Ücretsiz başla");
    }
  });

  it("indirim yokken {indirim_cumle} yalnız nokta; {indirim}'li SSS maddesi gizlenir", () => {
    const flat = plans.map((p) => ({ ...p, yearlyPaidMonths: 12 })) as PlanDef[];
    const ctx = { plans: flat, trialDays: 14 };
    expect(resolvePricingText("hariçtir{indirim_cumle}", ctx).parts).toEqual(["hariçtir", "."]);
    const faq = resolvePricingFaq(defaultPricingPage().faq, ctx);
    expect(faq.some((f) => f.q === "Yıllık ödemede indirim var mı?")).toBe(false);
  });

  it("yayınlanan SSS'ye eklenen soru sayfada ve aynı listeden JSON-LD'de görünür", () => {
    const c = defaultPricingPage();
    c.faq.push({ q: "Fatura kesiliyor mu?", a: "Evet, {deneme_ifade} sonrası her ödeme için fatura kesilir." });
    const copy = pricingCopy(c, ctx14);
    expect(copy.faq.at(-1)).toEqual({ q: "Fatura kesiliyor mu?", a: "Evet, 14 gün ücretsiz deneme sonrası her ödeme için fatura kesilir." });
    expect(read("src/lib/pricing-page/view.tsx")).toContain('<SeoJsonLd path="/fiyatlar" faq={faq} />');
  });

  it("ana sayfa değişkenleri de çözülür; bilinmeyen değişken doğrulamada hatadır", () => {
    expect(resolvePricingText("{deneme}", ctx14).text).toBe("14 gün ücretsiz");
    expect(resolvePricingText("Kayıt olunca {deneme_gun}ücretsiz", ctx14).text).toBe("Kayıt olunca 14 gün ücretsiz");
    const c = defaultPricingPage();
    c.hero.title = "Fiyatlar {bilinmeyen}";
    expect(validatePricingPage(c).issues.some((i) => i.level === "error" && /bilinmeyen/.test(i.message))).toBe(true);
  });

  it("yayın yokken sayfa varsayılan metin ve kod içi SSS ile çizilir", () => {
    const src = read("src/app/fiyatlar/page.tsx");
    expect(src).toContain("pricingCopy(live ?? defaultPricingPage(), copyContextOf(data), { faqFromCode: !live })");
  });
});

