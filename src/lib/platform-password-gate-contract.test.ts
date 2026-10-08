import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

function walk(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    return e.isDirectory() ? walk(rel) : [rel];
  });
}

/**
 * Zorunlu parola değişimi (must_change_password) SUNUCUDA kapılıdır: parolası değişmemiş personelin
 * kimliği `getPlatformStaff` / `getPlatformStaffIdentity` / `requirePlatform*` içinde null döner;
 * yalnız parola ekranı ve kendi hesabı action'ları kısıtsız kimliği kullanabilir.
 */
describe("zorunlu parola değişimi kapısı", () => {
  const platform = read("src/lib/platform.ts");

  it("kimlik kapıları bayrağı kontrol eder", () => {
    expect(platform).toContain("export function mustChangePassword");
    expect(platform).toMatch(/getPlatformStaffIdentity = cache\(async[\s\S]*?mustChangePassword\(await getRequestUser\(\)\)/);
    expect(platform).toMatch(/getPlatformStaff = cache\(async[\s\S]*?getPlatformStaffIdentity\(\)/);
  });

  it("kısıtsız kimliği yalnız izinli dosyalar kullanır", () => {
    const allowed = new Set([
      "src/lib/platform.ts",
      "src/app/actions/platform-account.ts",
      "src/lib/platform-password-gate-contract.test.ts",
    ]);
    const users = walk("src")
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => /getPlatformStaffUnrestricted|requirePlatformStaffForAccount/.test(read(f)))
      .filter((f) => !allowed.has(f))
      .sort();
    expect(users).toEqual(["src/app/admin/hesabim/page.tsx", "src/app/admin/layout.tsx"]);
  });

  it("/api/admin rotaları kısıtlı kapıyı kullanır", () => {
    for (const f of walk("src/app/api/admin").filter((x) => x.endsWith("route.ts"))) {
      const src = read(f);
      expect(src, f).not.toMatch(/getPlatformStaffUnrestricted|requirePlatformStaffForAccount/);
      expect(/getPlatformStaff\(|requirePlatform(Staff|Module)\(/.test(src), `${f}: kapı yok`).toBe(true);
    }
  });

  it("admin action'ları ortak kapıdan geçer", () => {
    const files = ["platform-members", "platform-cron", "platform-messaging-keys", "error-logs", "platform-staff"];
    for (const name of files) {
      const src = read(`src/app/actions/${name}.ts`);
      expect(/guardPlatformAction\(|requirePlatformModule\(|requirePlatformStaff\(/.test(src), name).toBe(true);
    }
    const guard = read("src/lib/platform-guards.ts");
    expect(guard).toContain("requirePlatformStaff()");
  });

  it("kendi hesabı action'ları yalnız oturumdaki kullanıcıyı hedefler", () => {
    const src = read("src/app/actions/platform-account.ts");
    expect(src).not.toMatch(/formData?\.get\("id"\)|fd\.get\("id"\)/);
  });
});
