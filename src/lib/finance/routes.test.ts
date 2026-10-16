import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  earningsHref,
  earningsPath,
  financeEntryPath,
  financeHref,
  financePartyHref,
  financePath,
  financeSectionOf,
  FINANCE_SECTIONS,
  isFinancePath,
  withQuery,
} from "./routes";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|json|md|sql)$/.test(name)) out.push(p);
  }
  return out;
}

describe("Finans adres üreticisi (WP6, tek kaynak)", () => {
  it("alt alan yolları gerçek bölümlerdir; ?sekme= yok", () => {
    expect(financePath()).toBe("/app/finans");
    expect(financePath("tekrarlayan")).toBe("/app/finans/tekrarlayan");
    expect(financeHref("cari", { yon: "alacak", bos: "", yok: null, kapali: false })).toBe("/app/finans/cari?yon=alacak");
    expect(financeHref("butce", undefined, "portal-getirisi")).toBe("/app/finans/butce#portal-getirisi");
    expect(financeHref("faturalar", new URLSearchParams({ kaynak: "serbest", bos: "" }))).toBe("/app/finans/faturalar?kaynak=serbest");
    expect(financePartyHref("11111111-2222-4333-8444-555555555555")).toBe("/app/finans/cari/11111111-2222-4333-8444-555555555555");
    expect(financeEntryPath("abc")).toBe("/app/finans/kayit/abc");
    expect(earningsPath()).toBe("/app/kazancim");
    expect(earningsHref("kasam", { hesap: "x" })).toBe("/app/kazancim/kasam?hesap=x");
    expect(withQuery("/x", {}, "#h")).toBe("/x#h");
    for (const s of FINANCE_SECTIONS) expect(financeHref(s)).not.toContain("sekme=");
  });

  it("yoldan alt alan çözümü ve Finans alanı denetimi", () => {
    expect(financeSectionOf("/app/finans")).toBe("genel");
    expect(financeSectionOf("/app/finans/cari/abc?x=1")).toBe("cari");
    expect(financeSectionOf("/app/finans/yok-boyle")).toBeNull();
    expect(financeSectionOf("/app/finansal")).toBeNull();
    expect(isFinancePath("/app/kazancim/kasam")).toBe(true);
    expect(isFinancePath("/app/raporlar")).toBe(false);
  });

  it("sözleşme: eski Finans yolları kaynak kodda hiçbir yerde geçmez (yönlendirme/takma ad yok)", () => {
    const legacy = [
      "/app/" + "giderler", "/app/" + "komisyon", "/app/" + "cuzdan", "sekme=" + "kasam",
      // Kaçışlı düzenli ifade biçimleri de (`\/app\/…`).
      "\\/app\\/" + "giderler", "\\/app\\/" + "komisyon", "\\/app\\/" + "cuzdan",
    ];
    const offenders: string[] = [];
    for (const dir of ["src", "e2e", "scripts"]) {
      let files: string[] = [];
      try {
        files = walk(join(ROOT, dir));
      } catch {
        continue;
      }
      for (const f of files) {
        const text = readFileSync(f, "utf8");
        for (const l of legacy) if (text.includes(l)) offenders.push(`${relative(ROOT, f)}: ${l}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
