import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * SÖZLEŞME (k) — SK10 / B057: yetkiye göre düğme çizimi SUNUCUDA hesaplanan `canEdit` ile yapılır.
 * İzinsiz rolde (danışman: commissions yalnız view) anlaşma tahtasında aşama geçiş düğmesi SAYISI 0'dır
 * (bugün 22 "Geçiş" + sonraki aşama / Kazan / Kayıp); izinli rolde düğmeler çizilir. Onaylar ekranında karar
 * düğmesi yalnız `canDecideApproval` ile çizilir (bkz. permissions-matrix-contract.test.ts).
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, refresh: () => undefined }) }));
vi.mock("@/components/app/toast-provider", () => ({ useToast: () => ({ push: () => undefined }) }));
vi.mock("@/app/actions/deals", () => ({ updateDealStage: async () => ({ ok: true }), updateDeal: async () => ({ ok: true }) }));
vi.mock("@/components/ui/smart-link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) => createElement("a", { href, ...rest }, children as never),
}));

import { DealBoard } from "./deal-board";
import { StatusTransitionBar } from "./status-transition";

type Deal = Parameters<typeof DealBoard>[0]["deals"][number];

const STAGES = ["new", "qualified", "negotiation", "won", "lost"] as const;
const deals: Deal[] = STAGES.map(
  (stage, i) =>
    ({
      id: `00000000-0000-0000-0000-00000000000${i}`,
      stage,
      deal_type: "sale",
      deal_value: 1000 * (i + 1),
      probability: 50,
      property_id: null,
      property_title: null,
      property_code: null,
      customer_id: null,
      customer_name: `Müşteri ${i}`,
      assigned_to: null,
      updated_at: "2026-10-01T10:00:00.000Z",
      note_count: 0,
      checklist_done: 0,
    }) as unknown as Deal,
);

/** Aşama değiştiren düğmeler: "Geçiş" menüsü, sonraki aşama (→), "Kazan", "Kayıp". */
function stageButtonCount(html: string): number {
  const buttons = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
  return buttons.filter((b) => /Geçiş|Kazan|Kayıp|<svg[^>]*lucide-arrow-right/.test(b)).length;
}

describe("sözleşme (k): anlaşma tahtası aşama düğmeleri yetkiye göre", () => {
  it("izinsiz rol (canEdit=false): aşama geçiş düğmesi 0, nedeni bir kez yazılır", () => {
    const html = renderToStaticMarkup(createElement(DealBoard, { deals, canEdit: false }));
    expect(stageButtonCount(html)).toBe(0);
    expect(html).toContain("Aşama değiştirme yöneticide");
  });

  it("izinli rol (canEdit=true): açık aşamalarda geçiş düğmeleri çizilir", () => {
    const html = renderToStaticMarkup(createElement(DealBoard, { deals, canEdit: true }));
    expect(stageButtonCount(html)).toBeGreaterThanOrEqual(STAGES.length);
    expect(html).not.toContain("Aşama değiştirme yöneticide");
  });

  it("StatusTransitionBar canEdit zorunlu: izin yoksa hiçbir şey çizmez", () => {
    expect(renderToStaticMarkup(createElement(StatusTransitionBar, { dealId: "d1", stage: "new", canEdit: false }))).toBe("");
    expect(renderToStaticMarkup(createElement(StatusTransitionBar, { dealId: "d1", stage: "new", canEdit: true }))).toContain("Geçiş");
  });

  it("portföysüz anlaşma 'Anlaşma' diye adlanmaz; taşıma etiketi ayırt edici ad taşır (B194)", () => {
    const src = readFileSync(join(process.cwd(), "src/app/app/anlasmalar/deal-board.tsx"), "utf8");
    expect(src).toMatch(/\?\? "Portföysüz anlaşma"/);
    expect(src).toMatch(/aria-label=\{`Anlaşmayı taşı: \$\{dealSpokenName\(d\)\}`\}/);
    expect(src).not.toMatch(/anlaşmasını taşı/);
  });
});
