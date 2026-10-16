import Link from "@/components/ui/smart-link";
import { Building2, ChevronRight, Search, UserPlus, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { importHref, type ImportStartTarget } from "@/lib/import-start";
import { SampleSeedButton } from "./sample-seed-button";

const CARDS: { target: ImportStartTarget; title: string; text: string; icon: typeof Users }[] = [
  { target: "customers", title: "Müşteriler", text: "Excel, Google Kişiler ya da telefon rehberi", icon: Users },
  { target: "properties", title: "Portföyler", text: "Excel ya da sahibinden.com mağaza listesi", icon: Building2 },
  { target: "demands", title: "Talepler", text: "Müşterilerin aradığı evler (bütçe, bölge, oda)", icon: Search },
];

/** Bu adımdan açılan içe aktarma "Geri" ile buraya döner. */
const BACK = "/app/baslangic?adim=veri";

/**
 * Kurulum 3. adımı "Verilerinizi taşıyın" (C27): ne taşınacağı üç büyük kartla seçilir, kart içe aktarma ekranını o hedefle
 * açar (`?hedef=`) ve "Geri" bu adıma döner (`?geri=`). Listesi olmayan ofis ilk müşterisini elle ekler ya da örnek
 * veriyle dener (boş ofiste, yetkisi varsa). Adım, ofiste örnek olmayan ilk müşteri/portföy kaydıyla kendiliğinden tamamlanır.
 */
export function VeriStep({ canImport, showSampleData, canSeedSample }: { canImport: boolean; showSampleData: boolean; canSeedSample: boolean }) {
  if (!canImport) {
    return <Alert tone="info">İçe aktarma için müşteri ekleme yetkisi gerekir. Bu adımı atlayabilirsiniz.</Alert>;
  }
  return (
    <div className="space-y-4">
      <p className="text-base font-semibold text-text">Ne taşıyorsunuz?</p>
      <ul className="grid gap-3 sm:grid-cols-3">
        {CARDS.map((c) => (
          <li key={c.target}>
            <Link
              href={importHref(c.target, BACK)}
              data-import-target={c.target}
              className="focus-ring press group flex min-h-24 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 transition hover:border-brand-300 sm:flex-col sm:items-start"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[var(--radius-card)] bg-brand-600/10 text-brand-600">
                <c.icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-base font-bold text-ink-950">{c.title}</span>
                <span className="mt-0.5 block text-sm text-text-muted">{c.text}</span>
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-text-faint sm:hidden" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Link href="/app/musteriler/yeni" className="focus-ring inline-flex min-h-11 items-center gap-1.5 font-semibold text-brand-600 hover:underline">
          <UserPlus className="h-4 w-4" aria-hidden /> Listem yok, ilk müşterimi elle ekleyeceğim
        </Link>
      </div>
      {showSampleData && canSeedSample ? <SampleSeedButton /> : null}
    </div>
  );
}
