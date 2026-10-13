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
      expect(threw, `${job}: yakalanmamış istisna (try/catch + recordHeartbeat error gerekir)`).toBe(false);
      expect(status, `${job}: iş çökünce 5xx beklenir`).toBeGreaterThanOrEqual(500);
      expect(mine.length, `${job}: recordHeartbeat(iş adı = klasör adı) çağrılmalı`).toBeGreaterThan(0);
      expect(mine.at(-1)?.status).toBe("error");
    });
  });
});

/**
 * EP3 (KVKK): EİDS ham e-posta silme, yeni cron açmadan operational-retention'ın AYRIK adımıdır. Adım 30 günü dolan
 * ham .eml'i NULL'lar (ayrıştırılmış alanlara dokunmaz) ve 24 saati geçen iletme onay kodunu siler; tablo yoksa atlar.
 */
describe("operational-retention: EİDS ham e-posta adımı", () => {
  it("rota adımı bağlı (yeni cron yolu yok)", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/cron/operational-retention/route.ts"), "utf8");
    expect(src).toContain("eidsInbound: () => purgeEidsInboundRaw(getAdmin(), { nowMs: now() })");
    expect(jobs.some((j) => j.includes("eids"))).toBe(false);
  });

  it("yalnız raw_eml_encrypted ve onay kodu NULL'lanır; süre sınırı uygulanır", async () => {
    const { purgeEidsInboundRaw } = await import("@/lib/eids/inbound-retention");
    const calls: { patch: Record<string, unknown>; filters: string[] }[] = [];
    const fake = {
      from(table: string) {
        expect(table).toBe("eids_inbound_messages");
        const call = { patch: {} as Record<string, unknown>, filters: [] as string[] };
        calls.push(call);
        const chain = {
          update(p: Record<string, unknown>) {
            call.patch = p;
            return chain;
          },
          not(c: string, op: string, v: unknown) {
            call.filters.push(`not:${c}:${op}:${String(v)}`);
            return chain;
          },
          lt(c: string, v: string) {
            call.filters.push(`lt:${c}:${v}`);
            return chain;
          },
          or(f: string) {
            call.filters.push(`or:${f}`);
            return chain;
          },
          select: async () => ({ data: [{ id: "a" }, { id: "b" }], error: null }),
        };
        return chain;
      },
    };
    const nowMs = Date.parse("2026-11-20T00:00:00Z");
    const r = await purgeEidsInboundRaw(fake as never, { nowMs });
    expect(r).toEqual({ rawPurged: 2, confirmationsCleared: 2 });
    expect(calls[0]!.patch).toEqual({ raw_eml_encrypted: null });
    expect(calls[0]!.filters).toContain("lt:raw_purge_after:2026-11-20T00:00:00.000Z");
    expect(calls[1]!.patch).toEqual({ confirm_code: null, confirm_url: null });
    expect(calls[1]!.filters).toContain("lt:confirm_expires_at:2026-11-20T00:00:00.000Z");
  });

  it("tablo yoksa atlanır (migration uygulanmamış ortam)", async () => {
    const { purgeEidsInboundRaw } = await import("@/lib/eids/inbound-retention");
    const chain = { update: () => chain, not: () => chain, lt: () => chain, or: () => chain, select: async () => ({ data: null, error: { code: "42P01", message: "relation does not exist" } }) };
    expect(await purgeEidsInboundRaw({ from: () => chain } as never, { nowMs: 0 })).toEqual({ skipped: true });
  });
});
