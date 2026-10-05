import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Liste sayfası sorgu-hatası sözleşmesi (R1).
 *
 * Supabase sorgu hatalarını DEĞER olarak döndürür. Sayfa `{ data }` ile yalnız veriyi
 * alırsa hata sessizce "kayıt yok" ekranına dönüşür (kullanıcı veri kaybı sanır). Bu yüzden
 * `.range(` ile sayfalayan ve `Promise.all` ile sorgu grubu çalıştıran her /app liste sayfası
 * sonuçları `assertQueryBatchSucceeded` (src/lib/supabase/query-batch.ts) ya da `batchAll`
 * ile doğrulamalıdır: hata error.tsx sınırına düşer ve oradan reportClientError ile kaydedilir.
 */
const ROOT = process.cwd();
const APP_DIR = join(ROOT, "src", "app", "app");

/** R1 kapsamında düzeltilen sayfalar: koruma kaybolursa test kırılır. */
const REQUIRED = [
  "src/app/app/musteriler/data.ts",
  "src/app/app/anlasmalar/page.tsx",
  "src/app/app/randevular/page.tsx",
  "src/app/app/teklifler/page.tsx",
  "src/app/app/sozlesmeler/page.tsx",
  "src/app/app/portfoyler/page.tsx",
  "src/app/app/portallar/page.tsx",
  "src/app/app/gorevler/page.tsx",
  "src/app/app/kiralama/page.tsx",
  "src/app/app/belgeler/page.tsx",
  "src/app/app/talepler/demands-view.tsx",
];

/**
 * Henüz düzeltilmemiş bilinen borç (R1 ikinci dalga). Yeni sayfa BURAYA EKLENMEZ: korumayı uygulayın.
 * Bir sayfa düzeltilince buradan silinir.
 */
const KNOWN_DEBT = new Set([
  "src/app/app/aidat/page.tsx",
  "src/app/app/arama/calls-view.tsx",
  "src/app/app/belgeler/evrak-linkleri/page.tsx",
  "src/app/app/bildirimler/notifications-view.tsx",
  "src/app/app/denetim/page.tsx",
  "src/app/app/destek/page.tsx",
  "src/app/app/gelen-kutusu/inbox-view.tsx",
  "src/app/app/kayip-kacak/page.tsx",
  "src/app/app/komisyon/page.tsx",
  "src/app/app/onaylar/page.tsx",
  "src/app/app/portfoyler/anahtarlar/page.tsx",
  "src/app/app/tavsiyeler/page.tsx",
  "src/app/app/uyum/kayit-defteri/page.tsx",
]);

const GUARD = /assertQueryBatchSucceeded|batchAll/;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/(^page|-view|^data)\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => file.slice(ROOT.length + 1).split("\\").join("/");

describe("liste sayfaları sorgu hatasını yutmaz", () => {
  it("range + Promise.all kullanan /app sayfaları sonuçları doğrular", () => {
    const offenders: string[] = [];
    for (const file of files(APP_DIR)) {
      const path = rel(file);
      if (KNOWN_DEBT.has(path)) continue;
      const text = readFileSync(file, "utf8");
      if (/\.range\(/.test(text) && /Promise\.all\(/.test(text) && !GUARD.test(text)) offenders.push(path);
    }
    expect(
      offenders,
      `Sorgu hatası "kayıt yok"a dönüşür; assertQueryBatchSucceeded/batchAll kullanın:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("R1 kapsamındaki sayfalar korumayı taşır", () => {
    const missing = REQUIRED.filter((path) => !GUARD.test(readFileSync(join(ROOT, path), "utf8")));
    expect(missing, `Koruma kaldırılmış:\n${missing.join("\n")}`).toEqual([]);
  });

  it("batchAll/assertQueryBatchSucceeded yardımcıları hatayı fırlatır", async () => {
    const { batchAll, assertQueryBatchSucceeded } = await import("@/lib/supabase/query-batch");
    await expect(
      batchAll("Test", ["ok", "bad"], [Promise.resolve({ data: [], error: null }), Promise.resolve({ data: null, error: { code: "42P01" } })]),
    ).rejects.toThrow(/bad:42P01/);
    await expect(batchAll("Test", ["ok", "plain"], [Promise.resolve({ data: [] }), Promise.resolve(["x"])])).resolves.toHaveLength(2);
    expect(() => assertQueryBatchSucceeded([{ error: { code: "X1" } }], ["q"], "Test")).toThrow(/q:X1/);
  });
});
