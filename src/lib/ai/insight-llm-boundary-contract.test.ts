import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/credits/usage", () => ({ getTenantUsage: vi.fn() }));

import {
  acceptNarrative,
  buildNarrativeInput,
  extractNumbers,
  normalizeNumber,
  outputNumbersAreGrounded,
  withinWordLimit,
} from "@/lib/ai/narrative-guard";
import { decideAutoCall } from "@/lib/ai/auto-call-gate";
import { buildDigestDraft } from "@/lib/insights/rules/digest";
import { DEFAULT_INSIGHT_SETTINGS } from "@/lib/insights/types";

/**
 * SÖZLEŞME: içgörü/brifing LLM sınırı.
 *  - yalnız openai-client.ts üzerinden (doğrudan api.openai.com / fetch yok), her çağrıda audit zorunlu;
 *  - otomatik çağrıda KOTA KAPISI; girdide olmayan sayı içeren çıktı REDDEDİLİR;
 *  - LLM anlatımı varsayılan KAPALI ve yalnız `digest` için; girdiye kişisel veri girmez;
 *  - openai-client-contract.test.ts kuralları korunur.
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

describe("OpenAI yalnız tek istemci üzerinden (insight/brifing)", () => {
  const NARRATIVE = read("src/lib/ai/insight-narrative.ts");
  const BRIEFING = read("src/lib/ai/briefing-summary.ts");

  it("api.openai.com ve ham fetch yok; openAiChat kullanılır", () => {
    for (const [name, src] of [["insight-narrative", NARRATIVE], ["briefing-summary", BRIEFING]] as const) {
      expect(src, name).not.toContain("api.openai.com");
      expect(src, name).not.toMatch(/\bfetch\s*\(/);
      expect(src, name).not.toMatch(/\bfetchExternal\s*\(/);
      expect(src, name).toMatch(/openAiChat\(/);
    }
  });

  it("api.openai.com yalnız openai-client.ts içinde geçer (insights klasörü dahil tüm src)", () => {
    const offenders = sourceFiles(resolve(root, "src")).filter((f) => read(f).includes("api.openai.com"));
    expect(offenders).toEqual(["src/lib/ai/openai-client.ts"]);
  });

  it("insights klasörü OpenAI'a hiç dokunmaz (anlatım yalnız lib/ai/insight-narrative üzerinden)", () => {
    for (const f of sourceFiles(resolve(root, "src/lib/insights"))) {
      const src = read(f);
      expect(src, f).not.toMatch(/openAiChat|openai-client|OPENAI_API_KEY|getOpenAiKey/);
    }
  });

  it("HER çağrıda audit zorunlu: openAiChat çağrılarında `audit` anahtarı var, imzada opsiyonel değil", () => {
    for (const [name, src] of [["insight-narrative", NARRATIVE], ["briefing-summary", BRIEFING]] as const) {
      const calls = src.match(/openAiChat\(\{[\s\S]*?\n    \}\);/g) ?? [];
      expect(calls.length, name).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c, name).toMatch(/\baudit,/);
        expect(c, name).toContain("purpose:");
      }
    }
    expect(BRIEFING).toMatch(/generateBriefingSummary\(items: BriefingItem\[\], audit: OpenAiAudit\)/);
    expect(BRIEFING).not.toMatch(/audit\?:\s*OpenAiAudit/);
    expect(NARRATIVE).toMatch(/call\(input: string, audit: OpenAiAudit\)/);
  });

  it("otomatik çağrılarda KOTA KAPISI çağrıdan ÖNCE", () => {
    for (const [name, src] of [["insight-narrative", NARRATIVE], ["briefing-summary", BRIEFING]] as const) {
      const gate = src.indexOf("canAutoCallAi(");
      const call = src.indexOf("await openAiChat(");
      expect(gate, name).toBeGreaterThan(-1);
      expect(gate, name).toBeLessThan(call);
    }
  });

  it("çıktı girdiyle doğrulanır (acceptNarrative) ve önbellek/tek uçuş var", () => {
    expect(NARRATIVE).toContain("acceptNarrative(");
    expect(BRIEFING).toContain("acceptNarrative(");
    expect(BRIEFING).toContain("inflight");
    expect(NARRATIVE).toMatch(/cache\.get\(/);
  });

  it("sistem istemi sayı uydurmayı yasaklar; girdi kaynağında müşteri adı/telefon/e-posta alanı yok", () => {
    expect(NARRATIVE).toMatch(/UYDURMA/);
    expect(NARRATIVE).not.toMatch(/phone|telefon|email|e-posta|full_name|fullName|tc_?no/i);
  });

  it("anlatım yalnız digest için (başka tür null döner)", () => {
    expect(NARRATIVE).toMatch(/if \(args\.draft\.kind !== "digest"\) return null;/);
  });
});

describe("LLM anlatımı varsayılan KAPALI ve opsiyonel", () => {
  it("ofis ayarı varsayılanı kapalı; engine yalnız ayar açıkken narrate çağırır", () => {
    expect(DEFAULT_INSIGHT_SETTINGS.narrativeEnabled).toBe(false);
    const engine = read("src/lib/insights/engine.ts");
    expect(engine).toMatch(/settings\.narrativeEnabled && deps\.narrate/);
  });

  it("reconciliation iş seçicisi anlatıcıyı yalnız tanımlı bağımlılık olarak verir (kural metni her zaman var)", () => {
    const rec = read("src/lib/billing/reconciliation.ts");
    expect(rec).toContain("generateInsightNarrative(a)");
  });
});

describe("modele giden metin yalnız özet sayı/etiket", () => {
  it("digest girdisi türlerin adet özetidir; ad/telefon/e-posta içermez", () => {
    const d = buildDigestDraft({
      userId: "u1",
      items: [
        { kind: "call_priority", severity: "orta" },
        { kind: "call_priority", severity: "bilgi" },
        { kind: "deal_risk", severity: "yuksek" },
      ],
      nowMs: Date.UTC(2026, 9, 6, 9, 0, 0),
    });
    expect(d).not.toBeNull();
    const input = buildNarrativeInput(d!);
    expect(input).toContain("Bugün sizin için 3 öneri var");
    expect(input).not.toMatch(/@|\+90|05\d{9}/);
  });
});

describe("narrative-guard (girdide olmayan sayı REDDEDİLİR)", () => {
  it("sayı çıkarma biçimleri normalize eder", () => {
    expect(extractNumbers("1.250.000 TL ve %12, 3,5 puan. 7.")).toEqual(["1250000", "12", "3.5", "7"]);
    expect(normalizeNumber("007")).toBe("7");
    expect(normalizeNumber("3,50")).toBe("3.5");
    expect(normalizeNumber("1,250,000")).toBe("1250000");
  });

  it("yalnız girdide geçen sayılar kabul edilir", () => {
    const input = "- 3 randevu\n- 2 görev gecikmiş";
    expect(outputNumbersAreGrounded("Bugün 3 randevun ve 2 görevin var.", input)).toBe(true);
    expect(outputNumbersAreGrounded("Bugün 5 randevun var.", input)).toBe(false);
    expect(outputNumbersAreGrounded("Harika bir gün seni bekliyor.", input)).toBe(true);
  });

  it("acceptNarrative: uydurma sayı, aşırı uzunluk, boş çıktı reddedilir; uygun çıktı döner", () => {
    const input = "3 randevu";
    expect(acceptNarrative("Bugün 3 randevun var.", input, { maxWords: 20 })).toBe("Bugün 3 randevun var.");
    expect(acceptNarrative("Bugün 4 randevun var.", input, { maxWords: 20 })).toBeNull();
    expect(acceptNarrative("Bugün 3 randevun var ve çok güzel bir gün geçireceksin.", input, { maxWords: 5 })).toBeNull();
    expect(acceptNarrative("   ", input, { maxWords: 20 })).toBeNull();
    expect(acceptNarrative(null, input, { maxWords: 20 })).toBeNull();
    expect(withinWordLimit("bir iki üç", 3)).toBe(true);
    expect(withinWordLimit("bir iki üç dört", 3)).toBe(false);
  });
});

describe("kota kapısı (kota dolu = LLM çağrısı yok)", () => {
  it("dolu kota kapıyı kapatır; sınırsız/ok/warn açık; sıfır kota kapalı", () => {
    expect(decideAutoCall({ quota: 100, state: "over" })).toBe(false);
    expect(decideAutoCall({ quota: 0, state: "ok" })).toBe(false);
    expect(decideAutoCall({ quota: null, state: "unlimited" })).toBe(true);
    expect(decideAutoCall({ quota: 100, state: "ok" })).toBe(true);
    expect(decideAutoCall({ quota: 100, state: "warn" })).toBe(true);
  });
});
