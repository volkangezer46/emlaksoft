import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { autoAskOnce } from "./sor";
import { parseSorParams } from "./sor-params";

describe("/sor açılış sorusu (?q) yalnız bir kez gönderilir", () => {
  it("aynı ref ile tekrar çağrılar (Strict Mode çift etkisi, yeniden çizim, ask kimliği değişimi) soruyu yinelemez", () => {
    const once = { current: false };
    const ask1 = vi.fn();
    const ask2 = vi.fn();
    expect(autoAskOnce(once, "Deneme süresi kaç gün?", ask1)).toBe(true);
    expect(autoAskOnce(once, "Deneme süresi kaç gün?", ask1)).toBe(false);
    expect(autoAskOnce(once, "Deneme süresi kaç gün?", ask2)).toBe(false);
    expect(ask1).toHaveBeenCalledTimes(1);
    expect(ask1).toHaveBeenCalledWith("Deneme süresi kaç gün?");
    expect(ask2).not.toHaveBeenCalled();
  });

  it("soru yoksa hiçbir şey gönderilmez ve koruma harcanmaz", () => {
    const once = { current: false };
    const ask = vi.fn();
    expect(autoAskOnce(once, null, ask)).toBe(false);
    expect(autoAskOnce(once, "", ask)).toBe(false);
    expect(once.current).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it("ZekaDock açılış sorusunu ref korumalı etkide autoAskOnce ile yollar; /sor soru başına yeniden kurar", () => {
    const panel = readFileSync(join(process.cwd(), "src/components/zeka/zeka-panel.tsx"), "utf8");
    expect(panel).toMatch(/const autoAsked = useRef\(false\);/);
    expect(panel).toMatch(/useEffect\(\(\) => \{\s*autoAskOnce\(autoAsked, initialQuestion, ask\);\s*\}, \[initialQuestion, ask\]\);/);
    // İstemci yardımcısı bağımlılıksızdır (NLU bağlam modülü pencere paketine girmez).
    expect(readFileSync(join(process.cwd(), "src/lib/ai/zeka/sor.ts"), "utf8")).not.toMatch(/^import /m);
    expect(readFileSync(join(process.cwd(), "src/app/sor/page.tsx"), "utf8")).toMatch(/<ZekaDock key=\{params\.q \?\? ""\}/);
  });
});

describe("/sor parametreleri (sunucuda okunur)", () => {
  it("q kırpılır, boşluklar sadeleşir; 2 karakterden kısa soru yok sayılır", () => {
    expect(parseSorParams({ q: "  Paketler   neler?  " })).toMatchObject({ q: "Paketler neler?", hasQuery: true });
    expect(parseSorParams({ q: "a" }).q).toBeNull();
    expect(parseSorParams({ q: ["KVKK uyumu", "ikinci"] }).q).toBe("KVKK uyumu");
    expect(parseSorParams({ q: "x".repeat(500) }).q).toHaveLength(300);
  });

  it("from yalnız güvenli yol ise bağlam olur; değilse /sor", () => {
    expect(parseSorParams({ from: "/fiyatlar" }).from).toBe("/fiyatlar");
    expect(parseSorParams({ from: "//kotu.example" }).from).toBe("/sor");
    expect(parseSorParams({ from: "https://kotu.example/x" }).from).toBe("/sor");
    expect(parseSorParams({}).from).toBe("/sor");
  });

  it("sorgu dizesi yoksa hasQuery false (yalın /sor indekslenir)", () => {
    expect(parseSorParams({}).hasQuery).toBe(false);
    expect(parseSorParams({ from: "/" }).hasQuery).toBe(true);
  });
});
