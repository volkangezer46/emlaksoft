import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PostgREST gömme (embed) sözleşmesi.
 *
 * `properties` ve `customers` tablolarına giden çoğu tablonun iki FK'sı vardır:
 * basit (`*_property_id_fkey`) ve ofis kapsamlı birleşik (`*_property_tenant_fkey`).
 * İpucusuz `alias:properties(...)` PostgREST'te PGRST201 (belirsiz ilişki) verir;
 * sayfa hatayı yutup LİSTEYİ BOŞ gösterir (özet kartlar dolu, liste boş).
 * Bu yüzden gömme her zaman FK adıyla yazılır: `alias:properties!<fk_adi>(...)`.
 */
const ROOT = join(process.cwd(), "src");

/** FK sayısı 1 olduğu doğrulanmış tablolar (belirsizlik yok). */
const ALLOW = new Set(["src/app/actions/network.ts"]);

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("PostgREST gömmeleri FK ipucu taşır", () => {
  it("alias:properties( / alias:customers( ipucusuz kullanılmaz", () => {
    const offenders: string[] = [];
    for (const file of files(ROOT)) {
      const rel = file.slice(process.cwd().length + 1).split("\\").join("/");
      if (ALLOW.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/:(properties|customers|customer_demands)\(/.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders, `İpucusuz gömme (alias:tablo!fk_adi( biçimine çevirin):\n${offenders.join("\n")}`).toEqual([]);
  });
});
