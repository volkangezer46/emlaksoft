"use server";

import { headers } from "next/headers";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { logError } from "@/lib/error-log";
import { parseClientErrorReport } from "@/lib/client-error-report";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

/**
 * İstemci hata sınırlarının çağırdığı ince sarmalayıcı.
 *
 * TASARIM KARARI — kiracı kimliği ÇAĞIRANDAN ALINMAZ: Bu bir Server Action,
 * yani tarayıcıdan doğrudan çağrılabilir. `tenantId`'yi parametre olarak
 * alsaydı, herkes istediği kiracıya hata satırı yazdırabilirdi. Kimlik
 * yalnızca OTURUMDAN çözülüyor; oturum yoksa kiracı NULL kalıyor (giriş
 * öncesi hatalar da kaydedilmeli).
 *
 * Yetki kapısı bilinçli olarak YOK: hata bildirimi oturumu olmayan
 * kullanıcıdan da gelebilmeli — zaten en çok merak edilen hatalar onlar.
 * Yazma yolu `logError` içinde sınırlı: yalnızca metin alanları, hepsi
 * kırpılıyor ve aynı parmak izi yeni satır değil sayaç artışı üretiyor.
 * Bu, kötü niyetli çağrının etkisini "bir sayacı şişirmek" ile sınırlıyor.
 */
export async function reportClientError(input: unknown): Promise<void> {
  const parsed = parseClientErrorReport(input);
  if (!parsed) return;

  const ip = await clientIp().catch(() => "unknown");
  const rate = await checkRateLimit(`client-error:${ip}`, {
    limit: 20,
    windowSec: 300,
    failurePolicy: "deny",
  });
  if (!rate.allowed) return;

  const user = await getRequestUser().catch(() => null);
  const h = await headers().catch(() => null);

  await logError({
    source: "client",
    message: parsed.message,
    digest: parsed.digest ?? null,
    stack: parsed.stack ?? null,
    path: parsed.path ?? null,
    userAgent: h?.get("user-agent") ?? null,
    // Kimlik yalnızca oturumdan — parametreden ASLA.
    tenantId: (user?.app_metadata?.tenant_id as string | undefined) ?? null,
    userId: user?.id ?? null,
  });
}
