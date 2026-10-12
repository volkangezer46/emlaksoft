import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Parametrik cron sözleşmesi: vercel.json'daki HER cron yolu için (yeni cron otomatik kapsanır)
 *  (a) CRON_SECRET yoksa 503, Bearer yoksa/yanlışsa 401 (iş hiç çalışmaz, heartbeat yazılmaz),
 *  (b) doğru Bearer ile iş çökerse (Supabase istemcisi patlar) 5xx dönmeli ve recordHeartbeat(iş, "error") yazılmalı,
 *  (c) heartbeat iş adı rota klasör adıyla aynı olmalı.
 * Statik envanter/zamanlama eşleşmesi `npm run check:cron` işidir; burada tekrar edilmez.
 */
const h = vi.hoisted(() => ({
  heartbeats: [] as { job: string; status: string; detail?: string }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cron-heartbeat", () => ({
  recordHeartbeat: async (job: string, status: string, detail?: string) => {
    h.heartbeats.push({ job, status, detail });
    return true;
  },
}));
const boom = () => {
  throw new Error("test_supabase_down");
};
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: boom }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => boom() }));

const SECRET = "test-cron-secret-value";
const vercel = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string }[] };
const jobs = vercel.crons.map((c) => c.path.replace("/api/cron/", ""));
const loaders = import.meta.glob("./*/route.ts") as Record<string, () => Promise<{ GET: (req: NextRequest) => Promise<Response> }>>;

/**
 * BİLİNEN AÇIK (ratchet): altyapı çökünce ya yakalanmamış istisna fırlatır (createAdminClient try dışında;
 * heartbeat 'error' yazılmaz) ya da hatayı yutup 200 döner. Liste yalnız KÜÇÜLEBİLİR: rota düzeltilince
 * test "artık sağlıklı, listeden çıkar" diye düşer. Yeni cron bu listeye GİREMEZ.
 */
const KNOWN_GAPS = new Set<string>([
  "gunluk-ozet",
  "randevu-hatirlat",
  "gorev-hatirlat",
  "portal-teyit",
  "abonelik-kontrol",
  "leak-sla",
  "dogum-gunu",
  "tcmb-kur",
  "otomasyon",
  "bolge-snapshot",
  "vitrin-eslesme",
  "dunning",
  "kira-tahakkuk",
  "proje-vade",
  "haftalik-ozet",
  "geo-sync",
  "lig-snapshot",
  "ef-kontor-hak",
  "ef-kontor-saglik",
  "ef-kontor-mutabakat",
]);

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/cron/x", { headers: authorization ? { authorization } : {} });
}

async function load(job: string) {
  const loader = loaders[`./${job}/route.ts`];
  expect(loader, `${job}: route.ts bulunamadı`).toBeTypeOf("function");
  return loader();
}

describe("cron rotaları: parametrik sözleşme", () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    h.heartbeats.length = 0;
    process.env.CRON_SECRET = SECRET;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  });

  it("vercel.json en az bir cron içerir ve her cron için route.ts vardır", () => {
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) expect(loaders[`./${job}/route.ts`], job).toBeTypeOf("function");
  });

  describe.each(jobs)("%s", (job) => {
    it("CRON_SECRET tanımsızsa 503, iş çalışmaz", async () => {
      delete process.env.CRON_SECRET;
      const { GET } = await load(job);
      const res = await GET(request(`Bearer ${SECRET}`));
      expect(res.status).toBe(503);
      expect(h.heartbeats).toHaveLength(0);
    });

    it("Bearer yok veya yanlışsa 401, iş çalışmaz", async () => {
      const { GET } = await load(job);
      for (const header of [undefined, "Bearer yanlis", SECRET, `Basic ${SECRET}`]) {
        const res = await GET(request(header));
        expect(res.status).toBe(401);
      }
      expect(h.heartbeats).toHaveLength(0);
    });

    it("doğru Bearer ile altyapı çökerse 5xx döner ve heartbeat 'error' yazar", { timeout: 60_000 }, async () => {
      const { GET } = await load(job);
      let status = 0;
      let threw = false;
      try {
        status = (await GET(request(`Bearer ${SECRET}`))).status;
      } catch {
        threw = true;
      }
      const mine = h.heartbeats.filter((b) => b.job === job);
      const healthy = !threw && status >= 500 && mine.length > 0 && mine.at(-1)?.status === "error";
      if (KNOWN_GAPS.has(job)) {
        expect(healthy, `${job}: artık sağlıklı; KNOWN_GAPS listesinden çıkarın`).toBe(false);
        return;
      }
      expect(threw, `${job}: yakalanmamış istisna (try/catch + recordHeartbeat error gerekir)`).toBe(false);
      expect(status, `${job}: iş çökünce 5xx beklenir`).toBeGreaterThanOrEqual(500);
      expect(mine.length, `${job}: recordHeartbeat(iş adı = klasör adı) çağrılmalı`).toBeGreaterThan(0);
      expect(mine.at(-1)?.status).toBe("error");
    });
  });
});
