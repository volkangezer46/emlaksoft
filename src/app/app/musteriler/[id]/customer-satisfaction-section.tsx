import Link from "next/link";
import { ExternalLink, Eye, HeartHandshake, MessageSquareQuote, Presentation } from "lucide-react";
// Kopyalama davranışı tek yerde yaşasın diye memnuniyet raporundaki client
// bileşeni AYNEN yeniden kullanılıyor (o dosya değiştirilmedi, yalnız import).
import { CopySurveyLinkButton } from "../../raporlar/memnuniyet/survey-actions";

export type CustomerSurveyRow = {
  id: string;
  score: number | null;
  status: string;
  comment: string | null;
  public_token: string;
  sent_at: string;
  answered_at: string | null;
};

export type CustomerPresentationRow = {
  id: string;
  title: string;
  public_token: string;
  property_count: number;
  view_count: number;
  created_at: string;
};

function tarih(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(iso));
}

/**
 * NPS sınıfı — 9-10 destekleyen, 7-8 pasif, 0-6 kötüleyen
 * (bkz. migration 20260727000104_surveys.sql kolon yorumu).
 */
function npsTone(score: number) {
  if (score >= 9) return { label: "Destekleyen", cls: "bg-mint-500/12 text-mint-600 ring-mint-500/30" };
  if (score >= 7) return { label: "Pasif", cls: "bg-amber-400/15 text-amber-600 ring-amber-400/30" };
  return { label: "Kötüleyen", cls: "bg-danger-500/10 text-danger-500 ring-danger-500/30" };
}

/**
 * "Memnuniyet & Paylaşımlar" — Müşteri 360'ın eksik çapraz bağı.
 *
 * NEDEN VAR: anket (surveys.customer_id) ve sunum (presentations.customer_id,
 * migration 113) kayıtları sistemde VARDI ama müşteri kartında hiç görünmüyordu;
 * danışman aynı müşteriye ikinci anket üretiyor, gönderdiği sunumun açılıp
 * açılmadığını bilmiyordu.
 *
 * SIFIR GÜRÜLTÜ: ikisi de boşsa bölüm hiç render edilmez (çağıran koşulu
 * kurar), böylece kart yığınına anlamsız bir "kayıt yok" kutusu eklenmez.
 */
export function CustomerSatisfactionSection({
  surveys,
  presentations,
  appUrl,
}: {
  surveys: CustomerSurveyRow[];
  presentations: CustomerPresentationRow[];
  appUrl: string;
}) {
  if (surveys.length === 0 && presentations.length === 0) return null;

  return (
    <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
          <HeartHandshake className="h-4 w-4 text-mint-600" /> Memnuniyet &amp; Paylaşımlar
        </h2>
        {surveys.length > 0 ? (
          <Link href="/app/raporlar/memnuniyet" className="text-xs font-semibold text-brand-600 hover:underline">
            Memnuniyet raporu →
          </Link>
        ) : null}
      </div>

      {surveys.length > 0 ? (
        <div className="mt-4 space-y-2">
          {surveys.map((s) => {
            const answered = s.status === "answered" && s.score != null;
            const tone = answered ? npsTone(s.score as number) : null;
            const url = `${appUrl}/anket/${s.public_token}`;
            return (
              <div key={s.id} className="rounded-[14px] border border-line bg-canvas/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    {answered && tone ? (
                      <>
                        <span className="numeric font-display text-2xl font-extrabold text-ink-950">
                          {s.score}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${tone.cls}`}
                        >
                          {tone.label}
                        </span>
                      </>
                    ) : (
                      <span className="rounded-full bg-brand-600/10 px-2.5 py-0.5 text-[11px] font-bold text-brand-600">
                        Yanıt bekliyor
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-text-faint">
                      {answered ? `Yanıt: ${tarih(s.answered_at)}` : `Gönderim: ${tarih(s.sent_at)}`}
                    </span>
                    {/* Yanıtlanmamış anketin linki hâlâ işe yarar — danışman tekrar iletir */}
                    {!answered ? <CopySurveyLinkButton url={url} /> : null}
                  </span>
                </div>
                {s.comment ? (
                  <p className="mt-2 flex items-start gap-2 text-sm italic leading-relaxed text-text-muted">
                    <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" />
                    {s.comment}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {presentations.length > 0 ? (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-text-faint">
            <Presentation className="h-3.5 w-3.5" /> Gönderilen sunumlar
          </p>
          <ul className="mt-2 space-y-2">
            {presentations.map((p) => {
              const url = `${appUrl}/sunum/${p.public_token}`;
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas/50 px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm font-semibold text-ink-950 underline-offset-2 transition hover:text-brand-600 hover:underline"
                    >
                      {p.title}
                    </a>
                    <span className="text-[11px] text-text-muted">
                      {p.property_count} portföy · {tarih(p.created_at)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold text-ink-950"
                      title="Sunumun açılma sayısı"
                    >
                      <Eye className="h-3.5 w-3.5 text-text-faint" /> {p.view_count}
                    </span>
                    <CopySurveyLinkButton url={url} />
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Sunumu yeni sekmede aç"
                      aria-label="Sunumu yeni sekmede aç"
                      className="focus-ring press grid h-8 w-8 place-items-center rounded-[8px] border border-hairline-strong bg-surface text-text-muted transition hover:bg-canvas hover:text-ink-950"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
