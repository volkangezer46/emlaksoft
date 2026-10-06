import { createHash } from "node:crypto";
import { notifyTenant, type NotifPrefKey } from "@/lib/notify";

/**
 * Devir / atama bildirimleri (müşteri tekil-toplu devri, portföy devri, ekip iş yükü devri, başkası adına randevu,
 * ödeme bağlantısı tahsilatı). TEK YOL `notifyTenant`: kullanıcı tercihi (`prefKey`), ofis varsayılanı ve tek seferlik
 * anahtar (`dedupeKey`, çift gönderimde ikinci bildirim yazılmaz) orada uygulanır. Bildirim hatası iş akışını
 * BOZMAZ (atama/devir zaten yazıldı): yakalanır ve loglanır. Yalnız sunucu kodundan çağrılır (notify service_role
 * kullanır); "server-only" işareti bilinçli yok: `payment-link-fulfill` birim testleri bu modülü içe aktarır.
 */
export async function notifyAssignment(input: {
  tenantId: string;
  userId: string;
  title: string;
  body: string;
  href: string;
  dedupeKey: string;
  prefKey?: NotifPrefKey;
  kind?: "info" | "success" | "warning";
}): Promise<void> {
  try {
    await notifyTenant({
      tenantId: input.tenantId,
      userId: input.userId,
      title: input.title,
      body: input.body,
      href: input.href,
      kind: input.kind ?? "info",
      prefKey: input.prefKey ?? "assignment",
      dedupeKey: input.dedupeKey.slice(0, 200),
    });
  } catch (e) {
    console.error("atama bildirimi", e);
  }
}

/** Kimlik kümesinin kısa, sıra bağımsız özeti (toplu işlem anahtarı için). */
export function idsDigest(ids: readonly string[]): string {
  return createHash("sha256").update([...ids].sort().join(","), "utf8").digest("hex").slice(0, 16);
}
