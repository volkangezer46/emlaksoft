import { describe, expect, it } from "vitest";
import {
  CONFLICT_NOTE,
  hashOf,
  overlapping,
  parseSchedule,
  pruneSchedule,
  runSchedule,
  stableJson,
  trLocalToUtcIso,
  type ScheduleAdapters,
  type ScheduledEntry,
} from "./schedule";

const T0 = Date.parse("2026-10-13T09:00:00Z");
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

function entry(over: Partial<ScheduledEntry> = {}): ScheduledEntry {
  const cfg = over.cfg ?? { announcement: { text: "Bayram indirimi" } };
  return {
    id: "e1",
    surface: "sitemenu",
    label: "Bayram",
    cfg,
    cfgHash: hashOf(cfg),
    publishAt: iso(T0 + 10 * MIN),
    unpublishAt: iso(T0 + 60 * MIN),
    by: "staff-1",
    byName: "Ayşe",
    createdAt: iso(T0),
    status: "bekliyor",
    note: "",
    prevLive: null,
    prevLiveHash: null,
    ...over,
  };
}

/** Bellek içi depo + yüzey: cron'un gerçek bağdaştırıcılarıyla aynı sözleşme. */
function harness(initial: ScheduledEntry[], live: unknown | null = { announcement: { text: "Eski" } }) {
  const db = { list: initial.map((e) => ({ ...e })), live: new Map<string, unknown | null>([["sitemenu", live]]) };
  const calls = { publish: [] as Array<{ cfg: unknown; kind: string }>, reset: 0, notify: [] as string[], log: [] as string[], revalidate: 0 };
  const a: ScheduleAdapters = {
    fresh: async (id) => db.list.find((e) => e.id === id) ?? null,
    commit: async (e) => {
      db.list = db.list.map((x) => (x.id === e.id ? { ...e } : x));
      return true;
    },
    readLive: async (s) => db.live.get(s) ?? null,
    publish: async (s, cfg, _e, kind) => {
      calls.publish.push({ cfg, kind });
      db.live.set(s, cfg);
      return { ok: true };
    },
    resetToDefault: async (s) => {
      calls.reset += 1;
      db.live.set(s, null);
      return { ok: true };
    },
    revalidate: () => {
      calls.revalidate += 1;
    },
    notify: async (e) => {
      calls.notify.push(e.id);
    },
    log: async (e, kind) => {
      calls.log.push(`${e.id}:${kind}`);
    },
  };
  return { db, calls, a, run: (nowMs: number) => runSchedule(db.list, nowMs, a) };
}

describe("runSchedule (saf zamanlayıcı çekirdeği)", () => {
  it("zamanı gelmeyen kayda dokunmaz", async () => {
    const h = harness([entry()]);
    const r = await h.run(T0 + 5 * MIN);
    expect(r).toMatchObject({ published: 0, reverted: 0, cancelled: 0, failed: 0 });
    expect(h.calls.publish).toHaveLength(0);
    expect(h.db.list[0]!.status).toBe("bekliyor");
    expect(h.db.list[0]!.prevLiveHash).toBeNull();
  });

  it("zamanı gelen kaydı yayınlar, önceki canlıyı saklar; bitişsizse tamamlandı", async () => {
    const h = harness([entry(), entry({ id: "e2", unpublishAt: null, surface: "sitemenu", publishAt: iso(T0 + 11 * MIN) })]);
    const r = await h.run(T0 + 12 * MIN);
    expect(r.published).toBe(2);
    expect(h.db.list[0]).toMatchObject({ status: "yayinda", prevLive: { announcement: { text: "Eski" } }, prevLiveHash: hashOf({ announcement: { text: "Eski" } }) });
    // e2 aynı cfg: canlı zaten o hash'te, ikinci kez yazılmaz.
    expect(h.calls.publish).toHaveLength(1);
    expect(h.db.list[1]!.status).toBe("tamamlandi");
    expect(h.calls.revalidate).toBe(1);
    expect(h.calls.log).toEqual(["e1:yayin", "e2:yayin"]);
  });

  it("bitişte önceki sürüme döner; önceki canlı yoksa varsayılana sıfırlar", async () => {
    const h = harness([entry()]);
    await h.run(T0 + 10 * MIN);
    const r = await h.run(T0 + 60 * MIN);
    expect(r.reverted).toBe(1);
    expect(h.calls.publish.at(-1)).toEqual({ cfg: { announcement: { text: "Eski" } }, kind: "bitis" });
    expect(h.db.live.get("sitemenu")).toEqual({ announcement: { text: "Eski" } });
    expect(h.db.list[0]!.status).toBe("tamamlandi");

    const d = harness([entry()], null);
    await d.run(T0 + 10 * MIN);
    await d.run(T0 + 61 * MIN);
    expect(d.calls.reset).toBe(1);
    expect(d.db.live.get("sitemenu")).toBeNull();
    expect(d.db.list[0]!.status).toBe("tamamlandi");
  });

  it("araya elle yayın girince geri dönmez, iptal eder ve bildirim gönderir", async () => {
    const h = harness([entry()]);
    await h.run(T0 + 10 * MIN);
    h.db.live.set("sitemenu", { announcement: { text: "Elle yayın" } });
    const r = await h.run(T0 + 60 * MIN);
    expect(r).toMatchObject({ reverted: 0, cancelled: 1 });
    expect(h.db.live.get("sitemenu")).toEqual({ announcement: { text: "Elle yayın" } });
    expect(h.db.list[0]).toMatchObject({ status: "iptal", note: CONFLICT_NOTE });
    expect(h.calls.notify).toEqual(["e1"]);
  });

  it("çift koşu idempotent: ikinci koşu hiçbir şey yayınlamaz", async () => {
    const h = harness([entry()]);
    const stale = h.db.list.map((e) => ({ ...e })); // ilk koşunun gördüğü eski liste
    await h.run(T0 + 10 * MIN);
    const r = await runSchedule(stale, T0 + 10 * MIN, h.a);
    expect(r.published).toBe(0);
    expect(r.skipped).toBe(1);
    expect(h.calls.publish).toHaveLength(1);
    await h.run(T0 + 60 * MIN);
    const again = await h.run(T0 + 60 * MIN);
    expect(again).toMatchObject({ published: 0, reverted: 0, cancelled: 0 });
    expect(h.calls.publish).toHaveLength(2);
  });

  it("yarıda kalan koşu: yayın olmuş ama durum yazılamamışsa tekrar yayınlamaz, önceki canlıyı korur", async () => {
    const e = entry();
    const h = harness([{ ...e, prevLive: { announcement: { text: "Eski" } }, prevLiveHash: hashOf({ announcement: { text: "Eski" } }) }], e.cfg);
    await h.run(T0 + 10 * MIN);
    expect(h.calls.publish).toHaveLength(0);
    expect(h.db.list[0]).toMatchObject({ status: "yayinda", prevLive: { announcement: { text: "Eski" } } });

    // Bitiş: geri dönüş olmuş ama durum yazılamamış -> yalnız tamamla, bildirim yok.
    h.db.live.set("sitemenu", { announcement: { text: "Eski" } });
    const r = await h.run(T0 + 60 * MIN);
    expect(r.reverted).toBe(1);
    expect(h.calls.notify).toHaveLength(0);
    expect(h.db.list[0]!.status).toBe("tamamlandi");
  });

  it("bitişi de geçmiş kayıt yayınlanmaz; kalıcı yayın hatası iptal eder, geçici hata yeniden denenir", async () => {
    const h = harness([entry()]);
    const r = await h.run(T0 + 90 * MIN);
    expect(r.cancelled).toBe(1);
    expect(h.calls.publish).toHaveLength(0);
    expect(h.db.list[0]!.status).toBe("iptal");

    const p = harness([entry()]);
    p.a.publish = async () => ({ ok: false, error: "medya yok", permanent: true });
    await p.run(T0 + 10 * MIN);
    expect(p.db.list[0]).toMatchObject({ status: "iptal" });

    const t = harness([entry()]);
    t.a.publish = async () => ({ ok: false, error: "db" });
    const tr = await t.run(T0 + 10 * MIN);
    expect(tr.failed).toBe(1);
    expect(t.db.list[0]!.status).toBe("bekliyor");
  });
});

describe("yardımcılar", () => {
  it("kararlı JSON anahtar sırasından bağımsız; hash buna göre", () => {
    expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"b":1}');
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
    expect(hashOf(null)).not.toBe(hashOf({}));
  });

  it("TR saat dönüşümü: datetime-local değeri Türkiye saati (+03:00) sayılır", () => {
    expect(trLocalToUtcIso("2026-10-13T14:00")).toBe("2026-10-13T11:00:00.000Z");
    expect(trLocalToUtcIso("2026-12-31T23:30")).toBe("2026-12-31T20:30:00.000Z");
    expect(trLocalToUtcIso("2026-10-13T00:15")).toBe("2026-10-12T21:15:00.000Z");
    expect(trLocalToUtcIso("2026-10-13T14:00:00Z")).toBe("2026-10-13T14:00:00.000Z");
    expect(trLocalToUtcIso("")).toBeNull();
    expect(trLocalToUtcIso("dün")).toBeNull();
  });

  it("çakışma: aynı yüzeyde aralığı kesişen açık kayıt", () => {
    const list = [entry(), entry({ id: "x", status: "iptal" }), entry({ id: "y", surface: "sitecontent" })];
    expect(overlapping(list, "sitemenu", T0 + 30 * MIN, null).map((e) => e.id)).toEqual(["e1"]);
    expect(overlapping(list, "sitemenu", T0 + 61 * MIN, T0 + 90 * MIN)).toEqual([]);
    expect(overlapping(list, "sitemenu", T0, T0 + 10 * MIN)).toEqual([]);
  });

  it("ayrıştırma bozuk girdiyi atar; budama açık kayıtları korur", () => {
    expect(parseSchedule("bozuk")).toEqual([]);
    expect(parseSchedule(JSON.stringify([{ id: 1 }, entry()]))).toHaveLength(1);
    const finished = Array.from({ length: 40 }, (_, i) => entry({ id: `f${i}`, status: "tamamlandi", publishAt: iso(T0 + i * MIN) }));
    const kept = pruneSchedule([entry(), ...finished]);
    expect(kept).toHaveLength(31);
    expect(kept.some((e) => e.id === "e1")).toBe(true);
    expect(kept.some((e) => e.id === "f0")).toBe(false);
  });
});
