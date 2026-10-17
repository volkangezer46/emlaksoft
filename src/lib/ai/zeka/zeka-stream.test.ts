import { describe, expect, it, vi } from "vitest";
import { consumeZekaStream, createZekaStreamParser, encodeZekaEvent, ZEKA_STREAM_DONE, type ZekaStreamEvent } from "./stream-protocol";
import type { ZekaResult } from "./types";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/streaming", () => ({ SSE_HEADERS: { "Content-Type": "text/event-stream; charset=utf-8" } }));

/**
 * Zeka akış protokolü: artımlı ayrıştırıcı (parça sınırları), yetkili `final`, hata olayı (429), yarıda kesilen akış,
 * iptal; sunucu katmanı (`zekaRespond`) JSON ve akış biçimlerini aynı sonuçtan üretir.
 */

const RESULT: ZekaResult = {
  surface: "app",
  engine: "gpt",
  intent: "data",
  answer: "7 gecikmiş kira var.",
  cards: [{ kind: "metric", label: "Geciken kira", value: "7", href: "/app/kiralama?durum=overdue" }],
  actions: [],
  followUps: ["Bunlardan kaçı bu ay?"],
  confidence: 0.9,
  answered: true,
};

function streamOf(chunks: string[], opts: { failAt?: number } = {}): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (opts.failAt === i) {
        controller.error(new Error("socket hang up"));
        return;
      }
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(enc.encode(chunks[i++]!));
    },
  });
}

describe("ayrıştırıcı", () => {
  it("olay ortadan bölünse de birleştirir; tek parçadaki birden çok olayı sırayla verir", () => {
    const wire = encodeZekaEvent({ t: "engine", engine: "gpt" }) + encodeZekaEvent({ t: "delta", text: "Merhaba " }) + encodeZekaEvent({ t: "delta", text: "dünya" });
    const p = createZekaStreamParser();
    const out: ZekaStreamEvent[] = [];
    for (let i = 0; i < wire.length; i += 7) out.push(...p.push(wire.slice(i, i + 7)));
    out.push(...p.end());
    expect(out).toEqual([
      { t: "engine", engine: "gpt" },
      { t: "delta", text: "Merhaba " },
      { t: "delta", text: "dünya" },
    ]);
  });

  it("bozuk, bilinmeyen ve boş satırları atlar; [DONE] sonrası hiçbir şey vermez", () => {
    const p = createZekaStreamParser();
    const out = p.push(`: yorum\n\ndata: {bozuk\n\ndata: {"t":"nope"}\n\ndata: {"t":"delta","text":""}\n\n${encodeZekaEvent({ t: "reset" })}${ZEKA_STREAM_DONE}${encodeZekaEvent({ t: "delta", text: "geç" })}`);
    expect(out).toEqual([{ t: "reset" }]);
    expect(p.done).toBe(true);
    expect(p.push(encodeZekaEvent({ t: "delta", text: "x" }))).toEqual([]);
  });

  it("final yalnız geçerli sonuç biçimiyle kabul edilir; hata olayı durum + metin taşır", () => {
    const p = createZekaStreamParser();
    const out = p.push(`data: {"t":"final","result":{"answer":1}}\n\n${encodeZekaEvent({ t: "final", result: RESULT })}data: {"t":"error","status":429}\n\n`);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ t: "final", result: RESULT });
    expect(out[1]).toMatchObject({ t: "error", status: 429, error: expect.stringMatching(/\S/) });
  });
});

describe("akış tüketimi (istemci)", () => {
  it("parçalar işleyicilere akar, final yetkili sonucu döner", async () => {
    const wire = [encodeZekaEvent({ t: "engine", engine: "gpt" }), encodeZekaEvent({ t: "delta", text: "7 gecikmiş " }).slice(0, 12), encodeZekaEvent({ t: "delta", text: "7 gecikmiş " }).slice(12) + encodeZekaEvent({ t: "delta", text: "kira var." }), encodeZekaEvent({ t: "final", result: RESULT }) + ZEKA_STREAM_DONE];
    const deltas: string[] = [];
    const engine = vi.fn();
    const out = await consumeZekaStream(streamOf(wire), { onEngine: engine, onDelta: (t) => deltas.push(t) });
    expect(engine).toHaveBeenCalledWith("gpt");
    expect(deltas.join("")).toBe("7 gecikmiş kira var.");
    expect(out).toEqual({ ok: true, result: RESULT });
  });

  it("akış ortası düşüş: reset gelir, yerel motor olayı ve yerel final ile biter", async () => {
    const local = { ...RESULT, engine: "local" as const, fallbackReason: "hata" };
    const wire = [encodeZekaEvent({ t: "engine", engine: "gpt" }), encodeZekaEvent({ t: "delta", text: "Yarım" }), encodeZekaEvent({ t: "reset" }), encodeZekaEvent({ t: "engine", engine: "local" }), encodeZekaEvent({ t: "final", result: local }), ZEKA_STREAM_DONE];
    let text = "";
    const engines: string[] = [];
    const out = await consumeZekaStream(streamOf(wire), { onEngine: (e) => engines.push(e), onDelta: (t) => (text += t), onReset: () => (text = "") });
    expect(text).toBe("");
    expect(engines).toEqual(["gpt", "local"]);
    expect(out).toMatchObject({ ok: true, result: { engine: "local", fallbackReason: "hata" } });
  });

  it("429 hata olayı nazik metinle döner", async () => {
    const out = await consumeZekaStream(streamOf([encodeZekaEvent({ t: "engine", engine: "local" }) + encodeZekaEvent({ t: "error", status: 429, error: "Bugünkü soru sınırına ulaşıldı." }) + ZEKA_STREAM_DONE]), {});
    expect(out).toEqual({ ok: false, status: 429, error: "Bugünkü soru sınırına ulaşıldı." });
  });

  it("final gelmeden biten ya da kopan akış hata döner (sessiz boş yanıt yok)", async () => {
    expect(await consumeZekaStream(streamOf([encodeZekaEvent({ t: "delta", text: "a" }), ZEKA_STREAM_DONE]), {})).toMatchObject({ ok: false, error: expect.stringMatching(/yarıda/) });
    expect(await consumeZekaStream(streamOf([encodeZekaEvent({ t: "delta", text: "a" })], { failAt: 1 }), {})).toMatchObject({ ok: false, status: 0, error: expect.stringMatching(/koptu/) });
  });

  it("iptal edilen akış aborted döner ve okumayı bırakır", async () => {
    const ctl = new AbortController();
    const out = await consumeZekaStream(
      streamOf([encodeZekaEvent({ t: "delta", text: "a" }), encodeZekaEvent({ t: "delta", text: "b" }), encodeZekaEvent({ t: "final", result: RESULT })]),
      { onDelta: () => ctl.abort() },
      ctl.signal,
    );
    expect(out).toMatchObject({ ok: false, aborted: true });
  });
});

describe("sunucu yanıt katmanı (zekaRespond)", () => {
  const base = { disabledMessage: "Kapalı.", failMessage: "Yanıt veremedi.", onError: vi.fn() };

  it("akışsız istek JSON döner: sonuç 200, sınır 429, kapalı 404, hata 500", async () => {
    const { zekaRespond } = await import("./stream-server");
    const sig = new AbortController().signal;
    const ok = await zekaRespond({ ...base, stream: false, signal: sig, run: async () => RESULT });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(RESULT);
    expect((await zekaRespond({ ...base, stream: false, signal: sig, run: async () => ({ limited: true }) })).status).toBe(429);
    expect((await zekaRespond({ ...base, stream: false, signal: sig, run: async () => ({ disabled: true }) })).status).toBe(404);
    const fail = await zekaRespond({ ...base, stream: false, signal: sig, run: async () => Promise.reject(new Error("x")) });
    expect(fail.status).toBe(500);
    expect(await fail.json()).toEqual({ error: "Yanıt veremedi." });
  });

  it("akışlı istek SSE döner: sink olayları + final + [DONE]; sınır 429 olayı", async () => {
    const { zekaRespond } = await import("./stream-server");
    const sig = new AbortController().signal;
    const res = await zekaRespond({
      ...base,
      stream: true,
      signal: sig,
      run: async (_s, sink) => {
        sink?.engine("gpt");
        sink?.delta("7 gecikmiş ");
        sink?.delta("kira var.");
        return RESULT;
      },
    });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text.endsWith(ZEKA_STREAM_DONE)).toBe(true);
    const events = createZekaStreamParser().push(text);
    expect(events.map((e) => e.t)).toEqual(["engine", "delta", "delta", "final"]);

    const limited = await zekaRespond({ ...base, stream: true, signal: sig, run: async () => ({ limited: true }) });
    expect(createZekaStreamParser().push(await limited.text())).toEqual([{ t: "error", status: 429, error: expect.stringMatching(/sınır/i) }]);
  });

  it("istemci kopunca motor sinyali iptal edilir; iptal hatası günlüğe yazılmaz", async () => {
    const { zekaRespond } = await import("./stream-server");
    const onError = vi.fn();
    const client = new AbortController();
    let engineSignal: AbortSignal | null = null;
    const res = await zekaRespond({
      ...base,
      onError,
      stream: true,
      signal: client.signal,
      run: (s) =>
        new Promise((_resolve, reject) => {
          engineSignal = s;
          s.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    });
    client.abort();
    const text = await res.text();
    expect(engineSignal!.aborted).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    expect(text).toBe(ZEKA_STREAM_DONE);
  });
});
