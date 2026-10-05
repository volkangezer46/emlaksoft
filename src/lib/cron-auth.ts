import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Cron yetki kapısı (TEK MERKEZ): `Authorization: Bearer <CRON_SECRET>` doğrular.
 * - Secret tanımsızsa 503 (`cron_not_configured`): yapılandırılmamış ortam sessizce açık kalmaz.
 * - Karşılaştırma `crypto.timingSafeEqual` (uzunluk farkı da eşit maliyetle reddedilir).
 */
export function isCronAuthorized(authorizationHeader: string | null, secret: string | undefined): boolean {
  const expected = secret?.trim();
  if (!expected || !authorizationHeader) return false;
  const given = Buffer.from(authorizationHeader);
  const want = Buffer.from(`Bearer ${expected}`);
  if (given.length !== want.length) {
    timingSafeEqual(want, want);
    return false;
  }
  return timingSafeEqual(given, want);
}

/** null = yetkili; aksi halde doğrudan döndürülecek 401/503 yanıtı. */
export function authorizeCron(req: Pick<Request, "headers">): NextResponse | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ ok: false, error: "cron_not_configured" }, { status: 503 });
  if (!isCronAuthorized(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  return null;
}
