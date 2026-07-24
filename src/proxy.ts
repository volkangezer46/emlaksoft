import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Yalnızca kimlik-doğrulama mantığının gerektiği yollarda çalış.
  // Public/marketing/vitrin/token/api sayfaları her istekte gereksiz
  // getUser() ağ çağrısı yapmasın — public trafikte büyük gecikme kazancı.
  matcher: ["/app/:path*", "/admin/:path*", "/giris", "/kayit"],
};
