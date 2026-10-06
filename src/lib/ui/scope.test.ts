import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseScope, resolveScope } from "./scope";

describe("kapsam tercihi (ScopeSwitch)", () => {
  it("URL > çerez > varsayılan 'ben'", () => {
    expect(resolveScope({ canSwitch: true, param: "ofis", cookie: "ben" })).toEqual({ scope: "ofis", explicit: "ofis" });
    expect(resolveScope({ canSwitch: true, param: "ben", cookie: "ofis" })).toEqual({ scope: "ben", explicit: "ben" });
    expect(resolveScope({ canSwitch: true, param: undefined, cookie: "ofis" })).toEqual({ scope: "ofis", explicit: null });
    expect(resolveScope({ canSwitch: true, param: "bozuk", cookie: undefined })).toEqual({ scope: "ben", explicit: null });
  });

  it("yönetim rolü değilse çerez/URL ofis geneline AÇAMAZ", () => {
    expect(resolveScope({ canSwitch: false, param: "ofis", cookie: "ofis" })).toEqual({ scope: "ben", explicit: null });
  });

  it("yalnız iki değer kabul edilir", () => {
    expect(parseScope("OFIS")).toBeNull();
    expect(parseScope(1)).toBeNull();
  });

  it("bileşen erişilebilir radyo grubudur ve ana ekran onu kullanır", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/ui/scope-switch.tsx"), "utf8");
    expect(src).toContain('role="radiogroup"');
    expect(src).toContain('role="radio"');
    expect(src).toContain("aria-checked");
    expect(src).not.toMatch(/from "motion|framer-motion/);
    const hero = fs.readFileSync(path.join(process.cwd(), "src/app/app/_home/ana-hero.tsx"), "utf8");
    expect(hero).toContain("<ScopeSwitch");
  });
});
