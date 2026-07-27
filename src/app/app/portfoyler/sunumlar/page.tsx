import Link from "next/link";
import { ArrowLeft, Eye, MonitorPlay, Presentation, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { NewPresentationDialog, type SelectableProperty } from "./new-presentation-dialog";
import { CopyLinkButton, DeletePresentationButton } from "./presentation-actions";

type PresentationRow = {
  id: string;
  public_token: string;
  title: string;
  customer_name: string | null;
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
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Portföy sunumları — danışmanın müşteri adına ürettiği /sunum/[token]
 * linklerinin listesi + yeni sunum sihirbazı. Portföy modülünün alt sayfası:
 * sidebar'a girmez, /app/portfoyler araç çubuğundan ve portföy detayından ulaşılır.
 */
export default async function PresentationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ portfoy?: string }>;
}) {
  const { perms } = await requireModulePage("properties");
  const canDelete = (perms.properties ?? []).includes("edit");
  const params = (await searchParams) ?? {};
  // Portföy detayındaki "Sunum oluştur" girişi ?portfoy= ile gelir → dialog ön seçili açılır.
  const preselectedId = (params.portfoy ?? "").trim() || null;

  const supabase = await createClient();
  const [{ data: presentationData }, { data: liveData }] = await Promise.all([
    supabase
      .from("presentations")
      .select("id, public_token, title, customer_name, property_ids, view_count, last_viewed_at, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
    // Dialog seçim havuzu: yalnız yayındaki portföyler (action da aynı kuralı zorlar).
    supabase
      .from("properties")
      .select("id, property_code, title, list_price, transaction_type, district:geo_districts(name)")
      .in("status", ["live", "Yayında"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);

  const presentations = (presentationData ?? []) as PresentationRow[];
  const liveProperties: SelectableProperty[] = (liveData ?? []).map((p) => {
    const rel = p.district as { name?: string } | { name?: string }[] | null;
    return {
      id: p.id as string,
      code: p.property_code as string,
      title: (p.title as string | null) ?? null,
      price: p.list_price != null ? Number(p.list_price) : null,
      tx: p.transaction_type as string,
      district: (Array.isArray(rel) ? rel[0]?.name : rel?.name) ?? null,
    };
  });

  const base = appUrl();
  const totalViews = presentations.reduce((sum, p) => sum + (p.view_count ?? 0), 0);

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div>
            <Link
              href="/app/portfoyler"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white/60 transition hover:text-white"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Portföy merkezine dön
            </Link>
            <h1 className="mt-2 flex items-center gap-2.5 font-display text-2xl font-extrabold text-white md:text-3xl">
              <Presentation className="h-7 w-7 text-mint-400" /> Portföy sunumları
            </h1>
            <p className="mt-1 text-sm text-white/60">
              Müşteriye özel seçki hazırlayın; link telefonda sunum, yazıcıda A4 dosya olur.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-center backdrop-blur">
              <p className="font-display text-xl font-extrabold text-white">{presentations.length}</p>
              <p className="text-[11px] text-white/50">Sunum</p>
            </div>
            <div className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-2.5 text-center backdrop-blur">
              <p className="font-display text-xl font-extrabold text-mint-400">{totalViews}</p>
              <p className="text-[11px] text-white/50">Görüntülenme</p>
            </div>
            <NewPresentationDialog properties={liveProperties} preselectedId={preselectedId} />
          </div>
        </div>
      </section>

      {presentations.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-[18px] bg-brand-600/10 text-brand-600">
            <MonitorPlay className="h-8 w-8" />
          </span>
          <h2 className="mt-5 font-display text-xl font-bold text-ink-950">İlk sunumunuzu hazırlayın</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-text-muted">
            1-5 portföy seçin, müşterinizin adını yazın; WhatsApp&apos;tan gönderebileceğiniz şık bir
            sunum linki saniyeler içinde hazır olsun.
          </p>
          <div className="mt-5">
            {/* preselectedId yalnız üstteki örneğe verilir — iki dialog birden otomatik açılmasın */}
            <NewPresentationDialog properties={liveProperties} preselectedId={null} />
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
                      {p.customer_name ? (
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
    </div>
  );
}
