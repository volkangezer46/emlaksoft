import { financePath } from "@/lib/finance/routes";
import Link from "@/components/ui/smart-link";
import { CalendarDays, Receipt, Send, UserPlus, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { HomeCtx } from "./data";

type Tile = { key: string; href: string; title: string; Icon: LucideIcon };

export function BugunKisayolIskelet() {
  return (
    <div role="status" aria-busy="true" className="grid grid-cols-2 gap-2">
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

/**
 * Danışman kısayolları — ana ekranda TEK yerde (sadeleştirme planı C07: "kısayollar yalnız bir kez"; eski "Ne yapmak
 * istiyorsun?" çipleri kaldırıldı). Kısa, tek satırlık kartlar: Müşteri ekle, Randevularım, İlan gönder, Kazancım.
 * Yalnız yetkisi olunan kısayol çizilir. Yönetimde yoktur: işleri "Senden bekleyenler" ve "Para" kartlarındadır.
 */
export function BugunKisayol({ ctx }: { ctx: HomeCtx }) {
  const can = (mod: string, action: string) => ((ctx.perms as Record<string, string[] | undefined>)[mod] ?? []).includes(action);
  const tiles: Tile[] = [];
  if (can("customers", "create")) tiles.push({ key: "musteri", href: "/app/musteriler/yeni", title: "Müşteri ekle", Icon: UserPlus });
  if (can("appointments", "view")) tiles.push({ key: "randevu", href: "/app/randevular", title: "Randevularım", Icon: CalendarDays });
  if (ctx.canSeeProperties) tiles.push({ key: "ilan", href: "/app/portfoyler", title: "İlan gönder", Icon: Send });
  if (ctx.canSeeCommissions) tiles.push({ key: "kazanc", href: financePath("komisyon"), title: "Kazancım", Icon: Receipt });
  if (tiles.length === 0) return null;
  return (
    <nav aria-label="Kısayollar" className="grid grid-cols-2 content-start gap-2" data-tour="kisayollar">
      {tiles.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className="focus-ring press flex min-h-14 items-center gap-2.5 rounded-[var(--radius-card)] border border-hairline bg-surface-raised px-3 shadow-[var(--elev-1)] transition hover:bg-surface-hover"
        >
          <t.Icon className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
          <span className="min-w-0 text-[15px] font-semibold text-text">{t.title}</span>
        </Link>
      ))}
    </nav>
  );
}
