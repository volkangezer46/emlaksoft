import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";

/**
 * Eski yer imi: "Riskli müşteriler" Akıllı listeler'in "Kaybedilme riski yüksek" bölümüne taşındı
 * (satır eylemleri ve kayıp nedenleri orada). Müşteri modülü kapısı korunur.
 */
export default async function KayipSatisPage() {
  await requireModulePage("customers", "/app/kayip-satis");
  redirect("/app/akilli-listeler?segment=churn");
}
