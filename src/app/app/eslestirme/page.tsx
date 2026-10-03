import { redirect } from "next/navigation";
import { mergedHref } from "@/components/app/page-tabs";
import { requireModulePage } from "@/lib/require-module-page";

export const metadata = { title: "Müşteriye uygun ilanlar" };

/**
 * ESKİ YOL (yer imi, bildirim ve portal bağlantıları): eşleştirme artık Talepler'in
 * "Eşleşme" sekmesidir. demand/property/customer/kriter/kademe/minSkor/sayfa parametreleri
 * korunur; kapı aynıdır (`matching`).
 */
export default async function MatchingRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("matching");
  redirect(mergedHref("/app/talepler", "eslesme", await searchParams));
}
