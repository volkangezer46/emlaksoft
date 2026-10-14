import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * KQ5: uzmanlık / bölge kaydında değişen satırlar döngüde sıralı update yerine TEK upsert ile yazılır
 * (id çakışmasında güncelleme; anahtar alanları ve kiracı/kişi satır içinde sabit).
 */
const src = readFileSync(resolve(process.cwd(), "src/app/actions/advisor-profile.ts"), "utf8");

describe("advisor-profile: değişen satırlar tek upsert", () => {
  it("döngü içinde update kalmadı", () => {
    expect(src).not.toMatch(/for \(const u of diff\.update\)/);
    expect(src).not.toMatch(/\.update\(\{ (level|weight):/);
  });

  it("uzmanlık ve bölge güncellemeleri id çakışmalı upsert, kiracı + kişi satırda sabit", () => {
    for (const table of ["advisor_specialties", "advisor_regions"]) {
      const at = src.indexOf(`from("${table}").upsert(`);
      expect(at, `${table} upsert`).toBeGreaterThan(0);
      const block = src.slice(at, at + 900);
      expect(block).toContain('{ onConflict: "id" }');
      expect(block).toContain("tenant_id: ctx.tenantId");
      expect(block).toContain("profile_id: profileId");
      expect(block).toContain("id: u.id");
    }
  });
});
