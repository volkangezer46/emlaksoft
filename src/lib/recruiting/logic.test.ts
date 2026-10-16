import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORIENTATION,
  RECRUIT_SOURCES,
  RECRUIT_STAGES,
  addDaysKey,
  isOrientationItemDone,
  orientationDueIso,
  orientationProgress,
  parseExperience,
  parseStageFilter,
  parseTemplateRows,
  sanitizeSearch,
} from "./logic";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const MIGRATION = "supabase/migrations/20261020050005_recruiting_onboarding.sql";

describe("OA9 işe alım mantığı", () => {
  it("aşama ve kaynak listesi DB CHECK ile aynı", () => {
    const sql = read(MIGRATION);
    expect(sql).toContain(`check (stage in (${RECRUIT_STAGES.map((s) => `'${s}'`).join(", ")}))`);
    expect(sql).toContain(`check (source in (${RECRUIT_SOURCES.map((s) => `'${s}'`).join(", ")}))`);
  });

  it("URL süzgeci yalnız bilinen aşamayı kabul eder", () => {
    expect(parseStageFilter("gorusme")).toBe("gorusme");
    expect(parseStageFilter(["teklif"])).toBe("teklif");
    expect(parseStageFilter("x")).toBeNull();
    expect(parseStageFilter(undefined)).toBeNull();
  });

  it("arama terimi PostgREST or() sözdizimini bozamaz", () => {
    expect(sanitizeSearch("ali,(veli)%*")).toBe("ali veli");
    expect(sanitizeSearch("a".repeat(100))).toHaveLength(60);
  });

  it("deneyim yılı 0-60 tam sayı", () => {
    expect(parseExperience("0")).toBe(0);
    expect(parseExperience("12")).toBe(12);
    expect(parseExperience("61")).toBeNull();
    expect(parseExperience("-1")).toBeNull();
    expect(parseExperience("")).toBeNull();
  });
});

describe("OA9 oryantasyon", () => {
  it("varsayılan şablon dolu ve gün sırası artan", () => {
    expect(DEFAULT_ORIENTATION.length).toBeGreaterThanOrEqual(5);
    const days = DEFAULT_ORIENTATION.map((d) => d.offsetDays);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  it("şablon satırı: boş başlık atılır, gün 0-180'e sıkışır", () => {
    const rows = parseTemplateRows(["A", "  ", "B"], ["açıklama", "", ""], ["5", "3", "999"]);
    expect(rows).toEqual([
      { title: "A", description: "açıklama", offsetDays: 5 },
      { title: "B", description: null, offsetDays: 180 },
    ]);
  });

  it("termin günü ve görev saati Türkiye saatiyle", () => {
    expect(addDaysKey("2026-10-30", 3)).toBe("2026-11-02");
    expect(orientationDueIso("2026-11-02")).toBe("2026-11-02T07:00:00.000Z");
  });

  it("ilerleme: elle işaret ya da bağlı görevin tamamlanması sayılır; geciken açık adım", () => {
    const items = [
      { done_at: "2026-10-01T00:00:00Z", due_on: "2026-10-01" },
      { done_at: null, due_on: "2026-10-02", task_status: "done" },
      { done_at: null, due_on: "2026-10-03", task_status: "open" },
      { done_at: null, due_on: "2026-12-01" },
    ];
    expect(isOrientationItemDone(items[1]!)).toBe(true);
    expect(orientationProgress(items, "2026-10-15")).toEqual({ total: 4, done: 2, overdue: 1, percent: 50 });
    expect(orientationProgress([], "2026-10-15").percent).toBe(0);
  });
});

describe("OA9 güvenlik sözleşmesi", () => {
  it("public RPC'ler DEFINER + boş search_path; temizlik yalnız service_role", () => {
    const sql = read(MIGRATION);
    for (const fn of ["recruit_public_form", "recruit_public_apply", "recruit_purge_expired"]) {
      const start = sql.indexOf(`create or replace function public.${fn}`);
      expect(start).toBeGreaterThan(0);
      const body = sql.slice(start, start + 600);
      expect(body).toContain("security definer");
      expect(body).toContain("set search_path = ''");
    }
    expect(sql).toContain("t.status in ('trial', 'active', 'past_due')");
    expect(sql).toMatch(/revoke all on function public\.recruit_purge_expired\(\) from public, anon, authenticated;/);
    expect(sql).not.toMatch(/^notify pgrst/m);
  });

  it("public eylem telefonu sıkı doğrular ve RPC dışında yazmaz", () => {
    const src = read("src/app/actions/recruiting-public.ts");
    expect(src).toContain("parsePhoneStrict");
    expect(src).toContain("checkRateLimit");
    expect(src).toContain('"recruit_public_apply"');
    expect(src).not.toContain("createAdminClient");
    expect(src).not.toMatch(/\.from\(/);
  });
});
