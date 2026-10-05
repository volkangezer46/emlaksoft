import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Globe } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { toTrLocalInput } from "@/lib/clock";
import { requirePlatformModule } from "@/lib/platform";
import { platformCanAccess } from "@/lib/platform-access";
import { getGeneralSettings } from "@/lib/platform-flags";
import { defaultSiteContent } from "@/lib/site-content/defaults";
import { sameContent } from "@/lib/site-content/schema";
import { siteContentStore } from "@/lib/site-content/store";
import { HUB_CARDS, type HubCardId } from "@/lib/site-hub/cards";
import { readLastChanges } from "@/lib/site-hub/last-changes";
import { defaultSiteMenu } from "@/lib/site-menu/defaults";
import { sameConfig } from "@/lib/site-menu/editor-model";
import { readAdminState as readMenuState } from "@/lib/site-menu/store";

export const metadata = { title: "Site yönetimi" };

type Chip = { text: string; tone: "ok" | "warn" | "info" };

const TONE: Record<Chip["tone"], string> = {
  ok: "bg-mint-500/15 text-mint-700",
  warn: "bg-amber-100 text-amber-900",
  info: "bg-brand-600/10 text-brand-700",
};

/** Admin'in online yönetebildiği tüm alanlar: her kartta durum (taslak/uyarı) ve son değişiklik. Ekranlara bağlanır, kopya yazmaz. */
export default async function AdminSiteHubPage() {
  const staff = await requirePlatformModule("dashboard");
  const cards = HUB_CARDS.filter((c) => platformCanAccess(staff.role, c.module));
  const wants = (id: HubCardId) => cards.some((c) => c.id === id);

  const [last, menu, content, general] = await Promise.all([
    readLastChanges(),
    wants("site-menu") ? readMenuState() : null,
    wants("site-icerik") ? siteContentStore.readState() : null,
    wants("bakim-kayit") ? getGeneralSettings() : null,
  ]);

  const chips: Partial<Record<HubCardId, Chip[]>> = {};
  if (menu) {
    const c: Chip[] = [{ text: menu.live ? "Özel yayın" : "Varsayılan menü", tone: "info" }];
    if (menu.draft && !sameConfig(menu.draft, menu.live ?? defaultSiteMenu())) c.push({ text: "Yayınlanmamış taslak var", tone: "warn" });
    chips["site-menu"] = c;
  }
  if (content) {
    const c: Chip[] = [{ text: content.live ? "Özel yayın" : "Varsayılan metin", tone: "info" }];
    if (content.draft && !sameContent(content.draft, content.live ?? defaultSiteContent())) c.push({ text: "Yayınlanmamış taslak var", tone: "warn" });
    chips["site-icerik"] = c;
  }
  if (general) {
    chips["bakim-kayit"] = [
      general.maintenanceMode ? { text: "Bakım modu AÇIK: site ziyaretçilere kapalı", tone: "warn" } : { text: "Bakım modu kapalı", tone: "ok" },
      general.registrationOpen ? { text: "Kayıt açık", tone: "ok" } : { text: "Yeni kayıt kapalı", tone: "warn" },
    ];
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Platform"
        icon={Globe}
        title="Site yönetimi"
        description="Herkese açık siteyi, fiyatları, muhasebeyi ve sistemi online yönetebildiğiniz tüm alanlar tek yerde. Her kart ilgili ekrana gider; durum ve son değişiklik kayıtlardan okunur."
        glow="brand"
      />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Yönetilebilir alanlar">
        {cards.map((c) => {
          const l = last[c.id];
          const cardChips = chips[c.id] ?? [];
          return (
            <li key={c.id}>
              <Link
                href={c.href}
                className="focus-ring group flex h-full flex-col gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4 transition hover:border-brand-400"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="font-display text-base font-extrabold text-ink-950">{c.title}</span>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-text-faint transition group-hover:text-brand-600" aria-hidden="true" />
                </span>
                <span className="text-sm text-text-muted">{c.description}</span>
                {cardChips.length ? (
                  <span className="flex flex-wrap gap-1.5">
                    {cardChips.map((ch) => (
                      <span key={ch.text} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${TONE[ch.tone]}`}>
                        {ch.tone === "warn" ? <AlertTriangle className="h-3 w-3" aria-hidden="true" /> : null}
                        {ch.text}
                      </span>
                    ))}
                  </span>
                ) : null}
                <span className="mt-auto text-xs text-text-faint">
                  {l ? `Son değişiklik: ${toTrLocalInput(l.at).replace("T", " ")}${l.actorName ? ` · ${l.actorName}` : ""}` : "Kayıtlı değişiklik yok"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
