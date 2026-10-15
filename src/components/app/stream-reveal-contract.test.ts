import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STREAM_REVEAL_SCRIPT } from "./stream-reveal-boot";

/**
 * B021 sözleşmesi: panelde akışlı Suspense içeriği React'in 300 ms gösterim kısıtına takılmaz. Betik React'in `$RC`
 * çalışma zamanındaki `"number"!==typeof $RT` dalına dayanır; React bunu değiştirirse bu test kırılır (betik etkisiz
 * kalır, davranış eski kısıta döner — sessiz gerileme olmasın).
 */
const NEXT_REACT_DOM = "node_modules/next/dist/compiled/react-dom/cjs";

describe("akışlı gösterim kısıtı (panel)", () => {
  it("Next'in derlediği React sunucu çalışma zamanı `$RT` sayı değilse içeriği aynı karede açar", () => {
    for (const f of ["react-dom-server.node.production.js", "react-dom-server.edge.production.js"]) {
      const src = readFileSync(join(process.cwd(), NEXT_REACT_DOM, f), "utf8");
      expect(src, f).toContain('"number"!==typeof $RT?requestAnimationFrame(');
      expect(src, f).toContain("$RT=performance.now()");
    }
  });

  it("betik `$RT`'yi hiç sayıya dönmeyen erişimciyle tanımlar (yazma yok sayılır)", () => {
    const win: Record<string, unknown> = {};
    new Function("window", STREAM_REVEAL_SCRIPT)(win);
    win.$RT = 1234.5;
    expect(typeof win.$RT).not.toBe("number");
  });

  it("panel layout'u betiği ilk Suspense sınırından ÖNCE çizer", () => {
    const layout = readFileSync(join(process.cwd(), "src/app/app/layout.tsx"), "utf8");
    const body = layout.slice(layout.indexOf("export default function AppLayout"));
    expect(body.indexOf("<StreamRevealBoot />")).toBeGreaterThan(0);
    expect(body.indexOf("<StreamRevealBoot />")).toBeLessThan(body.indexOf("<ShellBoot />"));
  });
});
