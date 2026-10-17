import type { ZekaEngineId, ZekaResult } from "./types";

/**
 * Zeka AKIŞ PROTOKOLÜ (SAF, bağımlılıksız; sunucu kodlar, istemci ayrıştırır). İstek gövdesinde `stream: true` olan
 * yanıt istekleri `text/event-stream` döner; her olay tek satırlık `data: <JSON>\n\n`, akış `data: [DONE]` ile biter:
 *
 *   {"t":"engine","engine":"gpt"|"local"}  motor seçildi (başlıktaki durum satırı hemen güncellenir)
 *   {"t":"delta","text":"…"}               GPT metin parçası (yerel motorda gönderilmez)
 *   {"t":"reset"}                          o ana kadarki metni sil (GPT akış ortasında düştü ya da araç turuna geçti)
 *   {"t":"final","result":ZekaResult}      YETKİLİ sonuç: kartlar, eylemler, devam soruları, logId; metni de değiştirir
 *   {"t":"error","status":429,"error":"…"} Türkçe hata (429 = günlük sınır; 404 = yüzey kapalı; 500 = beklenmeyen)
 *
 * Akış başlamadan reddedilen istekler (doğrulama, hız sınırı, yetki) eskisi gibi JSON + HTTP durumu döner; `stream`
 * olmayan istekler (/sor JS'siz yolu, komut paleti, testler) değişmeden JSON alır.
 */

export type ZekaStreamEvent =
  | { t: "engine"; engine: ZekaEngineId }
  | { t: "delta"; text: string }
  | { t: "reset" }
  | { t: "final"; result: ZekaResult }
  | { t: "error"; status: number; error: string };

/** Sunucu motorlarının akış çıkışı (yalnız `stream: true` isteklerinde verilir). */
export type ZekaStreamSink = {
  engine: (engine: ZekaEngineId) => void;
  delta: (text: string) => void;
  reset: () => void;
};

export const ZEKA_STREAM_DONE = "data: [DONE]\n\n";

export function encodeZekaEvent(event: ZekaStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function asEvent(raw: unknown): ZekaStreamEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  switch (e.t) {
    case "engine":
      return e.engine === "gpt" || e.engine === "local" ? { t: "engine", engine: e.engine } : null;
    case "delta":
      return typeof e.text === "string" && e.text ? { t: "delta", text: e.text } : null;
    case "reset":
      return { t: "reset" };
    case "final": {
      const r = e.result as Partial<ZekaResult> | null;
      return r && typeof r === "object" && typeof r.answer === "string" && Array.isArray(r.cards) && Array.isArray(r.actions) && Array.isArray(r.followUps)
        ? { t: "final", result: r as ZekaResult }
        : null;
    }
    case "error":
      return { t: "error", status: typeof e.status === "number" ? e.status : 500, error: typeof e.error === "string" && e.error ? e.error : "Zeka şu an yanıt veremedi." };
    default:
      return null;
  }
}

/**
 * Artımlı ayrıştırıcı: ağdan gelen parçalar olay sınırına denk gelmeyebilir (yarım satır, birden çok olay tek parçada).
 * Bozuk/bilinmeyen satırlar atlanır; `[DONE]` sonrası her şey yok sayılır.
 */
export function createZekaStreamParser() {
  let buffer = "";
  let done = false;
  const drain = (final: boolean): ZekaStreamEvent[] => {
    const out: ZekaStreamEvent[] = [];
    const parts = buffer.split(/\r?\n/);
    buffer = final ? "" : (parts.pop() ?? "");
    for (const line of parts) {
      if (done) break;
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        done = true;
        break;
      }
      try {
        const evt = asEvent(JSON.parse(data));
        if (evt) out.push(evt);
      } catch {
        // yarım ya da bozuk satır: atla
      }
    }
    return out;
  };
  return {
    push(chunk: string): ZekaStreamEvent[] {
      if (done) return [];
      buffer += chunk;
      return drain(false);
    },
    end(): ZekaStreamEvent[] {
      if (done) return [];
      buffer += "\n";
      return drain(true);
    },
    get done() {
      return done;
    },
  };
}

export type ZekaStreamHandlers = {
  onEngine?: (engine: ZekaEngineId) => void;
  onDelta?: (text: string) => void;
  onReset?: () => void;
};

export type ZekaStreamOutcome =
  | { ok: true; result: ZekaResult }
  | { ok: false; error: string; status: number; aborted?: boolean };

/**
 * Bir SSE gövdesini okur ve olayları işleyicilere dağıtır. `final` gelirse sonuç, `error` gelirse hata döner; ikisi de
 * gelmeden akış biterse "yarıda kesildi" hatası. İptal (AbortSignal) `aborted: true` döner.
 */
export async function consumeZekaStream(body: ReadableStream<Uint8Array>, handlers: ZekaStreamHandlers, signal?: AbortSignal): Promise<ZekaStreamOutcome> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createZekaStreamParser();
  let outcome: ZekaStreamOutcome | null = null;
  const apply = (events: ZekaStreamEvent[]) => {
    for (const e of events) {
      if (outcome) return;
      if (e.t === "engine") handlers.onEngine?.(e.engine);
      else if (e.t === "delta") handlers.onDelta?.(e.text);
      else if (e.t === "reset") handlers.onReset?.();
      else if (e.t === "final") outcome = { ok: true, result: e.result };
      else outcome = { ok: false, error: e.error, status: e.status };
    }
  };
  try {
    for (;;) {
      if (signal?.aborted) return { ok: false, error: "", status: 0, aborted: true };
      const { done, value } = await reader.read();
      if (done) break;
      apply(parser.push(decoder.decode(value, { stream: true })));
      if (outcome || parser.done) break;
    }
    if (!outcome) apply(parser.end());
  } catch (e) {
    if (signal?.aborted || (e as Error)?.name === "AbortError") return { ok: false, error: "", status: 0, aborted: true };
    return { ok: false, error: "Bağlantı koptu. Yanıt yarıda kesildi; tekrar deneyin.", status: 0 };
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return outcome ?? { ok: false, error: "Yanıt yarıda kesildi. Lütfen tekrar deneyin.", status: 0 };
}
