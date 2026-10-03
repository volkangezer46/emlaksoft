import { redirect } from "next/navigation";
import { mergedHref } from "@/components/app/page-tabs";
import { requireModulePage } from "@/lib/require-module-page";

export const metadata = { title: "Çağrı kaydı" };

/**
 * ESKİ YOL (yer imi / bağlantılar): çağrı kaydı artık Gelen Kutusu'nun ikinci
 * sekmesidir. Sorgu parametreleri korunur; kapı aynıdır (`calls`).
 */
export default async function CallsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("calls");
  redirect(mergedHref("/app/gelen-kutusu", "cagri", await searchParams));
}
