/** Test yardımcıları: sahte sağlayıcı HTTP'si (yalnız test dosyalarından import edilir). */
import { vi } from "vitest";

export type RecordedCall = { url: string; method: string; headers: Record<string, string>; body: string | null };
export type FakeReply = { status?: number; json?: unknown; text?: string; headers?: Record<string, string>; bytes?: Uint8Array };

export function installFakeFetch(handler: (call: RecordedCall) => FakeReply | undefined): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const headers: Record<string, string> = {};
      const raw = init?.headers;
      if (raw && typeof raw === "object") {
        for (const [k, v] of Object.entries(raw as Record<string, string>)) headers[k] = v;
      }
      const call: RecordedCall = {
        url: String(input),
        method: init?.method ?? "GET",
        headers,
        body: typeof init?.body === "string" ? init.body : null,
      };
      calls.push(call);
      const reply = handler(call) ?? { status: 404, json: { Message: "yok" } };
      const status = reply.status ?? 200;
      const baseHeaders = { ...(reply.headers ?? {}) };
      if (reply.bytes) {
        return new Response(reply.bytes as unknown as BodyInit, { status, headers: { "content-type": "application/pdf", ...baseHeaders } });
      }
      const body = reply.text ?? (reply.json !== undefined ? JSON.stringify(reply.json) : "");
      return new Response(body, { status, headers: { "content-type": "application/json", ...baseHeaders } });
    }),
  );
  return calls;
}

export function restoreFetch(): void {
  vi.unstubAllGlobals();
}

export const SAMPLE_DRAFT = {
  uuid: "11111111-2222-4333-8444-555555555555",
  issueDate: "2026-10-10",
  buyer: { name: "Örnek Yapı A.Ş.", taxId: "1234567890", taxOffice: "Kadıköy", address: "Caferağa Mah. Moda Cad. 1", city: "İstanbul", district: "Kadıköy" },
  lines: [{ description: "Satış aracılık hizmet bedeli", quantity: 1, unitPrice: 100000, vatRate: 20 }],
  note: null as string | null,
};
