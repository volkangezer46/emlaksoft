import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseMock, hasFilter } from "../../test/supabase-mock";
import { LAST_CONTACT_CHUNK, isContactStale, laterOf, loadLastContactSince } from "./last-contact";

const CUTOFF = "2026-09-27T00:00:00.000Z";
const NOW = "2026-10-11T00:00:00.000Z";

describe("isContactStale (saf eşik)", () => {
  it("temas yoksa bayat", () => {
    expect(isContactStale(null, CUTOFF)).toBe(true);
    expect(isContactStale(undefined, CUTOFF)).toBe(true);
  });
  it("eşikten eski bayat, eşit/yeni değil", () => {
    expect(isContactStale("2026-09-26T23:59:59.000Z", CUTOFF)).toBe(true);
    expect(isContactStale(CUTOFF, CUTOFF)).toBe(false);
    expect(isContactStale("2026-10-01T10:00:00.000Z", CUTOFF)).toBe(false);
  });
  it("geçersiz tarih temas sayılmaz (güvenli taraf: bayat)", () => {
    expect(isContactStale("bozuk", CUTOFF)).toBe(true);
  });
});

describe("laterOf", () => {
  it("yeni olanı seçer, null güvenli", () => {
    expect(laterOf("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z")).toBe("2026-10-02T00:00:00Z");
    expect(laterOf(null, "2026-10-02T00:00:00Z")).toBe("2026-10-02T00:00:00Z");
    expect(laterOf("2026-10-02T00:00:00Z", undefined)).toBe("2026-10-02T00:00:00Z");
    expect(laterOf(null, null)).toBeNull();
  });
});

describe("loadLastContactSince", () => {
  it("üç kaynağı (iletişim, arama, randevu) okur; en yeni temas kazanır; kiracı süzgeci vardır", async () => {
    const mock = createSupabaseMock((q) => {
      if (q.table === "communications") return { data: [{ customer_id: "A", ts: "2026-10-01T00:00:00Z" }] };
      if (q.table === "calls") return { data: [{ customer_id: "A", ts: "2026-10-05T00:00:00Z" }, { customer_id: "B", ts: "2026-10-03T00:00:00Z" }] };
      if (q.table === "appointments") return { data: [{ customer_id: "C", ts: "2026-10-02T00:00:00Z" }] };
      return undefined;
    });
    const map = await loadLastContactSince(mock.client as unknown as SupabaseClient, "t1", ["A", "B", "C", "D"], CUTOFF, NOW);
    expect(map.get("a")).toBe("2026-10-05T00:00:00Z");
    expect(map.get("b")).toBe("2026-10-03T00:00:00Z");
    expect(map.get("c")).toBe("2026-10-02T00:00:00Z");
    expect(map.has("d")).toBe(false);
    expect(mock.queries.map((q) => q.table).sort()).toEqual(["appointments", "calls", "communications"]);
    for (const q of mock.queries) expect(hasFilter(q, "eq", "tenant_id", "t1"), q.table).toBe(true);
    // İptal edilmiş randevu temas sayılmaz.
    expect(hasFilter(mock.forTable("appointments")[0], "neq", "status", "cancelled")).toBe(true);
  });

  it("kimlikler LAST_CONTACT_CHUNK'lık parçalarla okunur (parça başına 3 sorgu)", async () => {
    const ids = Array.from({ length: LAST_CONTACT_CHUNK * 2 + 1 }, (_, i) => `id${i}`);
    const mock = createSupabaseMock();
    await loadLastContactSince(mock.client as unknown as SupabaseClient, "t1", ids, CUTOFF, NOW);
    expect(mock.queries).toHaveLength(3 * 3);
    const sizes = mock.forTable("calls").map((q) => (q.filters.find((f) => f.method === "in")?.args[1] as string[]).length);
    expect(sizes).toEqual([LAST_CONTACT_CHUNK, LAST_CONTACT_CHUNK, 1]);
  });

  it("okuma hatası fırlatılır (çağıran tetiği atlar; sessizce 'temas yok' denmez)", async () => {
    const mock = createSupabaseMock((q) => (q.table === "calls" ? { error: { message: "boom" } } : undefined));
    await expect(loadLastContactSince(mock.client as unknown as SupabaseClient, "t1", ["A"], CUTOFF, NOW)).rejects.toThrow(/last_contact calls/);
  });
});

/**
 * KALICI SÖZLEŞME: "son temas" tanımı tek yerde (src/lib/contact/last-contact.ts). Otomasyon motorunun
 * no_contact_days dalı communications'ı doğrudan okuyup arama/randevuyu yok sayan eski davranışa dönemez.
 */
describe("son temas sözleşmesi", () => {
  const ROOT = join(process.cwd(), "src", "lib");
  function files(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) files(full, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("automation-engine no_contact_days dalı communications okumaz, yardımcıyı kullanır", () => {
    const src = readFileSync(join(ROOT, "automation-engine.ts"), "utf8");
    const start = src.indexOf('case "no_contact_days": {');
    const end = src.indexOf('case "appointment_missed"', start);
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, end);
    expect(block).not.toMatch(/communications/);
    expect(block).toMatch(/loadLastContactSince\(/);
    expect(block).toMatch(/isContactStale\(/);
  });

  it("src/lib'de 'no_contact' geçen hiçbir dosya yalnız communications tablosundan okumaz", () => {
    const offenders = files(ROOT)
      .filter((f) => {
        const t = readFileSync(f, "utf8");
        return /no_contact/.test(t) && /from\(\s*["']communications["']\s*\)\s*\.select/.test(t.replace(/\s+/g, " "));
      })
      .map((f) => f.slice(process.cwd().length + 1));
    expect(offenders, `Son temas için src/lib/contact/last-contact.ts kullanın:\n${offenders.join("\n")}`).toEqual([]);
  });
});
