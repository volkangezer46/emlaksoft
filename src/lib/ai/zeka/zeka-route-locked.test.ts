import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MATRIX } from "@/lib/permissions";
import { lockedHrefs } from "@/lib/billing/page-gates";
import { makeScope, withoutBlockedLinks, type ZekaAppScope } from "./scope";
import type { ZekaResult } from "./types";

/**
 * F7: /api/zeka kapsamı paket kilidini menüyle AYNI kuraldan (`lockedHrefs`, plan + kademe + deneme) alır ve kilitli
 * yol Zeka bağlantısı/eylemi olarak hiç görünmez (`withoutBlockedLinks` son süzgeci).
 */

vi.mock("server-only", () => ({}));

const ADVISOR_PLAN = { plan: "advisor", tier: "advisor" as const, trial: false, tenantCreatedAt: "2026-10-10T00:00:00.000Z" };

const h = vi.hoisted(() => ({ scope: null as ZekaAppScope | null, gateCtx: null as unknown, result: null as ZekaResult | null }));
vi.mock("@/lib/require-permission", () => ({
  requirePermission: async () => ({ ok: true, userId: "u1", tenantId: "t1", role: "owner", impersonating: false }),
}));
vi.mock("@/lib/permissions-effective", () => ({
  getEffectivePermissions: async () => DEFAULT_MATRIX.owner,
  immutableReadonlyPermissions: () => DEFAULT_MATRIX.readonly,
}));
vi.mock("@/lib/modules/state", () => ({ getClosedFeatures: async () => [] }));
vi.mock("@/lib/cache/request", () => ({ getTenantGateContext: async () => h.gateCtx }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/ai/zeka/app", () => ({
  ZekaLimitError: class extends Error {},
  answerApp: async (_q: string, scope: ZekaAppScope) => {
    h.scope = scope;
    return h.result;
  },
}));
vi.mock("@/lib/ai/zeka/stream-server", () => ({
  zekaRespond: async (o: { run: (s: AbortSignal | undefined, sink: undefined) => Promise<unknown> }) => Response.json(await o.run(undefined, undefined)),
}));

function req(body: unknown) {
  return new Request("http://x/api/zeka", { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/zeka: paket kilidi", () => {
  beforeEach(() => {
    h.scope = null;
    h.result = { surface: "app", engine: "local", intent: "navigate", answer: "", cards: [], actions: [], followUps: [], confidence: 1, answered: true };
  });

  it("alt pakette kapsamın locked listesi lockedHrefs ile aynı (boş değil)", async () => {
    h.gateCtx = ADVISOR_PLAN;
    const { POST } = await import("@/app/api/zeka/route");
    const res = await POST(req({ q: "teklifler", mode: "answer" }));
    expect(res.status).toBe(200);
    expect(h.scope!.locked).toEqual(lockedHrefs(ADVISOR_PLAN));
    expect(h.scope!.locked).toContain("/app/teklifler");
  });

  it("deneme sürümünde kilit yok", async () => {
    h.gateCtx = { ...ADVISOR_PLAN, trial: true };
    const { POST } = await import("@/app/api/zeka/route");
    await POST(req({ q: "teklifler", mode: "answer" }));
    expect(h.scope!.locked).toEqual([]);
  });
});

describe("withoutBlockedLinks", () => {
  const scope = makeScope({ userId: "u1", tenantId: "t1", role: "owner", perms: DEFAULT_MATRIX.owner, closed: [], locked: lockedHrefs(ADVISOR_PLAN) });
  it("kilitli yol eylem ve kayıt/sayfa kartından düşer; sayı kartında yalnız bağlantı düşer; açık yollar kalır", () => {
    const out = withoutBlockedLinks(scope, {
      actions: [
        { kind: "navigate", label: "Teklifler", href: "/app/teklifler?durum=submitted" },
        { kind: "navigate", label: "Lig", href: "/app/lig" },
        { kind: "navigate", label: "Müşteriler", href: "/app/musteriler" },
        { kind: "navigate", label: "Komisyon", href: "/app/finans/komisyon" },
      ],
      cards: [
        { kind: "nav", label: "Sözleşmeler", href: "/app/sozlesmeler" },
        { kind: "metric", label: "Bekleyen teklif", value: "3", href: "/app/teklifler" },
        { kind: "record", entity: "customer", id: "c1", title: "Ali", href: "/app/musteriler/c1" },
      ],
    });
    expect(out.actions.map((a) => a.href)).toEqual(["/app/musteriler", "/app/finans/komisyon"]);
    expect(out.cards).toEqual([
      { kind: "metric", label: "Bekleyen teklif", value: "3" },
      { kind: "record", entity: "customer", id: "c1", title: "Ali", href: "/app/musteriler/c1" },
    ]);
  });
});
