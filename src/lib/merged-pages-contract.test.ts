import { describe, expect, it } from "vitest";
import { PLAN_GATES } from "@/lib/billing/page-gates";

/**
 * Birleşen sayfalar: eski yol (yönlendirme kaynağı) ile yeni hedef AYNI paket kilidini taşımalıdır;
 * aksi halde eski yer imi, kilitli paketin kilidini atlatır ya da tersine yanlış kilitlenir.
 */
const MERGED: { from: string; to: string }[] = [{ from: "/app/ekip/kiyas", to: "/app/danisman-kpi" }];

describe("birleşen sayfaların paket kilidi", () => {
  for (const { from, to } of MERGED) {
    it(`${from} -> ${to} aynı minPlan`, () => {
      const a = PLAN_GATES.find((g) => g.href === from);
      const b = PLAN_GATES.find((g) => g.href === to);
      expect(a, `${from} page-gates kaydı yok`).toBeDefined();
      expect(b, `${to} page-gates kaydı yok`).toBeDefined();
      expect(a?.minPlan).toBe(b?.minPlan);
    });
  }
});
