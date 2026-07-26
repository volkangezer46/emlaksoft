import Link from "next/link";
import { ShieldAlert, ShieldCheck } from "lucide-react";
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

export default async function CompliancePage() {
  const { perms } = await requireModulePage("compliance");
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
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <ShieldAlert className="h-4 w-4 text-amber-500" /> Kayıtlı izinler
          </h2>
          {(consents ?? []).length === 0 ? (
            <p className="mt-6 rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
              Henüz İYS kaydı yok.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {(consents ?? []).map((c) => {
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
                      <p className="text-xs text-text-muted">{channelLabel[c.channel] ?? c.channel}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        c.status === "granted" ? "bg-mint-500/10 text-mint-600" : c.status === "denied" ? "bg-danger-500/10 text-danger-500" : "bg-amber-400/15 text-amber-600"
                      }`}
                    >
                      {statusLabel[c.status] ?? c.status}
                    </span>
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
