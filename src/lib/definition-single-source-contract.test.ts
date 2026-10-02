import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFINITION_CATEGORIES,
  DEFAULT_DEFINITIONS,
  SYSTEM_DEFINITION_VALUES,
  defaultLabelMap,
  isSystemDefinitionValue,
} from "@/lib/definition-defaults";

const SRC = join(process.cwd(), "src");
const SOURCE_OF_TRUTH = "lib/definition-defaults.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((f) => ({ rel: relative(SRC, f).split(sep).join("/"), text: readFileSync(f, "utf8") }));

describe("tanım listeleri tek kaynak sözleşmesi", () => {
  it("kategori listesi yalnız definition-defaults.ts içinde tanımlıdır", () => {
    const offenders = files
      .filter((f) => f.rel !== SOURCE_OF_TRUTH)
      .filter((f) => /"customer_type",\s*"customer_source",\s*"property_type"/.test(f.text) || /customer_type:\s*"Müşteri tipi"/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("varsayılan seed listeleri başka dosyada çoğaltılmaz", () => {
    const patterns: [string, RegExp][] = [
      ["property_type listesi", /"Daire",\s*"Villa"/],
      ["transaction_type listesi", /"Satılık",\s*"Kiralık"/],
      ["customer_type listesi", /"Alıcı",\s*"Satıcı"/],
      ["lead source", /value:\s*"portal_sahibinden"/],
      ["expense category", /value:\s*"komisyon_gider"/],
      ["appointment_type", /value:\s*"showing"/],
      ["demand_urgency", /value:\s*"urgent"/],
    ];
    const offenders: string[] = [];
    for (const f of files) {
      if (f.rel === SOURCE_OF_TRUTH) continue;
      for (const [name, re] of patterns) {
        if (re.test(f.text)) offenders.push(`${f.rel}: ${name}`);
      }
    }
    // Seed değil: playbook-labels örnek metin, arama-sonuclari hızlı arama çipleri.
    const notSeeds = ["lib/playbook-labels.ts", "app/arama-sonuclari/page.tsx"];
    expect(offenders.filter((o) => !notSeeds.some((n) => o.includes(n)))).toEqual([]);
  });

  it("lead-sources ve expense-categories yalnız tek kaynağı yeniden dışa aktarır", () => {
    for (const name of ["lead-sources.ts", "expense-categories.ts"]) {
      const text = files.find((f) => f.rel === `lib/${name}`)!.text;
      expect(text).toContain("@/lib/definition-defaults");
      expect(text).not.toMatch(/value:\s*"/);
    }
  });

  it("her kategorinin varsayılanı var ve sistem anahtarları varsayılanın alt kümesidir", () => {
    for (const { key } of DEFINITION_CATEGORIES) {
      expect(DEFAULT_DEFINITIONS[key].length).toBeGreaterThan(0);
      const values = DEFAULT_DEFINITIONS[key].map((d) => d.value);
      for (const sys of SYSTEM_DEFINITION_VALUES[key]) expect(values).toContain(sys);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("sistem anahtarı kilidi ve etiket haritası çalışır", () => {
    expect(isSystemDefinitionValue("transaction_type", "Satılık")).toBe(true);
    expect(isSystemDefinitionValue("appointment_type", "showing")).toBe(true);
    expect(isSystemDefinitionValue("property_type", "Daire")).toBe(false);
    expect(isSystemDefinitionValue("bilinmeyen", "x")).toBe(false);
    // eski (referral) ve yeni (portal_sahibinden) kaynak değerleri ikisi de etiketlenir
    const labels = defaultLabelMap("customer_source");
    expect(labels.referral).toBe("Referans");
    expect(labels.portal_sahibinden).toBe("Sahibinden.com");
  });

  it("lookup_values tablosu yalnız adaptör dosyasından okunur", () => {
    const readers = files.filter((f) => /\.from\("lookup_values"\)/.test(f.text)).map((f) => f.rel);
    expect(readers).toEqual(["app/actions/property-management.ts"]);
  });
});
