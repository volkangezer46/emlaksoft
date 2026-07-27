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
import { getPlatformStaff } from "@/lib/platform";
import { ButtonLink } from "@/components/ui/button";
import Link from "next/link";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

const nf = new Intl.NumberFormat("tr-TR");

const planLabel: Record<string, string> = {
  advisor: "Danışman",
  office: "Ofis",
  professional: "Profesyonel",
  enterprise: "Kurumsal",
};

/**
 * Askıya alınmış / iptal edilmiş abonelik ekranı. Panel kilitliyken kullanıcıya
 * ne olduğunu, verilerinin güvende olduğunu ve geri dönüş yolunu net anlatır.
 * Veri sayıları gerçektir (RLS tenant'ı süzer); sorgu boş dönerse kart gizlenir.
 */
export default async function SuspendedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("full_name, tenants(name, status, plan, created_at)")
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
        { icon: ShieldCheck, title: "3 · Kaldığınız yerden", desc: "Hesap açılır açılmaz tüm verileriniz olduğu gibi yerinde olur." },
      ]
    : [
        { icon: CreditCard, title: "1 · Ödemeyi tamamlayın", desc: "Abonelik sayfasından bekleyen ödemeyi kartla güvenle tamamlayın." },
        { icon: CalendarClock, title: "2 · Dakikalar içinde", desc: "Ödeme onaylanınca erişim otomatik açılır — beklemeye gerek yok." },
        { icon: ShieldCheck, title: "3 · Kaldığınız yerden", desc: "Müşteri, portföy ve anlaşmalarınız olduğu gibi sizi bekliyor." },
      ];

  return (
    <div className="space-y-6">
      {/* Koyu hero — durum + kimlik */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-5 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-danger-500/25 blur-[80px]" />
        <div className="pointer-events-none absolute -left-16 bottom-0 h-44 w-44 rounded-full bg-amber-400/15 blur-[80px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.3fr_auto] lg:items-center">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-500/15 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-danger-500">
              <Lock className="h-3 w-3" /> Erişim kilitli
            </span>
            <h1 className="mt-3 font-display text-2xl font-extrabold md:text-3xl">Hesap erişimi kısıtlandı</h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/65">
              <span className="font-semibold text-white">{office?.name ?? "Ofisiniz"}</span> aboneliği şu an{" "}
              <span className="font-semibold text-danger-500">{isCancelled ? "iptal" : "askıda"}</span>. Panel erişimi
              geçici olarak kapalı; verileriniz eksiksiz saklanıyor ve abonelik yenilendiğinde anında geri açılıyor.
            </p>

            {/* Hesap kimlik şeridi */}
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {[
                { label: "Ofis", value: office?.name ?? "—" },
                { label: "Durum", value: isCancelled ? "İptal" : "Askıda", danger: true },
                { label: "Paket", value: office?.plan ? planLabel[office.plan] ?? office.plan : "—" },
              ].map((r) => (
                <Link
                  key={r.label}
                  href="/app/abonelik"
                  className="focus-ring press group relative rounded-[13px] border border-white/10 bg-white/5 px-3.5 py-2.5 transition hover:border-white/30"
                >
                  <ArrowUpRight className="hover-action absolute right-2 top-2 h-3 w-3 text-white/50 opacity-0 transition group-hover:opacity-100" />
                  <p className="text-[10px] uppercase tracking-[0.08em] text-white/45">{r.label}</p>
                  <p className={`truncate text-sm font-bold ${r.danger ? "text-danger-500" : "text-white"}`}>{r.value}</p>
                </Link>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {!isCancelled ? (
                <ButtonLink href="/app/abonelik">
                  <CreditCard className="h-4 w-4" /> Ödemeyi tamamla
                </ButtonLink>
              ) : null}
              <a
                href="mailto:destek@emlaksoft.com.tr"
                className={`inline-flex min-h-[42px] items-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-semibold transition ${
                  isCancelled
                    ? "bg-brand-600 text-white hover:bg-brand-700"
                    : "border border-white/20 text-white/80 hover:border-white/40 hover:text-white"
                }`}
              >
                <Mail className="h-4 w-4" /> Destek yaz
              </a>
              {staff ? (
                <Link
                  href="/admin"
                  className="inline-flex min-h-[42px] items-center rounded-[10px] border border-amber-400/40 px-4 py-2.5 text-sm font-semibold text-amber-300 transition hover:border-amber-400/70"
                >
                  Ops paneline git
                </Link>
              ) : null}
              <form action={signOut}>
                <button
                  type="submit"
                  className="min-h-[42px] rounded-[10px] border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/60 transition hover:border-white/30 hover:text-white"
                >
                  Çıkış yap
                </button>
              </form>
            </div>
          </div>

          {/* Durum rozeti — animasyonlu halka */}
          <div className="mx-auto grid h-32 w-32 place-items-center lg:h-36 lg:w-36">
            <div className="relative grid h-full w-full place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-0 rounded-full opacity-30 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--danger-500), var(--amber-400), var(--danger-500))" }}
              />
              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--danger-500)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  className="ring-sweep"
                  style={{ "--circ": RING_C, "--dash": RING_C * 0.35 } as CSSProperties}
                />
              </svg>
              <span className="relative grid h-14 w-14 place-items-center rounded-[16px] bg-danger-500/15 text-danger-500">
                <ShieldAlert className="h-7 w-7" />
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {/* Geri dönüş adımları */}
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
          <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
            <CalendarClock className="h-4 w-4 text-brand-600" /> Erişimi geri açmak için
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {steps.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.title} className="rounded-[14px] border border-line bg-canvas/60 p-3.5">
                  <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-brand-600/10 text-brand-600">
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="mt-2.5 text-xs font-bold text-ink-950">{s.title}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{s.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Verileriniz güvende */}
        <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
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
                className="focus-ring press group relative rounded-[13px] border border-line bg-canvas/60 p-3.5 transition hover:border-brand-300"
              >
                <ArrowUpRight className="hover-action absolute right-2 top-2 h-3 w-3 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <Users className="h-3.5 w-3.5 text-brand-600" /> Korunan müşteri
                </span>
                <p className="numeric mt-1 font-display text-lg font-extrabold tabular-nums text-ink-950">
                  {nf.format(customerCount ?? 0)}
                </p>
              </Link>
              <Link
                href="/app/abonelik"
                className="focus-ring press group relative rounded-[13px] border border-line bg-canvas/60 p-3.5 transition hover:border-brand-300"
              >
                <ArrowUpRight className="hover-action absolute right-2 top-2 h-3 w-3 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <Building2 className="h-3.5 w-3.5 text-mint-600" /> Korunan portföy
                </span>
                <p className="numeric mt-1 font-display text-lg font-extrabold tabular-nums text-ink-950">
                  {nf.format(propertyCount ?? 0)}
                </p>
              </Link>
            </div>
          ) : null}
          <p className="mt-3 flex items-start gap-2 rounded-[11px] bg-mint-500/8 p-2.5 text-[11px] leading-relaxed text-text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" />
            KVKK gereği verileriniz yalnız sizin kontrolünüzdedir; dilediğinizde dışa aktarım talep edebilirsiniz.
          </p>
        </section>
      </div>
    </div>
  );
}
