import type { SupabaseClient } from "@supabase/supabase-js";
import Link from "@/components/ui/smart-link";
import { ArrowUpRight, Clock, Mail, MessageCircle, PhoneCall, Sparkles } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import type { MatchDemand } from "@/lib/matching";
import { now } from "@/lib/clock";
import { computeNextBestActions, type NbaLink, type NbaSignals, type NextBestAction, type NextBestActionInput } from "./next-best-action";
import { countCustomerMatches } from "./match-count";

/**
 * "Sonraki en iyi eylem" kartı — AKAN ada (CRM-G2). Kural girdisinin sayfada hazır olan kısmı prop olarak gelir;
 * gerçek eşleşme sayısı ve dijital ilgi sinyalleri (sunum açılışı, portal isteği) kendi Suspense sınırında okunur,
 * künye ve sekmeler onları beklemez. Mobilde kart sekmelerin ÜSTÜNDE, masaüstünde sağ sütunun başında durur
 * (tek render; yerleşim page.tsx'teki grid/order sınıflarıyla).
 */

export type NbaBaseInput = Omit<NextBestActionInput, "signals" | "nowMs">;

/** Akan sinyaller — üç bağımsız okuma tek turda. Okuma hatası "sinyal yok" sayılır (uydurma yok). */
export async function loadNbaSignals(
  supabase: SupabaseClient,
  opts: { tenantId: string | null; customerId: string; demands: MatchDemand[]; canMatch: boolean },
): Promise<NbaSignals> {
  const [match, presentation, portal] = await Promise.all([
    opts.canMatch && opts.demands.length > 0
      ? countCustomerMatches(supabase, opts.tenantId, opts.demands).catch(() => null)
      : Promise.resolve(null),
    supabase
      .from("presentations")
      .select("title, last_viewed_at")
      .eq("customer_id", opts.customerId)
      .not("last_viewed_at", "is", null)
      .order("last_viewed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    opts.tenantId
      ? supabase
          .from("portal_demand_updates")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", opts.tenantId)
          .eq("customer_id", opts.customerId)
          .eq("status", "pending")
      : Promise.resolve({ count: 0, error: null }),
  ]);
  const pres = presentation.error ? null : (presentation.data as { title: string | null; last_viewed_at: string | null } | null);
  return {
    matchCount: match ? match.count : null,
    matchTruncated: match?.truncated ?? false,
    presentationViewedAt: pres?.last_viewed_at ?? null,
    presentationTitle: pres?.title ?? null,
    pendingPortalRequests: portal.error ? 0 : (portal.count ?? 0),
  };
}

export async function NextBestActionIsland({
  base,
  signals,
  blacklist,
}: {
  base: NbaBaseInput;
  signals: Promise<NbaSignals>;
  blacklist: boolean;
}) {
  if (blacklist) return <NbaCard actions={[]} blacklist />;
  const resolved = await signals;
  const actions = computeNextBestActions({ ...base, signals: resolved, nowMs: now() });
  return <NbaCard actions={actions} blacklist={false} />;
}

const LINK_ICON = { call: PhoneCall, whatsapp: MessageCircle, mail: Mail, link: ArrowUpRight } as const;

function ActionLink({ link, primary }: { link: NbaLink; primary: boolean }) {
  const Icon = LINK_ICON[link.kind];
  const cls = buttonClass({ variant: primary ? "primary" : "outline", size: "sm", className: "touch:min-h-11" });
  const content = (
    <>
      {link.kind === "link" ? null : <Icon className="h-3.5 w-3.5" aria-hidden />}
      {link.label}
      {link.kind === "link" ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
    </>
  );
  if (link.external) {
    const newTab = link.kind === "whatsapp";
    return (
      <a href={link.href} className={cls} {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {content}
      </a>
    );
  }
  return (
    <Link href={link.href} className={cls}>
      {content}
    </Link>
  );
}

function ActionItem({ action, first }: { action: NextBestAction; first: boolean }) {
  return (
    <li className={first ? "" : "border-t border-line pt-3"}>
      <p className="text-sm font-semibold text-ink-950">{action.title}</p>
      <p className="mt-1 text-xs text-text-muted">
        <span className="font-semibold text-text">Neden: </span>
        {action.reason}
      </p>
      {action.timingNote ? (
        <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-400/12 px-2 py-0.5 text-xs font-semibold text-amber-700">
          <Clock className="h-3 w-3" aria-hidden /> {action.timingNote}
        </p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <ActionLink link={action.primary} primary={first} />
        {action.secondary ? <ActionLink link={action.secondary} primary={false} /> : null}
      </div>
    </li>
  );
}

export function NbaCard({ actions, blacklist }: { actions: NextBestAction[]; blacklist: boolean }) {
  const has = actions.length > 0;
  return (
    <section
      aria-label="Sonraki en iyi eylem"
      className={`rounded-[var(--radius-panel)] border bg-surface p-4 shadow-[var(--shadow-xs)] ${has ? "border-mint-500/30" : "border-line"}`}
    >
      <p className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] ${has ? "text-mint-600" : "text-text-muted"}`}>
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> Sonraki en iyi eylem
      </p>
      {has ? (
        <ul className="mt-2 space-y-3">
          {actions.map((a, i) => (
            <ActionItem key={a.key} action={a} first={i === 0} />
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-text-muted">
          {blacklist ? "Kara listedeki müşteri için eylem önerilmez." : "Şu an için önerilen bir eylem yok."}
        </p>
      )}
    </section>
  );
}

export function NbaSkeleton() {
  return (
    <section aria-label="Sonraki en iyi eylem yükleniyor" className="rounded-[var(--radius-panel)] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-text-muted">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> Sonraki en iyi eylem
      </p>
      <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-ink-950/[0.06]" aria-hidden />
      <div className="mt-2 h-3 w-full animate-pulse rounded bg-ink-950/[0.06]" aria-hidden />
      <div className="mt-3 h-9 w-32 animate-pulse rounded-[var(--radius-control)] bg-ink-950/[0.06]" aria-hidden />
    </section>
  );
}
