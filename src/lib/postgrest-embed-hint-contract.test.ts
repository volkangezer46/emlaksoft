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

  // profiles↔tenants arasında user_scopes gibi (tenant_id, user_id) tekil tablolar ikinci ilişki yolu açar; ipucusuz
  // `tenants(...)` PGRST201 verir. Bu, 2026-10-07'de istek kimlik okumasını ve tüm action yetki kapısını düşürmüştü.
  it("profiles sorgusunda tenants gömmesi profiles_tenant_id_fkey ipucu taşır", () => {
    const offenders: string[] = [];
    for (const file of files(ROOT)) {
      const rel = file.slice(process.cwd().length + 1).split("\\").join("/");
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/from\("profiles"\)/.test(line)) return;
        const window = lines.slice(i, i + 4).join("\n");
        if (/\btenants\((?!.*!)/.test(window) || /:tenants\(/.test(window)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    const identity = readFileSync(join(ROOT, "lib/cache/request.ts"), "utf8");
    expect(identity).toContain("tenants!profiles_tenant_id_fkey(");
    expect(offenders, `profiles → tenants gömmesine !profiles_tenant_id_fkey ekleyin:\n${offenders.join("\n")}`).toEqual([]);
  });
});
