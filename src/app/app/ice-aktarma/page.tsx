import Link from "next/link";
import { ArrowLeft, FileSpreadsheet, UploadCloud } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { ImportWizard } from "./import-wizard";

export const metadata = { title: "İçe aktarma" };

/**
 * CSV içe aktarma sihirbazı — başka programdan/Excel'den taşınan müşteri ve
 * portföy listelerini üç adımda içeri alır. Sayfa kapısı "customers" modülü;
 * portföy aktarımı ayrıca server action'da "properties.create" ile korunur.
 */
export default async function ImportPage() {
  await requireModulePage("customers");

  return (
    <div className="space-y-6">
      <Link
        href="/app/ayarlar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Ayarlara dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/35 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <UploadCloud className="h-4 w-4" /> Veri taşıma
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">CSV içe aktarma</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Eski programınızdan veya Excel&apos;den aldığınız müşteri ve portföy listelerini üç
            adımda EmlakSoft&apos;a taşıyın: dosya yükleyin, kolonları eşleyin, sonucu görün.
            Telefonu zaten kayıtlı müşteriler mükerrer korumasıyla atlanır.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-white/70">
            <FileSpreadsheet className="h-3.5 w-3.5 text-mint-400" />
            Excel dosyanızı &quot;Farklı Kaydet → CSV&quot; ile kaydedin — .xlsx doğrudan desteklenmez.
          </p>
        </div>
      </section>

      <ImportWizard />
    </div>
  );
}
