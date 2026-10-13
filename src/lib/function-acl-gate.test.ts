import { beforeAll, describe, expect, it } from "vitest";

// scripts/ tsconfig kapsamı dışında (tsx ile koşar: pg tipleri, .ts uzantılı içe aktarma); statik import tsc'yi
// oraya çeker. Yol değişkenle verilir ki modül yalnız vitest'te yüklensin.
type GateModule = {
  parseAcl: (acl: string) => Map<string, string>;
  aclRoleDiff: (target: string, shadow: string) => string[];
};
type AllowlistModule = { ANON_FUNCTION_ALLOWLIST: Record<string, { reason: string; note: string }> };
let parseAcl: GateModule["parseAcl"];
let aclRoleDiff: GateModule["aclRoleDiff"];
let ANON_FUNCTION_ALLOWLIST: AllowlistModule["ANON_FUNCTION_ALLOWLIST"];

beforeAll(async () => {
  const gatePath = "../../scripts/check-function-acl.ts";
  const listPath = "../../scripts/function-acl-allowlist.ts";
  const gate = (await import(/* @vite-ignore */ gatePath)) as GateModule;
  const list = (await import(/* @vite-ignore */ listPath)) as AllowlistModule;
  parseAcl = gate.parseAcl;
  aclRoleDiff = gate.aclRoleDiff;
  ANON_FUNCTION_ALLOWLIST = list.ANON_FUNCTION_ALLOWLIST;
});

// scripts/check-function-acl.ts saf yardımcıları: aclitem[] ayrıştırma ve anon/authenticated/PUBLIC farkı.
describe("ACL kapısı yardımcıları", () => {
  it("aclitem[] metnini rol → hak harflerine çevirir (PUBLIC = boş ad, grant option atılır)", () => {
    const m = parseAcl("{postgres=X*/postgres,anon=X/postgres,=X/postgres,\"Ozel Rol\"=r/postgres}");
    expect(m.get("postgres")).toBe("X");
    expect(m.get("anon")).toBe("X");
    expect(m.get("")).toBe("X");
    expect(m.get("Ozel Rol")).toBe("r");
    expect(parseAcl("{}").size).toBe(0);
  });

  it("yalnız anon/authenticated/PUBLIC farkını raporlar; service_role/postgres farkı yok sayılır", () => {
    const shadow = "{postgres=X/postgres,service_role=X/postgres}";
    expect(aclRoleDiff("{postgres=X/postgres,service_role=X/postgres}", shadow)).toEqual([]);
    expect(aclRoleDiff("{postgres=X/postgres}", shadow)).toEqual([]);
    const diff = aclRoleDiff("{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}", shadow);
    expect(diff).toHaveLength(2);
    expect(diff[0]).toMatch(/^anon:/);
    expect(aclRoleDiff("{=X/postgres}", shadow)[0]).toMatch(/^PUBLIC:/);
  });

  it("tablo hak harfleri sırasız karşılaştırılır", () => {
    expect(aclRoleDiff("{authenticated=rawd/postgres}", "{authenticated=adrw/postgres}")).toEqual([]);
    expect(aclRoleDiff("{authenticated=r/postgres}", "{authenticated=arwd/postgres}")).toHaveLength(1);
  });

  it("kabul listesi anahtarları şema önekli regprocedure metnidir ve gerekçelidir", () => {
    for (const [sig, v] of Object.entries(ANON_FUNCTION_ALLOWLIST)) {
      expect(sig).toMatch(/^public\.[a-z0-9_]+\(.*\)$/);
      expect(v.note.length).toBeGreaterThan(3);
    }
    // Zincirin anon'dan kapattığı RPC'ler listeye giremez (BUG-1/GUV-1).
    for (const kapali of ["merge_customers", "write_setting", "insight_quiet_valuable_customers", "increment_listing_view"]) {
      expect(Object.keys(ANON_FUNCTION_ALLOWLIST).some((k) => k.startsWith(`public.${kapali}(`))).toBe(false);
    }
  });
});
