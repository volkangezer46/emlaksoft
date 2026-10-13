import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  error: null as null | { code?: string; message: string },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.calls.push({ fn, args });
      return { data: null, error: h.error };
    },
  }),
}));

import {
  DAILY_KEY_CAP,
  FLUSH_INTERVAL_MS,
  MISSING_RETRY_MS,
  OVERFLOW_PATH,
  flushMeasureBuffer,
  installShutdownFlush,
  measureBufferStats,
  recordPageview,
  recordVital,
  resetMeasureBufferForTest,
  startMeasureBufferTimerForTest,
  type PageviewDims,
} from "./buffer";

const T0 = Date.parse("2026-10-13T09:00:00Z");
const pv = (path: string): PageviewDims => ({ path_tpl: path, channel: "direct", source: "", medium: "", campaign: "", device: "mobile" });
type PvRow = { path_tpl: string; n: number; day: string; channel: string };
const pvRows = (i = 0) => ((h.calls[i]!.args.p as { pv: PvRow[] }).pv);

describe("ölçüm tamponu", () => {
  beforeEach(() => {
    resetMeasureBufferForTest();
    h.calls.length = 0;
    h.error = null;
  });
  afterEach(() => {
    vi.useRealTimers();
    resetMeasureBufferForTest();
  });

  it("aynı anahtar toplanır; boşaltma TEK RPC ile yazar (TR günü anahtarı)", async () => {
    recordPageview(pv("/"), T0);
    recordPageview(pv("/"), T0);
    recordPageview(pv("/fiyatlar"), T0);
    recordVital({ path_tpl: "/", device: "mobile", metric: "LCP", bucket: 3, static: true }, T0);
    expect(h.calls).toHaveLength(0); // kayıt anında DB yok
    const r = await flushMeasureBuffer(T0);
    expect(r).toEqual({ ok: true, pv: 2, wv: 1 });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.fn).toBe("analytics_ingest");
    const rows = pvRows();
    expect(rows.find((x) => x.path_tpl === "/")).toMatchObject({ n: 2, day: "2026-10-13", channel: "direct" });
    const wv = (h.calls[0]!.args.p as { wv: Record<string, unknown>[] }).wv;
    expect(wv[0]).toMatchObject({ metric: "LCP", bucket: 3, static: true, n: 1 });
    expect((await flushMeasureBuffer(T0)).reason).toBe("empty");
    expect(h.calls).toHaveLength(1);
  });

  it("zamanlayıcıyla (15 sn) kendiliğinden boşalır", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    startMeasureBufferTimerForTest();
    recordPageview(pv("/"), T0);
    expect(h.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS + 10);
    expect(h.calls).toHaveLength(1);
    expect(pvRows()[0]).toMatchObject({ path_tpl: "/", n: 1 });
  });

  it("SIGTERM'de boşaltılır; başka dinleyici yoksa sinyal yeniden gönderilir", async () => {
    const proc = Object.assign(new EventEmitter(), { pid: 4242, kill: vi.fn() });
    installShutdownFlush(proc as never);
    recordPageview(pv("/kayit"), T0);
    proc.emit("SIGTERM");
    await vi.waitFor(() => expect(h.calls).toHaveLength(1));
    expect(pvRows()[0]).toMatchObject({ path_tpl: "/kayit" });
    await vi.waitFor(() => expect(proc.kill).toHaveBeenCalledWith(4242, "SIGTERM"));

    // Next'in kendi kapanış dinleyicisi varsa çıkışı o yapar: yeniden gönderilmez.
    const proc2 = Object.assign(new EventEmitter(), { pid: 1, kill: vi.fn() });
    proc2.on("SIGTERM", () => undefined);
    installShutdownFlush(proc2 as never);
    proc2.emit("SIGTERM");
    await new Promise((r) => setTimeout(r, 5));
    expect(proc2.kill).not.toHaveBeenCalled();
  });

  it("kardinalite: günde 2.000 ayrık anahtar; 2.001. anahtar (taşma) kovasına gider", async () => {
    for (let i = 0; i < DAILY_KEY_CAP; i++) recordPageview(pv(`/s${i}`), T0);
    recordPageview(pv("/s-yeni"), T0);
    recordPageview(pv("/s0"), T0); // bilinen anahtar tavanda bile kendi kovasında sayılır
    await flushMeasureBuffer(T0);
    const rows = pvRows();
    expect(rows.find((x) => x.path_tpl === "/s-yeni")).toBeUndefined();
    expect(rows.find((x) => x.path_tpl === OVERFLOW_PATH)).toMatchObject({ n: 1, channel: "unknown" });
    expect(rows.find((x) => x.path_tpl === "/s0")).toMatchObject({ n: 2 });
    expect(rows).toHaveLength(DAILY_KEY_CAP + 1);
    expect(measureBufferStats(T0).overflowed).toBe(1);
  });

  it("tablo/RPC yoksa 10 dk yazma durur, sonra yeniden denenir (F4)", async () => {
    h.error = { code: "PGRST202", message: "function not found" };
    recordPageview(pv("/"), T0);
    expect((await flushMeasureBuffer(T0)).reason).toBe("missing");
    expect(measureBufferStats(T0).tableMissing).toBe(true);
    recordPageview(pv("/"), T0 + 60_000); // bekleme süresinde kabul edilmez
    expect(measureBufferStats(T0 + 60_000).pendingPageviews).toBe(0);
    h.error = null;
    const later = T0 + MISSING_RETRY_MS + 1;
    recordPageview(pv("/"), later);
    expect((await flushMeasureBuffer(later)).ok).toBe(true);
    expect(h.calls).toHaveLength(2);
  });

  it("geçici hata: sayaçlar tampona geri konur, hata sağlık için tutulur", async () => {
    h.error = { code: "08006", message: "bağlantı koptu" };
    recordPageview(pv("/"), T0);
    expect((await flushMeasureBuffer(T0)).reason).toBe("error");
    const s = measureBufferStats(T0);
    expect(s.pendingPageviews).toBe(1);
    expect(s.lastError?.message).toContain("bağlantı");
    h.error = null;
    await flushMeasureBuffer(T0 + 1);
    expect(pvRows(1)[0]).toMatchObject({ n: 1 });
    expect(measureBufferStats(T0 + 1).lastError).toBeNull();
  });
});
