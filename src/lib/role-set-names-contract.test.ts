import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVAL_DECIDER_ROLES } from "@/lib/approvals";
import { APPROVAL_EXEMPT_ROLES, MANAGER_ROLES } from "@/lib/team/assignable-roles";

/**
 * Rol kümesi adları: AYNI adla iki farklı rol kümesi export edilemez (denetim: approvals.ts MANAGER_ROLES
 * assignable-roles.ts MANAGER_ROLES ile çakışıyordu). Rol kümeleri `team/assignable-roles.ts`'te tanımlanır;
 * onay karar yetkisi `APPROVAL_DECIDER_ROLES`, onay muafiyeti `APPROVAL_EXEMPT_ROLES` adıyla ayrıdır.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("rol kümesi export adları tekil", () => {
  it("*_ROLES sabiti src altında yalnız bir dosyada export edilir", () => {
    const owners = new Map<string, string[]>();
    for (const f of walk(join(process.cwd(), "src"))) {
      const rel = relative(process.cwd(), f).replace(/\\/g, "/");
      for (const m of readFileSync(f, "utf8").matchAll(/^export const ([A-Z][A-Z_]*_ROLES)\b/gm)) {
        owners.set(m[1]!, [...(owners.get(m[1]!) ?? []), rel]);
      }
    }
    const dups = [...owners.entries()].filter(([, files]) => files.length > 1);
    expect(dups, `Aynı adla birden çok rol kümesi: ${JSON.stringify(dups)}`).toEqual([]);
  });

  it("onay karar yetkisi, muafiyet ve ofis yöneticileri ayrı ve beklenen değerde", () => {
    expect([...MANAGER_ROLES]).toEqual(["owner", "gm", "branch_manager"]);
    expect([...APPROVAL_DECIDER_ROLES]).toEqual(["owner", "gm", "branch_manager", "team_lead"]);
    expect([...APPROVAL_EXEMPT_ROLES]).toEqual(["owner", "gm"]);
  });
});
