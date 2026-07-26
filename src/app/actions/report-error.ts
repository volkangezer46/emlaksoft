"use server";

import { headers } from "next/headers";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { logError } from "@/lib/error-log";

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
export async function reportClientError(input: {
  message: string;
  digest?: string;
  stack?: string;
  path?: string;
}): Promise<void> {
  const user = await getRequestUser().catch(() => null);
  const h = await headers().catch(() => null);

  await logError({
    source: "client",
    message: input.message,
    digest: input.digest ?? null,
    stack: input.stack ?? null,
    path: input.path ?? null,
    userAgent: h?.get("user-agent") ?? null,
    // Kimlik yalnızca oturumdan — parametreden ASLA.
    tenantId: (user?.app_metadata?.tenant_id as string | undefined) ?? null,
    userId: user?.id ?? null,
  });
}
