import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TRANSLATE_LANGS,
  TRANSLATION_LABEL,
  buildTranslateMessages,
  checkTranslation,
  isTranslateLang,
  normalizeDigits,
} from "./translate-logic";

const SRC = "Kadıköy'de 3+1, 120 m² daire. Fiyat: 5.250.000 ₺. Ara: 0532 123 45 67";

describe("ilan çevirisi mantığı", () => {
  it("dört dil: EN/DE/AR/RU", () => {
    expect(TRANSLATE_LANGS.map((l) => l.code)).toEqual(["en", "de", "ar", "ru"]);
    expect(isTranslateLang("de")).toBe(true);
    expect(isTranslateLang("fr")).toBe(false);
    expect(isTranslateLang(undefined)).toBe(false);
    expect(TRANSLATION_LABEL).toBe("AI çevirisi");
  });

  it("istem sayı/yer tutucu korumasını ister, hedef dili içerir", () => {
    const m = buildTranslateMessages(SRC, "ru");
    expect(m.system).toContain("Russian");
    expect(m.system).toMatch(/EXACTLY/);
    expect(m.system).toContain("[TELEFON_1]");
    expect(m.user).toBe(SRC);
  });

  it("sayıları koruyan çeviriyi kabul eder", () => {
    const out = "3+1, 120 m² apartment in Kadikoy. Price: 5,250,000 TRY. Call: 0532 123 45 67";
    const r = checkTranslation(out, SRC);
    expect(r.ok).toBe(true);
  });

  it("kaynakta olmayan sayı içeren çeviriyi reddeder", () => {
    const r = checkTranslation("3+1, 120 m² apartment. Price: 4,900,000 TRY", SRC);
    expect(r.ok).toBe(false);
  });

  it("Arapça rakamları Batı rakamına çevirerek doğrular", () => {
    expect(normalizeDigits("١٢٠ ۳")).toBe("120 3");
    const r = checkTranslation("شقة ١٢٠ م² و 3+1", SRC);
    expect(r.ok).toBe(true);
  });

  it("boş ve aşırı uzun çıktıyı reddeder", () => {
    expect(checkTranslation("   ", SRC).ok).toBe(false);
    expect(checkTranslation(null, SRC).ok).toBe(false);
    expect(checkTranslation("x".repeat(SRC.length * 3 + 500), SRC).ok).toBe(false);
  });
});

describe("çeviri hattı sözleşmesi", () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  it("OpenAI yalnız openai-client üzerinden; kayda yazan çağrı yok; yetki kapısı var", () => {
    const content = read("src/lib/ai/content.ts");
    expect(content).toContain("translateListingText");
    expect(content).not.toMatch(/api\.openai\.com/);
    const action = read("src/app/actions/ai-content.ts");
    const fn = action.slice(action.indexOf("export async function translatePropertyContent"), action.indexOf("export type SaveDescriptionResult"));
    expect(fn).toContain('requirePermission("properties", "view")');
    expect(fn).toContain('.eq("tenant_id", gate.tenantId)');
    expect(fn).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });
  it("panel 'AI çevirisi' etiketini ve RTL'yi taşır", () => {
    const panel = read("src/app/app/portfoyler/[id]/ai-content-panel.tsx");
    expect(panel).toContain("TRANSLATION_LABEL");
    expect(panel).toContain('dir={lang === "ar" ? "rtl" : "ltr"}');
  });
});
