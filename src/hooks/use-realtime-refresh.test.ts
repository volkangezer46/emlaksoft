import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createRefreshScheduler, createTableChannelSync } from "./use-realtime-refresh";
import { createTopicHub, TOPIC_LINGER_MS, type HubChannel, type HubClient, type TopicStatusEvent } from "@/lib/realtime";
import {
  REALTIME_BULK_MAX_WAIT_MS,
  REALTIME_BULK_QUIET_MS,
  REALTIME_HOME_MIN_INTERVAL_MS,
  REALTIME_MIN_INTERVAL_MS,
  tablesForPath,
} from "@/lib/realtime-throttle";

/* -------------------------------------------------------------------------- */
/* Sahte zaman                                                                 */
/* -------------------------------------------------------------------------- */

function fakeTime() {
  let t = 1_000_000;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      id += 1;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    /** Zamanı ilerletir, vadesi gelen zamanlayıcıları sırayla çalıştırır. */
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
    pending: () => timers.size,
  };
}

function scheduler(hidden = { v: false }) {
  const time = fakeTime();
  const refreshes: number[] = [];
  const s = createRefreshScheduler({
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    isHidden: () => hidden.v,
    refresh: () => refreshes.push(time.now()),
  });
  return { s, time, refreshes, hidden };
}

const REQ = { debounceMs: 150, minIntervalMs: REALTIME_MIN_INTERVAL_MS };

describe("tazeleme zamanlayıcısı", () => {
  it("ilk olay 150 ms'de; ardışık ikinci olay en geç 2 sn sonra (<2,5 sn)", () => {
    const { s, time, refreshes } = scheduler();
    const start = time.now();
    s.request(REQ);
    time.advance(150);
    expect(refreshes).toEqual([start + 150]);
    time.advance(100);
    s.request(REQ);
    time.advance(5_000);
    expect(refreshes).toHaveLength(2);
    expect(refreshes[1] - refreshes[0]).toBe(REALTIME_MIN_INTERVAL_MS);
  });

  it("bekleyen tazeleme varken gelen olaylar birleşir", () => {
    const { s, time, refreshes } = scheduler();
    for (let i = 0; i < 10; i++) s.request(REQ);
    time.advance(1_000);
    expect(refreshes).toHaveLength(1);
  });

  it("yoğun ofis (60 sn boyunca saniyede 1 olay): panoda en çok 5 sn'de 1 tam yenileme", () => {
    const { s, time, refreshes } = scheduler();
    for (let i = 0; i < 60; i++) {
      s.request({ debounceMs: 150, minIntervalMs: REALTIME_HOME_MIN_INTERVAL_MS });
      time.advance(1_000);
    }
    time.advance(10_000);
    for (let i = 1; i < refreshes.length; i++) expect(refreshes[i] - refreshes[i - 1]).toBeGreaterThanOrEqual(REALTIME_HOME_MIN_INTERVAL_MS);
    expect(refreshes.length).toBeLessThanOrEqual(13);
  });

  it("toplu işlem akışı (bulk) boyunca tazeleme yok, sessizlikten sonra TEK tazeleme", () => {
    const { s, time, refreshes } = scheduler();
    for (let i = 0; i < 20; i++) {
      s.request({ ...REQ, bulk: true });
      s.request(REQ); // aynı içe aktarmanın küçük deyimleri akışa katılır
      time.advance(400);
    }
    expect(refreshes).toHaveLength(0);
    time.advance(REALTIME_BULK_QUIET_MS);
    expect(refreshes).toHaveLength(1);
  });

  it("hiç susmayan toplu akış en geç REALTIME_BULK_MAX_WAIT_MS sonra tazelenir", () => {
    const { s, time, refreshes } = scheduler();
    for (let i = 0; i < 200; i++) {
      s.request({ ...REQ, bulk: true });
      time.advance(500);
    }
    expect(refreshes.length).toBeGreaterThanOrEqual(1);
    expect(refreshes[0] - 1_000_000).toBeLessThanOrEqual(REALTIME_BULK_MAX_WAIT_MS + REALTIME_BULK_QUIET_MS);
  });

  it("sekme arkadayken tazeleme yok; görünür olunca TEK tazeleme", () => {
    const hidden = { v: true };
    const { s, time, refreshes } = scheduler(hidden);
    s.request(REQ);
    s.request(REQ);
    time.advance(5_000);
    expect(refreshes).toHaveLength(0);
    hidden.v = false;
    s.onVisible();
    s.onVisible();
    time.advance(5_000);
    expect(refreshes).toHaveLength(1);
  });

  it("rota değişince bekleyen tazeleme iptal (B012)", () => {
    const { s, time, refreshes } = scheduler();
    s.request(REQ);
    s.cancel();
    time.advance(5_000);
    expect(refreshes).toHaveLength(0);
    expect(time.pending()).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Konu hub'ı                                                                  */
/* -------------------------------------------------------------------------- */

type FakeChannel = HubChannel & {
  topic: string;
  private: boolean;
  status?: (s: string, err?: Error) => void;
  broadcast?: (msg: { event?: string; payload?: unknown }) => void;
  system?: (msg: { status?: string; message?: string }) => void;
};

function fakeHubClient() {
  const channels: FakeChannel[] = [];
  const removed: string[] = [];
  let connected = true;
  const connect = vi.fn(() => {
    connected = true;
  });
  const client: HubClient = {
    channel(topic, params) {
      const ch = { topic, private: params.config.private } as FakeChannel;
      ch.on = ((type: string, _f: unknown, cb: never) => {
        if (type === "broadcast") ch.broadcast = cb;
        else ch.system = cb;
        return ch;
      }) as HubChannel["on"];
      ch.subscribe = (cb) => {
        ch.status = cb;
        return ch;
      };
      channels.push(ch);
      return ch;
    },
    async removeChannel(ch) {
      removed.push((ch as FakeChannel).topic);
    },
    realtime: { isConnected: () => connected, connect },
  };
  return {
    client,
    channels,
    removed,
    connect,
    drop: () => {
      connected = false;
    },
  };
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function hubSetup() {
  const time = fakeTime();
  const f = fakeHubClient();
  const reports: string[] = [];
  const hub = createTopicHub({
    loadClient: async () => f.client,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    random: () => 0,
    report: (kind, topic) => reports.push(`${kind}:${topic.split(":")[0]}`),
  });
  return { hub, time, f, reports };
}

describe("konu hub'ı: sayfada konu başına tek özel kanal", () => {
  it("ofis konusu ÖZEL kanal; iki tüketici tek kanalı paylaşır; olaylar ikisine dağıtılır", async () => {
    const { hub, f } = hubSetup();
    const a = vi.fn();
    const b = vi.fn();
    hub.subscribe("tenant:t1", { on: { change: a } });
    await flush();
    hub.subscribe("tenant:t1", { on: { change: b } });
    await flush();
    expect(f.channels).toHaveLength(1);
    expect(f.channels[0].topic).toBe("tenant:t1");
    expect(f.channels[0].private).toBe(true);
    f.channels[0].broadcast?.({ event: "change", payload: { t: "tasks", op: "INSERT" } });
    expect(a).toHaveBeenCalledWith({ t: "tasks", op: "INSERT" });
    expect(b).toHaveBeenCalledWith({ t: "tasks", op: "INSERT" });
  });

  it("ilk SUBSCRIBED first, kopup yeniden katılım rejoin olarak bildirilir", async () => {
    const { hub, f } = hubSetup();
    const events: TopicStatusEvent[] = [];
    hub.subscribe("tenant:t1", { onStatus: (e) => events.push(e) });
    await flush();
    f.channels[0].status?.("SUBSCRIBED");
    f.channels[0].status?.("CHANNEL_ERROR", new Error("socket closed"));
    f.channels[0].status?.("SUBSCRIBED");
    expect(events.map((e) => [e.status, e.first, e.rejoin])).toEqual([
      ["live", true, false],
      ["offline", false, false],
      ["live", false, true],
    ]);
  });

  it("CHANNEL_ERROR / TIMED_OUT / sistem hatası: telemetri + üstel geri çekilmeyle yeniden kurulum", async () => {
    const { hub, f, time, reports } = hubSetup();
    hub.subscribe("tenant:t1", {});
    await flush();
    f.channels[0].status?.("TIMED_OUT");
    expect(reports).toEqual(["TIMED_OUT:tenant"]);
    time.advance(999);
    await flush();
    expect(f.channels).toHaveLength(1);
    time.advance(1);
    await flush();
    expect(f.removed).toEqual(["tenant:t1"]);
    expect(f.channels).toHaveLength(2);
    f.channels[1].status?.("CHANNEL_ERROR", new Error("x"));
    time.advance(1_999);
    await flush();
    expect(f.channels).toHaveLength(2);
    time.advance(1);
    await flush();
    expect(f.channels).toHaveLength(3);
    f.channels[2].system?.({ status: "error", message: "boom" });
    expect(reports).toEqual(["TIMED_OUT:tenant", "CHANNEL_ERROR:tenant", "SYSTEM_ERROR:tenant"]);
  });

  it("yetki reddi unauthorized olarak bildirilir (eski yola geri düşüş kararı)", async () => {
    const { hub, f, reports } = hubSetup();
    const events: TopicStatusEvent[] = [];
    hub.subscribe("tenant:t1", { onStatus: (e) => events.push(e) });
    await flush();
    f.channels[0].status?.("CHANNEL_ERROR", new Error("Unauthorized: You do not have permissions to read from this Channel topic"));
    expect(events.at(-1)).toMatchObject({ status: "offline", unauthorized: true });
    expect(reports).toEqual(["UNAUTHORIZED:tenant"]);
  });

  it("ağ geri gelince beklemeden yeniden bağlanır (geri çekilme beklenmez)", async () => {
    const { hub, f } = hubSetup();
    hub.subscribe("tenant:t1", {});
    await flush();
    f.drop();
    f.channels[0].status?.("CHANNEL_ERROR", new Error("socket"));
    hub.reconnectNow();
    await flush();
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.channels).toHaveLength(2);
  });

  it("son tüketici ayrılınca kanal bekleme süresi sonunda kapanır; arada dönen tüketici kanalı korur", async () => {
    const { hub, f, time } = hubSetup();
    const off = hub.subscribe("tenant:t1", {});
    await flush();
    f.channels[0].status?.("SUBSCRIBED");
    off();
    time.advance(TOPIC_LINGER_MS - 1);
    const events: TopicStatusEvent[] = [];
    hub.subscribe("tenant:t1", { onStatus: (e) => events.push(e) });
    await flush();
    time.advance(TOPIC_LINGER_MS * 2);
    await flush();
    expect(f.removed).toEqual([]);
    expect(f.channels).toHaveLength(1);
    // Açık kanala katılan tüketici mevcut durumu öğrenir; ilk katılım/yeniden katılım SAYILMAZ.
    expect(events).toEqual([{ status: "live", first: false, rejoin: false, unauthorized: false }]);
  });

  it("durum toplamı: ofis konusu yoksa idle, canlıysa live", async () => {
    const { hub, f } = hubSetup();
    expect(hub.statusOf("tenant:")).toBe("idle");
    hub.subscribe("tenant:t1", {});
    await flush();
    expect(hub.statusOf("tenant:")).toBe("connecting");
    f.channels[0].status?.("SUBSCRIBED");
    expect(hub.statusOf("tenant:")).toBe("live");
  });
});

/* -------------------------------------------------------------------------- */
/* Eski yol (geri düşüş) tablo kanalı                                          */
/* -------------------------------------------------------------------------- */

type Binding = { table: string; filter: string };
type SyncClient = Parameters<ReturnType<typeof createTableChannelSync>["attach"]>[0];

function fakeClient() {
  const open = new Map<string, { topic: string; bindings: Binding[]; subscribed: boolean; status?: (s: string) => void }>();
  const removed: string[] = [];
  const client = {
    channel: vi.fn((topic: string) => {
      const rec: { topic: string; bindings: Binding[]; subscribed: boolean; status?: (s: string) => void } = { topic, bindings: [], subscribed: false };
      open.set(topic, rec);
      const ch = {
        topic,
        on: (_type: string, cfg: { table: string; filter: string }) => {
          rec.bindings.push({ table: cfg.table, filter: cfg.filter });
          return ch;
        },
        subscribe: (cb?: (s: string) => void) => {
          rec.subscribed = true;
          rec.status = cb;
          return ch;
        },
      };
      return ch;
    }),
    removeChannel: vi.fn(async (ch: { topic: string }) => {
      open.delete(ch.topic);
      removed.push(ch.topic);
      return "ok";
    }),
  };
  return { client, open, removed, asClient: client as unknown as SyncClient };
}

describe("geri düşüş: postgres_changes tablo kanalı (yalnız yetki reddinde)", () => {
  it("yalnız eski yayındaki tablolar, tenant filtreli tek kanal", () => {
    const f = fakeClient();
    const sync = createTableChannelSync({ tenantId: "t1", onEvent: () => {} });
    sync.attach(f.asClient);
    sync.setTables(tablesForPath("/app/onaylar")); // approval_requests eski yayında yok
    expect(f.open.size).toBe(0);
    sync.setTables(tablesForPath("/app/gorevler"));
    const [ch] = [...f.open.values()];
    expect(ch!.bindings).toEqual([{ table: "tasks", filter: "tenant_id=eq.t1" }]);
  });

  it("küme değişince eski kanal kaldırılır; aynı küme yeniden kurulmaz; ikinci SUBSCRIBED tek tazeleme", () => {
    const f = fakeClient();
    const onRejoin = vi.fn();
    const sync = createTableChannelSync({ tenantId: "t1", onEvent: () => {}, onRejoin });
    sync.attach(f.asClient);
    sync.setTables(tablesForPath("/app/musteriler"));
    sync.setTables(tablesForPath("/app/musteriler/yeni"));
    expect(f.client.channel).toHaveBeenCalledTimes(1);
    const ch = [...f.open.values()][0];
    ch.status?.("SUBSCRIBED");
    expect(onRejoin).not.toHaveBeenCalled();
    ch.status?.("SUBSCRIBED");
    expect(onRejoin).toHaveBeenCalledTimes(1);
    sync.setTables(tablesForPath("/app/anlasmalar"));
    expect(f.removed).toHaveLength(1);
    sync.dispose();
    expect(f.open.size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Kaynak sözleşmeleri                                                         */
/* -------------------------------------------------------------------------- */

describe("kaynak sözleşmeleri", () => {
  const hook = readFileSync("src/hooks/use-realtime-refresh.ts", "utf8");
  const layout = readFileSync("src/components/app/realtime-refresh.tsx", "utf8");
  const lib = readFileSync("src/lib/realtime.ts", "utf8");

  it("layout: rota tablo süzgeci + detay süzgeci; ofis konusu + kişisel kutu; postgres_changes YOK", () => {
    expect(layout).toMatch(/^\s*tablesForPath,$/m);
    expect(layout).toMatch(/^\s*detailForPath,$/m);
    expect(layout).toMatch(/subscribeTopic\(tenantTopic\(tenantId\)/);
    expect(layout).toMatch(/subscribeTopic\(inboxTopic\(uid\)/);
    expect(layout).not.toMatch(/postgres_changes/);
    expect(layout).not.toMatch(/\.channel\(/);
  });

  it("kanca ofis konusuna hub üzerinden abone olur; kendi kanalını yalnız geri düşüşte açar", () => {
    expect(hook).toMatch(/subscribeTopic\(tenantTopic\(tenantId\)/);
    expect((hook.match(/\.channel\(/g) ?? []).length).toBe(1);
    expect(hook).toMatch(/s\.status === "offline" && s\.unauthorized\) \{\s*startLegacy\(\);/);
  });

  it("kanal oturum jetonu verilmeden açılmaz; istemci dinamik yüklenir; konu kanalı özel", () => {
    expect(lib).toMatch(/import\("@\/lib\/supabase\/client"\)/);
    const auth = lib.indexOf("await ensureRealtimeAuth(supabase)");
    expect(auth).toBeGreaterThan(-1);
    expect(auth).toBeLessThan(lib.indexOf("resolve(supabase)"));
    expect(lib).toMatch(/\.channel\(e\.topic, \{ config: \{ private: true \} \}\)/);
  });

  it("ilk katılımda açılış penceresi, yeniden katılımda tek tazeleme", () => {
    expect(hook).toMatch(/if \(s\.rejoin\) request\(\);/);
    expect(hook).toMatch(/s\.first && needsOpenWindowRefresh\(now\(\), pageDataAt\(scheduler\)\)/);
  });
});
