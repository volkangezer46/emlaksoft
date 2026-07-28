"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Check, Copy, ExternalLink, Share2, UserRound, XCircle } from "lucide-react";
import { revokeCustomerPortalToken } from "@/app/actions/customer-portal";
import { revokeOwnerPortalToken } from "@/app/actions/owner-portal";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export type SharedPortalRow = {
  id: string;
  kind: "customer" | "owner";
  /** Portalın muhatabı — müşteri adı ya da malik adı. */
  subject: string;
  /** Müşteri/portföy kartına giden iç link (varsa). */
  href: string | null;
  /** Malik portalında portföy başlığı; müşteri portalında null. */
  context: string | null;
  url: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  /** Sunucuda hesaplanır — render'da Date.now() yok (clock.ts kuralı). */
  expired: boolean;
};

function tarih(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(iso));
}

function CopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* pano kapalı — kullanıcı linki elle seçebilir */
        }
      }}
      title="Linki kopyala"
      aria-label="Portal linkini kopyala"
      className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function RevokeButton({ row }: { row: SharedPortalRow }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const revoke = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", row.id);
      if (row.kind === "customer") await revokeCustomerPortalToken(fd);
      else await revokeOwnerPortalToken(fd);
      setConfirming(false);
      router.refresh();
    });
  };

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={revoke}
          disabled={pending}
          className="rounded-[7px] bg-danger-500 px-2 py-1 text-[11px] font-bold text-white transition hover:bg-danger-600 disabled:opacity-60"
        >
          {pending ? "İptal ediliyor…" : "İptal et"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-[7px] px-1.5 py-1 text-[11px] font-semibold text-text-muted hover:text-ink-950"
        >
          Vazgeç
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      title="Linki iptal et"
      aria-label={`${row.subject} portal linkini iptal et`}
      className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line bg-surface text-text-faint transition hover:border-danger-500/40 hover:text-danger-500"
    >
      <XCircle className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * "Paylaşılan portallar" — danışmanın dışarıya verdiği müşteri/malik portal
 * linklerinin tek listesi.
 *
 * KONUM GEREKÇESİ: bu sayfa zaten ofisin "dışarıya verilen public link"
 * merkezi (sunum linkleri: kopyala / önizle / görüntülenme / sil). Portal
 * linkleri de aynı cinsten — token'lı, süreli, iptal edilebilir dış linkler.
 * Ayrı bir modül açmak 4 kayıt yeri (permissions + NAV + sidebar + roller)
 * gerektirirdi; mevcut hub'a eklemek linki üreten ekranlardan (müşteri/portföy
 * listesi) tek tıkla ulaşılabilir kılıyor — diyalogların başarı ekranı da
 * buraya çapa (#paylasilan-portallar) veriyor.
 */
export function SharedPortals({ rows }: { rows: SharedPortalRow[] }) {
  return (
    <section id="paylasilan-portallar" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink-950">
            <Share2 className="h-4 w-4 text-brand-600" /> Paylaşılan portallar
          </h2>
          <p className="text-xs text-text-muted">
            Müşteri ve malik portalı linkleri — süresi, son ziyareti ve iptali tek yerde.
          </p>
        </div>
        <span className="numeric rounded-full bg-brand-600/10 px-3 py-1 text-xs font-semibold text-brand-600">
          {rows.length} link
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-[14px] bg-brand-600/10 text-brand-600">
            <Share2 className="h-6 w-6" />
          </span>
          <p className="mt-4 font-display font-bold text-ink-950">Henüz portal linki paylaşılmadı</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
            Müşteri listesindeki paylaş simgesinden müşteri portalı, portföy kartındaki paylaş
            simgesinden malik portalı linki üretebilirsiniz.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              href="/app/musteriler"
              className="focus-ring press rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-ink-950 transition hover:border-brand-300"
            >
              Müşteriler
            </Link>
            <Link
              href="/app/portfoyler"
              className="focus-ring press rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-ink-950 transition hover:border-brand-300"
            >
              Portföyler
            </Link>
          </div>
        </div>
      ) : (
        <TableFrame minWidth={760}>
          <Table>
            <THead>
              <TR>
                <TH>Portal</TH>
                <TH>Muhatap</TH>
                <TH>Son ziyaret</TH>
                <TH>Geçerlilik</TH>
                <TH>Oluşturulma</TH>
                <TH align="right">İşlem</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={`${row.kind}-${row.id}`}>
                  <TD className="font-semibold text-ink-950">
                    <span className="inline-flex items-center gap-1.5">
                      {row.kind === "customer" ? (
                        <UserRound className="h-3.5 w-3.5 text-brand-600" />
                      ) : (
                        <Building2 className="h-3.5 w-3.5 text-mint-600" />
                      )}
                      {row.kind === "customer" ? "Müşteri portalı" : "Malik portalı"}
                    </span>
                    {row.context ? (
                      <span className="mt-0.5 block truncate text-[11px] font-medium text-text-muted">
                        {row.context}
                      </span>
                    ) : null}
                  </TD>
                  <TD>
                    {row.href ? (
                      <Link
                        href={row.href}
                        className="focus-ring rounded-[6px] font-semibold text-ink-950 underline-offset-2 transition hover:text-brand-600 hover:underline"
                      >
                        {row.subject}
                      </Link>
                    ) : (
                      <span className="text-text-muted">{row.subject}</span>
                    )}
                  </TD>
                  <TD className="text-text-muted">
                    {row.lastSeenAt ? (
                      tarih(row.lastSeenAt)
                    ) : (
                      <span className="text-text-faint">Hiç açılmadı</span>
                    )}
                  </TD>
                  <TD>
                    {row.expired ? (
                      <span className="rounded-full bg-ink-950/8 px-2.5 py-1 text-[11px] font-semibold text-text-muted">
                        Süresi doldu / iptal
                      </span>
                    ) : (
                      <span className="rounded-full bg-mint-500/10 px-2.5 py-1 text-[11px] font-semibold text-mint-600">
                        {tarih(row.expiresAt)}&apos;e kadar
                      </span>
                    )}
                  </TD>
                  <TD className="text-text-muted">{tarih(row.createdAt)}</TD>
                  <TD align="right">
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {row.expired ? null : (
                        <>
                          <CopyButton url={row.url} />
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Portalı yeni sekmede aç"
                            aria-label="Portalı yeni sekmede aç"
                            className="focus-ring press grid h-8 w-8 place-items-center rounded-[9px] border border-line bg-surface text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                          <RevokeButton row={row} />
                        </>
                      )}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableFrame>
      )}
    </section>
  );
}
