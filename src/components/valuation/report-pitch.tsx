import { BadgeCheck, CalendarCheck, Megaphone, Phone, Trophy, UserRound } from "lucide-react";
import { formatPhoneDisplay } from "@/lib/phone";
import { marketingPlanLines, type PresentationEntry } from "@/lib/valuation/listing-pitch";

export type PitchAdvisor = { name: string; title: string | null; phone: string | null; photoUrl: string | null };

/**
 * PF-03 — Değerleme raporunun "yetki alma sunumu" bölümleri (iç rapor ve herkese açık rapor AYNI bileşen).
 * Sunucu bileşeni; istemci JS yok, çıktıda (print) aynı düzen. Kartlar kayıttaki anlık görüntüden okunur.
 */
export function ReportPitch({
  entry,
  officeName,
  advisor,
  bookingHref,
}: {
  entry: PresentationEntry;
  officeName: string;
  advisor: PitchAdvisor | null;
  bookingHref: string | null;
}) {
  if (!entry.options.enabled) return null;
  const cards = entry.options.trackRecord ? entry.cards : [];
  const plan = entry.options.marketing ? marketingPlanLines(entry) : [];
  const showAdvisor = entry.options.advisor && advisor;
  const showCta = entry.options.cta && bookingHref;
  if (cards.length === 0 && plan.length === 0 && !showAdvisor && !showCta) return null;
  const asOf = entry.computed_at
    ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "Europe/Istanbul" }).format(new Date(entry.computed_at))
    : null;

  return (
    <>
      {cards.length > 0 ? (
        <section className="print-avoid-break mt-7">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <Trophy className="h-4 w-4 text-brand-600" /> {entry.areaLabel ? `${entry.areaLabel} bölgesindeki sonuçlarımız` : "Sonuçlarımız"}
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map((c) => (
              <div key={c.key} className="rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-faint">{c.label}</p>
                <p className="numeric mt-1 font-display text-xl font-extrabold text-ink-950">{c.value}</p>
                <p className="mt-0.5 text-xs leading-snug text-text-muted">{c.note}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-faint">
            Rakamlar yalnız {officeName} kayıtlarından{asOf ? `, ${asOf} itibarıyla` : ""} hesaplanmıştır; kişi ve adres bilgisi içermez.
          </p>
        </section>
      ) : null}

      {plan.length > 0 ? (
        <section className="print-avoid-break mt-7">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <Megaphone className="h-4 w-4 text-brand-600" /> Pazarlama planımız
          </h2>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2">
            {plan.map((p, i) => (
              <li key={p.key} className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2.5">
                <span className="numeric grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-600/10 text-xs font-bold text-brand-600">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-950">{p.label}</span>
                  <span className="block text-xs leading-snug text-text-muted">{p.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {showAdvisor || showCta ? (
        <section className="print-avoid-break mt-7 rounded-[var(--radius-card)] border border-brand-300/50 bg-brand-600/5 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {showAdvisor ? (
              <div className="flex min-w-0 items-center gap-3">
                {advisor!.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- danışman fotoğrafı (genel profil; boyut küçük)
                  <img src={advisor!.photoUrl} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-brand-600/10 text-brand-600">
                    <UserRound className="h-6 w-6" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate font-display text-base font-bold text-ink-950">
                    {advisor!.name} <BadgeCheck className="h-4 w-4 shrink-0 text-mint-600" aria-label="Ofis danışmanı" />
                  </p>
                  <p className="truncate text-xs text-text-muted">{advisor!.title ?? "Gayrimenkul danışmanı"} · {officeName}</p>
                  {advisor!.phone ? (
                    <a
                      href={`tel:${advisor!.phone}`}
                      className="focus-ring mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] text-sm font-bold text-brand-600 sm:min-h-0"
                    >
                      <Phone className="h-4 w-4" /> {formatPhoneDisplay(advisor!.phone)}
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="text-sm font-semibold text-ink-950">Satış sürecinizi birlikte planlayalım.</p>
            )}
            {showCta ? (
              <a
                href={bookingHref!}
                className="no-print focus-ring press inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-brand-600 px-5 text-sm font-bold text-white shadow-[var(--shadow-xs)] transition hover:bg-brand-700"
              >
                <CalendarCheck className="h-4 w-4" /> Yetki görüşmesi planlayalım
              </a>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
