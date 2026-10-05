import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROPERTY_DESCRIPTION_MAX, parsePropertyDescription, withDescription } from "./property-description";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("portföy açıklaması (tek akış)", () => {
  it("boş girdi silme sayılır, satır sonları LF olur", () => {
    expect(parsePropertyDescription("   ")).toEqual({ ok: true, value: null });
    expect(parsePropertyDescription(" a\r\nb ")).toEqual({ ok: true, value: "a\nb" });
  });

  it("üst sınırı aşan metin reddedilir", () => {
    expect(parsePropertyDescription("x".repeat(PROPERTY_DESCRIPTION_MAX)).ok).toBe(true);
    expect(parsePropertyDescription("x".repeat(PROPERTY_DESCRIPTION_MAX + 1)).ok).toBe(false);
  });

  it("features'a birleştirirken diğer anahtarları korur; null anahtarı siler", () => {
    expect(withDescription({ rooms: "3+1" }, "metin")).toEqual({ rooms: "3+1", description: "metin" });
    expect(withDescription({ rooms: "3+1", description: "eski" }, null)).toEqual({ rooms: "3+1" });
    expect(withDescription(null, "a")).toEqual({ description: "a" });
  });

  it("iki giriş noktası da aynı modülü kullanır; başka yerde features.description yazılmaz", () => {
    expect(read("src/app/actions/properties.ts")).toContain("parsePropertyDescription");
    expect(read("src/app/actions/ai-content.ts")).toContain("parsePropertyDescription");
    expect(read("src/app/app/portfoyler/[id]/edit-property-dialog.tsx")).toContain('name="description"');
    // AI paneli kendi başına yazmaz: yalnız ortak action'ı çağırır
    const panel = read("src/app/app/portfoyler/[id]/ai-content-panel.tsx");
    expect(panel).toContain("savePropertyDescription");
    expect(panel).not.toContain(".from(\"properties\")");
  });
});
