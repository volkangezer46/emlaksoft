import Link from "next/link";
import { Building2, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { brandTheme } from "./brand";

/**
 * Token'lı public sayfaların ORTAK kabuğu.
 *
 * anket / tavsiye / randevu-al / randevu-teyit / acik-ev-kayit sayfaları
 * birbirinin kopyası olan bir düzeni (marka bandı → kart → başlık bloğu →
 * gövde → "Powered by" notu) satır satır tekrarlıyordu; bir sayfada yapılan
 * iyileştirme diğer dördüne geçmiyordu. Kabuk buraya taşındı: düzen, marka
 * tonlaması, giriş animasyonu ve erişilebilirlik tek yerden gelir.
 *
 * Sayfa MANTIĞI burada değil — bileşen yalnızca sunum yapar; token doğrulama,
 * rate limit, honeypot ve KVKK zorunluluğu çağıran sayfada/formda kalır.
 */

type Width = "md" | "lg" | "xl";

const WIDTH: Record<Width, string> = {
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

/**
 * Marka bandı — "linki kim gönderdi?" sorusunun ilk ekrandaki cevabı.
 * Logo varsa logo, yoksa marka renginde baş harf rozeti.
 */
export function PublicBrandBand({
  office,
  logoUrl,
  className = "",
}: {
  office: string;
  logoUrl?: string | null;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center gap-2 text-xs font-semibold text-text-muted ${className}`}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- kiracı logosu keyfi bir Storage URL'i; next/image domain listesi gerektirir
        <img
          src={logoUrl}
          alt=""
          width={24}
          height={24}
          className="h-6 w-6 rounded-[8px] object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-[8px] text-[11px] font-bold"
          style={{ backgroundColor: "var(--pb-soft)", color: "var(--pb-ink)" }}
        >
          {office.slice(0, 1).toLocaleUpperCase("tr-TR")}
        </span>
      )}
      <span className="min-w-0 truncate">{office}</span>
      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-mint-600" aria-hidden="true" />
    </div>
  );
}

/**
 * Sayfa altındaki güven notu — bu linkin ne İÇİN olduğunu söyler
 * ("yalnızca randevu teyidi içindir"), sızıntı endişesini azaltır.
 */
export function PublicFooterNote({
  purpose,
  children,
}: {
  purpose: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-6 space-y-2 text-center text-[11px] leading-relaxed text-text-faint">
      <p>
        <Building2 className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />
        {purpose} ·{" "}
        <Link
          href="/"
          className="focus-ring rounded-[4px] font-semibold underline-offset-2 transition hover:text-text-muted hover:underline"
        >
          Powered by EmlakSoft
        </Link>
      </p>
      {children}
      <p>
        <Link
          href="/kvkk-aydinlatma"
          className="focus-ring rounded-[4px] underline-offset-2 transition hover:text-text-muted hover:underline"
        >
          KVKK Aydınlatma Metni
        </Link>
        <span aria-hidden="true"> · </span>
        <Link
          href="/gizlilik"
          className="focus-ring rounded-[4px] underline-offset-2 transition hover:text-text-muted hover:underline"
        >
          Gizlilik Politikası
        </Link>
      </p>
    </div>
  );
}

/**
 * Kartın başlık bloğu: ikon madalyonu + h1 + tek cümlelik açıklama.
 * Zemin, kiracı marka renginden türetilen ÇOK hafif bir degrade (`--pb-tint`)
 * — metin kontrastını bozmaz, ama sayfa "beyaz form" olmaktan çıkar.
 */
function PublicCardHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="relative overflow-hidden border-b border-line px-6 py-6 text-center">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: "var(--pb-tint)" }}
      />
      <div className="relative">
        <span
          aria-hidden="true"
          className="mx-auto grid h-12 w-12 place-items-center rounded-[14px]"
          style={{ backgroundColor: "var(--pb-soft)" }}
        >
          <Icon className="h-6 w-6" style={{ color: "var(--pb-ink)" }} />
        </span>
        <h1 className="mt-3 text-balance font-display text-xl font-extrabold leading-snug tracking-[-0.01em] text-ink-950">
          {title}
        </h1>
        {subtitle ? (
          <p className="mx-auto mt-2 max-w-prose text-pretty text-sm leading-relaxed text-text-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Tam sayfa kabuk. `brandColor` kiracının rengidir; verilmezse ürün mavisine
 * düşer. Kontrast kararları `brandTheme()` içinde ÖLÇÜLEREK verilir.
 */
export function PublicTokenPage({
  office,
  logoUrl,
  brandColor,
  icon,
  title,
  subtitle,
  purpose,
  width = "md",
  footerExtra,
  children,
}: {
  office: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  icon: LucideIcon;
  title: string;
  subtitle?: React.ReactNode;
  /** Footer'daki "Bu sayfa yalnızca … içindir" cümlesi. */
  purpose: string;
  width?: Width;
  footerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const theme = brandTheme(brandColor);
  return (
    <div
      className="grid min-h-screen place-items-center bg-canvas px-4 py-10 sm:py-14"
      style={theme.style}
    >
      {/* Giriş hareketi 260ms; prefers-reduced-motion altında motion-safe ile kapalı. */}
      <div
        className={`w-full ${WIDTH[width]} motion-safe:animate-[rise_0.26s_cubic-bezier(0.16,1,0.3,1)_both]`}
      >
        <PublicBrandBand office={office} logoUrl={logoUrl} className="mb-5" />

        <main className="surface-card overflow-hidden rounded-[22px]">
          <PublicCardHeader icon={icon} title={title} subtitle={subtitle} />
          <div className="px-5 py-5 sm:px-6">{children}</div>
        </main>

        <PublicFooterNote purpose={purpose}>{footerExtra}</PublicFooterNote>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kart içi ortak parçalar                                             */
/* ------------------------------------------------------------------ */

type Tone = "neutral" | "success" | "warning" | "danger" | "brand";

const TONE: Record<Tone, { box: string; icon: string; title: string }> = {
  neutral: { box: "border-line bg-canvas", icon: "text-text-faint", title: "text-ink-950" },
  success: { box: "border-mint-500/30 bg-mint-500/8", icon: "text-mint-600", title: "text-ink-950" },
  warning: { box: "border-amber-400/40 bg-amber-400/10", icon: "text-amber-700", title: "text-ink-950" },
  danger: { box: "border-danger-500/25 bg-danger-500/6", icon: "text-danger-600", title: "text-ink-950" },
  brand: { box: "border-brand-300/40 bg-brand-600/5", icon: "text-brand-600", title: "text-ink-950" },
};

/**
 * Anlamlı boş/son durum kutusu — "kapandı", "süresi doldu", "yanıtınız alındı".
 * İkon + başlık + açıklayıcı metin + (varsa) çıkış yolu; kullanıcıyı çıkmazda
 * bırakmama kuralının public karşılığı.
 */
export function PublicStateBox({
  icon: Icon,
  title,
  description,
  tone = "neutral",
  action,
  className = "",
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  tone?: Tone;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <div
      className={`rounded-[14px] border px-4 py-8 text-center ${t.box} ${className}`}
      role="status"
    >
      <span
        aria-hidden="true"
        className={`mx-auto grid h-11 w-11 place-items-center rounded-full bg-surface/70 ${t.icon}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <p className={`mt-3 text-balance text-sm font-bold ${t.title}`}>{title}</p>
      {description ? (
        <p className="mx-auto mt-1.5 max-w-prose text-pretty text-xs leading-relaxed text-text-muted">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/**
 * Etiket/değer satırları (tarih, saat, tür, ofis…). `dl` semantiği korunur;
 * uzun değerler mobilde taşmasın diye alta kırılır.
 */
export function PublicDetailList({
  items,
  className = "",
}: {
  items: ReadonlyArray<{
    label: string;
    value: React.ReactNode;
    icon?: LucideIcon;
  }>;
  className?: string;
}) {
  return (
    <dl className={`space-y-2 ${className}`}>
      {items.map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[12px] border border-line bg-canvas/60 px-4 py-2.5"
        >
          <dt className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-text-muted">
            {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {label}
          </dt>
          <dd className="min-w-0 flex-1 text-right text-sm font-semibold text-ink-950">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Marka renginde birincil aksiyon — dolgu marka rengi, metin rengi kontrast
 * ölçülerek seçilmiş (`--pb-on-brand`). Dokunma hedefi ≥44px.
 */
export function PublicBrandButton({
  href,
  children,
  className = "",
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      className={`focus-ring press inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] px-5 text-sm font-bold transition hover:brightness-95 ${className}`}
      style={{ backgroundColor: "var(--pb-brand)", color: "var(--pb-on-brand)" }}
      {...rest}
    >
      {children}
    </a>
  );
}

/** İkincil aksiyon — yüzey dolgulu, kenarlıklı. Dokunma hedefi ≥44px. */
export function PublicGhostButton({
  href,
  children,
  className = "",
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      className={`focus-ring press inline-flex min-h-11 items-center justify-center gap-2 rounded-[12px] border border-hairline-strong bg-surface px-5 text-sm font-bold text-ink-950 transition hover:bg-canvas ${className}`}
      {...rest}
    >
      {children}
    </a>
  );
}
