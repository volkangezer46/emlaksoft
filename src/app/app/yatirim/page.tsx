import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";

export const metadata = { title: "Yatırım getirisi analizi" };

/**
 * ESKİ YOL (yer imi / müşteriye gönderilmiş linkler): yatırım analizi artık
 * /app/hesaplayici içinde ikinci sekmedir. Tüm sorgu parametreleri korunarak
 * yönlendirilir; kapı aynıdır (`valuation`).
 */
export default async function InvestmentRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireModulePage("valuation");
  const sp = await searchParams;
  const qs = new URLSearchParams({ sekme: "yatirim" });
  for (const [key, value] of Object.entries(sp)) {
    if (key === "sekme") continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v != null) qs.set(key, v);
  }
  redirect(`/app/hesaplayici?${qs.toString()}`);
}
