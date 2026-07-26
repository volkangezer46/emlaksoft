import Link from "next/link";
import { ArrowUpRight, FileCheck2, ShieldAlert, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { IysForm } from "./iys-form";
import { listErasureLog } from "@/app/actions/kvkk";
import { KvkkPanel } from "./kvkk-panel";

const channelLabel: Record<string, string> = {
  sms: "SMS",
  email: "E-posta",
  whatsapp: "WhatsApp",
  call: "Arama",
};

const statusLabel: Record<string, string> = {
  granted: "İzinli",
  denied: "Ret",
  unknown: "Bilinmiyor",
  pending: "Bekliyor",
};

const CHANNELS = Object.keys(channelLabel);
const STATUSES = Object.keys(statusLabel);

/** Bellek-içi filtre bağlantısı — aynı değere tıklanınca filtre kalkar (toggle). */
function consentFilterHref(current: { kanal?: string; durum?: string }, patch: { kanal?: string; durum?: string }) {
  const next = { ...current, ...patch };
  if (patch.kanal !== undefined && current.kanal === patch.kanal) next.kanal = undefined;
  if (patch.durum !== undefined && current.durum === patch.durum) next.durum = undefined;
  const sp = new URLSearchParams();
  if (next.kanal) sp.set("kanal", next.kanal);
  if (next.durum) sp.set("durum", next.durum);
  const qs = sp.toString();
  return qs ? `/app/uyum?${qs}` : "/app/uyum";
}

export default async function CompliancePage({
  searchParams,
}: {
  searchParams?: Promise<{ kanal?: string; durum?: string }>;
}) {
  const { perms } = await requireModulePage("compliance");
  const params = (await searchParams) ?? {};
  const kanal = CHANNELS.includes(params.kanal ?? "") ? params.kanal : undefined;
  const durum = STATUSES.includes(params.durum ?? "") ? params.durum : undefined;
  const supabase = await createClient();

  // KVKK silme kaniti + yetki. Anonimlestirme geri alinamaz bir islem oldugu
  // icin `customers.delete` izni isteniyor; bir danismanin kendi basina
  // yapabilecegi bir sey olmamali.
  const canErase = (perms.customers ?? []).includes("delete");
  const erasureLog = await listErasureLog(50);

  const [{ data: consents }, { data: customers }] = await Promise.all([
    supabase
      .from("iys_consents")
      .select("id, channel, status, granted_at, customer:customers(id, full_name)")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("customers")
      .select("id, full_name")
      .is("deleted_at", null)
      .order("full_name")
      .limit(200),
  ]);

  const filteredConsents = (consents ?? []).filter(
    (c) => (!kanal || c.channel === kanal) && (!durum || c.status === durum),
  );

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="relative">
          <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-mint-400">
            <ShieldCheck className="h-3.5 w-3.5" /> İYS / EİDS kalkanı
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold">Uyum merkezi</h1>
          <p className="mt-2 max-w-xl text-sm text-white/60">
            Ticari ileti izinleri ve yetki belgesi kontrolü. İYS entegratör API’si bağlanınca senkron otomatikleşir.
          </p>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <IysForm customers={customers ?? []} />
        <section className="rounded-[20px] border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <ShieldAlert className="h-4 w-4 text-amber-500" /> Kayıtlı izinler
            </h2>
            {kanal || durum ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                {kanal ? (
                  <span className="rounded-full bg-brand-600/10 px-2 py-0.5 font-semibold text-brand-600">{channelLabel[kanal]}</span>
                ) : null}
                {durum ? (
                  <span className="rounded-full bg-brand-600/10 px-2 py-0.5 font-semibold text-brand-600">{statusLabel[durum]}</span>
                ) : null}
                <Link href="/app/uyum" className="font-semibold text-text-muted underline-offset-2 hover:text-brand-600 hover:underline">
                  Filtreyi temizle
                </Link>
              </div>
            ) : null}
          </div>
          {filteredConsents.length === 0 ? (
            <p className="mt-6 rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
              {(consents ?? []).length === 0 ? "Henüz İYS kaydı yok." : "Filtreye uyan izin kaydı yok."}
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {filteredConsents.map((c) => {
                const cust = c.customer as { id?: string; full_name?: string } | { id?: string; full_name?: string }[] | null;
                const custRow = Array.isArray(cust) ? cust[0] : cust;
                const name = custRow?.full_name;
                const custId = custRow?.id;
                return (
                  <div key={c.id} className="group relative flex items-center justify-between rounded-[12px] border border-line bg-canvas/60 px-3 py-2.5 text-sm">
                    {custId ? (
                      <Link href={`/app/musteriler/${custId}`} className="absolute inset-0 rounded-[12px]" aria-label={`${name ?? "Müşteri"} kaydını aç`} />
                    ) : null}
                    <div>
                      <p className="font-semibold text-ink-950">{name ?? "Müşteri"}</p>
                      {/* Overlay müşteri linkinin üstünde kalması için relative z-10 */}
                      <Link
                        href={consentFilterHref({ kanal, durum }, { kanal: c.channel })}
                        className={`relative z-10 text-xs underline-offset-2 transition hover:underline ${kanal === c.channel ? "font-semibold text-brand-600" : "text-text-muted hover:text-brand-600"}`}
                        title={`${channelLabel[c.channel] ?? c.channel} kanalına göre filtrele`}
                      >
                        {channelLabel[c.channel] ?? c.channel}
                      </Link>
                    </div>
                    <Link
                      href={consentFilterHref({ kanal, durum }, { durum: c.status })}
                      title={`${statusLabel[c.status] ?? c.status} durumuna göre filtrele`}
                      className={`relative z-10 rounded-full px-2 py-0.5 text-[11px] font-bold transition hover:ring-1 hover:ring-brand-300 ${
                        c.status === "granted" ? "bg-mint-500/10 text-mint-600" : c.status === "denied" ? "bg-danger-500/10 text-danger-500" : "bg-amber-400/15 text-amber-600"
                      } ${durum === c.status ? "ring-1 ring-brand-400" : ""}`}
                    >
                      {statusLabel[c.status] ?? c.status}
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* KVKK yasam dongusu: `deleted_at` isaretli musteriler HIC temizlenmiyordu,
          yani "silinmis" bir musterinin adi/telefonu/e-postasi veritabaninda
          sonsuza kadar duruyordu. */}
      <KvkkPanel initialLog={erasureLog as Parameters<typeof KvkkPanel>[0]["initialLog"]} canErase={canErase} />

      {/* Denetim dosyasi: yetki belgeleri, sozlesmeler, hizmet bedeli ve IYS
          rizalari BES AYRI SAYFAYA dagilmisti; denetim aninda tek tek toplamak
          gerekiyordu. */}
      <Link
        href="/app/uyum/denetim-dosyasi"
        className="lift-hover focus-ring group surface-card flex items-center justify-between gap-3 rounded-[var(--radius-panel)] p-5 transition hover:border-brand-300"
      >
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
            <FileCheck2 className="h-4 w-4" /> Denetime hazırlık
          </p>
          <h2 className="mt-1 font-display font-bold text-ink-950">Denetim dosyası</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Yetki belgeleri, sözleşmeler, hizmet bedeli ve İYS rızaları tek yazdırılabilir sayfada —
            eksikler dahil.
          </p>
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-canvas text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600">
          <ArrowUpRight className="h-4 w-4" />
        </span>
      </Link>

      <section className="rounded-[20px] border border-amber-400/30 bg-amber-400/5 p-5">
        <h2 className="font-display font-bold text-ink-950">EİDS / yetki kalkanı</h2>
        <p className="mt-2 text-sm text-text-muted">
          Yazılı yetki belgesi olmadan kapora, pazarlık ve sözleşme adımlarında sistem uyarı üretir.
          `checkAuthorityShield` workflow ve portföy kapanışına entegre edilmeye hazır.
        </p>
      </section>
    </div>
  );
}
