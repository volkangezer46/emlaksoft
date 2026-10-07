import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Danışman listesi TEK bileşen + TEK kaynak: Ofis Merkezi > Danışmanlar ve Ekip Merkezi > Genel aynı tabloyu çizer. */
describe("tek danışman listesi", () => {
  const office = readFileSync("src/app/app/ofis-merkezi/_tabs/advisors-tab.tsx", "utf8");
  const team = readFileSync("src/app/app/ekip/page.tsx", "utf8");
  it("iki ekran AdvisorTable + loadOfficeAdvisors kullanır", () => {
    for (const src of [office, team]) {
      expect(src).toContain("<AdvisorTable");
      expect(src).toContain("loadOfficeAdvisors(");
    }
  });
  it("Ekip sayfasında ikinci bir üye satırı/rol formu kopyası yok", () => {
    expect(team).not.toContain("setMemberRole");
    expect(team).not.toMatch(/members\.map\(\(m\) => \{\s*const meta = roleMeta/);
    expect(readFileSync("src/app/actions/team.ts", "utf8")).not.toContain("export async function setMemberRole(");
  });
});
