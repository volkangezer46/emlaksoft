import { redirect } from "next/navigation";
import { mergedHref } from "@/components/app/page-tabs";
import { requirePlatformModule } from "@/lib/platform";

export const metadata = { title: "Üretim hataları" };

/** ESKİ YOL: hata listesi artık Sistem sağlığı sayfasının "Üretim hataları" sekmesidir (kapı: `sistem`). */
export default async function ErrorLogsRedirectPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformModule("sistem");
  redirect(mergedHref("/admin/sistem", "hatalar", (await searchParams) ?? {}));
}
