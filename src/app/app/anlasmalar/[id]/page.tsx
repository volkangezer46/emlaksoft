import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  Building2,
  CalendarClock,
  Gauge,
  Handshake,
  HeartHandshake,
  ListChecks,
  MessageSquareQuote,
  Tag,
  TrendingUp,
  User,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { Badge } from "@/components/ui/badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { computeDealScore, scoreGap } from "@/lib/deal-score";
import {
  ChecklistLoader,
  ChecklistSkeleton,
  CostsLoader,
  CostsSkeleton,
  NotesLoader,
  NotesSkeleton,
} from "./sections";
/*
 * Anket üretme + link kopyalama client bileşenleri memnuniyet raporunda zaten
 * var; YENİDEN YAZILMADI, aynen import edildi (o dosyaya dokunulmadı). Aksi
 * halde aynı davranışın iki kopyası ayrışmaya başlar.
 */
import { CopySurveyLinkButton, CreateSurveyButton } from "../../raporlar/memnuniyet/survey-actions";

export const metadata = { title: "Anlaşma detayı" };

/** Pipeline aşamaları — deal-board ile aynı sıra ve etiketler. */
const STAGES = [
  { key: "new", label: "Yeni" },
  { key: "qualified", label: "Nitelikli" },
  { key: "negotiation", label: "Müzakere" },
  { key: "won", label: "Kazanıldı" },
  { key: "lost", label: "Kaybedildi" },
] as const;

function money(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Number(n)) + " ₺";
}

function tarih(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/** supabase-js gömülü ilişkiyi dizi olarak tipleyebilir; iki biçimi de karşıla. */
function rel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * Anlaşma detayı — pipeline'daki paranın 360° görünümü.
 *
 * NEDEN VAR: Anlaşma bu sistemdeki en değerli kayıt (para burada dönüyor) ama
 * DETAY SAYFASI YOKTU. Kanban kartındaki üç satır dışında hiçbir yerde
 * görülemiyordu: bağlı komisyon, teklif, sözleşme ve görevler ayrı ayrı
 * sayfalarda duruyor ve hangisinin bu anlaşmaya ait olduğu görülemiyordu.
 *
 * İLİŞKİ HARİTASI: `commissions.deal_id` ve `tasks.deal_id` doğrudan FK;
 * teklif ve sözleşmede `deal_id` YOK — onlar portföy+müşteri ikilisi üzerinden
 * eşleştiriliyor. Bu bir yaklaşım, kesin bağ değil; sayfada da öyle
 * etiketleniyor ("aynı portföy + müşteri").
 */
export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms, userId } = await requireModulePage("commissions");
  const { id } = await params;
  const supabase = await createClient();

  const { data: deal } = await supabase
    .from("deals")
    .select(
      "id, deal_type, stage, deal_value, probability, loss_reason, created_at, updated_at, property_id, customer_id, assigned_to",
    )
    .eq("id", id)
    .maybeSingle();

  // RLS kiracı dışını zaten göstermiyor; burada yalnızca "yok" durumu.
  if (!deal) notFound();

  const [
    { data: property },
    { data: customer },
    { data: assignee },
    { data: commissions },
    { data: tasks },
    { data: survey },
  ] = await Promise.all([
      deal.property_id
        ? supabase
            .from("properties")
            .select(
              "id, property_code, title, list_price, transaction_type, property_type, status, province:geo_provinces(name), district:geo_districts(name)",
            )
            .eq("id", deal.property_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      deal.customer_id
        ? supabase
            .from("customers")
            .select("id, full_name, phone, email")
            .eq("id", deal.customer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      deal.assigned_to
        ? supabase.from("profiles").select("full_name, role").eq("id", deal.assigned_to).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("commissions")
        .select("id, gross_amount, vat_amount, status, created_at")
        .eq("deal_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("id, title, status, due_at, priority")
        .eq("deal_id", id)
        .order("due_at", { ascending: true })
        .limit(20),
      /*
       * Memnuniyet anketi (surveys — migration 104). Yalnız kazanılan anlaşmada
       * anlamlı; unique(deal_id) sayesinde en fazla bir satır olur.
       */
      deal.stage === "won"
        ? supabase
            .from("surveys")
            .select("id, score, status, comment, public_token, sent_at, answered_at")
            .eq("deal_id", id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  /*
   * Teklif ve sözleşmede `deal_id` kolonu YOK. Aynı portföy + müşteri ikilisine
   * bakarak yaklaşık eşleştirme yapıyoruz. Her ikisi de dolu değilse hiç
   * sorgu atmıyoruz — tek başına portföy eşleşmesi başka müşterinin teklifini
   * bu anlaşmaya bağlar, bu yanlış olur.
   */
  const capraz = Boolean(deal.property_id && deal.customer_id);
  const [{ data: offers }, { data: contracts }, { count: gorusmeSayisi }] = await Promise.all([
    capraz
      ? supabase
          .from("offers")
          .select("id, amount, status, valid_until, created_at")
          .eq("property_id", deal.property_id!)
          .eq("customer_id", deal.customer_id!)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null }),
    capraz
      ? supabase
          .from("contracts")
          .select("id, title, contract_type, status, signed_at, created_at")
          .eq("property_id", deal.property_id!)
          .eq("customer_id", deal.customer_id!)
          .order("created_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null }),
    /*
     * Gorusme sayisi kapanma tahmininde kullaniliyor. Ilk yazimda bu deger
     * SABIT 0 birakilmisti — yani "gorusme" faktoru hic calismiyordu ve skor
     * sessizce eksik hesaplaniyordu. Randevuda `deal_id` yok; teklif ve
     * sozlesmeyle ayni yaklasimla portfoy+musteri ikilisinden eslestiriliyor.
     */
    capraz
      ? supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("property_id", deal.property_id!)
          .eq("customer_id", deal.customer_id!)
          .neq("status", "cancelled")
      : Promise.resolve({ count: 0 }),
  ]);

  /*
   * Evrak dosyası, işlem dosyası ve not akışı ARTIK BURADA ÇEKİLMİYOR.
   * Üçü de künyeden ve birbirinden bağımsızdı ama ardışık üç `await` olarak
   * duruyor, sayfayı üç ekstra gidiş-dönüş kadar geciktiriyorlardı.
   * `./sections.tsx` içinde kendi `<Suspense>` sınırlarında akıyorlar.
   */

  const stageIdx = STAGES.findIndex((s) => s.key === deal.stage);
  const kayip = deal.stage === "lost";
  const kazanildi = deal.stage === "won";
  const province = property ? rel(property.province as { name: string } | { name: string }[] | null) : null;
  const district = property ? rel(property.district as { name: string } | { name: string }[] | null) : null;

  const komisyonlar = commissions ?? [];
  const brutToplam = komisyonlar.reduce((s, c) => s + Number(c.gross_amount ?? 0), 0);
  const kdvToplam = komisyonlar.reduce((s, c) => s + Number(c.vat_amount ?? 0), 0);
  const tahsilEdilen = komisyonlar
    .filter((c) => c.status === "paid" || c.status === "Tahsil edildi")
    .reduce((s, c) => s + Number(c.gross_amount ?? 0), 0);

  const acikGorev = (tasks ?? []).filter((t) => t.status !== "done" && t.status !== "Tamamlandı").length;
  const olasilik = deal.probability != null ? Number(deal.probability) : null;
  const dealValue = deal.deal_value != null ? Number(deal.deal_value) : null;
  // Beklenen değer = tutar × olasılık. Kazanılan/kaybedilende olasılık anlamsız.
  const beklenen =
    dealValue != null && olasilik != null && !kazanildi && !kayip
      ? Math.round(dealValue * (olasilik > 1 ? olasilik / 100 : olasilik))
      : null;

  const canSeeCommission = (perms.commissions ?? []).includes("view");

  /*
   * Memnuniyet anketi kutusu — createSurveyForDeal action'ı reports.view VE
   * commissions.view ister; butonu göstermeden önce aynı çizgiyi burada da
   * çekiyoruz ki kullanıcı basıp yetki hatası yemesin.
   */
  const surveyRow = survey as {
    id: string;
    score: number | null;
    status: string;
    comment: string | null;
    public_token: string;
    sent_at: string;
    answered_at: string | null;
  } | null;
  const canCreateSurvey = (perms.reports ?? []).includes("view") && canSeeCommission;
  const surveyUrl = surveyRow
    ? `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/anket/${surveyRow.public_token}`
    : null;
  const surveyAnswered = Boolean(surveyRow && surveyRow.status === "answered" && surveyRow.score != null);
  // NPS eşikleri: 9-10 destekleyen, 7-8 pasif, 0-6 kötüleyen (bkz. migration 104)
  const surveyTone =
    surveyAnswered && surveyRow
      ? (surveyRow.score as number) >= 9
        ? { label: "Destekleyen", cls: "bg-mint-500/12 text-mint-600 ring-mint-500/30" }
        : (surveyRow.score as number) >= 7
          ? { label: "Pasif", cls: "bg-amber-400/15 text-amber-600 ring-amber-400/30" }
          : { label: "Kötüleyen", cls: "bg-danger-500/10 text-danger-500 ring-danger-500/30" }
      : null;

  /*
   * Sistem tahmini (X8). `deals.probability` YALNIZCA asamadan turetiliyordu
   * (20/40/60/100), yani asamanin sayiya cevrilmis haliydi ve ek bilgi
   * tasimiyordu. Bu hesap teklif, gorusme, hareketsizlik, yas ve fiyat
   * acigini da isin icine katiyor.
   *
   * Kullanicinin elle girdigi `probability` UZERINE YAZILMIYOR — yaninda
   * duruyor. Asil deger ikisinin farkinda: danisman %80 diyorsa ve sistem
   * %35 diyorsa sebebini gormek gerekir.
   */
  const simdi = new Date().getTime();
  const skor = computeDealScore(
    {
      stage: deal.stage,
      createdAt: deal.created_at,
      updatedAt: deal.updated_at,
      offerCount: (offers ?? []).length,
      hasAcceptedOffer: (offers ?? []).some((o) => o.status === "accepted"),
      appointmentCount: gorusmeSayisi ?? 0,
      openTaskCount: acikGorev,
      dealValue,
      listPrice: property?.list_price != null ? Number(property.list_price) : null,
    },
    simdi,
  );
  const sapma = scoreGap(olasilik, skor.score);

  return (
    <div className="space-y-6">
      <Link
        href="/app/anlasmalar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Pipeline&apos;a dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-mint-500/25 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <Handshake className="h-3.5 w-3.5" /> {deal.deal_type === "rent" ? "Kiralama" : "Satış"} anlaşması
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">
            {property?.title ?? property?.property_code ?? "Portföysüz anlaşma"}
          </h1>
          <p className="mt-1 text-sm text-white/60">
            {customer?.full_name ?? "Müşteri atanmadı"} · {tarih(deal.created_at)} tarihinde açıldı
          </p>

          {/* Pipeline şeridi: anlaşmanın hangi aşamada olduğunu tek bakışta göster. */}
          <ol className="relative mt-6 flex flex-wrap gap-2" aria-label="Anlaşma aşaması">
            {STAGES.map((s, i) => {
              const gecildi = !kayip && stageIdx >= 0 && i <= stageIdx && s.key !== "lost";
              const aktif = s.key === deal.stage;
              if (s.key === "lost" && !kayip) return null;
              return (
                <li
                  key={s.key}
                  aria-current={aktif ? "step" : undefined}
                  className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                    aktif
                      ? "border-white/40 bg-white text-ink-950"
                      : gecildi
                        ? "border-mint-400/40 bg-mint-500/15 text-mint-300"
                        : "border-white/12 bg-white/[0.04] text-white/45"
                  }`}
                >
                  {s.label}
                </li>
              );
            })}
          </ol>

          <div className="relative mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Anlaşma tutarı", value: money(dealValue), icon: Banknote, href: undefined },
              {
                label: kazanildi || kayip ? "Sonuç" : "Beklenen değer",
                value: beklenen != null ? money(beklenen) : skor.label,
                icon: TrendingUp,
                href: undefined,
              },
              { label: "Komisyon (brüt)", value: canSeeCommission ? money(brutToplam) : "—", icon: Tag, href: undefined },
              { label: "Açık görev", value: String(acikGorev), icon: ListChecks, href: "#gorevler" },
            ].map((k) =>
              k.href ? (
                <Link
                  key={k.label}
                  href={k.href}
                  className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur transition hover:border-brand-300"
                >
                  <div className="flex items-start justify-between">
                    <k.icon className="h-4 w-4 text-mint-400" />
                    <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </div>
                  <p className="numeric mt-2 truncate font-display text-lg font-extrabold text-white">{k.value}</p>
                  <p className="text-[11px] text-white/45 sm:text-xs">{k.label}</p>
                </Link>
              ) : (
                <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
                  <k.icon className="h-4 w-4 text-mint-400" />
                  <p className="numeric mt-2 truncate font-display text-lg font-extrabold text-white">{k.value}</p>
                  <p className="text-[11px] text-white/45 sm:text-xs">{k.label}</p>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      {kayip && deal.loss_reason ? (
        <p
          className="flex items-start gap-2 rounded-[14px] border border-danger-500/30 bg-danger-500/5 px-4 py-3 text-sm text-danger-600"
          role="status"
        >
          <span className="font-bold">Kayıp nedeni:</span> {deal.loss_reason}
        </p>
      ) : null}

      {!kazanildi && !kayip ? (
        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                <Gauge className="h-4 w-4 text-brand-600" /> Kapanma tahmini
              </h2>
              <p className="mt-0.5 text-[11px] text-text-faint">
                Kural tabanlı puanlama — istatistiksel model değil. Her faktör aşağıda gerekçesiyle.
              </p>
            </div>
            <div className="text-right">
              <p
                className={`numeric font-display text-3xl font-extrabold ${
                  skor.tier === "high"
                    ? "text-mint-600"
                    : skor.tier === "medium"
                      ? "text-amber-600"
                      : "text-danger-600"
                }`}
              >
                %{skor.score}
              </p>
              <p className="text-[11px] text-text-muted">sistem tahmini</p>
            </div>
          </div>

          {/* Faktor dokumu: kullanici katilmadiginda NEDENINI gorebilmeli. */}
          <ul className="mt-4 grid gap-1.5 sm:grid-cols-2">
            {skor.factors.map((f) => (
              <li
                key={f.label}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-canvas px-3 py-2 text-sm"
              >
                <span className="text-text-muted">{f.label}</span>
                <span
                  className={`numeric font-bold ${f.points < 0 ? "text-danger-600" : "text-ink-950"}`}
                >
                  {f.points > 0 ? "+" : ""}
                  {f.points}
                </span>
              </li>
            ))}
          </ul>

          {/* Sapma uyarisi: 20 puan altindaki fark gurultu sayiliyor. */}
          {sapma != null ? (
            <p
              className="mt-3 rounded-[12px] border border-amber-400/35 bg-amber-400/[0.07] px-4 py-2.5 text-xs leading-relaxed text-ink-950"
              role="status"
            >
              Kayıtlı olasılık <strong className="numeric">%{Math.round(olasilik ?? 0)}</strong>, sistem
              tahmini <strong className="numeric">%{skor.score}</strong> —{" "}
              <strong className="numeric">{Math.abs(sapma)} puan</strong>{" "}
              {sapma > 0 ? "daha iyimser" : "daha karamsar"}. Yukarıdaki faktörlere bakın.
            </p>
          ) : null}
        </section>
      ) : null}

      {/*
        Memnuniyet anketi — yalnız kazanılan anlaşmada. Anket kapanışın son
        halkasıydı ama yalnız rapor sayfasından üretilebiliyordu; danışman
        anlaşmayı kapattığı yerde tek tıkla üretebilsin.
      */}
      {kazanildi ? (
        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
                <HeartHandshake className="h-4 w-4 text-mint-600" /> Memnuniyet anketi
              </h2>
              <p className="mt-0.5 text-[11px] text-text-faint">
                Tek soruluk 0-10 anketi. SMS gönderilmez — linki müşteriye siz iletirsiniz.
              </p>
            </div>
            {surveyRow && surveyUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                {surveyAnswered && surveyTone ? (
                  <>
                    <span className="numeric font-display text-2xl font-extrabold text-ink-950">
                      {surveyRow.score}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset ${surveyTone.cls}`}
                    >
                      {surveyTone.label}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="rounded-full bg-brand-600/10 px-2.5 py-0.5 text-[11px] font-bold text-brand-600">
                      Yanıt bekliyor
                    </span>
                    <CopySurveyLinkButton url={surveyUrl} />
                  </>
                )}
              </div>
            ) : !deal.customer_id ? (
              <p className="text-xs font-semibold text-text-muted">
                Anlaşmaya müşteri bağlı değil — anket gönderilecek kişi belirsiz.
              </p>
            ) : canCreateSurvey ? (
              <CreateSurveyButton dealId={deal.id} />
            ) : (
              <p className="text-xs font-semibold text-text-muted">
                Anket üretmek için rapor yetkisi gerekiyor.
              </p>
            )}
          </div>
          {surveyRow?.comment ? (
            <p className="mt-3 flex items-start gap-2 rounded-[12px] border border-line bg-canvas px-4 py-2.5 text-sm italic leading-relaxed text-text-muted">
              <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-faint" />
              {surveyRow.comment}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bağlı portföy — tıklanabilir */}
        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Building2 className="h-4 w-4 text-brand-600" /> Portföy
          </h2>
          {property ? (
            <Link
              href={`/app/portfoyler/${property.id}`}
              className="lift-hover focus-ring group mt-3 block rounded-[14px] border border-line bg-canvas p-4 transition hover:border-brand-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">
                    {property.property_code}
                  </p>
                  <p className="mt-0.5 truncate font-semibold text-ink-950">{property.title ?? "Başlıksız"}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    {[property.transaction_type, property.property_type, province?.name, district?.name]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="numeric mt-2 font-display text-lg font-extrabold text-ink-950">
                    {money(property.list_price != null ? Number(property.list_price) : null)}
                  </p>
                </div>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-surface text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </div>
            </Link>
          ) : (
            <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Bu anlaşmaya portföy bağlanmamış.
            </p>
          )}
        </section>

        {/* Bağlı müşteri — tıklanabilir */}
        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <User className="h-4 w-4 text-brand-600" /> Müşteri
          </h2>
          {customer ? (
            <Link
              href={`/app/musteriler/${customer.id}`}
              className="lift-hover focus-ring group mt-3 block rounded-[14px] border border-line bg-canvas p-4 transition hover:border-brand-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink-950">{customer.full_name}</p>
                  <p className="numeric mt-1 text-xs text-text-muted">{customer.phone ?? "Telefon yok"}</p>
                  <p className="mt-0.5 truncate text-xs text-text-muted">{customer.email ?? "E-posta yok"}</p>
                </div>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-surface text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600">
                  <ArrowUpRight className="h-4 w-4" />
                </span>
              </div>
            </Link>
          ) : (
            <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              Bu anlaşmaya müşteri bağlanmamış.
            </p>
          )}
          <dl className="mt-3 space-y-1.5">
            <div className="hairline-t flex justify-between gap-3 pt-2 text-sm">
              <dt className="text-text-muted">Sorumlu danışman</dt>
              <dd className="font-semibold text-ink-950">
                {deal.assigned_to ? (
                  <Link
                    href={`/app/ekip/${deal.assigned_to}`}
                    className="focus-ring rounded-[6px] text-brand-600 hover:underline"
                  >
                    {assignee?.full_name ?? "Danışman"}
                  </Link>
                ) : (
                  "Atanmadı"
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3 text-sm">
              <dt className="text-text-muted">Son güncelleme</dt>
              <dd className="font-semibold text-ink-950">{tarih(deal.updated_at)}</dd>
            </div>
          </dl>
        </section>
      </div>

      {/* Komisyon — yetki gerektiriyor */}
      {canSeeCommission ? (
        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Banknote className="h-4 w-4 text-brand-600" /> Komisyon
            </h2>
            <Link href="/app/komisyon" className="text-xs font-semibold text-brand-600 hover:underline">
              Komisyon merkezine git →
            </Link>
          </div>
          {komisyonlar.length === 0 ? (
            <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
              {kazanildi
                ? "Anlaşma kazanıldı ama komisyon kaydı açılmamış."
                : "Bu anlaşmaya bağlı komisyon kaydı yok."}
            </p>
          ) : (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {[
                  ["Brüt", money(brutToplam)],
                  ["KDV", money(kdvToplam)],
                  ["Tahsil edilen", money(tahsilEdilen)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
                    <p className="text-[11px] text-text-faint">{k}</p>
                    <p className="numeric text-sm font-bold text-ink-950">{v}</p>
                  </div>
                ))}
              </div>
              <TableFrame className="mt-3" minWidth={480}>
                <Table>
                  <THead>
                    <TR>
                      <TH>Tarih</TH>
                      <TH align="right">Brüt</TH>
                      <TH align="right">KDV</TH>
                      <TH>Durum</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {komisyonlar.map((c) => {
                      const tahsil = c.status === "paid" || c.status === "collected";
                      return (
                        <TR key={c.id} interactive>
                          <TD>
                            {/* Satır → komisyon defteri, kaydın durumuna uyan filtreyle */}
                            <Link
                              href={`/app/komisyon?durum=${tahsil ? "tahsil" : "bekleyen"}`}
                              className="absolute inset-0"
                              aria-label="Komisyon defterinde aç"
                            />
                            {tarih(c.created_at)}
                          </TD>
                          <TD align="right">{money(Number(c.gross_amount))}</TD>
                          <TD align="right">{money(Number(c.vat_amount))}</TD>
                          <TD>
                            <Badge variant={tahsil ? "success" : "warning"}>{c.status ?? "—"}</Badge>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableFrame>
            </>
          )}
        </section>
      ) : null}

      {/* Evrak dosyası — kapanış evrakları kontrol listesi (deal_checklist_items) */}
      <Suspense fallback={<ChecklistSkeleton />}>
        <ChecklistLoader
          dealId={deal.id}
          dealType={deal.deal_type}
          canEdit={(perms.commissions ?? []).includes("edit")}
        />
      </Suspense>

      {/* İşlem dosyası — kapora + kapanış masrafları (deal_costs ile GERÇEK bağ) */}
      <Suspense fallback={<CostsSkeleton />}>
        <CostsLoader dealId={deal.id} canEdit={(perms.commissions ?? []).includes("edit")} />
      </Suspense>

      {/* Notlar — ekip içi yorum akışı + sistem izleri (deal_notes ile GERÇEK bağ) */}
      <Suspense fallback={<NotesSkeleton />}>
        <NotesLoader
          dealId={deal.id}
          canEdit={(perms.commissions ?? []).includes("edit")}
          currentUserId={userId}
        />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Teklifler ve sözleşmeler: yaklaşık eşleşme, bu açıkça yazılıyor */}
        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Tag className="h-4 w-4 text-brand-600" /> Teklifler
          </h2>
          <p className="mt-1 text-[11px] text-text-faint">
            Teklif kaydında anlaşma bağı yok; aynı portföy + müşteri ikilisine göre listeleniyor.
          </p>
          {(offers ?? []).length === 0 ? (
            <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
              Eşleşen teklif yok.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(offers ?? []).map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/app/teklifler/${o.id}`}
                    className="focus-ring flex items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas px-4 py-2.5 transition hover:border-brand-300"
                  >
                    <span className="numeric font-semibold text-ink-950">{money(Number(o.amount))}</span>
                    <span className="flex items-center gap-2 text-xs text-text-muted">
                      {o.status ?? "—"}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <CalendarClock className="h-4 w-4 text-brand-600" /> Sözleşmeler
          </h2>
          <p className="mt-1 text-[11px] text-text-faint">
            Aynı portföy + müşteri ikilisine göre listeleniyor.
          </p>
          {(contracts ?? []).length === 0 ? (
            <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
              Eşleşen sözleşme yok.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {(contracts ?? []).map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/app/sozlesmeler/${c.id}`}
                    className="focus-ring flex items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas px-4 py-2.5 transition hover:border-brand-300"
                  >
                    <span className="min-w-0 truncate font-semibold text-ink-950">{c.title ?? c.contract_type}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-text-muted">
                      {c.status ?? "—"}
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Görevler — deal_id ile GERÇEK bağ */}
      <section id="gorevler" className="surface-card scroll-mt-24 rounded-[var(--radius-panel)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <ListChecks className="h-4 w-4 text-brand-600" /> Bağlı görevler
          </h2>
          <Link href="/app/gorevler" className="text-xs font-semibold text-brand-600 hover:underline">
            Görev merkezine git →
          </Link>
        </div>
        {(tasks ?? []).length === 0 ? (
          <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-8 text-center text-sm text-text-muted">
            Bu anlaşmaya bağlı görev yok.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {(tasks ?? []).map((t) => {
              const bitti = t.status === "done" || t.status === "Tamamlandı";
              return (
                <li key={t.id}>
                  <Link
                    href={`/app/gorevler?filter=${bitti ? "done" : "open"}`}
                    className="focus-ring flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas px-4 py-2.5 transition hover:border-brand-300"
                  >
                    <span className={`font-medium ${bitti ? "text-text-faint line-through" : "text-ink-950"}`}>
                      {t.title}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-text-muted">
                      {t.due_at ? tarih(t.due_at) : "Tarihsiz"}
                      <Badge variant={bitti ? "success" : t.priority === "high" ? "danger" : "default"}>
                        {bitti ? "Tamam" : (t.status ?? "Açık")}
                      </Badge>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
