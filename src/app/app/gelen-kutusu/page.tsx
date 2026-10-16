import { PageViewSwitch, type PageTab } from "@/components/app/page-tabs";
import { ICONS } from "@/lib/icons";
import { requireModulePage } from "@/lib/require-module-page";
import { CallsView } from "./calls-view";
import { InboxView } from "./inbox-view";
import { ConversationsView } from "./conversations-view";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  const sekme = (await searchParams).sekme;
  return { title: sekme === "cagri" ? "Çağrı kaydı · Gelen kutusu" : sekme === "akis" ? "Tüm akış · Gelen kutusu" : "Gelen kutusu" };
}

const TABS: readonly PageTab[] = [
  { id: "konusma", label: "Konuşmalar", icon: ICONS.mesaj },
  { id: "akis", label: "Tüm akış", icon: ICONS.gelenKutusu },
  { id: "cagri", label: "Çağrı kaydı", icon: ICONS.telefon },
];

/**
 * Gelen Kutusu: konuşmalar (varsayılan; kişi bazlı, "yanıt bekliyor") + tüm iletişim akışı + çağrı kaydı tek sayfada.
 * `?sekme=akis` kronolojik akışı, `?sekme=cagri` çağrı kaydını açar; üç sekme de `calls` modülündedir (tek kapı).
 * `?customer=<id>` (müşteri kartı / "yanıt bekleyen" önerisi) konuşmayı doğrudan açar.
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
  tel?: string;
}>;
}) {
  await requireModulePage("calls", "/app/gelen-kutusu");
  const sp = await searchParams;
  const active = sp.sekme === "cagri" ? "cagri" : sp.sekme === "akis" ? "akis" : "konusma";
  const rest = Promise.resolve(sp);

  return (
    <div className="space-y-6">
      {/* Müşteriler şeridi "Gelen kutusu" sekmesindedir; alt görünümler ikinci şerit değil, sağdaki Görünüm anahtarıdır. */}
      <PageViewSwitch base="/app/gelen-kutusu" label="Görünüm" tabs={TABS} active={active} />
      {active === "cagri" ? (
        <CallsView searchParams={rest} />
      ) : active === "akis" ? (
        <InboxView searchParams={rest} />
      ) : (
        <ConversationsView searchParams={rest} />
      )}
    </div>
  );
}
