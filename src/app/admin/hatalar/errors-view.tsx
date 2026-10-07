import Link from "@/components/ui/smart-link";
import { AlertTriangle, Bug, CheckCircle2, ChevronDown, Clock3, Info, Repeat, Search, X } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { Badge } from "@/components/ui/badge";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { now } from "@/lib/clock";
import { orIlike } from "@/lib/pgrst";
import { ResolveErrorButton } from "./resolve-button";
import { ErrorsBulkBar, ReopenErrorButton } from "./error-bulk";
import { ERRORS_BULK_FORM_ID } from "./bulk-form-id";
import { hrefWith, type Filters } from "./errors-href";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";

export const metadata = { title: "Üretim hataları" };

type Row = {
  id: string;
  tenant_id: string | null;
  source: string;
  digest: string | null;
  message: string;
  stack: string | null;
  path: string | null;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  resolved_at: string | null;
  tenant: { name: string } | { name: string }[] | null;
};

function rel<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return (Array.isArray(v) ? v[0] : v) ?? null;
}

function ne_zaman(iso: string, simdi: number) {
  const dk = Math.round((simdi - new Date(iso).getTime()) / 60_000);
  if (dk < 1) return "az önce";
  if (dk < 60) return `${dk} dk önce`;
  const sa = Math.round(dk / 60);
  if (sa < 24) return `${sa} sa önce`;
  return `${Math.round(sa / 24)} gün önce`;
}

/*
 * Zaman hesabi bilesen govdesinden CIKARILDI. `Date.now()` bir Server
 * Component'te istek basina degerlendirildigi icin semantik olarak dogru
 * ama react-hooks/purity kurali bunu ayirt etmiyor. Modul duzeyinde bir
 * yardimciya tasimak hem kurali gecirir hem de "simdi"yi tek bir noktada
 * sabitler — satirlar arasi tutarli bir referans an olur.
 */
function ozetle(rows: Row[]) {
  return {
    toplamOlay: rows.reduce((s, r) => s + (r.occurrences ?? 0), 0),
  };
}

/**
 * Üretim hataları.
 *
 * NEDEN VAR: Hatalar `console.error` ile Vercel loglarına düşüyordu — yani
 * kaybolmuyordu ama TOPLANMIYORDU. "Bu hata bir kez mi oldu, 400 kez mi",
 * "hangi kiracıda", "hâlâ oluyor mu" sorularının cevabı yoktu.
 *
 * NEDEN SENTRY DEĞİL: Ücretli bir dış bağımlılık ve bu karar kullanıcının.
 * Bu sayfa bağımlılık eklemeden aynı sorunun büyük kısmını çözüyor.
 *
 * TEKİLLEŞTİRME: Aynı parmak izi yeni satır değil sayaç artışı üretiyor. Bir
 * render döngüsü saniyede yüzlerce hata atabilir; her biri satır olsaydı
 * tablo dakikalar içinde şişer ve "kaç FARKLI hata var" bilgisi kaybolurdu.
 */
export async function ErrorsView({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; son?: string; sayfa?: string; q?: string; kaynak?: string; ofis?: string }>;
}) {
  await requirePlatformModule("sistem");
  const params = (await searchParams) ?? {};
  const cozulmusGoster = params.durum === "cozulmus";
  const sonBirSaat = params.son === "1saat";
  const q = (params.q ?? "").trim().slice(0, 80);
  const kaynak = params.kaynak === "server" || params.kaynak === "client" ? params.kaynak : undefined;
  const ofis = /^[0-9a-f-]{36}$/i.test(params.ofis ?? "") ? params.ofis : undefined;
  const base: Filters = {
    durum: params.durum,
    son: sonBirSaat ? "1saat" : undefined,
    q: q || undefined,
    kaynak,
    ofis,
  };
  const sayfa = parsePage(params.sayfa);
  const simdi = now();

  const admin = createAdminClient();
  let listQ = admin
    .from("error_logs")
    .select("id, tenant_id, source, digest, message, stack, path, occurrences, first_seen, last_seen, resolved_at, tenant:tenants(name)", {
      count: "exact",
    })
    .order("last_seen", { ascending: false })
    .range(...pageRange(sayfa));

  listQ = cozulmusGoster ? listQ.not("resolved_at", "is", null) : listQ.is("resolved_at", null);
  if (sonBirSaat) listQ = listQ.gte("last_seen", new Date(simdi - 3_600_000).toISOString());
  if (kaynak) listQ = listQ.eq("source", kaynak);
  if (ofis) listQ = listQ.eq("tenant_id", ofis);
  if (q) listQ = listQ.or(orIlike(["message", "path"], q));

  // "Son 1 saatte" kartı sayfa dilimine değil, aynı durum filtresindeki TÜM
  // kayıtlara bakar — sayfa 2'de yanlış sayı göstermesin.
  let sonSaatQ = admin
    .from("error_logs")
    .select("id", { count: "exact", head: true })
    .gte("last_seen", new Date(simdi - 3_600_000).toISOString());
  sonSaatQ = cozulmusGoster ? sonSaatQ.not("resolved_at", "is", null) : sonSaatQ.is("resolved_at", null);

  const [{ data, count }, { count: acikSayi }, { count: sonSaatSayi }, ofisRes] = await Promise.all([
    listQ,
    admin.from("error_logs").select("id", { count: "exact", head: true }).is("resolved_at", null),
    sonSaatQ,
    ofis
      ? admin.from("tenants").select("name").eq("id", ofis).maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);
  const ofisAdi = ofisRes.data?.name ?? null;

  const rows = (data ?? []) as unknown as Row[];
  const { toplamOlay } = ozetle(rows);
  const sonSaat = sonSaatSayi ?? 0;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="pulse"
        eyebrow="Üretim izleme"
        icon={Bug}
        title="Hatalar"
        description="Aynı hata tekrar geldiğinde yeni satır açılmaz, sayaç artar: kaç farklı sorun olduğu görünür."
      >
        <KpiGrid label="Hata göstergeleri" className="lg:grid-cols-4 2xl:grid-cols-4">
          {[
            { label: "Açık hata türü", value: acikSayi ?? 0, icon: AlertTriangle, href: hrefWith({ ...base, durum: undefined }), active: false },
            { label: "Eşleşen hata", value: count ?? 0, icon: Info, href: hrefWith(base), active: false },
            { label: "Sayfadaki olay", value: toplamOlay, icon: Repeat, href: `${hrefWith(base)}#hata-listesi`, active: false },
            { label: "Son 1 saatte", value: sonSaat, icon: Clock3, href: hrefWith({ ...base, son: sonBirSaat ? undefined : "1saat" }), active: sonBirSaat },
          ].map((k) => (
            <KpiCard
              key={k.label}
              layout="inline"
              label={k.label}
              value={k.value}
              href={k.href}
              icon={k.icon}
              tone="danger"
              tinted={k.active}
              attention={k.value > 0 && k.label === "Son 1 saatte"}
              hint={k.active ? "filtre aktif · kaldırmak için tıkla" : undefined}
            />
          ))}
        </KpiGrid>
      </AdminPageHeader>

      <nav aria-label="Durum filtresi" className="flex flex-wrap gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        {[
          { v: "", l: "Açık" },
          { v: "cozulmus", l: "Çözülmüş" },
        ].map((o) => (
          <Link
            key={o.l}
            href={hrefWith({ ...base, durum: o.v || undefined })}
            aria-current={(o.v === "cozulmus") === cozulmusGoster ? "page" : undefined}
            className={`focus-ring press rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold transition ${
              (o.v === "cozulmus") === cozulmusGoster
                ? "bg-ink-950 text-white"
                : "border border-line text-text-muted hover:text-ink-950"
            }`}
          >
            {o.l}
          </Link>
        ))}
        <Link
          href={hrefWith({ ...base, son: sonBirSaat ? undefined : "1saat" })}
          aria-current={sonBirSaat ? "page" : undefined}
          className={`focus-ring press ml-auto inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-2 text-xs font-semibold transition ${
            sonBirSaat ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
          }`}
        >
          <Clock3 className="h-3.5 w-3.5" /> Son 1 saat
        </Link>
      </nav>

      <form
        action="/admin/sistem"
        role="search"
        className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-surface p-3"
      >
        <input type="hidden" name="sekme" value="hatalar" />
        {params.durum ? <input type="hidden" name="durum" value={params.durum} /> : null}
        {sonBirSaat ? <input type="hidden" name="son" value="1saat" /> : null}
        {ofis ? <input type="hidden" name="ofis" value={ofis} /> : null}
        <label className="relative min-w-0 flex-1 basis-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" aria-hidden />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Hata metni veya sayfa yolu ara…"
            aria-label="Hata metni veya sayfa yolu ara"
            className="focus-ring w-full rounded-[var(--radius-control)] border border-line bg-canvas py-2 pl-9 pr-3 text-sm outline-none transition focus:border-brand-400"
          />
        </label>
        <select
          name="kaynak"
          defaultValue={kaynak ?? ""}
          aria-label="Kaynak"
          className="focus-ring rounded-[var(--radius-control)] border border-line bg-canvas px-3 py-2 text-sm"
        >
          <option value="">Tüm kaynaklar</option>
          <option value="server">Sunucu</option>
          <option value="client">İstemci</option>
        </select>
        <button
          type="submit"
          className="focus-ring press rounded-[var(--radius-control)] bg-ink-950 px-4 py-2 text-xs font-semibold text-white"
        >
          Filtrele
        </button>
        {q || kaynak || ofis ? (
          <span className="flex flex-wrap items-center gap-2">
            {q ? (
              <Link href={hrefWith({ ...base, q: undefined })} className="focus-ring press inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600">
                Arama: {q} <X className="h-3 w-3" />
              </Link>
            ) : null}
            {kaynak ? (
              <Link href={hrefWith({ ...base, kaynak: undefined })} className="focus-ring press inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600">
                Kaynak: {kaynak === "server" ? "Sunucu" : "İstemci"} <X className="h-3 w-3" />
              </Link>
            ) : null}
            {ofis ? (
              <Link href={hrefWith({ ...base, ofis: undefined })} className="focus-ring press inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-bold text-brand-600">
                Ofis: {ofisAdi ?? "Kiracı"} <X className="h-3 w-3" />
              </Link>
            ) : null}
          </span>
        ) : null}
        <p className="basis-full text-xs text-text-faint">{count ?? 0} kayıt eşleşiyor. Arama sunucuda çalışır ve tüm sayfaları tarar.</p>
      </form>

      {!cozulmusGoster && rows.length > 0 ? <ErrorsBulkBar pageCount={rows.length} /> : null}

      {rows.length === 0 ? (
        <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-[var(--radius-panel)] bg-mint-500/12 text-mint-600">
            <CheckCircle2 className="h-8 w-8" />
          </span>
          <h2 className="mt-5 font-display text-xl font-bold text-ink-950">
            {sonBirSaat ? "Son 1 saatte kayıt yok" : cozulmusGoster ? "Çözülmüş kayıt yok" : "Açık hata yok"}
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-text-muted">
            {sonBirSaat
              ? "Bu filtrede son 1 saat içinde görülen hata bulunmuyor."
              : cozulmusGoster
                ? "Henüz hiçbir hata çözüldü olarak işaretlenmemiş."
                : "Tarayıcı hata sınırlarından bu yana kayıt düşmedi. Bu sayfa Vercel loglarının yerine geçmez; oradaki sunucu hataları ayrıca incelenmeli."}
          </p>
        </div>
      ) : (
        <div id="hata-listesi" className="space-y-3">
          {rows.map((r) => {
            const tenant = rel(r.tenant);
            return (
              <article key={r.id} className="surface-card rounded-[var(--radius-panel)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {!cozulmusGoster ? (
                    <input
                      type="checkbox"
                      form={ERRORS_BULK_FORM_ID}
                      value={r.id}
                      aria-label="Toplu işlem için seç"
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge variant={r.source === "server" ? "danger" : "warning"}>
                        {r.source === "server" ? "Sunucu" : "İstemci"}
                      </Badge>
                      {r.occurrences > 1 ? (
                        <span className="numeric rounded-full bg-danger-500/10 px-2.5 py-0.5 text-xs font-bold text-danger-600">
                          {r.occurrences}× tekrar
                        </span>
                      ) : null}
                      {r.tenant_id ? (
                        <>
                          <Link
                            href={`/admin/tenants/${r.tenant_id}`}
                            className="text-xs font-semibold text-brand-600 transition hover:underline"
                          >
                            {tenant?.name ?? "Kiracı"}
                          </Link>
                          <Link
                            href={hrefWith({ ...base, ofis: r.tenant_id })}
                            className="text-xs font-semibold text-text-muted transition hover:text-brand-600 hover:underline"
                          >
                            yalnız bu ofis
                          </Link>
                        </>
                      ) : (
                        <span className="text-xs text-text-muted">Kiracı bilinmiyor</span>
                      )}
                    </p>
                    <p className="mt-2 break-words font-semibold text-ink-950">{r.message}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-faint">
                      {r.path ? <span className="numeric">{r.path}</span> : null}
                      <span>ilk: {ne_zaman(r.first_seen, simdi)}</span>
                      <span>son: {ne_zaman(r.last_seen, simdi)}</span>
                      {r.digest ? (
                        <span className="numeric" title="Vercel logundaki satırla eşleştirmek için">
                          digest {r.digest.slice(0, 12)}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {r.resolved_at ? (
                    <span className="inline-flex items-center gap-2">
                      <Badge variant="success">Çözüldü</Badge>
                      <ReopenErrorButton id={r.id} />
                    </span>
                  ) : (
                    <ResolveErrorButton id={r.id} />
                  )}
                </div>
                {r.digest || r.stack ? (
                  <details className="group mt-3">
                    <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-xs font-semibold text-text-muted transition hover:text-ink-950 [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" /> Teknik detay
                    </summary>
                    <div className="mt-2 space-y-2 rounded-[var(--radius-control)] border border-line bg-canvas p-3">
                      {r.digest ? (
                        <p className="numeric break-all text-xs text-text-muted">
                          digest: <span className="font-semibold text-ink-950">{r.digest}</span>
                        </p>
                      ) : null}
                      {r.stack ? (
                        <pre className="numeric max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs leading-relaxed text-text-muted">
                          {r.stack}
                        </pre>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
          <Pagination
            page={sayfa}
            total={count ?? 0}
            hrefFor={(p) =>
              hrefWith({ ...base, sayfa: p })
            }
          />
        </div>
      )}

      <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
        <span>
          Next.js üretimde hata metnini gizler ve yerine <strong>digest</strong> verir; sunucu
          logundaki satırla eşleştirmenin tek yolu odur. Hata metni bir sorgu parçası ya da kullanıcı
          girdisi taşıyabileceği için mesaj 500, yığın izi 4000 karakterde kırpılır.{" "}
          <code className="rounded bg-surface px-1">purge_old_error_logs(90)</code> ile eski kayıtlar
          temizlenebilir.
        </span>
      </p>
    </div>
  );
}
