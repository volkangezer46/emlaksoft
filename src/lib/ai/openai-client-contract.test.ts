import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [relative(process.cwd(), full).split(sep).join("/")];
  });
}

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

describe("OpenAI tek istemci sözleşmesi (KVKK m.9)", () => {
  const files = sourceFiles(resolve(process.cwd(), "src"));

  it("api.openai.com yalnız openai-client.ts içinde geçer", () => {
    const offenders = files.filter((f) => read(f).includes("api.openai.com"));
    expect(offenders).toEqual(["src/lib/ai/openai-client.ts"]);
  });

  it("istemci her çıkışı Redactor'dan geçirir ve fetchExternal kullanır", () => {
    const src = read("src/lib/ai/openai-client.ts");
    expect(src).toContain("redactDeep(");
    expect(src).toContain("fetchExternal(");
    expect(src).toMatch(/body: payload/);
    expect(src).not.toMatch(/\bfetch\s*\(/);
  });

  it("OpenAI kullanan tüm modüller istemci üzerinden gider", () => {
    for (const f of [
      "src/lib/ai-advisor.ts",
      "src/lib/ai/briefing-summary.ts",
      "src/lib/ai/call-summary.ts",
      "src/lib/ai/content.ts",
      "src/lib/ai/document-ocr.ts",
      "src/lib/ai/streaming.ts",
      "src/app/actions/ai-tenant-advisor.ts",
    ]) {
      const src = read(f);
      expect(src, f).toMatch(/openAiChat(?:Request)?\(/);
      expect(src, f).not.toMatch(/\bfetchExternal\s*\(/);
      expect(src, f).not.toMatch(/\bfetch\s*\(/);
    }
  });

  it("denetim izi yalnız sayaç ve etiket içerir (istem/yanıt yok)", () => {
    const src = read("src/lib/ai/openai-client.ts");
    const start = src.indexOf('action: "ai.openai_call"');
    const block = src.slice(start, src.indexOf("});", start));
    expect(block).not.toMatch(/messages|content|prompt|body/);
  });
});
