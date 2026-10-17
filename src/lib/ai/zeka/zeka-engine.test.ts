import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MATRIX, type AppRole } from "@/lib/permissions";
import { KnowledgeBase } from "./knowledge/base";
import { staticAppChunks } from "./knowledge/chunks";
import { answerLocalApp } from "./local-engine";
import { makeScope, type ZekaAppScope } from "./scope";
import type { ToolEnv, ZekaDataPort } from "./tools";
import type { MetricId } from "./metrics";

/**
 * Zeka motor sözleşmeleri: yetki kapsamı (rolün göremediği veri sorgulanmaz bile), kapalı modül, "asla yazmaz",
 * GPT hatasında yerel motora düşüş.
 */

const NOW = Date.parse("2026-10-17T09:00:00+03:00");
const GEO = {
  provinces: [{ id: "p34", name: "İstanbul" }],
  districts: [
    { id: "d-kadikoy", name: "Kadıköy", parentId: "p34" },
    { id: "d-besiktas", name: "Beşiktaş", parentId: "p34" },
  ],
};
const kb = new KnowledgeBase(staticAppChunks());

function fakePort() {
  const calls: { method: string; arg: unknown }[] = [];
  const port: ZekaDataPort = {
    async search(text) {
      calls.push({ method: "search", arg: text });
      if (/ahmet/i.test(text)) return [{ id: "11111111-1111-4111-8111-111111111111", kind: "customer", title: "Ahmet Yılmaz", subtitle: "Müşteri", href: "/app/musteriler/11111111-1111-4111-8111-111111111111" }];
      if (/ay[sş]e/i.test(text))
        return [
          { id: "22222222-2222-4222-8222-222222222222", kind: "customer", title: "Ayşe Demir", subtitle: "Müşteri", href: "/app/musteriler/2" },
          { id: "33333333-3333-4333-8333-333333333333", kind: "customer", title: "Ayşe Demirci", subtitle: "Müşteri", href: "/app/musteriler/3" },
        ];
      return [];
    },
    async metric(id: MetricId) {
      calls.push({ method: "metric", arg: id });
      if (id === "sales_volume") return { kind: "money", amount: 12_500_000, count: 3 };
      if (id === "top_advisor") return { kind: "ranking", rows: [{ name: "Ayşe Yılmaz", count: 4, amount: 9_750_000 }] };
      return { kind: "count", count: 7 };
    },
  };
  return { port, calls };
}

function envFor(role: AppRole, opts: { closed?: string[] } = {}): { env: ToolEnv; calls: { method: string; arg: unknown }[]; scope: ZekaAppScope } {
  const { port, calls } = fakePort();
  const scope = makeScope({ userId: "u1", tenantId: "t1", role, perms: DEFAULT_MATRIX[role], closed: opts.closed ?? [], locked: [] });
  return { env: { scope, port, kb, nowMs: NOW, geo: GEO }, calls, scope };
}

describe("yetki kapsamı", () => {
  it("danışman ofis cirosunu göremez: tutar sorgusu HİÇ çalışmaz, yanıtta tutar yok", async () => {
    const { env, calls } = envFor("advisor");
    const r = await answerLocalApp("bu ay ciro ne kadar", env);
    expect(r.intent).toBe("data");
    expect(calls.some((c) => c.method === "metric" && c.arg === "sales_volume")).toBe(false);
    expect(r.answer).toMatch(/tüm kazançları görme izni/);
    expect(JSON.stringify(r)).not.toContain("12.500.000");
    expect(r.actions[0]?.href).toBe("/app/kazancim");
  });
  it("danışman diğer danışmanların sıralamasını göremez", async () => {
    const { env, calls } = envFor("advisor");
    const r = await answerLocalApp("en çok satış yapan danışman kim", env);
    expect(calls.some((c) => c.arg === "top_advisor")).toBe(false);
    expect(r.answer).toMatch(/yönetici rollerine/);
  });
  it("ofis sahibi ciroyu tam TL görür (kısaltma yok) ve filtreli listeye gider", async () => {
    const { env } = envFor("owner");
    const r = await answerLocalApp("bu ay ciro ne kadar", env);
    expect(r.answer).toContain("₺12.500.000");
    expect(r.answer).not.toMatch(/\bMn\b|milyon|bin\b/i);
    expect(r.cards[0]).toMatchObject({ kind: "metric", value: "₺12.500.000", href: "/app/anlasmalar?gorunum=liste&asama=won&from=2026-10-01&to=2026-10-31" });
  });
  it("muhasebe (earnings_all) ciroyu görür; şube müdürü (earnings_all yok) göremez", async () => {
    expect((await answerLocalApp("bu ay ciro ne kadar", envFor("accounting").env)).answer).toContain("₺12.500.000");
    const bm = envFor("branch_manager");
    const r = await answerLocalApp("bu ay ciro ne kadar", bm.env);
    expect(r.answer).not.toContain("₺12.500.000");
    expect(bm.calls.some((c) => c.arg === "sales_volume")).toBe(false);
  });
  it("çağrı merkezi portföy modülü olmadan portföy sayısı alamaz ve portföy sayfası önerilmez", async () => {
    const { env, calls } = envFor("call_center");
    const r = await answerLocalApp("Kadıköy'de 3+1 kaç portföy var", env);
    expect(calls.some((c) => c.method === "metric" && c.arg === "properties")).toBe(false);
    expect(r.answer).toMatch(/kapsamında değil/);
    const nav = await answerLocalApp("portföyler", env);
    expect(JSON.stringify(nav)).not.toContain("/app/portfoyler");
  });
  it("ofisin kapattığı modül (kiralama) sorgulanmaz", async () => {
    const { env, calls } = envFor("owner", { closed: ["rentals"] });
    const r = await answerLocalApp("geciken kira kaç", env);
    expect(calls.some((c) => c.arg === "rent_overdue")).toBe(false);
    expect(r.answered).toBe(false);
  });
  it("oluşturma izni olmayan rol için form önerilmez (muhasebe randevu açamaz)", async () => {
    const { env } = envFor("accounting");
    const r = await answerLocalApp("Ahmet Yılmaz için yarın 14:00 randevu", env);
    expect(r.actions.some((a) => a.href.startsWith("/app/randevular/yeni"))).toBe(false);
  });
  it("salt okunur hesap hiçbir oluşturma bağlantısı almaz", async () => {
    const { env } = envFor("readonly");
    const r = await answerLocalApp("yeni müşteri ekle", env);
    expect(r.actions.some((a) => a.kind === "create")).toBe(false);
  });
});

describe("yanıt kalitesi", () => {
  it("randevu: müşteri bulunur, tarih/saat ön doldurulur, kayıt yazılmaz", async () => {
    const { env, calls } = envFor("advisor");
    const r = await answerLocalApp("Ahmet Yılmaz için yarın 14:00 randevu", env);
    expect(r.intent).toBe("create");
    expect(r.actions[0]).toMatchObject({ kind: "create", href: "/app/randevular/yeni?customer=11111111-1111-4111-8111-111111111111&tarih=2026-10-18&saat=14%3A00" });
    expect(r.actions[0]?.confirm).toMatch(/siz kaydedene kadar/);
    expect(calls.every((c) => c.method === "search" || c.method === "metric")).toBe(true);
  });
  it("aynı adda birden çok müşteri: seçenek sunar, tahmin etmez", async () => {
    const r = await answerLocalApp("Ayşe için yarın 10:00 randevu", envFor("advisor").env);
    expect(r.answer).toMatch(/2 müşteri var/);
    expect(r.actions).toHaveLength(2);
  });
  it("Kadıköy 3+1 sayısı gerçek sayıyla ve filtreli listeyle", async () => {
    const r = await answerLocalApp("Kadıköy'de 3+1 kaç portföy var", envFor("owner").env);
    expect(r.answer).toBe("Kadıköy 3+1 portföy: 7.");
    expect(r.cards[0]).toMatchObject({ href: "/app/portfoyler?oda=3%2B1&ilce=d-kadikoy" });
  });
  it("geciken kira → durum süzgeçli kiralama listesi", async () => {
    const r = await answerLocalApp("geciken kira kaç", envFor("owner").env);
    expect(r.cards[0]).toMatchObject({ value: "7", href: "/app/kiralama?durum=overdue" });
  });
  it("danışmanda sayı kapsam notu taşır", async () => {
    const r = await answerLocalApp("bu ay kaç satış yaptık", envFor("advisor").env);
    expect(r.answer).toMatch(/yalnız sizin kapsamınızdaki/);
  });
  it("nasıl yapılır: resmî rehberden yanıt ve derin bağlantı", async () => {
    const r = await answerLocalApp("müşteri nasıl eklenir", envFor("advisor").env);
    expect(r.intent).toBe("howto");
    expect(r.answered).toBe(true);
    expect(r.actions[0]?.href).toBe("/app/musteriler/yeni");
  });
  it("gezinme: sayfa adı doğrudan bulunur", async () => {
    const r = await answerLocalApp("ayarlar", envFor("owner").env);
    expect(r.actions[0]?.href).toBe("/app/ayarlar");
  });
  it("anlaşılmayan sorguda uydurma yok: emin değilim + seçenekler", async () => {
    const r = await answerLocalApp("qwxz plmk", envFor("owner").env);
    expect(r.answered).toBe(false);
    expect(r.confidence).toBeLessThan(0.45);
    expect(r.followUps.length).toBeGreaterThan(0);
  });
  it("öneri kipi (lite) veri sayımı yapmaz", async () => {
    const { env, calls } = envFor("owner");
    await answerLocalApp("bu ay kaç satış yaptık", env, { lite: true });
    expect(calls.some((c) => c.method === "metric")).toBe(false);
  });
});

describe("ASLA YAZMAZ sözleşmesi", () => {
  const DIR = join(process.cwd(), "src/lib/ai/zeka");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) files.push(f);
    }
  };
  walk(DIR);
  const ALLOWED_RPC = new Set(["zeka_log_query", "zeka_query_feedback", "zeka_knowledge_vectors_read", "zeka_knowledge_vectors_store", "zeka_knowledge_vectors_state", "zeka_usage_stats"]);

  it("zeka çekirdeğinde insert/update/upsert/delete çağrısı yok", () => {
    for (const f of files) {
      const src = readFileSync(f, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      expect(src, f).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    }
  });
  it("yalnız Zeka'nın kendi günlük/dizin RPC'leri çağrılır (iş kaydı yazan RPC yok)", () => {
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/\.rpc\(\s*"([a-z_]+)"/g)) expect(ALLOWED_RPC.has(m[1]!), `${f}: ${m[1]}`).toBe(true);
    }
  });
  it("hiçbir server action (yazma eylemi) içe aktarılmaz; yalnız salt-okunur çalışma alanı araması", () => {
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/from "@\/app\/actions\/([^"]+)"/g)) expect(m[1], f).toBe("search");
    }
  });
  it("veri kapısı yalnız okuma yöntemleri taşır", () => {
    const src = readFileSync(join(DIR, "tools.ts"), "utf8");
    const port = /export interface ZekaDataPort \{([\s\S]*?)\n\}/.exec(src)?.[1] ?? "";
    const methods = [...port.matchAll(/^\s+(\w+)\(/gm)].map((m) => m[1]);
    expect(methods.sort()).toEqual(["metric", "search"]);
  });
  it("oluşturma eylemleri yalnız /app içi GET bağlantılarıdır ve onay cümlesi taşır", async () => {
    const { env } = envFor("owner");
    for (const q of ["yeni müşteri ekle", "Ahmet Yılmaz için yarın 14:00 randevu", "kampanya oluştur", "gider ekle 5000 TL", "Ahmet Yılmaz için teklif hazırla"]) {
      const r = await answerLocalApp(q, env);
      const creates = r.actions.filter((a) => a.kind === "create");
      expect(creates.length, q).toBeGreaterThan(0);
      for (const a of creates) {
        expect(a.href, q).toMatch(/^\/app\//);
        expect(a.confirm, q).toBeTruthy();
      }
    }
  });
});

/* ------------------------------ GPT → yerel düşüş ------------------------------ */

const openAiChat = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/openai-client", () => ({
  openAiChat: (o: unknown) => openAiChat(o),
  openAiEmbeddings: vi.fn().mockResolvedValue([]),
  getOpenAiChatModel: () => "gpt-4o-mini",
}));
const settingsMock = { mode: "auto" as "auto" | "local" | "gpt", key: "sk-test" as string | null };
vi.mock("./settings", () => ({
  readZekaConfig: async (surface: string) => ({ surface, enabled: true, mode: settingsMock.mode, model: "gpt-4o-mini", maxTokens: 400, embeddings: false, embeddingModel: "x" }),
  zekaApiKey: async () => settingsMock.key,
  chooseEngine: (mode: string, hasKey: boolean, quota: boolean) =>
    mode === "local" ? { engine: "local" } : !hasKey ? { engine: "local", reason: mode === "gpt" ? "anahtar_yok" : undefined } : !quota ? { engine: "local", reason: "kota" } : { engine: "gpt" },
}));
vi.mock("@/lib/ai/auto-call-gate", () => ({ canAutoCallAi: async () => true }));
vi.mock("./knowledge/store", () => ({ getKnowledgeBase: async () => kb }));
const sharedPort = fakePort();
vi.mock("./port-supabase", () => ({ createSupabaseZekaPort: () => sharedPort.port }));
const logZekaQuery = vi.fn().mockResolvedValue("44444444-4444-4444-8444-444444444444");
vi.mock("./log", () => ({ logZekaQuery: (i: unknown) => logZekaQuery(i) }));
vi.mock("@/lib/nl-search/geo-source", () => ({ loadNlProvincesAndDistricts: async () => GEO }));

describe("GPT motoru ve yerel düşüş", () => {
  beforeEach(() => {
    openAiChat.mockReset();
    logZekaQuery.mockClear();
    settingsMock.mode = "auto";
    settingsMock.key = "sk-test";
  });
  const owner = () => envFor("owner").scope;

  it("openai-client hata verirse yerel motor yanıtlar (fallbackReason=hata)", async () => {
    openAiChat.mockRejectedValue(new Error("network"));
    const { answerApp } = await import("./app");
    const r = await answerApp("geciken kira kaç", owner(), { mode: "answer" });
    expect(openAiChat).toHaveBeenCalled();
    expect(r.engine).toBe("local");
    expect(r.fallbackReason).toBe("hata");
    expect(r.cards[0]).toMatchObject({ value: "7" });
    expect(r.logId).toBe("44444444-4444-4444-8444-444444444444");
  });
  it("anahtar yoksa GPT hiç çağrılmaz", async () => {
    settingsMock.key = null;
    const { answerApp } = await import("./app");
    const r = await answerApp("geciken kira kaç", owner(), { mode: "answer" });
    expect(openAiChat).not.toHaveBeenCalled();
    expect(r.engine).toBe("local");
  });
  it("yerel kipte anahtar olsa da GPT çağrılmaz", async () => {
    settingsMock.mode = "local";
    const { answerApp } = await import("./app");
    await answerApp("geciken kira kaç", owner(), { mode: "answer" });
    expect(openAiChat).not.toHaveBeenCalled();
  });
  it("GPT aynı araçları fonksiyon çağrısıyla kullanır; kartlar araç çıktısından gelir", async () => {
    openAiChat
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: "c1", name: "count_metric", arguments: JSON.stringify({ query: "geciken kira kaç", metric: "rent_overdue" }) }] })
      .mockResolvedValueOnce({ content: "7 gecikmiş kira var; listeyi açabilirsiniz.", toolCalls: [] });
    const { answerApp } = await import("./app");
    const r = await answerApp("geciken kira kaç", owner(), { mode: "answer" });
    expect(r.engine).toBe("gpt");
    expect(r.intent).toBe("data");
    expect(r.cards[0]).toMatchObject({ kind: "metric", value: "7", href: "/app/kiralama?durum=overdue" });
    const body = (openAiChat.mock.calls[0]![0] as { body: { tools: { function: { name: string } }[] } }).body;
    expect(body.tools.map((t) => t.function.name).sort()).toEqual(["count_metric", "help_lookup", "navigate", "prepare_create", "search_records"]);
  });
  it("GPT yetki dışı metrik isterse araç reddeder (danışman ciro)", async () => {
    openAiChat
      .mockResolvedValueOnce({ content: null, toolCalls: [{ id: "c1", name: "count_metric", arguments: JSON.stringify({ query: "ciro", metric: "sales_volume" }) }] })
      .mockResolvedValueOnce({ content: "Bu bilgi rolünüze açık değil.", toolCalls: [] });
    const { answerApp } = await import("./app");
    const r = await answerApp("bu ay ciro ne kadar", envFor("advisor").scope, { mode: "answer" });
    const toolMsg = (openAiChat.mock.calls[1]![0] as { body: { messages: { role: string; content: string }[] } }).body.messages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("yetki_yok");
    expect(JSON.stringify(r)).not.toContain("12.500.000");
  });
  it("öneri kipi her zaman yerel ve günlüksüz", async () => {
    const { answerApp } = await import("./app");
    const r = await answerApp("geciken", owner(), { mode: "suggest" });
    expect(r.engine).toBe("local");
    expect(openAiChat).not.toHaveBeenCalled();
    expect(logZekaQuery).not.toHaveBeenCalled();
  });
});
