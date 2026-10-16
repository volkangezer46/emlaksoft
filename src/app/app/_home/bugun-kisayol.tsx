import { financePath } from "@/lib/finance/routes";
import Link from "@/components/ui/smart-link";
import { CalendarDays, Receipt, Send, UserPlus, type LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { HomeCtx } from "./data";

type Tile = { key: string; href: string; title: string; hint: string; tone: "brand" | "success" | "warn" | "gold"; Icon: LucideIcon };

export function BugunKisayolIskelet() {
  return (
    <div role="status" aria-busy="true" className="ds-card ds-pad grid grid-cols-2 gap-2.5">
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
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
  if (can("customers", "create")) tiles.push({ key: "musteri", href: "/app/musteriler/yeni", title: "Müşteri ekle", hint: "Yeni kişi ve talep kaydı", tone: "brand", Icon: UserPlus });
  if (can("appointments", "view")) tiles.push({ key: "randevu", href: "/app/randevular", title: "Randevularım", hint: "Takvim ve yer gösterme", tone: "success", Icon: CalendarDays });
  if (ctx.canSeeProperties) tiles.push({ key: "ilan", href: "/app/portfoyler", title: "İlan gönder", hint: "Portföyü müşteriye paylaşın", tone: "warn", Icon: Send });
  if (ctx.canSeeCommissions) tiles.push({ key: "kazanc", href: financePath("komisyon"), title: "Kazancım", hint: "Komisyon ve tahsilat", tone: "gold", Icon: Receipt });
  if (tiles.length === 0) return null;
  return (
    // Komşu "Bugünüm" kartıyla aynı boyda biter: karolar kalan yüksekliği eşit paylaşır (sağ sütunda boşluk kalmaz).
    <nav aria-label="Kısayollar" className="ds-card ds-pad flex h-full flex-col gap-3" data-tour="kisayollar">
      <p className="ds-title">Hızlı işlemler</p>
      <div className="grid flex-1 auto-rows-fr grid-cols-2 gap-2.5">
        {tiles.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`pm-t-${t.tone} ds-lift focus-ring press flex min-h-24 flex-col justify-between gap-3 rounded-[var(--radius-card)] border border-hairline bg-[linear-gradient(150deg,var(--t-soft),var(--surface-raised)_70%)] p-3.5 shadow-[var(--elev-1)] transition hover:border-[color:var(--t)]`}
          >
            <span className="pm-ico" aria-hidden="true">
              <t.Icon />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-text">{t.title}</span>
              <span className="block text-xs text-text-muted">{t.hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
