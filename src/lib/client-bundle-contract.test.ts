import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * İstemci paket bütçesi sözleşmesi (HIZ_OLCUM_RAPORU_5, HAFIZA §27).
 *
 * 1) Ağır sunucu/doğrulama paketleri (zod ~280 KB ham / ~52 KB brotli) kabuğa ve ortak form kabuğuna sızmaz.
 *    Ölçülen kök neden: `form-field-labels` → `demand-criteria` (modül düzeyinde zod şeması) zinciri 28 form
 *    sayfasına, `matching` → `demand-criteria` zinciri /app/ayarlar'a zod taşıyordu. Etiket/ağırlık sabitleri
 *    bağımlılıksız modüllere ayrıldı; bu test zinciri statik olarak izler (değer içe aktarmaları; `import type`,
 *    dinamik `import()` ve `"use server"` sınırı istemci paketine girmez).
 * 2) Kabuk panelleri `lazyPanel` ile yüklenir ve boşta önceden indirilir (ilk tık askıya alınmasın).
 */
const ROOT = process.cwd();

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const p = base + ext;
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** Değer içe/dışa aktarma belirteçleri (`import type` ve yalnız-tip süslü listeler hariç). */
function valueImports(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) continue;
    const inner = m[2].match(/^\{([\s\S]*)\}$/);
    if (inner && inner[1].split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "))) continue;
    out.push(m[3]);
  }
  for (const s of text.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) out.push(s[1]);
  return out;
}

/** `entry`den `pkg` paketine giden ilk değer-içe-aktarma zinciri (yoksa null). */
function chainTo(entry: string, pkg: string): string | null {
  const seen = new Set<string>();
  const walk = (file: string, chain: string[]): string | null => {
    if (seen.has(file)) return null;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    if (chain.length > 0 && /^\s*["']use server["']/.test(text)) return null;
    for (const spec of valueImports(text)) {
      const short = file.slice(ROOT.length + 1).split("\\").join("/");
      if (spec === pkg || spec.startsWith(`${pkg}/`)) return [...chain, short, pkg].join(" -> ");
      const next = resolveSpec(spec, file);
      if (next) {
        const hit = walk(next, [...chain, short]);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(join(ROOT, entry), []);
}

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** İstemci girişleri: kabuk + ortak form kabuğu + ayarlar formları. */
const CLIENT_ENTRIES = [
  "src/components/app/app-sidebar.tsx",
  "src/components/app/section-tabs.tsx",
  "src/components/app/app-breadcrumb.tsx",
  "src/components/app/command-search.tsx",
  "src/components/app/notification-bell.tsx",
  "src/components/app/quick-create-menu.tsx",
  "src/components/ui/console/user-menu.tsx",
  "src/components/ui/tabbed-form-shell.tsx",
  "src/app/app/ayarlar/matching-weights-form.tsx",
  "src/app/app/ayarlar/company-form.tsx",
  "src/app/app/ayarlar/integrations-form.tsx",
  "src/app/app/ayarlar/logo-upload-form.tsx",
  "src/components/app/notification-prefs.tsx",
  // P3 (PB52 turu): talep ölçütü doğrulaması el yazımı (demand-criteria zod'suz), parsel ön doğrulaması tıklamada yüklenir.
  "src/app/app/ice-aktarma/import-wizard.tsx",
  "src/app/app/musteriler/yeni/customer-form.tsx",
  "src/app/app/portfoyler/yeni/property-form.tsx",
  "src/app/app/talepler/yeni/demand-form.tsx",
  "src/app/app/degerleme/parsel/parsel-client.tsx",
  "src/components/app/structured-demand-fields.tsx",
  "src/components/app/demand-summary.tsx",
  "src/components/app/duplicate-hint.tsx",
  "src/app/app/giderler/expense-create-form.tsx",
  "src/app/app/sozlesmeler/[id]/remind-signer.tsx",
];

describe("istemci paketi: zod kabuğa/form kabuğuna sızmaz", () => {
  it.each(CLIENT_ENTRIES)("%s → zod zinciri yok", (entry) => {
    expect(existsSync(join(ROOT, entry)), `${entry} yok`).toBe(true);
    expect(chainTo(entry, "zod")).toBeNull();
  });

  it("hafif sabit modülleri bağımlılıksızdır", () => {
    for (const f of ["src/lib/demand-criteria-labels.ts", "src/lib/matching-weights.ts"]) {
      expect(valueImports(read(f)), f).toEqual([]);
    }
  });

  it("tek kaynak: demand-criteria ve matching sabitleri hafif modülden yeniden dışa aktarır (kopya yok)", () => {
    const dc = read("src/lib/demand-criteria.ts");
    expect(dc).toContain('from "@/lib/demand-criteria-labels"');
    expect(dc).not.toMatch(/export const CRITERIA_LABELS\b|export const CRITERIA_REQUIRED_KEYS\b/);
    const m = read("src/lib/matching.ts");
    expect(m).toContain('from "@/lib/matching-weights"');
    expect(m).not.toMatch(/export const DEFAULT_MATCHING_WEIGHTS\b|export function sanitizeMatchingWeights\b/);
  });

  it("zincir izleyici gerçek zinciri bulur (öz-sınama)", () => {
    expect(chainTo("src/lib/validation/contact.ts", "zod")).toBe("src/lib/validation/contact.ts -> zod");
  });

  it(".xlsx kütüphanesi yalnız dinamik içe aktarılır (statik zincir yok)", () => {
    for (const entry of ["src/app/app/ice-aktarma/import-wizard.tsx", "src/components/listing-control/inventory-import-form.tsx", ...CLIENT_ENTRIES]) {
      expect(chainTo(entry, "read-excel-file"), entry).toBeNull();
    }
    expect(read("src/lib/xlsx-import.ts")).toContain('await import("read-excel-file/browser")');
  });

  it("demand-criteria zod'suz kalır (istemci formlarının ortak modülü)", () => {
    expect(chainTo("src/lib/demand-criteria.ts", "zod")).toBeNull();
  });
});

describe("kabuk panelleri: lazyPanel + boşta ön yükleme", () => {
  const PANELS = [
    "src/components/ui/console/user-menu.tsx",
    "src/components/app/notification-bell.tsx",
    "src/components/app/command-search.tsx",
    "src/components/app/quick-create-menu.tsx",
  ];
  it.each(PANELS)("%s", (file) => {
    const src = read(file);
    expect(src).toContain('from "@/lib/lazy-panel"');
    expect(src).toMatch(/runWhenIdle\(\w+\.preload\)/);
    expect(src).not.toMatch(/\blazy\(/);
    // Bileşen tık anında seçilir ve state'e yazılır (render içinde değişmez).
    expect(src).toMatch(/set\w+\(\(\) => \w+\.resolve\(\)\)/);
  });
});

describe("rapor merkezi: XLSX / PDF üreticileri istemci paketine girmez", () => {
  // İstemci bileşenleri (use client) yalnız düz dize alır; katalog ve biçim yazıcıları sunucudadır.
  const REPORT_CLIENT_ENTRIES = [
    "src/components/report-center/download-buttons.tsx",
    "src/components/report-center/report-tabs.tsx",
    "src/components/report-center/report-open-link.tsx",
    "src/components/ui/segmented-control.tsx",
  ];
  const HEAVY = ["pdf-lib", "@pdf-lib/fontkit", "node:zlib", "node:fs/promises"];
  it.each(REPORT_CLIENT_ENTRIES)("%s → pdf-lib / fontkit / zlib zinciri yok", (entry) => {
    expect(existsSync(join(ROOT, entry)), `${entry} yok`).toBe(true);
    for (const pkg of HEAVY) expect(chainTo(entry, pkg), `${entry} → ${pkg}`).toBeNull();
  });

  it("indirme düğmesi istemci bileşeni katalog / yazıcı modüllerini içe aktarmaz", () => {
    const src = read("src/components/report-center/download-buttons.tsx");
    expect(src).toMatch(/^"use client";/);
    expect(src).not.toMatch(/report-center\/(registry|catalog|format|engine|render|download|context)/);
    expect(chainTo("src/components/report-center/download-buttons.tsx", "zod")).toBeNull();
  });

  it("yazıcı bağımlılıkları yalnız sunucu yazıcılarında; XLSX sıfır bağımlılık", () => {
    expect(read("src/lib/report-center/format/pdf.ts")).toContain('from "pdf-lib"');
    expect(read("src/lib/report-center/format/xlsx.ts")).not.toMatch(/from "(exceljs|xlsx)"/);
    // Hiçbir "use client" dosyası format/ dizinini içe aktarmaz.
    expect(read("src/components/report-center/download-buttons.tsx")).not.toContain("report-center/format");
  });
});
