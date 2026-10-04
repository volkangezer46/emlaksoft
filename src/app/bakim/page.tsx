import Link from "next/link";
import { Wrench } from "lucide-react";
import { getGeneralSettings } from "@/lib/platform-flags";

export const metadata = {
  title: "Bakımdayız",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const DEFAULT_MESSAGE =
  "EmlakSoft kısa süreli planlı bakımda. Verileriniz güvende; çok yakında yeniden buradayız.";

/** Bakım modu sayfası: proxy bakım açıkken public ve /app isteklerini buraya yazar (503). */
export default async function MaintenancePage() {
  const settings = await getGeneralSettings().catch(() => null);
  const message = settings?.maintenanceMessage || DEFAULT_MESSAGE;
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-md rounded-[var(--radius-panel)] border border-line bg-surface p-8 text-center shadow-[var(--shadow-xs)]">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-amber-400/15 text-amber-600">
          <Wrench className="h-6 w-6" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-extrabold text-ink-950">Bakımdayız</h1>
        <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-text-muted">{message}</p>
        <Link
          href="/giris"
          className="mt-6 inline-flex min-h-[42px] items-center rounded-[var(--radius-control)] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted transition hover:border-brand-300 hover:text-text"
        >
          Yönetici girişi
        </Link>
      </div>
    </main>
  );
}
