import Link from "@/components/ui/smart-link";
import { ArrowRight, FileSpreadsheet, Home, Rocket, UserPlus, type LucideIcon } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { effectiveHasPermission } from "@/lib/permissions-effective";
import { loadOnboardingState, type HomeCtx } from "./data";

type Kisayol = { key: string; href: string; label: string; Icon: LucideIcon };

/**
 * YENİ OFİS KAHRAMANI (sadeleştirme planı 2.4; ilk 14 gün ya da kurulum bitene kadar, karar `showNewOfficeHero`):
 * TEK "Sıradaki adım" kartı (kurulum sihirbazının sıradaki adımı, tek birincil düğme) + 3 kısa yol: Müşteri ekle,
 * Portföy ekle, Excel'den yükle. Bu sürede öneriler ve kurulum listesi gösterilmez (tek "buradan başla" kalır).
 * Kısa yol yalnız o kaydı oluşturabilene çizilir.
 */
export async function YeniOfisHero({ ctx }: { ctx: HomeCtx }) {
  const state = await loadOnboardingState(ctx);
  if (!state) return null;
  const next = state.steps.find((s) => s.id === state.nextId) ?? null;
  const kisayollar: Kisayol[] = [];
  if (effectiveHasPermission(ctx.perms, "customers", "create")) kisayollar.push({ key: "musteri", href: "/app/musteriler/yeni", label: "Müşteri ekle", Icon: UserPlus });
  if (effectiveHasPermission(ctx.perms, "properties", "create")) kisayollar.push({ key: "portfoy", href: "/app/portfoyler/yeni", label: "Portföy ekle", Icon: Home });
  if (effectiveHasPermission(ctx.perms, "customers", "create")) kisayollar.push({ key: "excel", href: "/app/ice-aktarma", label: "Excel'den yükle", Icon: FileSpreadsheet });

  return (
    <section aria-labelledby="siradaki-adim-baslik" className="flex flex-col gap-3" data-tour="kurulum">
      <div className="ds-card ds-pad flex flex-col gap-4 border border-brand-300/60 bg-brand-600/[0.04] sm:flex-row sm:items-center">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-600/10 text-brand-600" aria-hidden="true">
          <Rocket className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-muted">
            Sıradaki adım · {state.doneCount}/{state.total}
          </p>
          <h2 id="siradaki-adim-baslik" className="font-display text-xl font-bold text-ink-950">
            {next ? next.title : "Kurulumu gözden geçirin"}
          </h2>
          {next?.description ? <p className="mt-1 text-[15px] text-text-muted">{next.description}</p> : null}
        </div>
        <ButtonLink href={`/app/baslangic${next ? `?adim=${next.id}` : ""}`} size="lg" iconRight={ArrowRight} className="h-11 shrink-0">
          Başla
        </ButtonLink>
      </div>
      {kisayollar.length > 0 ? (
        <nav aria-label="Kısa yollar" className="grid grid-cols-3 gap-2">
          {kisayollar.map((k) => (
            <Link
              key={k.key}
              href={k.href}
              className="focus-ring press flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-[var(--radius-card)] border border-hairline bg-surface-raised p-3 text-center shadow-[var(--elev-1)] transition hover:bg-surface-hover"
            >
              <k.Icon className="h-5 w-5 text-brand-600" aria-hidden="true" />
              <span className="text-sm font-semibold text-text">{k.label}</span>
            </Link>
          ))}
        </nav>
      ) : null}
    </section>
  );
}
