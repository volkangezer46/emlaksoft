import "server-only";
import { NextResponse } from "next/server";
import { SSE_HEADERS } from "@/lib/ai/streaming";
import { encodeZekaEvent, ZEKA_STREAM_DONE, type ZekaStreamEvent, type ZekaStreamSink } from "./stream-protocol";
import { ZEKA_DAILY_LIMIT_MESSAGE } from "./policy";
import type { ZekaResult } from "./types";

/**
 * Dört Zeka uç noktasının ORTAK yanıt katmanı: aynı motor çağrısı iki biçimde döner.
 *  - JSON (varsayılan; /sor JS'siz yolu, komut paleti, öneri kipi, testler): sonuç ya da `{error}` + HTTP durumu.
 *  - Akış (`stream: true`, yalnız yanıt kipi): `stream-protocol.ts` olayları (engine → delta… → final | error).
 * İstemci bağlantıyı kapatırsa (Durdur, pencereyi kapatma) motor sinyali iptal edilir: GPT çağrısı kesilir.
 */

export type ZekaOutcome = ZekaResult | { disabled: true } | { limited: true };

export type ZekaRespondSpec = {
  /** İstek akış istedi mi (`body.stream === true` ve yanıt kipi). */
  stream: boolean;
  signal: AbortSignal;
  run: (signal: AbortSignal, sink: ZekaStreamSink | undefined) => Promise<ZekaOutcome>;
  disabledMessage: string;
  failMessage: string;
  onError: (error: unknown) => void;
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function zekaRespond(spec: ZekaRespondSpec): Promise<Response> {
  if (!spec.stream) {
    try {
      const out = await spec.run(spec.signal, undefined);
      if ("disabled" in out) return json({ error: spec.disabledMessage }, 404);
      if ("limited" in out) return json({ error: ZEKA_DAILY_LIMIT_MESSAGE }, 429);
      return json(out);
    } catch (error) {
      spec.onError(error);
      return json({ error: spec.failMessage }, 500);
    }
  }

  const encoder = new TextEncoder();
  const ctl = new AbortController();
  const abort = () => ctl.abort();
  if (spec.signal.aborted) ctl.abort();
  else spec.signal.addEventListener("abort", abort, { once: true });
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const send = (e: ZekaStreamEvent) => write(encodeZekaEvent(e));
      const sink: ZekaStreamSink = {
        engine: (engine) => send({ t: "engine", engine }),
        delta: (text) => {
          if (text) send({ t: "delta", text });
        },
        reset: () => send({ t: "reset" }),
      };
      void spec
        .run(ctl.signal, sink)
        .then((out) => {
          if ("disabled" in out) send({ t: "error", status: 404, error: spec.disabledMessage });
          else if ("limited" in out) send({ t: "error", status: 429, error: ZEKA_DAILY_LIMIT_MESSAGE });
          else send({ t: "final", result: out });
        })
        .catch((error: unknown) => {
          if (ctl.signal.aborted) return;
          spec.onError(error);
          send({ t: "error", status: 500, error: spec.failMessage });
        })
        .finally(() => {
          spec.signal.removeEventListener("abort", abort);
          write(ZEKA_STREAM_DONE);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // akış zaten kapalı
            }
          }
        });
    },
    cancel() {
      closed = true;
      ctl.abort();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
