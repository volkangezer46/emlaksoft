import Link from "@/components/ui/smart-link";
import { AlarmClock, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { now } from "@/lib/clock";
import { formatDateTimeTr } from "@/lib/format";
import { eidsDisplayStatus } from "@/lib/eids/authority-status";
import { propertyLabel } from "@/lib/eids/actions-core";
import { EidsConfirmButtons } from "./eids-confirm-buttons";

/**
 * Danışmanın "Benim" ekranı: KENDİ portföylerinin EİDS yetki durumu, açık acil görevleri ve haftalık "Yetki doğrula"
 * listesi (bildirimden `#yetki-dogrula` ile gelinir). Oturumlu istemci (RLS); sorgu her zaman oturum sahibine kilitlidir.
 * Satırda "Malikten teyit iste" (SMS / WhatsApp / e-posta şablonu) ve "Portalda doğrula" (portföyün yetki kartı) vardır.
 */
const CLOSED = "(sold,rented,archived,withdrawn,passive)";
const SETTLED = new Set(["approved", "revoked", "expired", "rejected"]);

const STATUS_META: Record<string, { label: string; cls: string; href: string }> = {
  approved: { label: "Onaylı", cls: "bg-mint-500/12 text-mint-700", href: "/app/ilan-kontrol/yetki" },
  pending: { label: "Onay bekliyor", cls: "bg-amber-400/15 text-amber-700", href: "/app/ilan-kontrol/yetki?kova=bekleyen" },
  unknown: { label: "Bilinmiyor", cls: "bg-amber-400/15 text-amber-700", href: "/app/ilan-kontrol/yetki?kova=bilinmiyor" },
  expired: { label: "Süresi doldu", cls: "bg-danger-500/10 text-danger-600", href: "/app/ilan-kontrol/yetki?kova=dolmus" },
  revoked: { label: "İptal edildi", cls: "bg-danger-500/10 text-danger-600", href: "/app/gorevler?tur=eids_takedown&mine=1" },
  rejected: { label: "Reddedildi", cls: "bg-danger-500/10 text-danger-600", href: "/app/ilan-kontrol/yetki" },
};

type Prop = {
  id: string;
  title: string | null;
  property_code: string | null;
  status: string | null;
  authority_eids_status: string | null;
  authorization_start: string | null;
  authorization_end: string | null;
};

export async function EidsMine({ tenantId, userId }: { tenantId: string; userId: string }) {
  const supabase = await createClient();
  const nowMs = now();
  const [{ data: props, error }, { data: tasks }] = await Promise.all([
    supabase
      .from("properties")
      .select("id, title, property_code, status, authority_eids_status, authorization_start, authorization_end")
      .eq("tenant_id", tenantId)
      .eq("assigned_to", userId)
      .is("deleted_at", null)
      .eq("is_sample", false)
      .not("status", "in", CLOSED)
      .limit(500),
    supabase
      .from("tasks")
      .select("id, title, kind, due_at, priority")
      .eq("tenant_id", tenantId)
      .eq("assigned_to", userId)
      .eq("status", "open")
      .or("kind.eq.eids_takedown,priority.eq.urgent")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(20),
  ]);
  if (error) return null;
  const rows = (props ?? []) as Prop[];
  if (rows.length === 0 && (tasks ?? []).length === 0) return null;

  const ids = rows.map((r) => r.id);
  const liveBy = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from("portal_listings").select("property_id").eq("tenant_id", tenantId).eq("status", "live").in("property_id", ids.slice(i, i + 200));
    for (const l of (data ?? []) as { property_id: string }[]) liveBy.add(l.property_id);
  }

  const statusOf = (r: Prop): string => {
    const raw = r.authority_eids_status ?? "unknown";
    if (raw === "revoked" || raw === "unknown") return raw;
    return eidsDisplayStatus(r, nowMs);
  };
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(statusOf(r), (counts.get(statusOf(r)) ?? 0) + 1);

  // Haftalık "Yetki doğrula": yayında (vitrin ya da portal) ve yetkisi teyitli değil.
  const verify = rows.filter((r) => (r.status === "live" || liveBy.has(r.id)) && !SETTLED.has(r.authority_eids_status ?? "")).slice(0, 20);
  const contact = new Map<string, { phone: boolean; email: boolean }>();
  if (verify.length) {
    const { data: oi } = await supabase.from("property_owner_info").select("property_id, customer_id").eq("tenant_id", tenantId).in("property_id", verify.map((v) => v.id));
    const owners = ((oi ?? []) as { property_id: string; customer_id: string | null }[]).filter((o) => o.customer_id);
    const { data: cs } = owners.length
      ? await supabase.from("customers").select("id, phone, email").eq("tenant_id", tenantId).in("id", owners.map((o) => String(o.customer_id)))
      : { data: [] };
    const byCustomer = new Map(((cs ?? []) as { id: string; phone: string | null; email: string | null }[]).map((c) => [c.id, c]));
    for (const o of owners) {
      const c = byCustomer.get(String(o.customer_id));
      contact.set(o.property_id, { phone: Boolean(c?.phone?.trim()), email: Boolean(c?.email?.trim()) });
    }
  }
  const openTasks = (tasks ?? []) as { id: string; title: string; kind: string; due_at: string | null }[];

  return (
    <section aria-labelledby="eids-mine-baslik" className="space-y-4 rounded-[var(--radius-panel)] border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck aria-hidden="true" className="h-4 w-4 text-brand-600" />
        <h2 id="eids-mine-baslik" className="font-display text-base font-bold text-ink-950">
          Portföylerimin yetki durumu
        </h2>
      </div>

      {rows.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {[...counts.entries()].map(([k, n]) => {
            const m = STATUS_META[k] ?? STATUS_META.unknown;
            return (
              <li key={k}>
                <Link href={m.href} className={`focus-ring inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold touch:min-h-11 ${m.cls}`}>
                  {m.label} <span className="tabular-nums">{n}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {openTasks.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-ink-950">Açık acil görevlerim</h3>
          <ul className="divide-y divide-line rounded-[var(--radius-control)] border border-danger-500/25">
            {openTasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={t.kind === "eids_takedown" ? `/app/gorevler/eids/${t.id}` : "/app/gorevler?mine=1"}
                  className="focus-ring flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-hover touch:min-h-11"
                >
                  <span className="min-w-0 truncate font-medium text-ink-950">{t.title}</span>
                  {t.due_at ? (
                    <span className={`flex shrink-0 items-center gap-1 text-xs ${Date.parse(t.due_at) < nowMs ? "text-danger-600" : "text-text-muted"}`}>
                      <AlarmClock aria-hidden="true" className="h-3.5 w-3.5" /> {formatDateTimeTr(t.due_at)}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div id="yetki-dogrula" className="scroll-mt-24 space-y-2">
        <h3 className="text-sm font-semibold text-ink-950">Yetki doğrula</h3>
        {verify.length === 0 ? (
          <p className="text-xs text-text-muted">Yayındaki tüm portföylerinizin yetkisi kayıtlı. Teşekkürler.</p>
        ) : (
          <>
            <p className="text-xs text-text-muted">
              Bu portföyler yayında ama EİDS yetkisi teyitli değil. Malikten e-Devlet ekran görüntüsü isteyin ya da portalda doğrulayıp portföyün yetki kartında işaretleyin.
            </p>
            <ul className="divide-y divide-line">
              {verify.map((v) => {
                const c = contact.get(v.id) ?? { phone: false, email: false };
                return (
                  <li key={v.id} className="flex flex-wrap items-center gap-3 py-2.5">
                    <Link href={`/app/portfoyler/${v.id}`} className="focus-ring min-w-0 flex-1 truncate text-sm font-semibold text-brand-600 hover:underline">
                      {propertyLabel(v)}
                    </Link>
                    <EidsConfirmButtons propertyId={v.id} hasPhone={c.phone} hasEmail={c.email} />
                    <Link href={`/app/portfoyler/${v.id}#yetki`} className="focus-ring text-xs font-semibold text-text-muted hover:text-brand-600 touch:min-h-11">
                      Portalda doğrulandı →
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
