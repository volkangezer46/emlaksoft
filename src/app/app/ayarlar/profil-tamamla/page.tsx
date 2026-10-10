import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";
import { resolveLegacyStep } from "@/lib/onboarding-steps";

export const metadata = { title: "Kurulum" };

/**
 * Eski "Ofis profilini tamamla" adresi: tek Kurulum sihirbazına (`/app/baslangic`) yönlenir. Eski `?adim=` değerleri
 * (konum, iletisim, fatura, marka, odak, ekip) yeni adıma eşlenir; eski bağlantılar kırılmaz. Yetki kapısı hedef sayfadadır.
 */
export default async function ProfileCompleteRedirect({ searchParams }: { searchParams: Promise<{ adim?: string }> }) {
  await requireModulePage("dashboard");
  const { adim } = await searchParams;
  const step = resolveLegacyStep(adim);
  redirect(step ? `/app/baslangic?adim=${step}` : "/app/baslangic");
}
