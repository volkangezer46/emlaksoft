import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { scanAdminClientUsage, type AdminUsage } from "../../scripts/audit-admin-client";
import { ADMIN_CLIENT_ALLOWLIST } from "./admin-client-allowlist";

/**
 * createAdminClient (service_role) kabul listesi sözleşmesi.
 *
 * Amaç: RLS'i atlayan istemcinin YENİ bir yerde sessizce kullanılmasını ve
 * tenant filtresiz kullanımların artmasını engellemek. Bu test tenant filtresinin
 * doğruluğunu kanıtlamaz (heuristik); yalnız "bilinmeyen/artan" riski yakalar.
 *
 * Liste güncelleme: npx tsx scripts/audit-admin-client.ts --write
 * (önce docs/security/ADMIN_CLIENT_INVENTORY.md'de yeni kullanımı incele.)
 */
const UNFILTERED = new Set(["yok", "devir"]);
const key = (u: { file: string; fn: string }) => `${u.file}::${u.fn}`;

describe("createAdminClient kabul listesi", () => {
  const usages: AdminUsage[] = scanAdminClientUsage(process.cwd());
  const allowed = new Map(ADMIN_CLIENT_ALLOWLIST.map((e) => [key(e), e]));

  it("kabul listesinde tekrar eden anahtar yok", () => {
    expect(allowed.size).toBe(ADMIN_CLIENT_ALLOWLIST.length);
  });

  it("listede olmayan YENİ bir createAdminClient kullanımı yok", () => {
    const fresh = usages.filter((u) => !allowed.has(key(u))).map((u) => `${u.file}:${u.line} ${u.fn}`);
    expect(
      fresh,
      "Yeni createAdminClient kullanımı: önce RLS'li createClient ile çözülemez mi bak; gerekiyorsa " +
        "tenant filtresi + kapı ekle, docs/security/ADMIN_CLIENT_INVENTORY.md'yi incele ve " +
        "`npx tsx scripts/audit-admin-client.ts --write` ile listeyi yenile.",
    ).toEqual([]);
  });

  it("listede olup kodda artık bulunmayan (bayat) kayıt yok", () => {
    const current = new Set(usages.map(key));
    const stale = ADMIN_CLIENT_ALLOWLIST.filter((e) => !current.has(key(e))).map(key);
    expect(stale, "Kullanım kaldırıldı/yeniden adlandırıldı: listeyi yeniden üretin.").toEqual([]);
  });

  it("bir işlevdeki createAdminClient çağrı sayısı artmadı", () => {
    const grown = usages
      .filter((u) => (allowed.get(key(u))?.calls ?? Infinity) < u.calls)
      .map((u) => `${key(u)} (${allowed.get(key(u))?.calls} -> ${u.calls})`);
    expect(grown).toEqual([]);
  });

  it("tenant filtresiz (yok/devir) kullanım listede işaretlenenden fazla değil", () => {
    const regressed = usages
      .filter((u) => UNFILTERED.has(u.tenantFilter))
      .filter((u) => {
        const a = allowed.get(key(u));
        return a !== undefined && !UNFILTERED.has(a.tenantFilter);
      })
      .map((u) => `${u.file}:${u.line} ${u.fn}`);
    expect(regressed, "Daha önce tenant filtreli olan işlev filtresiz hale geldi.").toEqual([]);

    const currentUnfiltered = usages.filter((u) => UNFILTERED.has(u.tenantFilter)).length;
    const allowedUnfiltered = ADMIN_CLIENT_ALLOWLIST.filter((e) => UNFILTERED.has(e.tenantFilter)).length;
    expect(currentUnfiltered).toBeLessThanOrEqual(allowedUnfiltered);
  });

  it("service_role anahtarı createAdminClient dışında (kabul listesi dışı) okunmuyor", () => {
    // createAdminClient'ı baypas eden ikinci bir istemci kurulumu denetimsiz kalmasın.
    const KNOWN = new Set([
      "src/lib/supabase/admin.ts",
      "src/lib/deployment-env.ts", // yalnız ortam doğrulaması
    ]);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const rel = relative(process.cwd(), p).split("\\").join("/");
          if (KNOWN.has(rel)) continue;
          if (/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/.test(readFileSync(p, "utf8"))) offenders.push(rel);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
