import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readCached, walkSource } from "./test-support/src-tree";

/**
 * YD5 klavye sözleşmesi:
 *  1) Klavye ipuçları dokunmatik cihazda gizli: her <kbd> ve ipucu cümlesi (`.kbd-hint`) `(hover: none) and (pointer: coarse)`
 *     altında görünmez; ortak Kbd/ShortcutHint bu sınıfı taşır.
 *  2) Ctrl/⌘K her yerde aynı anlam: GENEL komut paleti. Paletin kendi dosyaları dışında hiçbir bileşen Ctrl/⌘K yakalamaz
 *     (Muhasebe komut çubuğu M tuşunda) ve görünür metin "Ctrl K"yı başka bir anlamla anmaz.
 */
const ROOT = join(process.cwd(), "src");
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** Ctrl/⌘K dinleyebilen tek yerler: /app paleti (kabuk + gövde) ve /admin paleti (kabuk + gövde). */
const PALETTE_FILES = new Set([
  "src/components/app/command-search.tsx",
  "src/components/app/command-search-panel.tsx",
  "src/components/admin/command-palette-lazy.tsx",
  "src/components/admin/command-palette.tsx",
]);

describe("klavye ipuçları dokunmatikte gizli", () => {
  it("a11y.css: kbd ve .kbd-hint dokunmatik (fare yok) ortamda display:none", () => {
    const css = read("src/app/a11y.css");
    const m = css.match(/@media \(hover: none\) and \(pointer: coarse\) \{([\s\S]*?)\n\}/);
    expect(m, "dokunmatik medya kuralı yok").not.toBeNull();
    expect(m![1]).toMatch(/kbd,\s*\.kbd-hint\s*\{\s*display: none !important;/);
  });

  it("ortak Kbd, KbdCombo ve ShortcutHint .kbd-hint taşır", () => {
    const kbd = read("src/components/ui/kbd.tsx");
    expect(kbd).toMatch(/const BASE =\s*"kbd-hint /);
    expect(kbd).toMatch(/className="kbd-hint inline-flex items-center gap-1"/);
    expect(read("src/components/app/shortcut-hint.tsx")).toMatch(/kbd-hint/);
  });

  it("ipucu cümleleri (gezin / ile kaydet / seç · Enter) sarmalayıcıyla birlikte gizlenir", () => {
    expect(read("src/components/ui/form-action-bar.tsx")).toMatch(/className="kbd-hint hidden min-w-0 truncate/);
    expect(read("src/components/app/command-search-panel.tsx")).toMatch(/className="kbd-hint flex items-center gap-3 border-t/);
    expect(read("src/components/admin/command-palette.tsx")).toMatch(/className="kbd-hint hairline-t/);
    expect(read("src/app/app/giderler/_components/command-bar.tsx")).toMatch(/className="kbd-hint border-t[^"]*">↑ ↓ seç/);
  });
});

describe("Ctrl/⌘K her yerde komut paleti", () => {
  it("palet dosyaları dışında Ctrl/⌘K dinleyicisi yok", () => {
    const offenders: string[] = [];
    for (const f of walkSource(ROOT)) {
      const rel = relative(process.cwd(), f).replace(/\\/g, "/");
      if (PALETTE_FILES.has(rel) || /\.test\.tsx?$/.test(rel)) continue;
      const src = readCached(f);
      if (/(metaKey|ctrlKey)[^\n]{0,80}key(\.toLowerCase\(\))?\s*===\s*["']k["']/.test(src)) offenders.push(rel);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("muhasebe: komut çubuğu M tuşunda, metinler Ctrl K'yı başka anlamla anmaz", () => {
    const qe = read("src/app/app/giderler/quick-entry.tsx");
    expect(qe).toMatch(/k === "m" && !chained/);
    expect(qe).not.toMatch(/Control\+K/);
    expect(read("src/app/app/giderler/_components/entry-dialog.tsx")).not.toMatch(/Ctrl K komutlar/);
    expect(read("src/app/app/giderler/_tabs/finance-shell.tsx")).not.toMatch(/Yeni kayıt için Ctrl K/);
  });

  it("kenar menüdeki Ara düğmesi ikinci bir Ctrl K ipucu çizmez (tek tetikleyici ipucu üst çubukta)", () => {
    const qa = read("src/components/ui/console/quick-access.tsx");
    const body = qa.slice(qa.indexOf("export function MenuSearchButton"));
    expect(body).not.toMatch(/ShortcutHint|Kbd/);
  });
});
