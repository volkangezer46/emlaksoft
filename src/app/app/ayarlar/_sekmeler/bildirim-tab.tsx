import Link from "next/link";
import { getNotificationPrefs } from "@/app/actions/notification-prefs";
import { NotificationPrefsPanel } from "@/components/app/notification-prefs";
import { loadNotificationChannels } from "@/lib/notification-channels";

const QUICK_LINKS = [
  { href: "/app/anlasmalar", label: "Anlaşma tahtası" },
  { href: "/app/denetim", label: "Denetim" },
  { href: "/app/uyum", label: "İYS / yetki kalkanı" },
  { href: "/app/degerleme", label: "Değerleme" },
];

/** Sekme: bildirim tercihleri + operasyon kısayolları. */
export async function BildirimTab({ tenantId }: { tenantId: string | null }) {
  const [notifPrefs, channels] = await Promise.all([getNotificationPrefs(), loadNotificationChannels(tenantId)]);
  return (
    <div id="bildirimler" className="grid scroll-mt-24 gap-4 lg:grid-cols-[1.1fr_1fr]">
      <NotificationPrefsPanel initial={notifPrefs} channels={channels} />
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="font-display font-bold text-ink-950">Hızlı bağlantılar</h2>
        <p className="mt-1 text-xs text-text-muted">Operasyon ve uyum kısayolları</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {QUICK_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
