import { cache } from "react";
import Link from "@/components/ui/smart-link";
import { CalendarDays, Inbox, Receipt, UserPlus, Layers, type LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isPoolEnabled } from "@/lib/pool/server";
import { OPEN_LISTING_STATUSES } from "@/lib/office-center/store";
import { Skeleton } from "@/components/ui/skeleton";
import { loadTodayAppointments, type HomeCtx } from "./data";

type Tile = { key: string; href: string; title: string; hint: string; Icon: LucideIcon; tone: "brand" | "warn" | "success" | "neutral" };

const TONE: Record<Tile["tone"], string> = {
  brand: "bg-brand-50 text-brand-700",
  warn: "bg-amber-500/10 text-amber-700",
  success: "bg-mint-500/10 text-mint-700",
  neutral: "bg-canvas text-text-muted",
};

/** Danışmanı olmayan açık ilan sayısı (hafif head count); hata → null (sahte 0 gösterilmez). */
const loadUnassignedCount = cache(async (tenantId: string): Promise<number | null> => {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .is("assigned_to", null)
    .is("deleted_at", null)
    .in("status", [...OPEN_LISTING_STATUSES]);
  return error ? null : (count ?? 0);
});

export function BugunKisayolIskelet() {
  return (
    <div role="status" aria-busy="true" className="grid grid-cols-2 gap-3">
      <span className="sr-only">Yükleniyor</span>
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-28 w-full" />
      ))}
    </div>
  );
}

/**
 * "Bugün" büyük kısayol kartları (3-4 adet, rol bazlı). Her kart filtreli hedefe gider (sıfır çıkmaz metrik).
 * Sahip/yönetici: Atanmamış ilan N → ilan havuzu (havuz kapalıysa "Havuzu aç"), Müşteri ekle, Bugünkü randevular, Komisyonlar.
 * Danışman: Müşteri ekle, Randevularım, İlan paylaş, Komisyonum.
 */
export async function BugunKisayol({ ctx }: { ctx: HomeCtx }) {
  const tiles: Tile[] = [];
  const can = (mod: string, action: string) => ((ctx.perms as Record<string, string[] | undefined>)[mod] ?? []).includes(action);

  if (ctx.isManagement && ctx.canSeeProperties && ctx.tenantId) {
    const supabase = await createClient();
    const [enabled, unassigned] = await Promise.all([isPoolEnabled(supabase, ctx.tenantId), loadUnassignedCount(ctx.tenantId)]);
    if (!enabled) {
      tiles.push({ key: "havuz", href: "/app/ilan-havuzu", title: "Havuzu aç", hint: "Sahipsiz ilanları danışmanlara kolayca dağıtın", Icon: Inbox, tone: "brand" });
    } else {
      tiles.push({
        key: "havuz",
        href: "/app/ilan-havuzu",
        title: unassigned === null ? "Atanmamış ilanlar" : `Atanmamış ilan ${unassigned}`,
        hint: unassigned ? "Önerilen danışmanla tek tıkla atayın" : "Hepsi bir danışmanda",
        Icon: Inbox,
        tone: unassigned ? "warn" : "success",
      });
    }
  }
  if (can("customers", "create")) {
    tiles.push({ key: "musteri", href: "/app/musteriler/yeni", title: "Müşteri ekle", hint: "Yeni bir kişiyi kaydedin", Icon: UserPlus, tone: "brand" });
  }
  if (can("appointments", "view")) {
    const today = await loadTodayAppointments(ctx).catch(() => null);
    tiles.push({
      key: "randevu",
      href: "/app/randevular",
      title: ctx.isManagement ? "Bugünkü randevular" : "Randevularım",
      hint: today ? (today.total > 0 ? `Bugün ${today.total} randevu var` : "Bugün randevu yok") : "Takvime bakın",
      Icon: CalendarDays,
      tone: "neutral",
    });
  }
  if (!ctx.isManagement && ctx.canSeeProperties) {
    tiles.push({ key: "ilan", href: "/app/portfoyler", title: "İlan paylaş", hint: "Portföyünüzden müşteriye gönderin", Icon: Layers, tone: "neutral" });
  }
  if (ctx.canSeeCommissions) {
    tiles.push({
      key: "komisyon",
      href: ctx.isManagement ? "/app/komisyon?durum=bekleyen" : "/app/komisyon",
      title: ctx.isManagement ? "Bekleyen komisyonlar" : "Komisyonum",
      hint: "Kazanç ve ödeme durumu",
      Icon: Receipt,
      tone: "success",
    });
  }

  const shown = tiles.slice(0, 4);
  if (shown.length === 0) return null;
  return (
    <nav aria-label="Kısayollar" className="grid grid-cols-2 gap-3">
      {shown.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className="focus-ring press flex min-h-28 flex-col justify-between gap-2 rounded-[var(--radius-card)] border border-hairline bg-surface-raised p-4 shadow-[var(--elev-1)] transition hover:bg-surface-hover"
        >
          <span className={`grid h-10 w-10 place-items-center rounded-full ${TONE[t.tone]}`} aria-hidden="true">
            <t.Icon className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold text-text">{t.title}</span>
            <span className="block text-xs text-text-muted">{t.hint}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}
