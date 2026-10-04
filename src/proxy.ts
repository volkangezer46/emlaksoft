import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Kimlik-doğrulama yalnız /app, /admin, /giris, /kayit için çözülür (getUser() ağ çağrısı);
  // diğer public sayfalarda yalnız bakım modu bayrağı (30 sn bellek önbellekli) okunur.
  // API (cron, webhook, health), _next ve uzantılı statik dosyalar proxy dışındadır.
  matcher: ["/((?!api/|_next/|.*\\..*).*)"],
};
