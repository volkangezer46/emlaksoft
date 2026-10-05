import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const cronRoot = join(root, "src", "app", "api", "cron");
const jobs = readdirSync(cronRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(cronRoot, e.name, "route.ts")))
  .map((e) => e.name);
const read = (job: string) => readFileSync(join(cronRoot, job, "route.ts"), "utf8");

describe("cron yetki kapısı sözleşmesi", () => {
  it("ortak yardımcı timingSafeEqual + 503 kullanır", () => {
    const src = readFileSync(join(root, "src/lib/cron-auth.ts"), "utf8");
    expect(src).toContain("timingSafeEqual");
    expect(src).toContain("status: 503");
    expect(src).toContain("process.env.CRON_SECRET");
  });

  for (const job of jobs) {
    it(`${job}: authorizeCron ile yetkilendirir, kopya authorized() yok, heartbeat iş adı literal`, () => {
      const src = read(job);
      expect(src).toMatch(/import \{ authorizeCron \} from "@\/lib\/cron-auth"/);
      expect(src).toMatch(/authorizeCron\(\s*\w+\s*\)/);
      expect(src).not.toMatch(/function authorized\(/);
      expect(src).not.toContain("Bearer ${secret}");
      expect(src).toMatch(new RegExp(`recordHeartbeat\\(\\s*["']${job}["']`));
    });
  }

  it("tenant döngülü ve toplu cron'larda maxDuration tanımlı", () => {
    for (const job of [
      "bolge-snapshot",
      "lig-snapshot",
      "portal-teyit",
      "leak-sla",
      "randevu-hatirlat",
      "gunluk-ozet",
      "haftalik-ozet",
      "otomasyon",
    ]) {
      expect(read(job), job).toMatch(/export const maxDuration = \d+;/);
    }
  });

  it("tenant döngülü cron'lar sıralı sayfalama kullanır (sırasız .limit(500) yok) ve kısmi hatada 'error' yazar", () => {
    for (const job of ["gunluk-ozet", "haftalik-ozet", "bolge-snapshot", "lig-snapshot"]) {
      const src = read(job);
      expect(src, job).toContain("fetchAllPaged");
      expect(src, job).toContain('.order("id", { ascending: true })');
      expect(src, job).not.toMatch(/\.in\("status", \["active", "trial", "past_due"\]\)\s*\.limit\(/);
      expect(src, job).toContain("heartbeatFor");
    }
  });

  it("R4: portal-teyit 24 saat dedupe + leak-sla bildirim hatası kontrolü ve sıra", () => {
    const portal = read("portal-teyit");
    expect(portal).toContain("findRecentKeysByPrefix");
    const leak = read("leak-sla");
    expect(leak.indexOf("insertNotificationsDetailed(")).toBeGreaterThan(-1);
    expect(leak.indexOf("insertNotificationsDetailed(")).toBeLessThan(leak.lastIndexOf("sla_warning_sent_at"));
    expect(leak).toContain("ins.failed > 0");
  });

  it("R7: hatırlatma cron'ları saat dilimli TR biçimleyici kullanır", () => {
    for (const job of ["gorev-hatirlat", "randevu-hatirlat"]) {
      const src = read(job);
      expect(src, job).toContain("formatDateTimeTr");
      expect(src, job).not.toContain("toLocaleString");
    }
  });

  it("migration: dedupe_key kolonu + kısmi benzersiz indeks + rollback", () => {
    const m = readFileSync(join(root, "supabase/migrations/20260826001500_notifications_dedupe_key.sql"), "utf8");
    expect(m).toContain("add column if not exists dedupe_key text");
    expect(m).toMatch(/create unique index if not exists[\s\S]*\(tenant_id, dedupe_key\)[\s\S]*where dedupe_key is not null/);
    const r = readFileSync(join(root, "supabase/rollbacks/20260826001500_notifications_dedupe_key.rollback.sql"), "utf8");
    expect(r).toContain("drop column if exists dedupe_key");
  });
});
