import {
  ArrowUpRight,
  Building2,
  CalendarClock,
  CreditCard,
  Database,
  FileCheck2,
  Lock,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/server";
import { getRequestUser } from "@/lib/supabase/auth-cache";
import { getPlatformStaff } from "@/lib/platform";
import { PageHeader } from "@/components/ui/page-header";
import { ButtonLink } from "@/components/ui/button";
import Link from "next/link";
import { planLabel } from "@/lib/billing/plans";
import { closureDownloadAllowed } from "@/lib/admin/office-closure";
import { ClosureDataPanel } from "./closure-data-panel";


const nf = new Intl.NumberFormat("tr-TR");

/**
 * Askıya alınmış / iptal edilmiş abonelik ekranı. Panel kilitliyken kullanıcıya
 * ne olduğunu, verilerinin güvende olduğunu ve geri dönüş yolunu net anlatır.
 * Veri sayıları gerçektir (RLS tenant'ı süzer); sorgu boş dönerse kart gizlenir.
 */
export default async function SuspendedPage() {
  const supabase = await createClient();
  const user = await getRequestUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("full_name, role, tenants(name, status, plan, created_at)")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const tenant = profile?.tenants as
    | { name?: string; status?: string; plan?: string; created_at?: string }
    | { name?: string; status?: string; plan?: string; created_at?: string }[]
    | null
    | undefined;
  const office = (Array.isArray(tenant) ? tenant[0] : tenant) ?? undefined;
  const staff = await getPlatformStaff();
  const isCancelled = office?.status === "cancelled";
  // Arşivlenmiş ofisin sahibi: kapatma talebi sonrası veri paketi (CSV) sunulur.
  let showClosureData = false;
  if (isCancelled && profile?.role === "owner") {
    const { data: closureRequests } = await supabase
      .from("kvkk_requests")
      .select("status")
      .in("request_type", ["account_closure", "data_export"]);
    showClosureData = closureDownloadAllowed(office?.status, (closureRequests ?? []).map((r) => String(r.status)));
  }

  // Korunan veri hacmi — abonelik dondurulsa da kayıtlar silinmez; sayılar
  // gerçek sorgudan gelir. RLS erişim vermezse count null döner, kart gizlenir.
  const [{ count: customerCount }, { count: propertyCount }] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabase.from("properties").select("id", { count: "exact", head: true }),
  ]);
  const hasDataCounts = customerCount !== null || propertyCount !== null;

  const memberSince = office?.created_at
    ? new Intl.DateTimeFormat("tr-TR", { month: "long", year: "numeric" }).format(new Date(office.created_at))
    : null;

  const steps = isCancelled
    ? [
        { icon: Mail, title: "1 · Bize yazın", desc: "destek@emlaksoft.com.tr adresine ofis adınızla kısa bir e-posta gönderin." },
        { icon: FileCheck2, title: "2 · Paketi seçin", desc: "Ekibimiz size uygun paketi ve geçiş adımlarını aynı gün iletir." },
        { icon: ShieldCheck, title: "3 · Kaldığınız yerden", desc: "Saklama politikası içindeki mevcut kayıtlarınıza hesap yeniden açıldığında erişirsiniz." },
      ]
    : [
        { icon: CreditCard, title: "1 · Ödemeyi tamamlayın", desc: "Abonelik sayfasından bekleyen ödemeyi kartla güvenle tamamlayın." },
        { icon: CalendarClock, title: "2 · Dakikalar içinde", desc: "Ödeme onaylanınca erişim otomatik açılır — beklemeye gerek yok." },
        { icon: ShieldCheck, title: "3 · Kaldığınız yerden", desc: "Saklama politikası içindeki müşteri, portföy ve anlaşma kayıtlarınıza yeniden erişin." },
      ];

  return (
    <div className="space-y-6">
      <PageHeader
        className="mb-0"
        icon={
          <span className="grid h-12 w-12 place-items-center rounded-[var(--radius-card)] bg-danger-500/10 text-danger-600">
            <ShieldAlert className="h-6 w-6" />
          </span>
        }
        title="Hesap erişimi kısıtlandı"
        meta={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-500/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-danger-600">
            <Lock className="h-3 w-3" /> Erişim kilitli
          </span>
        }
        description={
          <>
            <span className="font-semibold text-text">{office?.name ?? "Ofisiniz"}</span> aboneliği şu an{" "}
            <span className="font-semibold text-danger-600">{isCancelled ? "iptal" : "askıda"}</span>. Panel erişimi
            geçici olarak kapalı; kayıtlar saklama politikası kapsamında korunur.
            {isCancelled
              ? " Abonelik yenilendiğinde erişim yeniden değerlendirilir."
              : " Deneme süreniz ve ardından tanınan tolerans sona erdiği için hesap otomatik askıya alındı; bir plan seçip ödemeyi tamamladığınızda erişim otomatik açılır."}
          </>
        }
        actions={
          <>
            {!isCancelled ? (
              <ButtonLink href="/app/abonelik">
                <CreditCard className="h-4 w-4" /> Planı seç ve öde
              </ButtonLink>
            ) : null}
            <a
              href="mailto:destek@emlaksoft.com.tr"
              className={`inline-flex min-h-[42px] items-center gap-2 rounded-[var(--radius-control)] px-4 py-2.5 text-sm font-semibold transition ${
                isCancelled
                  ? "bg-brand-600 text-white hover:bg-brand-700"
                  : "border border-line text-text-muted hover:border-brand-300 hover:text-brand-600"
              }`}
            >
              <Mail className="h-4 w-4" /> Destek yaz
            </a>
            {staff ? (
              <Link
                href="/admin"
                className="inline-flex min-h-[42px] items-center rounded-[var(--radius-control)] border border-amber-400/40 px-4 py-2.5 text-sm font-semibold text-amber-700 transition hover:border-amber-400/70"
              >
                Ops paneline git
              </Link>
            ) : null}
            <form action={signOut}>
              <button
                type="submit"
                className="min-h-[42px] rounded-[var(--radius-control)] border border-line px-4 py-2.5 text-sm font-semibold text-text-muted transition hover:border-brand-300 hover:text-text"
              >
                Çıkış yap
              </button>
            </form>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "Ofis", value: office?.name ?? "—" },
          { label: "Durum", value: isCancelled ? "İptal" : "Askıda", danger: true },
          { label: "Paket", value: office?.plan ? planLabel(office.plan) : "—" },
        ].map((r) => (
          <Link
            key={r.label}
            href="/app/abonelik"
            className="focus-ring press group relative rounded-[var(--radius-card)] border border-line bg-surface px-3.5 py-2.5 shadow-[var(--shadow-xs)] transition hover:border-brand-300"
          >
            <ArrowUpRight className="hover-action absolute right-2 top-2 h-3 w-3 text-text-faint opacity-0 transition group-hover:opacity-100" />
            <p className="text-xs uppercase tracking-wider text-text-muted">{r.label}</p>
            <p className={`truncate text-sm font-bold ${r.danger ? "text-danger-600" : "text-text"}`}>{r.value}</p>
          </Link>
        ))}
      </div>

      {showClosureData ? <ClosureDataPanel /> : null}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {/* Geri dönüş adımları */}
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
            <CalendarClock className="h-4 w-4 text-brand-600" /> Erişimi geri açmak için
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {steps.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.title} className="rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3.5">
                  <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-xs font-bold text-ink-950">{s.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Verileriniz güvende */}
        <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
            <Database className="h-4 w-4 text-mint-600" /> Verileriniz güvende
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-text-muted">
            Askı süresince hiçbir kayıt silinmez. {memberSince ? `${memberSince} tarihinden bu yana biriktirdiğiniz` : "Biriktirdiğiniz"}{" "}
            tüm müşteri, portföy ve anlaşma geçmişiniz şifreli olarak saklanır.
          </p>
          {hasDataCounts ? (
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Link
                href="/app/abonelik"
                className="focus-ring press group relative rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3.5 transition hover:border-brand-300"
              >
                <ArrowUpRight className="hover-action absolute right-2 top-2 h-3 w-3 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                <span className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Users className="h-3.5 w-3.5 text-brand-600" /> Korunan müşteri
                </span>
                <p className="numeric mt-1 font-display text-lg font-extrabold tabular-nums text-ink-950">
                  {nf.format(customerCount ?? 0)}
                </p>
              </Link>
              <Link
                href="/app/abonelik"
                className="focus-ring press group relative rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3.5 transition hover:border-brand-300"
              >
                <ArrowUpRight className="hover-action absolute right-2 top-2 h-3 w-3 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                <span className="flex items-center gap-1.5 text-xs text-text-muted">
                  <Building2 className="h-3.5 w-3.5 text-mint-600" /> Korunan portföy
                </span>
                <p className="numeric mt-1 font-display text-lg font-extrabold tabular-nums text-ink-950">
                  {nf.format(propertyCount ?? 0)}
                </p>
              </Link>
            </div>
          ) : null}
          <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-control)] bg-mint-500/8 p-2.5 text-xs leading-relaxed text-text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" />
            KVKK gereği verileriniz yalnız sizin kontrolünüzdedir; dilediğinizde dışa aktarım talep edebilirsiniz.
          </p>
        </section>
      </div>
    </div>
  );
}
