import { redirect } from "next/navigation";
import { LISTING_POOL_PATH, parseTab, tabHref } from "@/lib/office-center/logic";
import { OFFICE_CENTER_PATH } from "@/lib/office-center/types";
import { requireModulePage } from "@/lib/require-module-page";

export const metadata = { title: "Ekip Merkezi" };

type Sp = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

/**
 * Ofis Merkezi artık ayrı bir ekran DEĞİL: danışmanlar, istatistikler, talep dağıtımı ve tanımlar Ekip Merkezi'nin
 * (`/app/ekip`) sekmeleridir. Bu yol eski yer imleri, e-posta bağlantıları ve modül kapısı için korunur; sayfa kapıdan
 * geçirir ve aynı filtrelerle tek hub'a yönlendirir. "Atamalar" sekmesi kalktı → atama tek ekranı İlan Havuzu.
 */
export default async function OfficeCenterRedirect({ searchParams }: { searchParams: Promise<Sp> }) {
  await requireModulePage("office_center", OFFICE_CENTER_PATH);
  const sp = await searchParams;
  if (first(sp.sekme) === "atamalar") redirect(LISTING_POOL_PATH);
  const tab = parseTab(sp.sekme);
  const extra: Record<string, string | undefined> = {};
  for (const k of ["durum", "q", "rol", "sube", "sirala", "yon"]) extra[k] = first(sp[k]) || undefined;
  redirect(tabHref(tab, extra));
}
