import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isIyzicoConfigured } from "@/lib/billing/iyzico";
import { PayButtons } from "./pay-buttons";
import { isPast } from "@/lib/clock";

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

export default async function PublicPaymentLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; error?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const admin = createAdminClient();
  const { data: link } = await admin
    .from("payment_links")
    .select("id, title, amount_try, status, expires_at, tenant:tenants(name)")
    .eq("token", token)
    .maybeSingle();

  if (!link) notFound();

  const tenant = link.tenant as { name?: string } | { name?: string }[] | null;
  const office = Array.isArray(tenant) ? tenant[0]?.name : tenant?.name;
  const expired = isPast(link.expires_at);
  const iyzicoReady = isIyzicoConfigured();
  const justPaid = sp.paid === "1" || link.status === "paid";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[image:var(--grad-ink)] px-4 py-12">
      <div className="w-full max-w-md overflow-hidden rounded-[22px] border border-white/15 bg-surface shadow-[var(--shadow-lg)]">
        <div className="theme-dark bg-[image:var(--grad-ink)] px-6 py-5 text-white">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-cyan-400">{office || "EmlakSoft"}</p>
          <h1 className="mt-2 font-display text-2xl font-extrabold">{link.title}</h1>
          <p className="mt-3 font-display text-3xl font-extrabold text-mint-300">{money(Number(link.amount_try))}</p>
        </div>
        <div className="p-6">
          {justPaid ? (
            <p className="rounded-[12px] border border-mint-500/30 bg-mint-500/10 px-4 py-3 text-sm font-semibold text-mint-700">
              Ödeme alındı. Teşekkürler.
            </p>
          ) : expired ? (
            <p className="rounded-[12px] border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-600">
              Bu linkin süresi dolmuş.
            </p>
          ) : (
            <>
              <p className="text-sm text-text-muted">
                {iyzicoReady
                  ? "Ödeme iyzico Checkout Form üzerinden alınır."
                  : "iyzico anahtarı yok — demo tahsilat ile test edilir."}
              </p>
              {sp.error ? (
                <p className="mt-3 rounded-[10px] border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-600">
                  Ödeme tamamlanamadı. Tekrar deneyin.
                </p>
              ) : null}
              <div className="mt-4">
                <PayButtons token={token} iyzicoReady={iyzicoReady} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
