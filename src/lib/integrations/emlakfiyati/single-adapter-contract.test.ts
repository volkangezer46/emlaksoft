import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sözleşme: emlakfiyati.com'a TÜM çağrılar `src/lib/integrations/emlakfiyati/` içindeki tek adaptörden geçer;
 * anahtar istemciye/loga sızmaz; denetim kaydında anahtar değeri yoktur.
 */

const root = process.cwd();
const ADAPTER_DIR = "src/lib/integrations/emlakfiyati/";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" || e.name === ".next" ? [] : walk(full);
    return /\.(?:ts|tsx)$/.test(e.name) ? [relative(root, full).split(sep).join("/")] : [];
  });
}

const read = (f: string) => readFileSync(resolve(root, f), "utf8");
const nonTest = walk(resolve(root, "src")).filter((f) => !/\.(?:test|spec)\.(?:ts|tsx)$/.test(f));

describe("EmlakFiyati tek adaptör sözleşmesi", () => {
  it("emlakfiyati.com adresi adaptör klasörü dışında hiçbir kaynakta bulunmaz", () => {
    const hits = nonTest.filter((f) => !f.startsWith(ADAPTER_DIR) && /emlakfiyati\.com/i.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("fetchExternal'ı yalnız adaptör çağırır (klasör içinde başka dosya ağa çıkmaz)", () => {
    const callers = nonTest.filter((f) => f.startsWith(ADAPTER_DIR) && /fetchExternal\(/.test(read(f)));
    expect(callers).toEqual([`${ADAPTER_DIR}adapter.ts`]);
  });

  it("Authorization başlığı yalnız policy.ts'te üretilir; x-api-key hiçbir yerde kullanılmaz", () => {
    const authFiles = nonTest.filter((f) => f.startsWith(ADAPTER_DIR) && /Authorization["']?\s*:\s*`/.test(read(f)));
    expect(authFiles).toEqual([`${ADAPTER_DIR}policy.ts`]);
    expect(nonTest.filter((f) => f.startsWith(ADAPTER_DIR) && /x-api-key/i.test(read(f)) && !f.endsWith("policy.ts"))).toEqual([]);
  });

  it("adaptör ve anahtar modülü log/hata çağrılarına anahtar koymaz; yanıt/hata nesnesinde anahtar alanı yok", () => {
    for (const f of ["adapter.ts", "keys.ts", "client.ts", "ortak.ts"]) {
      const src = read(`${ADAPTER_DIR}${f}`);
      expect(src, f).not.toMatch(/console\.\w+\([^)]*(?:apiKey|keys\.|\.current|\.previous|Bearer)/);
    }
  });

  it("istemci bileşenleri sunucu modüllerini import etmez; anahtar tarayıcı ortam değişkenine konmaz", () => {
    const panel = read("src/app/admin/sistem/emlakfiyati-panel.tsx");
    expect(panel.startsWith('"use client";')).toBe(true);
    expect(panel).not.toMatch(/integrations\/emlakfiyati\/(?:adapter|keys|admin-status|ortak|client)/);
    expect(panel).not.toMatch(/platform-secrets|process\.env/);
    expect(nonTest.filter((f) => /NEXT_PUBLIC_EMLAKFIYATI/.test(read(f)))).toEqual([]);
  });

  it("denetim kaydı yalnız 'değişti' der: anahtar değeri/maskesi action'da logPlatformActivity'ye geçmez", () => {
    const actions = read("src/app/actions/platform-emlakfiyati.ts");
    const audits = [...actions.matchAll(/logPlatformActivity\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
    expect(audits.length).toBeGreaterThanOrEqual(5);
    for (const a of audits) expect(a).not.toMatch(/value|api_key|mask|plain|fd\./);
  });

  it("her action requirePlatformModule/guardPlatformAction ile 'sistem' modülünde ve yalnız süper admin için kapılıdır", () => {
    const actions = read("src/app/actions/platform-emlakfiyati.ts");
    expect(actions).toContain('module: "sistem"');
    expect(actions).toContain('roles: ["super_admin"]');
    const fnCount = [...actions.matchAll(/export async function /g)].length;
    const gateCount = [...actions.matchAll(/await gate\(/g)].length;
    expect(gateCount).toBe(fnCount);
  });

  it("ortak uçlar için uç yolu/şeması yazılmamıştır (yalnız kapı + başlık yardımcıları)", () => {
    for (const f of nonTest.filter((x) => x.startsWith(ADAPTER_DIR))) {
      expect(read(f), f).not.toMatch(/\/api\/ortak\/v1\/(?:degerleme|rapor)/);
    }
  });
});
