import { PageTabs, type PageTab } from "@/components/app/page-tabs";
import { ICONS } from "@/lib/icons";
import { requireModulePage } from "@/lib/require-module-page";
import { CallsView } from "../arama/calls-view";
import { InboxView } from "./inbox-view";

export const metadata = { title: "Gelen Kutusu" };

const TABS: readonly PageTab[] = [
  { id: "akis", label: "İletişim akışı", icon: ICONS.gelenKutusu },
  { id: "cagri", label: "Çağrı kaydı", icon: ICONS.telefon },
];

/**
 * Gelen Kutusu: iletişim akışı + çağrı kaydı (eski /app/arama) tek sayfada.
 * `?sekme=cagri` çağrı kaydını açar; iki sekme de `calls` modülündedir (tek kapı).
 * Eski /app/arama yolu parametreleri koruyarak buraya yönlendirir.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
  sekme?: string;
  q?: string;
  kanal?: string;
  yon?: string;
  from?: string;
  to?: string;
  durum?: string;
  sayfa?: string;
  danisman?: string;
  sonuc?: string;
  customer?: string;
}>;
}) {
  await requireModulePage("calls", "/app/gelen-kutusu");
  const sp = await searchParams;
  const active = sp.sekme === "cagri" ? "cagri" : "akis";
  const rest = Promise.resolve(sp);

  return (
    <div className="space-y-6">
      <PageTabs base="/app/gelen-kutusu" label="Gelen kutusu sekmeleri" tabs={TABS} active={active} />
      {active === "cagri" ? <CallsView searchParams={rest} /> : <InboxView searchParams={rest} />}
    </div>
  );
}
