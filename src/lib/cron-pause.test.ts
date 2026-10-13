import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ paused: false as boolean, error: null as { code: string } | null, calls: 0 }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("cron_job_state");
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              h.calls += 1;
              return { data: h.error ? null : { paused: h.paused }, error: h.error };
            },
          }),
        }),
      };
    },
  }),
}));

import { beginCronRun, CRON_TRIGGER_HEADER, takeCronRunStart } from "./cron-pause";

const req = (manual = false) => new Request("http://x/api/cron/y", { headers: manual ? { [CRON_TRIGGER_HEADER]: "manual" } : {} });

describe("cron duraklatma", () => {
  beforeEach(() => {
    h.paused = false;
    h.error = null;
    h.calls = 0;
  });

  it("duraklatılmamış iş çalışır, başlangıç not edilir", async () => {
    expect(await beginCronRun("dunning", req())).toBeNull();
    const s = takeCronRunStart("dunning", Date.now());
    expect(s?.trigger).toBe("schedule");
    expect(typeof s?.at).toBe("number");
    expect(takeCronRunStart("dunning", Date.now())).toBeNull();
  });

  it("duraklatılan iş zamanlanmış çağrıda erken döner (200 + skipped)", async () => {
    h.paused = true;
    const res = await beginCronRun("dunning", req());
    expect(res?.status).toBe(200);
    expect(await res?.json()).toMatchObject({ ok: true, skipped: "paused", job: "dunning" });
    expect(takeCronRunStart("dunning", Date.now())).toBeNull();
  });

  it("Şimdi çalıştır (elle başlık) duraklatmayı aşar ve DB'ye sormaz", async () => {
    h.paused = true;
    expect(await beginCronRun("dunning", req(true))).toBeNull();
    expect(h.calls).toBe(0);
    expect(takeCronRunStart("dunning", Date.now())?.trigger).toBe("manual");
  });

  it("durum okunamazsa iş çalışır (güvenli varsayılan)", async () => {
    h.error = { code: "42P01" };
    expect(await beginCronRun("dunning", req())).toBeNull();
  });

  it("her cron route'u yetki kapısından hemen sonra beginCronRun çağırır (iş adı = klasör)", () => {
    const dir = join(process.cwd(), "src/app/api/cron");
    const jobs = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    expect(jobs.length).toBeGreaterThanOrEqual(40);
    for (const job of jobs) {
      const src = readFileSync(join(dir, job, "route.ts"), "utf8");
      expect(src, job).toMatch(new RegExp(`if \\(denied\\) return denied;\\n[\\s\\S]{0,400}const pausedRun = await beginCronRun\\("${job}", \\w+\\);\\n\\s*if \\(pausedRun\\) return pausedRun;`));
    }
  });
});
