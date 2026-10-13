import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** optimizer.ts yetki sözleşmesi: operasyon toplu yayın ve Otopilot çağıramaz; hiçbir yan etki oluşmaz. */

const role = { current: "ops" as "ops" | "super_admin" };
const sideEffects: string[] = [];

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => sideEffects.push("revalidate"), updateTag: () => sideEffects.push("tag") }));
vi.mock("next/server", () => ({ after: () => sideEffects.push("after") }));
vi.mock("@/lib/platform", () => ({
  requirePlatformModule: async (m: string) => {
    sideEffects.push(`gate:${m}`);
    return { id: "00000000-0000-4000-8000-000000000001", email: "x@y.z", full_name: "Test", role: role.current, is_active: true };
  },
}));
vi.mock("@/lib/platform-activity", () => ({ logPlatformActivity: async () => void sideEffects.push("log") }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: true }) }));
vi.mock("@/lib/site-issues/autopilot-server", () => ({
  readAutopilot: async () => ({ enabled: false, kinds: [], publish: false }),
  writeAutopilot: async () => (sideEffects.push("write-autopilot"), true),
}));
vi.mock("@/lib/site-issues/publish-all", () => ({
  hasPendingDraft: () => false,
  publishDraftsSequential: async () => (sideEffects.push("publish"), []),
}));
vi.mock("@/lib/site-issues/store", () => ({
  patchIssue: async () => (sideEffects.push("patch"), true),
  readIssuesByIds: async () => [],
  readQueueIssues: async () => ({ available: true, data: [] }),
  recordOptimizerAction: async () => (sideEffects.push("record"), true),
}));
vi.mock("@/lib/site-issues/collectors", () => ({ syncSiteIssues: async () => [] }));
vi.mock("@/lib/publishing/after-publish", () => ({
  HOOKS: [],
  runAfterPublish: async () => ({ ok: true, hooks: [] }),
  captureLiveDigests: async () => ({}),
  lastBaseline: async () => ({}),
}));
vi.mock("@/lib/publishing/surfaces", () => ({ SURFACES: [], surfaceById: () => null }));

import { ignoreIssue, publishAllDrafts, setAutopilot } from "@/app/actions/optimizer";

describe("optimizer.ts yetki", () => {
  beforeEach(() => {
    sideEffects.length = 0;
    role.current = "ops";
  });

  it("operasyon publishAllDrafts çağıramaz: yayın yapılmaz, kayıt düşmez", async () => {
    const r = await publishAllDrafts([{ surface: "sitecontent", hash: "abc" }]);
    expect(r.error).toMatch(/yalnız süper admin/);
    expect(sideEffects).toEqual(["gate:seo"]);
  });

  it("süper admin: önizleme özeti olmadan toplu yayın yapılmaz (zod)", async () => {
    role.current = "super_admin";
    for (const bad of [[], [{ surface: "", hash: "x" }], [{ surface: "sitecontent" }]] as unknown as { surface: string; hash: string }[][]) {
      expect((await publishAllDrafts(bad)).error).toMatch(/yeniden önizleyin/);
    }
    expect(sideEffects).not.toContain("publish");
    expect(await publishAllDrafts([{ surface: "sitecontent", hash: "abc" }])).toEqual({ ok: true, items: [] });
    expect(sideEffects).toContain("publish");
  });

  it("operasyon setAutopilot çağıramaz: ayar yazılmaz", async () => {
    const r = await setAutopilot({ enabled: true });
    expect(r.error).toMatch(/yalnız süper admin/);
    expect(sideEffects).toEqual(["gate:seo"]);
  });

  it("süper admin Otopilot'u açabilir; girdi zod ile doğrulanır (bilinmeyen tür reddedilir)", async () => {
    role.current = "super_admin";
    expect((await setAutopilot({ enabled: true, kinds: ["sil_her_seyi"] })).error).toBe("Geçersiz Otopilot ayarı.");
    expect(sideEffects).not.toContain("write-autopilot");
    expect((await setAutopilot({ enabled: true, kinds: ["indexnow"] })).ok).toBe(true);
    expect(sideEffects).toContain("write-autopilot");
    expect(sideEffects).toContain("log");
  });

  it("yoksaymada gerekçe zorunlu (operasyon yoksayabilir)", async () => {
    expect((await ignoreIssue("00000000-0000-4000-8000-000000000009", "kısa")).error).toMatch(/gerekçe/);
    expect(sideEffects).not.toContain("patch");
    expect((await ignoreIssue("00000000-0000-4000-8000-000000000009", "bilerek kısa tutuldu")).ok).toBe(true);
    expect(sideEffects).toContain("patch");
  });

  it("her eylem requirePlatformModule ile kapılanır; AI çağrısı yok", () => {
    const src = readFileSync(join(process.cwd(), "src/app/actions/optimizer.ts"), "utf8");
    const fns = [...src.matchAll(/export async function (\w+)/g)].map((m) => m[1]!);
    expect(fns).toEqual(expect.arrayContaining(["runSiteAudit", "prepareSafeFixes", "applyFixes", "ignoreIssue", "setAutopilot", "publishAllDrafts"]));
    for (const fn of fns) {
      const body = src.slice(src.indexOf(`export async function ${fn}`)).slice(0, 400);
      expect(body, fn).toMatch(/await gate\((true|false)\)/);
    }
    expect(src).toContain('requirePlatformModule("seo")');
    expect(src).not.toMatch(/openai|ai-client|@\/lib\/ai\//i);
  });
});
