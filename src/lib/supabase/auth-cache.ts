import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Request başına TEK `getUser()`.
 *
 * `@supabase/ssr` içinde `auth.getUser()` her çağrıda Supabase Auth sunucusuna
 * gidip JWT'yi doğrular (ağ round-trip'i). Aynı istek yaşam döngüsünde bu fonksiyon
 * onlarca yerden (auth gate'ler, platform staff kontrolü, tenant guard) çağrılıyor.
 * React `cache()` ile istek başına bir kez çalışır; kalan çağrılar bellekten döner.
 */
export const getRequestUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
