import Link from "next/link";
import { KeyRound, Layers } from "lucide-react";
import { moneyTry } from "@/lib/leak-shield";
import { loadRentalsAndProjects, type HomeCtx } from "./data";

const cell =
  "focus-ring group block rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5 transition hover:border-brand-300 hover:bg-surface";

/**
 * Kiralama & projeler — sayılar /app/kiralama ve /app/projeler sayfalarının OKUDUĞU
 * filtre adlarıyla linklenir (kiralama: durum=pending | overdue, projeler: durum=aktif).
 * Modül verisi/yetkisi yoksa kart hiç render edilmez.
 */
export async function KiralamaProje({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.canSeeRentals && !ctx.canSeeProjects) return null;
  const { activeRentals, rentCharges, projects } = await loadRentalsAndProjects(ctx);

  const rentPendingThisMonth = rentCharges
    .filter((c) => (c.period ?? "").slice(0, 10) === ctx.monthStartKey && c.status === "pending")
    .reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const rentOverdueRows = rentCharges.filter((c) => c.status === "overdue");
  const rentOverdueSum = rentOverdueRows.reduce((s, c) => s + Number(c.amount ?? 0), 0);
  const showRentalCard = ctx.canSeeRentals && (activeRentals > 0 || rentCharges.length > 0);

  const activeProjectCount = projects.filter((p) => p.status !== "delivered").length;
  const allUnits = projects.flatMap((p) => p.units ?? []);
  const soldUnitCount = allUnits.filter((u) => u.status === "sold").length;
  const remainingUnitCount = Math.max(0, allUnits.length - soldUnitCount);
  const showProjectCard = ctx.canSeeProjects && projects.length > 0;

  if (!showRentalCard && !showProjectCard) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {showRentalCard && (
        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-xs font-semibold text-cyan-600">
              <KeyRound className="h-4 w-4" /> Kiralama
            </p>
            <Link href="/app/kiralama" className="text-xs font-semibold text-brand-600 hover:underline">
              Kira merkezi →
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Link href="/app/kiralama" className={cell}>
              <p className="font-display text-xl font-extrabold tabular-nums text-ink-950">{activeRentals}</p>
              <p className="text-xs text-text-muted">Aktif sözleşme</p>
            </Link>
            <Link href="/app/kiralama?durum=pending" className={cell}>
              <p className="font-display text-xl font-extrabold tabular-nums text-ink-950">
                {moneyTry(rentPendingThisMonth)}
              </p>
              <p className="text-xs text-text-muted">Bu ay tahsil edilecek</p>
            </Link>
            <Link
              href="/app/kiralama?durum=overdue"
              className={`focus-ring group block rounded-[var(--radius-card)] border px-3 py-2.5 transition hover:border-brand-300 ${
                rentOverdueRows.length > 0 ? "border-danger-500/30 bg-danger-500/5" : "border-line bg-canvas hover:bg-surface"
              }`}
            >
              <p
                className={`font-display text-xl font-extrabold tabular-nums ${
                  rentOverdueRows.length > 0 ? "text-danger-500" : "text-ink-950"
                }`}
              >
                {moneyTry(rentOverdueSum)}
              </p>
              <p className="text-xs text-text-muted">
                Gecikmiş{rentOverdueRows.length > 0 ? ` · ${rentOverdueRows.length} tahakkuk` : ""}
              </p>
            </Link>
          </div>
        </section>
      )}

      {showProjectCard && (
        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
              <Layers className="h-4 w-4" /> Projeler
            </p>
            <Link href="/app/projeler" className="text-xs font-semibold text-brand-600 hover:underline">
              Proje merkezi →
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Link href="/app/projeler?durum=aktif" className={cell}>
              <p className="font-display text-xl font-extrabold tabular-nums text-ink-950">{activeProjectCount}</p>
              <p className="text-xs text-text-muted">Aktif proje</p>
            </Link>
            <Link href="/app/projeler?durum=aktif" className={cell}>
              <p className="font-display text-xl font-extrabold tabular-nums text-mint-600">{soldUnitCount}</p>
              <p className="text-xs text-text-muted">Satılan birim</p>
            </Link>
            <Link href="/app/projeler?durum=selling" className={cell}>
              <p className="font-display text-xl font-extrabold tabular-nums text-ink-950">{remainingUnitCount}</p>
              <p className="text-xs text-text-muted">Kalan birim</p>
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
