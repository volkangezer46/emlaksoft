import Link from "next/link";
import { MessageCircle, Phone, Zap } from "lucide-react";
import { toTelHref, toWhatsAppLink } from "@/lib/phone";
import { Widget } from "../dashboard-widgets";
import { loadActivityFeed, type HomeCtx } from "./data";
import { timeFmt } from "./format";
import { PanelLink } from "./ortak";

type FeedAction = { key: string; kind: "tel" | "wa" | "link"; href: string; label?: string };
type FeedItem = { key: string; icon: string; text: string; time: string; tone: string; href: string; actions?: FeedAction[] };

const actionBtn =
  "focus-ring press grid h-6 w-6 min-h-9 min-w-9 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-mint-600 transition hover:border-mint-500/50 hover:bg-mint-500/10";

/** Son 24s birleşik aktivite akışı — tip bazlı hızlı aksiyonlarla. */
export async function CanliAkis({ ctx }: { ctx: HomeCtx }) {
  const feed = await loadActivityFeed(ctx);
  const items: FeedItem[] = [
    ...feed.customers.map((c) => ({
      key: `cust-${c.id}`,
      icon: "👤",
      text: `Yeni müşteri: ${c.full_name}`,
      time: c.created_at,
      tone: "text-brand-600",
      href: `/app/musteriler/${c.id}`,
      actions: c.phone
        ? [
            { key: "tel", kind: "tel" as const, href: toTelHref(c.phone) ?? `tel:${c.phone}` },
            ...(toWhatsAppLink(c.phone)
              ? [{ key: "wa", kind: "wa" as const, href: toWhatsAppLink(c.phone) as string }]
              : []),
          ]
        : [],
    })),
    ...feed.properties.map((p) => ({
      key: `prop-${p.id}`,
      icon: "🏠",
      text: `Portföy eklendi: ${p.title ?? p.property_code}`,
      time: p.created_at,
      tone: "text-mint-600",
      href: `/app/portfoyler/${p.id}`,
      actions: [{ key: "portal", kind: "link" as const, href: `/app/portallar?property=${p.id}`, label: "Portala bas →" }],
    })),
    ...feed.calls.map((c) => ({
      key: `call-${c.id}`,
      icon: c.direction === "inbound" ? "📲" : "📞",
      text: `${c.direction === "inbound" ? "Gelen" : "Giden"} arama: ${c.phone}`,
      time: c.started_at,
      tone: "text-cyan-600",
      href: "/app/arama",
      actions: c.phone ? [{ key: "tel", kind: "tel" as const, href: `tel:${c.phone}` }] : [],
    })),
    ...feed.appointments.map((a) => ({
      key: `appt-${a.id}`,
      icon: "📅",
      text: `Randevu: ${a.appointment_type === "showing" ? "Yer gösterme" : a.appointment_type}`,
      time: a.scheduled_at,
      tone: "text-amber-600",
      href: "/app/randevular",
    })),
  ]
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, 8);

  return (
    <Widget id="akis" className="h-full">
      <section className="pm-bx h-full p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-mint-600">
              <Zap className="h-4 w-4" /> Canlı akış
            </p>
            <h2 className="mt-1 font-display font-bold text-ink-950">Son 24 saat</h2>
          </div>
          <PanelLink href="/app/denetim">Denetim</PanelLink>
        </div>
        <div className="relative mt-5 space-y-3 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-line">
          {items.length === 0 ? (
            <p className="text-sm text-text-muted">Son 24 saatte aktivite yok.</p>
          ) : (
            items.map((item) => (
              <div key={item.key} className="group relative flex items-center gap-3">
                <Link
                  href={item.href}
                  className="focus-ring absolute inset-0 z-0 rounded-[var(--radius-control)]"
                  aria-label={item.text}
                />
                <span className="pointer-events-none z-10 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-line bg-surface text-base transition group-hover:border-brand-300">
                  {item.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-xs font-semibold ${item.tone} group-hover:underline`}>{item.text}</p>
                </div>
                {!ctx.tvMode && item.actions && item.actions.length > 0 ? (
                  <span className="hover-action relative z-10 flex shrink-0 items-center gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
                    {item.actions.map((a) =>
                      a.kind === "tel" ? (
                        <a key={a.key} href={a.href} title="Ara" aria-label="Telefonla ara" className={actionBtn}>
                          <Phone className="h-3 w-3" />
                        </a>
                      ) : a.kind === "wa" ? (
                        <a
                          key={a.key}
                          href={a.href}
                          target="_blank"
                          rel="noreferrer"
                          title="WhatsApp"
                          aria-label="WhatsApp ile yaz"
                          className={actionBtn}
                        >
                          <MessageCircle className="h-3 w-3" />
                        </a>
                      ) : (
                        <Link
                          key={a.key}
                          href={a.href}
                          className="focus-ring rounded-[var(--radius-control)] text-xs font-bold text-brand-600 hover:underline"
                        >
                          {a.label}
                        </Link>
                      ),
                    )}
                  </span>
                ) : null}
                <span className="shrink-0 text-xs text-text-faint">{timeFmt.format(new Date(item.time))}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </Widget>
  );
}
