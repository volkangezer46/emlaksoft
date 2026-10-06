import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const chat = vi.fn();
const gate = vi.fn();
vi.mock("@/lib/ai-advisor", () => ({ getOpenAiKey: vi.fn(async () => "sk-test") }));
vi.mock("@/lib/ai/openai-client", () => ({
  getOpenAiChatModel: () => "test-model",
  openAiChat: (opts: unknown) => chat(opts),
}));
vi.mock("@/lib/ai/auto-call-gate", () => ({ canAutoCallAi: (t: string) => gate(t) }));
vi.mock("@/lib/external-fetch", () => ({ externalErrorMetadata: () => ({}) }));

import { generateBriefingSummary, resetBriefingSummaryCache } from "@/lib/ai/briefing-summary";
import type { BriefingItem } from "@/lib/briefing";

/**
 * SÖZLEŞME: "audit olmadan derlenmez" + günlük önbellek + kota kapısı (brifing LLM çağrısı, P0).
 * Önceki durum: ana ekran her render'da, audit vermeden (ölçüsüz/denetimsiz) çağırıyordu.
 */

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [relative(root, full).split(sep).join("/")];
  });
}

describe("statik: audit olmadan derlenmez", () => {
  it("imzada audit ZORUNLU (opsiyonel değil)", () => {
    const src = read("src/lib/ai/briefing-summary.ts");
    expect(src).toMatch(/export async function generateBriefingSummary\(items: BriefingItem\[\], audit: OpenAiAudit\)/);
    expect(src).not.toMatch(/audit\?\s*:/);
  });

  it("her çağıran ikinci argüman olarak tenantId taşıyan audit nesnesi geçer", () => {
    const callers = sourceFiles(resolve(root, "src")).filter(
      (f) => f !== "src/lib/ai/briefing-summary.ts" && /generateBriefingSummary\(/.test(read(f)),
    );
    expect(callers.length).toBeGreaterThan(0);
    for (const f of callers) {
      const src = read(f);
      for (const m of src.matchAll(/generateBriefingSummary\(([^;]*)\)/g)) {
        expect(m[1], f).toMatch(/tenantId\s*:/);
        expect(m[1], f).toMatch(/actorId\s*:/);
      }
    }
  });

  it("bugun-ozet: tenant yoksa çağrı yapılmaz", () => {
    const src = read("src/app/app/_home/bugun-ozet.tsx");
    const guard = src.indexOf("if (!ctx.tenantId) return null;");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(src.indexOf("await generateBriefingSummary("));
  });
});

describe("davranış: önbellek + kota kapısı + audit", () => {
  const items: BriefingItem[] = [
    { icon: "x", text: "3 randevu bugün", href: "/app/randevular", tone: "brand" },
    { icon: "x", text: "2 gecikmiş görev", href: "/app/gorevler", tone: "danger" },
  ];
  const audit = { tenantId: "t1", actorId: "u1" };

  beforeEach(() => {
    chat.mockReset();
    gate.mockReset();
    resetBriefingSummaryCache();
    gate.mockResolvedValue(true);
    chat.mockResolvedValue({ content: "Bugün 3 randevun ve 2 görevin var." });
  });

  it("audit istemciye iletilir (kredi defteri + denetim izi)", async () => {
    await generateBriefingSummary(items, audit);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0]).toMatchObject({ purpose: "briefing_summary", audit });
  });

  it("aynı gün + aynı içerik için yeniden render model çağırmaz (önbellek); aynı anda iki çağrı tek uçuş", async () => {
    const [a, b] = await Promise.all([generateBriefingSummary(items, audit), generateBriefingSummary(items, audit)]);
    expect(a).toBe("Bugün 3 randevun ve 2 görevin var.");
    expect(b).toBe(a);
    await generateBriefingSummary(items, audit);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("kota dolu: LLM ÇAĞRILMAZ (null)", async () => {
    gate.mockResolvedValue(false);
    expect(await generateBriefingSummary(items, audit)).toBeNull();
    expect(chat).not.toHaveBeenCalled();
  });

  it("girdide olmayan sayı içeren çıktı reddedilir (null)", async () => {
    chat.mockResolvedValue({ content: "Bugün 9 randevun var." });
    expect(await generateBriefingSummary(items, audit)).toBeNull();
  });

  it("tenant yoksa ya da madde yoksa çağrı yok; farklı kullanıcı ayrı önbellek anahtarı", async () => {
    expect(await generateBriefingSummary(items, { tenantId: "", actorId: "u1" })).toBeNull();
    expect(await generateBriefingSummary([], audit)).toBeNull();
    expect(chat).not.toHaveBeenCalled();
    await generateBriefingSummary(items, audit);
    await generateBriefingSummary(items, { tenantId: "t1", actorId: "u2" });
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("model hatası null döner, fırlatmaz", async () => {
    chat.mockRejectedValue(new Error("boom"));
    await expect(generateBriefingSummary(items, audit)).resolves.toBeNull();
  });
});
