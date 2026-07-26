import { notFound } from "next/navigation";
import { CalendarClock, Lock, Mail, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isIyzicoConfigured } from "@/lib/billing/iyzico";
import { PayButtons } from "./pay-buttons";
import { isPast, msUntil, DAY_MS } from "@/lib/clock";
import { toTelHref, toWhatsAppLink } from "@/lib/phone";

export const metadata = {
  title: "Güvenli Ödeme",
  robots: { index: false, follow: false },
};

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n);
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

type TenantRel = { name?: string; phone?: string | null } | { name?: string; phone?: string | null }[] | null;

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
    .select("id, title, amount_try, status, expires_at, created_by, tenant:tenants(name, phone)")
    .eq("token", token)
    .maybeSingle();

  if (!link) notFound();

  const tenant = link.tenant as TenantRel;
  const tenantRow = Array.isArray(tenant) ? tenant[0] : tenant;
  const office = tenantRow?.name;
  const officePhone = tenantRow?.phone ?? null;
  const officeTel = toTelHref(officePhone);
  const officeWhatsApp = toWhatsAppLink(officePhone, `Merhaba, süresi dolan ödeme bağlantısı hakkında yazıyorum (${link.title}).`);

  const expired = isPast(link.expires_at);
  const iyzicoReady = isIyzicoConfigured();
  const justPaid = sp.paid === "1" || link.status === "paid";
  // Son 24 saat: kullanıcı bağlantıyı ertelemesin diye görünür uyarı
  const expiresSoon = !expired && !justPaid && link.expires_at != null && msUntil(link.expires_at) < DAY_MS;

  // Ofis telefonu yoksa süresi dolan linkte e-posta ile iletişim sunulur
  // (tenants tablosunda e-posta yok; linki oluşturan kullanıcının adresi kullanılır)
  let contactEmail: string | null = null;
  if (expired && !justPaid && !officeTel && link.created_by) {
    const { data: creator } = await admin.auth.admin.getUserById(link.created_by);
    contactEmail = creator?.user?.email ?? null;
  }

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
            <>
              <p className="rounded-[12px] border border-mint-500/30 bg-mint-500/10 px-4 py-3 text-sm font-semibold text-mint-700">
                Ödeme alındı. Teşekkürler.
              </p>
              <p className="mt-3 rounded-[10px] border border-line bg-canvas px-3.5 py-2.5 text-xs text-text-muted">
                Makbuz talebiniz için ofisinizle iletişime geçin.
              </p>
            </>
          ) : expired ? (
            <>
              <p className="rounded-[12px] border border-danger-500/30 bg-danger-500/10 px-4 py-3 text-sm text-danger-600">
                Bu linkin süresi dolmuş.
              </p>
              <div className="mt-4 rounded-[12px] border border-line bg-canvas px-4 py-3.5">
                <p className="text-sm font-semibold text-ink-950">Ödemeye devam etmek ister misiniz?</p>
                <p className="mt-1 text-xs text-text-muted">
                  {office || "Ofisiniz"} sizin için yeni bir ödeme bağlantısı oluşturabilir.
                </p>
                {officeTel ? (
                  <div className="mt-3 grid grid-cols-2 gap-2.5">
                    <a
                      href={officeTel}
                      className="inline-flex items-center justify-center gap-2 rounded-[10px] bg-brand-600 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                    >
                      <Phone className="h-3.5 w-3.5" /> Ofisi Ara
                    </a>
                    {officeWhatsApp && (
                      <a
                        href={officeWhatsApp}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center gap-2 rounded-[10px] border border-mint-500/40 bg-mint-500/10 px-3 py-2.5 text-xs font-semibold text-mint-700 transition hover:bg-mint-500/20"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                      </a>
                    )}
                  </div>
                ) : contactEmail ? (
                  <a
                    href={`mailto:${contactEmail}?subject=${encodeURIComponent(`Ödeme bağlantısı: ${link.title}`)}`}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-brand-600 px-3 py-2.5 text-xs font-semibold text-white transition hover:bg-brand-700"
                  >
                    <Mail className="h-3.5 w-3.5" /> E-posta gönder
                  </a>
                ) : (
                  <p className="mt-2 text-xs font-medium text-ink-800">
                    Lütfen ofisinizle bilinen iletişim kanalınızdan görüşün.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-text-muted">
                {iyzicoReady
                  ? "Ödeme iyzico Checkout Form üzerinden alınır."
                  : "iyzico anahtarı yok — demo tahsilat ile test edilir."}
              </p>
              {link.expires_at ? (
                expiresSoon ? (
                  <p className="mt-3 flex items-start gap-2 rounded-[10px] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-700">
                    <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Bu bağlantının süresi yakında doluyor — son geçerlilik: {formatDateTime(link.expires_at)}
                  </p>
                ) : (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-text-faint">
                    <CalendarClock className="h-3.5 w-3.5" /> Son geçerlilik: {formatDateTime(link.expires_at)}
                  </p>
                )
              ) : null}
              {sp.error ? (
                <p className="mt-3 rounded-[10px] border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-xs text-danger-600">
                  Ödeme tamamlanamadı. Tekrar deneyin.
                </p>
              ) : null}
              <div className="mt-4">
                <PayButtons token={token} iyzicoReady={iyzicoReady} />
              </div>
              {/* Güven işaretleri — metin rozeti, abartısız */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-line pt-3 text-[11px] font-medium text-text-faint">
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3 w-3 text-mint-600" /> 3D Secure
                </span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <ShieldCheck className="h-3 w-3 text-mint-600" /> SSL ile şifreli ödeme
                </span>
                {iyzicoReady ? (
                  <>
                    <span aria-hidden>·</span>
                    <span>iyzico altyapısı</span>
                  </>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
