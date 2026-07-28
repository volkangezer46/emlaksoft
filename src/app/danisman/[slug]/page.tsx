import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { after } from "next/server";
import {
  ArrowRight,
  BedDouble,
  Building2,
  CalendarClock,
  ContactRound,
  Languages,
  MapPin,
  MessageCircle,
  Phone,
  Quote,
  Ruler,
  Sparkles,
  Star,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { agentInitials, shortenCustomerName } from "@/lib/agent-profile";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { AgentShareCard } from "./agent-share-card";

/**
 * Danışman dijital kartviziti — PUBLIC mini profil sitesi.
 *
 * SEO KARARI: bu sayfa `noindex` DEĞİL. Token'lı portallarımız (anket, sunum,
 * randevu-al, tavsiye) kişiye özel ve gizlidir; burada amaç tam tersi —
 * danışmanın adıyla aranınca bulunması. Adres tahmin edilebilir bir slug,
 * içerik danışmanın kendi onayıyla ("Yayına al") açılmış tanıtım verisi ve
 * zaten herkese açık vitrin ilanları. Müşteri verisi gösterilmez: memnuniyet
 * yorumlarında ad KISALTILIR ("A. Yılmaz"), telefon/anlaşma bilgisi geçmez.
 *
 * ISR: revalidate = 300 — ilan listesi ve NPS ortalaması dakikalık tazelikte
 * yeterli, sayfa CDN'den anında açılır (vitrin deseni, orada 120sn).
 *
 * GÜVENLİK: RLS anon'a açık olmadığından tüm sorgular service role ile yapılır
 * (vitrin/anket deseni). Yayın kapalıysa veya slug yoksa → notFound().
 */

export const revalidate = 300;

const MAX_LISTINGS = 6;

type Rel = { name?: string } | { name?: string }[] | null;
function relName(v: Rel) {
  if (!v) return null;
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

function money(n: number | null, tx?: string | null) {
  if (n == null) return "Fiyat için sorun";
  const s = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
  return (tx ?? "").toLowerCase().includes("kira") || tx === "rent" ? `${s}/ay` : s;
}

/** Slug DB'de küçük harf saklanır; sorguya gitmeden biçim elenir. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

type AgentRecord = {
  id: string;
  tenant_id: string;
  full_name: string;
  phone: string | null;
  title: string | null;
  bio: string | null;
  photo_url: string | null;
  specialties: string[] | null;
  languages: string[] | null;
};

/** Yayındaki danışmanı slug'dan çözer; kapalı/pasif profil null döner. */
async function loadAgent(slug: string): Promise<AgentRecord | null> {
  if (!SLUG_RE.test(slug)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, tenant_id, full_name, phone, title, bio, photo_url, specialties, languages, is_active, is_public")
    .eq("public_slug", slug)
    .maybeSingle();
  // Pasifleştirilmiş üyenin kartviziti de kapanır — ofisten ayrılan kişi
  // "aktif danışman" gibi görünmesin.
  if (!data || data.is_public !== true || data.is_active !== true) return null;
  return data as AgentRecord;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const agent = await loadAgent(slug);
  if (!agent) return { title: "Danışman bulunamadı", robots: { index: false, follow: false } };

  const admin = createAdminClient();
  const { data: tenant } = await admin.from("tenants").select("name").eq("id", agent.tenant_id).maybeSingle();
  const office = (tenant?.name as string | null) ?? "Emlak ofisi";
  const role = agent.title?.trim() || "Emlak danışmanı";

  const title = `${agent.full_name} — ${role} | ${office}`;
  const description =
    agent.bio?.trim() ||
    `${agent.full_name}, ${office} bünyesinde ${role.toLocaleLowerCase("tr")}. ${
      agent.specialties?.length ? `Uzmanlık: ${agent.specialties.join(", ")}. ` : ""
    }Portföyleri görün, tek tıkla arayın veya randevu alın.`;

  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/danisman/${slug}` },
    openGraph: {
      type: "profile",
      locale: "tr_TR",
      siteName: office,
      title,
      description,
      url: `/danisman/${slug}`,
      // Portre varsa OG görseli odur; yoksa kök opengraph-image.tsx devreye girer.
      ...(agent.photo_url ? { images: [{ url: agent.photo_url, alt: agent.full_name }] } : {}),
    },
    twitter: { card: agent.photo_url ? "summary" : "summary", title, description },
  };
}

export default async function AgentCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const agent = await loadAgent(slug);
  if (!agent) notFound();

  const admin = createAdminClient();

  const [{ data: tenant }, { data: booking }, { data: listingRows, count: listingCount }, { data: surveyRows }] =
    await Promise.all([
      admin.from("tenants").select("name, slug, brand_color, logo_url").eq("id", agent.tenant_id).maybeSingle(),
      admin
        .from("booking_settings")
        .select("public_token")
        .eq("staff_id", agent.id)
        .eq("is_active", true)
        .maybeSingle(),
      admin
        .from("properties")
        .select(
          "id, title, property_code, transaction_type, list_price, features, province:geo_provinces(name), district:geo_districts(name)",
          { count: "exact" },
        )
        .eq("tenant_id", agent.tenant_id)
        .eq("assigned_to", agent.id)
        .eq("status", "live")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(MAX_LISTINGS),
      admin
        .from("surveys")
        .select("score, comment, answered_at, customer:customers(full_name)")
        .eq("tenant_id", agent.tenant_id)
        .eq("agent_id", agent.id)
        .eq("status", "answered")
        .not("score", "is", null)
        .order("answered_at", { ascending: false })
        .limit(200),
    ]);

  const office = (tenant?.name as string | null) ?? "Emlak ofisi";
  const officeSlug = (tenant?.slug as string | null) ?? null;
  const brand = (tenant?.brand_color as string | null) || "#1463FF";
  const role = agent.title?.trim() || "Emlak danışmanı";
  const specialties = (agent.specialties ?? []).filter(Boolean);
  const languages = (agent.languages ?? []).filter(Boolean);

  const listings = listingRows ?? [];
  const totalListings = listingCount ?? listings.length;

  // Kapak görselleri — vitrin kartıyla aynı seçim kuralı (kapak > sıra).
  const coverMap = new Map<string, string>();
  if (listings.length) {
    const { data: media } = await admin
      .from("property_media")
      .select("id, property_id, is_cover, sort_order")
      .eq("kind", "image")
      .in(
        "property_id",
        listings.map((p) => p.id),
      )
      .order("is_cover", { ascending: false })
      .order("sort_order", { ascending: true });
    for (const m of media ?? []) if (!coverMap.has(m.property_id)) coverMap.set(m.property_id, m.id);
  }

  /*
   * Memnuniyet — SAHTE SKOR YOK: hiç yanıtlanmış anket yoksa bölüm hiç
   * basılmaz. Ortalama tüm yanıtlardan (0-10) hesaplanır; vitrine yalnızca
   * "destekleyen" (>=9) ve yorumu dolu olan son 3 kayıt çıkar. Müşteri adı
   * kısaltılır — public sayfada tam ad gösterilmez.
   */
  type CustomerRel = { full_name?: string } | { full_name?: string }[] | null;
  const answered = (surveyRows ?? []) as {
    score: number | null;
    comment: string | null;
    answered_at: string | null;
    customer: CustomerRel;
  }[];
  const scores = answered.map((s) => Number(s.score)).filter((n) => Number.isFinite(n));
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const testimonials = answered
    .filter((s) => Number(s.score) >= 9 && String(s.comment ?? "").trim().length > 0)
    .slice(0, 3)
    .map((s) => {
      const c = Array.isArray(s.customer) ? s.customer[0] : s.customer;
      return { comment: String(s.comment).trim(), who: shortenCustomerName(c?.full_name ?? null) };
    });

  const telHref = toTelHref(agent.phone);
  const waHref = toWhatsAppLink(agent.phone);
  const bookingToken = (booking?.public_token as string | null) ?? null;

  // Görüntüleme sayacı — yanıt gönderildikten SONRA atomik +1
  // (increment_presentation_view deseni). ISR nedeniyle sayaç "sayfa üretimi"
  // sayar; panelde bu yüzden "yaklaşık" olarak etiketlenir.
  after(async () => {
    const { error } = await admin.rpc("increment_profile_view", { p_profile_id: agent.id });
    if (error) console.error("increment_profile_view", error.message);
  });

  const actions = [
    telHref ? { key: "ara", href: telHref, label: "Ara", icon: Phone, primary: true } : null,
    waHref ? { key: "wa", href: waHref, label: "WhatsApp", icon: MessageCircle, primary: false } : null,
    bookingToken
      ? { key: "randevu", href: `/randevu-al/${bookingToken}`, label: "Randevu al", icon: CalendarClock, primary: false }
      : null,
    { key: "vcard", href: `/danisman/${slug}/vcard`, label: "Rehbere ekle", icon: ContactRound, primary: false },
  ].filter(Boolean) as { key: string; href: string; label: string; icon: typeof Phone; primary: boolean }[];

  return (
    <div className="min-h-screen bg-canvas pb-24 sm:pb-0">
      {/* ---------------------------------------------------------------- Hero */}
      <header className="theme-dark relative overflow-hidden bg-[image:var(--grad-ink)] text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-30" />
        <div
          className="pointer-events-none absolute -right-24 -top-28 h-96 w-96 rounded-full blur-[130px] opacity-40"
          style={{ background: brand }}
        />
        <div className="relative mx-auto max-w-5xl px-4 py-12 sm:py-16">
          {/* Ofis kimliği — vitrine dönüş */}
          {officeSlug ? (
            <Link
              href={`/vitrin/${officeSlug}`}
              className="focus-ring flex w-fit items-center gap-2.5 rounded-[14px] transition hover:opacity-90"
            >
              <span
                className="grid h-9 w-9 place-items-center rounded-[11px] text-sm font-extrabold text-white"
                style={{ background: brand }}
              >
                {office[0]}
              </span>
              <span>
                <span className="block text-sm font-bold">{office}</span>
                <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-mint-400">
                  Portföy vitrinine git
                </span>
              </span>
            </Link>
          ) : (
            <span className="flex w-fit items-center gap-2.5">
              <span
                className="grid h-9 w-9 place-items-center rounded-[11px] text-sm font-extrabold text-white"
                style={{ background: brand }}
              >
                {office[0]}
              </span>
              <span className="text-sm font-bold">{office}</span>
            </span>
          )}

          <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-center">
            {/* Portre veya monogram */}
            <div className="relative shrink-0">
              <span
                className="absolute -inset-1 rounded-[28px] opacity-60 blur-lg"
                style={{ background: brand }}
                aria-hidden
              />
              {agent.photo_url ? (
                <Image
                  src={agent.photo_url}
                  alt={agent.full_name}
                  width={144}
                  height={144}
                  priority
                  className="relative h-32 w-32 rounded-[26px] border border-white/20 object-cover sm:h-36 sm:w-36"
                />
              ) : (
                <span
                  className="relative grid h-32 w-32 place-items-center rounded-[26px] border border-white/20 font-display text-4xl font-extrabold text-white sm:h-36 sm:w-36"
                  style={{ background: `linear-gradient(140deg, ${brand}, rgba(255,255,255,0.08))` }}
                >
                  {agentInitials(agent.full_name)}
                </span>
              )}
            </div>

            <div className="min-w-0">
              <h1 className="font-display text-3xl font-extrabold leading-tight sm:text-4xl">{agent.full_name}</h1>
              <p className="mt-1.5 text-sm font-semibold text-mint-400">{role}</p>
              {agent.bio ? (
                <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/65">{agent.bio}</p>
              ) : null}

              {specialties.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {specialties.map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/85"
                    >
                      <Sparkles className="h-3 w-3 text-mint-400" />
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}

              {languages.length > 0 ? (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-white/50">
                  <Languages className="h-3.5 w-3.5" /> {languages.join(" · ")}
                </p>
              ) : null}

              {agent.phone ? (
                <p className="mt-3 font-display text-lg font-extrabold tracking-wide text-white">
                  {formatTurkishPhone(agent.phone)}
                </p>
              ) : null}
            </div>
          </div>

          {/* Masaüstü aksiyon şeridi */}
          <div className="mt-8 hidden flex-wrap items-center gap-2.5 sm:flex">
            {actions.map((a) => (
              <a
                key={a.key}
                href={a.href}
                className={`focus-ring press inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition ${
                  a.primary
                    ? "bg-white text-ink-950 hover:bg-white/90"
                    : "border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.12]"
                }`}
              >
                <a.icon className="h-4 w-4" />
                {a.label}
              </a>
            ))}
            <AgentShareCard name={agent.full_name} office={office} slug={slug} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-10">
        {/* -------------------------------------------------------- Memnuniyet */}
        {avgScore != null ? (
          <section className="rounded-[22px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)] sm:p-6">
            <div className="flex flex-wrap items-center gap-5">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-[15px] bg-amber-400/15 text-amber-500">
                  <Star className="h-6 w-6" />
                </span>
                <div>
                  <p className="font-display text-2xl font-extrabold text-ink-950">
                    {avgScore.toFixed(1)}
                    <span className="text-sm font-bold text-text-faint"> / 10</span>
                  </p>
                  <p className="text-xs text-text-muted">
                    {scores.length} müşteri değerlendirmesi
                  </p>
                </div>
              </div>
              <p className="max-w-md text-xs leading-relaxed text-text-muted">
                Puanlar, iş tamamlandıktan sonra müşterilere gönderilen memnuniyet anketinden gelir —
                düzenlenmez, seçilerek gösterilmez.
              </p>
            </div>

            {testimonials.length > 0 ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                {testimonials.map((t, i) => (
                  <figure key={i} className="rounded-[16px] border border-line bg-canvas p-4">
                    <Quote className="h-4 w-4 text-brand-600" />
                    <blockquote className="mt-2 text-sm leading-relaxed text-ink-950">{t.comment}</blockquote>
                    <figcaption className="mt-3 text-xs font-semibold text-text-muted">{t.who}</figcaption>
                  </figure>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ----------------------------------------------------- Aktif portföy */}
        {listings.length > 0 ? (
          <section>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
                  <Building2 className="h-4 w-4" /> Yayındaki portföyler
                </p>
                <h2 className="mt-1 font-display text-xl font-extrabold text-ink-950">
                  {agent.full_name.split(" ")[0]} ile satılık &amp; kiralık
                </h2>
              </div>
              {officeSlug ? (
                <Link
                  href={`/vitrin/${officeSlug}`}
                  className="focus-ring inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-xs font-bold text-brand-600 transition hover:border-brand-300"
                >
                  {totalListings > listings.length ? `Tüm ilanlar (${totalListings})` : "Ofis vitrinine git"}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </div>

            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((p) => {
                const feat = (p.features ?? {}) as { rooms?: string; sqm?: number };
                const coverId = coverMap.get(p.id);
                const loc = [relName(p.district as Rel), relName(p.province as Rel)].filter(Boolean).join(", ");
                const href = officeSlug ? `/vitrin/${officeSlug}/${p.id}` : null;
                const card = (
                  <>
                    <div className="relative aspect-[4/3] overflow-hidden bg-ink-950/5">
                      {coverId ? (
                        <Image
                          src={`/api/property-media/${coverId}`}
                          alt={p.title || "Portföy"}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          className="object-cover transition group-hover:scale-105"
                        />
                      ) : (
                        <div className="grid h-full w-full place-items-center text-text-faint">
                          <Building2 className="h-10 w-10" />
                        </div>
                      )}
                      <span className="absolute left-3 top-3 rounded-full bg-ink-950/80 px-2.5 py-1 text-[11px] font-bold uppercase text-white">
                        {p.transaction_type}
                      </span>
                    </div>
                    <div className="p-4">
                      <p className="line-clamp-1 font-display font-bold text-ink-950">{p.title || p.property_code}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
                        <MapPin className="h-3.5 w-3.5 text-brand-600" /> {loc || "Konum belirtilmedi"}
                      </p>
                      <div className="mt-3 flex items-center gap-3 text-xs text-text-muted">
                        {feat.rooms ? (
                          <span className="flex items-center gap-1">
                            <BedDouble className="h-3.5 w-3.5" /> {feat.rooms}
                          </span>
                        ) : null}
                        {feat.sqm ? (
                          <span className="flex items-center gap-1">
                            <Ruler className="h-3.5 w-3.5" /> {feat.sqm} m²
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-3 font-display text-xl font-extrabold text-brand-600">
                        {money(p.list_price != null ? Number(p.list_price) : null, p.transaction_type)}
                      </p>
                    </div>
                  </>
                );
                return href ? (
                  <Link
                    key={p.id}
                    href={href}
                    className="lift group overflow-hidden rounded-[18px] border border-line bg-surface transition hover:border-brand-300"
                  >
                    {card}
                  </Link>
                ) : (
                  <article
                    key={p.id}
                    className="group overflow-hidden rounded-[18px] border border-line bg-surface"
                  >
                    {card}
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* -------------------------------------------------------- İletişim CTA */}
        <section className="theme-dark overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white sm:p-8">
          <h2 className="font-display text-xl font-extrabold">Aradığınızı bulamadınız mı?</h2>
          <p className="mt-2 max-w-lg text-sm text-white/60">
            {agent.full_name.split(" ")[0]} size uygun portföyleri bulup yerinde inceleme planlasın.
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {actions.map((a) => (
              <a
                key={a.key}
                href={a.href}
                className={`focus-ring press inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition ${
                  a.primary
                    ? "bg-white text-ink-950 hover:bg-white/90"
                    : "border border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.12]"
                }`}
              >
                <a.icon className="h-3.5 w-3.5" />
                {a.label}
              </a>
            ))}
          </div>
        </section>
      </main>

      {/* --------------------------------------- Mobil yapışkan aksiyon şeridi */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-3 py-2.5 backdrop-blur sm:hidden">
        <div className="flex items-center gap-2">
          {actions.map((a) => (
            <a
              key={a.key}
              href={a.href}
              className={`focus-ring press flex flex-1 flex-col items-center gap-1 rounded-[12px] px-1 py-2 text-[10px] font-bold transition ${
                a.primary ? "bg-brand-600 text-white" : "text-text-muted hover:text-brand-600"
              }`}
            >
              <a.icon className="h-4 w-4" />
              {a.label}
            </a>
          ))}
          <AgentShareCard name={agent.full_name} office={office} slug={slug} compact />
        </div>
      </div>

      <footer className="border-t border-line py-6 text-center text-[11px] text-text-faint">
        <Link href="/" className="font-semibold underline-offset-2 transition hover:text-brand-600 hover:underline">
          Powered by EmlakSoft
        </Link>{" "}
        — Türkiye&apos;nin emlak işletim sistemi
      </footer>
    </div>
  );
}
