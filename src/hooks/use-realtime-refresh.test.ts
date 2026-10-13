import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createTableChannelSync } from "./use-realtime-refresh";
import { tablesForPath } from "@/lib/realtime-throttle";

type Binding = { table: string; filter: string };
type SyncClient = Parameters<ReturnType<typeof createTableChannelSync>["attach"]>[0];

/** Sahte supabase istemcisi: açılan/kaldırılan kanalları ve bağlamaları kaydeder. */
function fakeClient() {
  const open = new Map<string, { topic: string; bindings: Binding[]; subscribed: boolean }>();
  const removed: string[] = [];
  const client = {
    channel: vi.fn((topic: string) => {
      const rec = { topic, bindings: [] as Binding[], subscribed: false };
      open.set(topic, rec);
      const ch = {
        topic,
        on: (_type: string, cfg: { table: string; filter: string }) => {
          rec.bindings.push({ table: cfg.table, filter: cfg.filter });
          return ch;
        },
        subscribe: () => {
          rec.subscribed = true;
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

function setup() {
  const f = fakeClient();
  const sync = createTableChannelSync({ tenantId: "t1", onEvent: () => {} });
  sync.attach(f.asClient);
  return { ...f, sync };
}

describe("useRealtimeRefresh: rotaya inen tek tablo kanalı", () => {
  it("/app: tüm pano tabloları TEK kanalda, tenant filtreli", () => {
    const { sync, open } = setup();
    sync.setTables(tablesForPath("/app"));
    expect(open.size).toBe(1);
    const [ch] = [...open.values()];
    expect(ch!.subscribed).toBe(true);
    expect(ch!.bindings.map((b) => b.table).sort()).toEqual([...tablesForPath("/app")].sort());
    for (const b of ch!.bindings) expect(b.filter).toBe("tenant_id=eq.t1");
  });

  it("küme değişince eski kanal kaldırılır, tek kanal kalır ve yeniden abone olunur", () => {
    const { sync, open, removed, client } = setup();
    sync.setTables(tablesForPath("/app/musteriler"));
    const first = [...open.keys()][0]!;
    sync.setTables(tablesForPath("/app/anlasmalar"));
    expect(removed).toEqual([first]);
    expect(open.size).toBe(1);
    const [ch] = [...open.values()];
    expect(ch!.subscribed).toBe(true);
    expect(ch!.bindings.map((b) => b.table).sort()).toEqual(["commissions", "deals"]);
    expect(client.channel).toHaveBeenCalledTimes(2);
  });

  it("aynı küme (alt sayfa, farklı sıra) kanalı yeniden kurmaz", () => {
    const { sync, client, removed } = setup();
    sync.setTables(tablesForPath("/app/musteriler"));
    sync.setTables(tablesForPath("/app/musteriler/abc"));
    sync.setTables(["deals", "commissions"]);
    sync.setTables(["commissions", "deals"]);
    expect(client.channel).toHaveBeenCalledTimes(2);
    expect(removed).toHaveLength(1);
  });

  it("ilgisiz rotada 0 kanal; geri dönünce yeni konu adıyla yeniden açılır", () => {
    const { sync, open, client } = setup();
    sync.setTables(tablesForPath("/app/musteriler"));
    const first = [...open.keys()][0]!;
    sync.setTables(tablesForPath("/app/ayarlar"));
    expect(open.size).toBe(0);
    sync.setTables(tablesForPath("/app/musteriler"));
    expect(open.size).toBe(1);
    expect([...open.keys()][0]).not.toBe(first); // ayrılmakta olan eski kanal yeniden kullanılmaz
    expect(client.channel).toHaveBeenCalledTimes(2);
  });

  it("istemci sonradan (boşta) yüklenir: o ana kadar kanal yok, bağlanınca son küme uygulanır", () => {
    const f = fakeClient();
    const sync = createTableChannelSync({ tenantId: "t1", onEvent: () => {} });
    sync.setTables(tablesForPath("/app/musteriler"));
    sync.setTables(tablesForPath("/app/gorevler"));
    expect(f.client.channel).not.toHaveBeenCalled();
    sync.attach(f.asClient);
    expect(f.open.size).toBe(1);
    expect([...f.open.values()][0]!.bindings.map((b) => b.table)).toEqual(["tasks"]);
  });

  it("dispose kanalı kaldırır; sonraki küme değişimi kanal açmaz", () => {
    const { sync, open, client } = setup();
    sync.setTables(tablesForPath("/app/komisyon"));
    sync.dispose();
    expect(open.size).toBe(0);
    sync.setTables(tablesForPath("/app/musteriler"));
    expect(client.channel).toHaveBeenCalledTimes(1);
  });

  it("/app layout'u en çok 1 tablo kanalı + 1 bildirim kanalı açar (bildirim kanalı ayrı ve anında)", () => {
    const layout = readFileSync("src/components/app/realtime-refresh.tsx", "utf8");
    expect(layout).toMatch(/tablesForPath,/);
    expect((layout.match(/\.channel\(/g) ?? []).length).toBe(1);
    expect(layout).toMatch(/es-rt-notif:\$\{tenantId\}/);
    expect(layout).toMatch(/event: "INSERT", schema: "public", table: "notifications", filter: `tenant_id=eq\.\$\{tenantId\}`/);
    const hook = readFileSync("src/hooks/use-realtime-refresh.ts", "utf8");
    expect((hook.match(/\.channel\(/g) ?? []).length).toBe(1);
    expect(hook).toMatch(/import\("@\/lib\/supabase\/client"\)/); // supabase-js dinamik yüklenir
  });
});
