import { PageHeader } from "@/components/ui/page-header";
import Link from "@/components/ui/smart-link";
import { redirect } from "next/navigation";
import { Eye, MonitorPlay, Presentation, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ButtonLink } from "@/components/ui/button";
import { CopyLinkButton, DeletePresentationButton } from "./presentation-actions";
import { SharedPortals, type SharedPortalRow } from "./shared-portals";
import { now } from "@/lib/clock";
import { getBaseUrl } from "@/lib/base-url";

type PresentationRow = {
  id: string;
  public_token: string;
  title: string;
  customer_name: string | null;
  customer_id: string | null;
  property_ids: string[];
  view_count: number;
  last_viewed_at: string | null;
  created_at: string;
};

function tarih(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function appUrl() {
  return getBaseUrl();
}

/**
 * Portföy sunumları — danışmanın müşteri adına ürettiği /sunum/[token]
 * linklerinin listesi + yeni sunum sihirbazı. Portföy modülünün alt sayfası:
 * sidebar'a girmez, /app/portfoyler araç çubuğundan ve portföy detayından ulaşılır.
 */
export default async function PresentationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ portfoy?: string; musteri?: string }>;
}) {
  const { perms } = await requireModulePage("properties", "/app/portfoyler/sunumlar");
  const canDelete = (perms.properties ?? []).includes("edit");
  // Müşteri seçici yalnız müşteri görebilenlere; göremeyene liste sızmasın.
  const canSeeCustomers = (perms.customers ?? []).includes("view");
  const params = (await searchParams) ?? {};
  // Eski girişler (?portfoy= / ?musteri=) tam sayfa forma taşınır, ön seçim korunur.
  if (params.portfoy || params.musteri) {
    const sp = new URLSearchParams();
    if (params.portfoy) sp.set("portfoy", params.portfoy);
    if (params.musteri) sp.set("musteri", params.musteri);
    redirect(`/app/portfoyler/sunumlar/yeni?${sp.toString()}`);
  }

  const supabase = await createClient();
  const [{ data: presentationData }] = await Promise.all([
    supabase
      .from("presentations")
      .select(
        "id, public_token, title, customer_name, customer_id, property_ids, view_count, last_viewed_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const presentations = (presentationData ?? []) as PresentationRow[];
  const base = appUrl();
  const totalViews = presentations.reduce((sum, p) => sum + (p.view_count ?? 0), 0);

  // ---- Paylaşılan portallar ------------------------------------------------
  // Müşteri portalı token'ları müşteri adı taşıdığı için yalnız müşteri
  // görebilenlere gösterilir (sunum müşteri seçicisiyle aynı kapı).
  const [{ data: ownerTokenData }, { data: customerTokenData }] = await Promise.all([
    supabase
      .from("owner_portal_tokens")
      .select("id, token, owner_name, property_id, expires_at, created_at, last_seen_at, property:properties!owner_portal_tokens_property_id_fkey(property_code, title)")
      .order("created_at", { ascending: false })
      .limit(100),
    canSeeCustomers
      ? supabase
          .from("customer_portal_tokens")
          .select("id, token, customer_id, expires_at, created_at, last_seen_at, customer:customers!customer_portal_tokens_customer_id_fkey(full_name)")
          .order("created_at", { ascending: false })
          .limit(100)
      : Promise.resolve({ data: null }),
  ]);

  const nowMs = now();
  const relOne = <T,>(v: T | T[] | null | undefined): T | null =>
    v == null ? null : Array.isArray(v) ? (v[0] ?? null) : v;

  const sharedPortals: SharedPortalRow[] = [
    ...((customerTokenData ?? []) as Record<string, unknown>[]).map((t) => {
      const c = relOne(t.customer as { full_name?: string } | { full_name?: string }[] | null);
      return {
        id: String(t.id),
        kind: "customer" as const,
        subject: c?.full_name ?? "Müşteri",
        href: t.customer_id ? `/app/musteriler/${String(t.customer_id)}` : null,
        context: null,
        url: `${base}/musteri-portali/${String(t.token)}`,
        createdAt: String(t.created_at),
        expiresAt: String(t.expires_at),
        lastSeenAt: (t.last_seen_at as string | null) ?? null,
        expired: new Date(String(t.expires_at)).getTime() <= nowMs,
      };
    }),
    ...((ownerTokenData ?? []) as Record<string, unknown>[]).map((t) => {
      const p = relOne(
        t.property as { property_code?: string; title?: string | null } | { property_code?: string; title?: string | null }[] | null,
      );
      return {
        id: String(t.id),
        kind: "owner" as const,
        subject: String(t.owner_name ?? "Malik"),
        href: t.property_id ? `/app/portfoyler/${String(t.property_id)}` : null,
        context: p?.title ?? p?.property_code ?? null,
        url: `${base}/malik-portali/${String(t.token)}`,
        createdAt: String(t.created_at),
        expiresAt: String(t.expires_at),
        lastSeenAt: (t.last_seen_at as string | null) ?? null,
        expired: new Date(String(t.expires_at)).getTime() <= nowMs,
      };
    }),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Portföyler", href: "/app/portfoyler" }, { label: "Sunumlar" }]}
        title="Portföy sunumları"
        description="Müşteriye özel seçki hazırlayın; link telefonda sunum, yazıcıda A4 dosya olur. Paylaştığınız müşteri/malik portalı linkleri de aşağıda listelenir."
        icon={<span className="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-mint-500/12 text-mint-700"><Presentation className="h-5 w-5" /></span>}
        actions={<ButtonLink href="/app/portfoyler/sunumlar/yeni">Yeni sunum</ButtonLink>}
      />
      <div className="mb-6 grid max-w-md grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2.5 shadow-[var(--shadow-xs)]">
          <p className="numeric font-display text-xl font-extrabold text-text">{presentations.length}</p>
          <p className="text-xs text-text-muted">Sunum</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2.5 shadow-[var(--shadow-xs)]">
          <p className="numeric font-display text-xl font-extrabold text-mint-700">{totalViews}</p>
          <p className="text-xs text-text-muted">Görüntülenme</p>
        </div>
      </div>

      {presentations.length === 0 ? (
        <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-[var(--radius-panel)] bg-brand-600/10 text-brand-600">
            <MonitorPlay className="h-8 w-8" />
          </span>
          <h2 className="mt-5 font-display text-xl font-bold text-ink-950">İlk sunumunuzu hazırlayın</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">
            1-5 portföy seçin, müşterinizin adını yazın; WhatsApp&apos;tan gönderebileceğiniz şık bir
            sunum linki saniyeler içinde hazır olsun.
          </p>
          <div className="mt-5">
            <ButtonLink href="/app/portfoyler/sunumlar/yeni">Yeni sunum</ButtonLink>
          </div>
        </div>
      ) : (
        <TableFrame minWidth={760}>
          <Table>
            <THead>
              <TR>
                <TH>Sunum</TH>
                <TH>Müşteri</TH>
                <TH align="right">Portföy</TH>
                <TH align="right">Görüntülenme</TH>
                <TH>Son görüntüleme</TH>
                <TH>Oluşturulma</TH>
                <TH align="right">İşlem</TH>
              </TR>
            </THead>
            <TBody>
              {presentations.map((p) => {
                const url = `${base}/sunum/${p.public_token}`;
                return (
                  <TR key={p.id}>
                    <TD className="font-semibold text-ink-950">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 transition hover:text-brand-600 hover:underline"
                        title="Sunumu yeni sekmede aç"
                      >
                        {p.title}
                      </a>
                    </TD>
                    <TD>
                      {/* Bağlı müşteri varsa satır kartına gider (sıfır çıkmaz metrik) */}
                      {p.customer_id && canSeeCustomers ? (
                        <Link
                          href={`/app/musteriler/${p.customer_id}`}
                          className="inline-flex items-center gap-1.5 font-semibold text-ink-950 underline-offset-2 transition hover:text-brand-600 hover:underline"
                        >
                          <UserRound className="h-3.5 w-3.5 text-brand-600" />
                          {p.customer_name ?? "Müşteri kartı"}
                        </Link>
                      ) : p.customer_name ? (
                        <span className="inline-flex items-center gap-1.5 text-text-muted">
                          <UserRound className="h-3.5 w-3.5 text-brand-600" /> {p.customer_name}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD align="right" className="numeric">{p.property_ids?.length ?? 0}</TD>
                    <TD align="right">
                      <span className="inline-flex items-center gap-1 font-semibold text-ink-950">
                        <Eye className="h-3.5 w-3.5 text-text-faint" /> {p.view_count ?? 0}
                      </span>
                    </TD>
                    <TD className="text-text-muted">{tarih(p.last_viewed_at)}</TD>
                    <TD className="text-text-muted">{tarih(p.created_at)}</TD>
                    <TD align="right">
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <CopyLinkButton url={url} />
                        {canDelete ? <DeletePresentationButton id={p.id} title={p.title} /> : null}
                      </span>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </TableFrame>
      )}

      {/* Paylaşılan portallar — üretilmiş müşteri/malik portal linkleri */}
      <SharedPortals rows={sharedPortals} />
    </div>
  );
}
