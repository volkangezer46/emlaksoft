import { handleBeacon } from "@/lib/measure/beacon";

/**
 * Birinci taraf ölçüm işaretçisi (çerezsiz sayaç + gerçek kullanıcı hız ölçümü). Kurallar: src/lib/measure/beacon.ts.
 * Yanıt gövdesizdir (204/413/429/400); istemci `sendBeacon` yanıtı okumaz.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  return handleBeacon(req);
}
