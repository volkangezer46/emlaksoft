import { redirect } from "next/navigation";
import { requireModulePage } from "@/lib/require-module-page";

type SearchParams = { sirala?: string; filtre?: string };

/**
 * Karşılaştır, Karne içine taşındı (/app/danisman-kpi?gorunum=kiyas).
 * Eski yol ve paket kapısı korunur; filtre/sıralama aktarılır.
 */
export default async function TeamBenchmarkRedirect({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  await requireModulePage("reports", "/app/ekip/kiyas");
  const sp = (await searchParams) ?? {};
  const q = new URLSearchParams({ gorunum: "kiyas" });
  if (sp.sirala) q.set("sirala", sp.sirala);
  if (sp.filtre) q.set("filtre", sp.filtre);
  redirect(`/app/danisman-kpi?${q.toString()}`);
}
