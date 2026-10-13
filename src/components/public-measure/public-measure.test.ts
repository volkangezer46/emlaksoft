import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ settingsReads: 0 }));
vi.mock("@/lib/measure/settings", async (orig) => ({
  ...(await orig<typeof import("@/lib/measure/settings")>()),
  getMeasureSettings: async () => {
    h.settingsReads += 1;
    return { pageviews: true, vitals: true, attribution: true, attributionLegalAt: "2026-10-13T00:00:00.000Z" };
  },
}));

import { PublicMeasure } from "./public-measure";
import { measureScriptProps } from "./script-src";
import { MEASURE_DEFAULTS } from "@/lib/measure/settings";

const SRC = "/statik/m-0123456789.js";

describe("<PublicMeasure />", () => {
  it.each(["/admin", "/admin/site/reklam", "/app", "/app/musteriler", "/giris", "/kayit/tamamla", "/sifre-yenile"])(
    "%s altında null döner (ayar bile okunmaz)",
    async (path) => {
      const before = h.settingsReads;
      expect(await PublicMeasure({ path })).toBeNull();
      expect(h.settingsReads).toBe(before);
      expect(measureScriptProps(path, MEASURE_DEFAULTS, SRC)).toBeNull();
    },
  );

  it("herkese açık yolda etiket öznitelikleri: data-a atıf ayarından", () => {
    expect(measureScriptProps("/", MEASURE_DEFAULTS, SRC)).toEqual({ src: SRC, "data-a": "0" });
    expect(measureScriptProps(undefined, { ...MEASURE_DEFAULTS, attribution: true }, SRC)).toEqual({ src: SRC, "data-a": "1" });
  });

  it("sayaç ve hız ölçümü ikisi de kapalıysa ya da paket yoksa etiket basılmaz", () => {
    expect(measureScriptProps("/", { ...MEASURE_DEFAULTS, pageviews: false, vitals: false }, SRC)).toBeNull();
    expect(measureScriptProps("/", MEASURE_DEFAULTS, null)).toBeNull();
  });

  it("altbilgi tek satırla bağlar; etiket K4 (data-static-keep, defer, /statik/) biçiminde", () => {
    const footer = readFileSync(join(process.cwd(), "src/components/site-footer.tsx"), "utf8");
    expect(footer.match(/<PublicMeasure \/>/g)).toHaveLength(1);
    const src = readFileSync(join(process.cwd(), "src/components/public-measure/public-measure.tsx"), "utf8");
    expect(src).toMatch(/<script src=\{props\.src\} defer data-static-keep="" data-a=\{props\["data-a"\]\} \/>/);
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
  });
});
