import { notFound } from "next/navigation";
import { getRequestUser } from "@/lib/supabase/auth-cache";

export const metadata = { title: "Sayfa bulunamadı" };

/**
 * Olmayan /app yolları KABUK İÇİNDE 404 gösterir (`app/app/not-found.tsx`; menü yerinde kalır). Yönlendirme YOK:
 * yalnız `notFound()`. Oturum kapısı istek-içi önbellekli kimlikten (proxy zaten oturumsuz isteği girişe gönderir).
 */
export default async function BilinmeyenSayfa(): Promise<never> {
  await getRequestUser();
  notFound();
}
