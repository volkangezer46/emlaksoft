import Link from "next/link";
import { AlertTriangle, Bug, CheckCircle2, ChevronDown, Clock3, Info, Repeat } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { Badge } from "@/components/ui/badge";
import { Pagination, pageRange, parsePage } from "@/app/admin/_components/pagination";
import { now } from "@/lib/clock";
import { ResolveErrorButton } from "./resolve-button";

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

function hrefWith(p: { durum?: string; son?: string; sayfa?: number }) {
  const sp = new URLSearchParams();
  if (p.durum) sp.set("durum", p.durum);
  if (p.son) sp.set("son", p.son);
  if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
  const s = sp.toString();
  return s ? `/admin/hatalar?${s}` : "/admin/hatalar";
}

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
export default async function ErrorLogsPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; son?: string; sayfa?: string }>;
}) {
  await requirePlatformModule("sistem");
  const params = (await searchParams) ?? {};
  const cozulmusGoster = params.durum === "cozulmus";
  const sonBirSaat = params.son === "1saat";
  const sayfa = parsePage(params.sayfa);
  const simdi = now();

  const admin = createAdminClient();
  let q = admin
    .from("error_logs")
    .select("id, tenant_id, source, digest, message, stack, path, occurrences, first_seen, last_seen, resolved_at, tenant:tenants(name)", {
      count: "exact",
    })
    .order("last_seen", { ascending: false })
    .range(...pageRange(sayfa));

  q = cozulmusGoster ? q.not("resolved_at", "is", null) : q.is("resolved_at", null);
  if (sonBirSaat) q = q.gte("last_seen", new Date(simdi - 3_600_000).toISOString());

  // "Son 1 saatte" kartı sayfa dilimine değil, aynı durum filtresindeki TÜM
  // kayıtlara bakar — sayfa 2'de yanlış sayı göstermesin.
  let sonSaatQ = admin
    .from("error_logs")
    .select("id", { count: "exact", head: true })
    .gte("last_seen", new Date(simdi - 3_600_000).toISOString());
  sonSaatQ = cozulmusGoster ? sonSaatQ.not("resolved_at", "is", null) : sonSaatQ.is("resolved_at", null);

  const [{ data, count }, { count: acikSayi }, { count: sonSaatSayi }] = await Promise.all([
    q,
    admin.from("error_logs").select("id", { count: "exact", head: true }).is("resolved_at", null),
    sonSaatQ,
  ]);

  const rows = (data ?? []) as unknown as Row[];
  const { toplamOlay } = ozetle(rows);
  const sonSaat = sonSaatSayi ?? 0;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-danger-500/25 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-danger-300">
            <Bug className="h-3.5 w-3.5" /> Üretim izleme
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Hatalar</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Aynı hata tekrar geldiğinde yeni satır açılmaz, sayaç artar — kaç <strong>farklı</strong>{" "}
            sorun olduğu görünür.
          </p>

          <div className="relative mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Açık hata türü", value: String(acikSayi ?? 0), icon: AlertTriangle, href: "/admin/hatalar", active: false },
              { label: "Listelenen", value: String(rows.length), icon: Info, href: null, active: false },
              { label: "Sayfadaki olay", value: String(toplamOlay), icon: Repeat, href: null, active: false },
              {
                label: "Son 1 saatte",
                value: String(sonSaat),
                icon: Clock3,
                href: hrefWith({ durum: params.durum, son: sonBirSaat ? undefined : "1saat" }),
                active: sonBirSaat,
              },
            ].map((k) =>
              k.href ? (
                <Link
                  key={k.label}
                  href={k.href}
                  aria-current={k.active ? "page" : undefined}
                  className={`focus-ring press group relative block rounded-[14px] border p-3 backdrop-blur transition ${
                    k.active ? "border-danger-300/50 bg-white/12" : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10"
                  }`}
                >
                  <k.icon className="h-4 w-4 text-danger-300" />
                  <p className="numeric mt-2 font-display text-lg font-extrabold text-white">{k.value}</p>
                  <p className="text-[11px] text-white/45 sm:text-xs">{k.label}</p>
                </Link>
              ) : (
                <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
                  <k.icon className="h-4 w-4 text-danger-300" />
                  <p className="numeric mt-2 font-display text-lg font-extrabold text-white">{k.value}</p>
                  <p className="text-[11px] text-white/45 sm:text-xs">{k.label}</p>
                </div>
              ),
            )}
          </div>
        </div>
      </section>

      <nav aria-label="Durum filtresi" className="flex flex-wrap gap-2 rounded-[16px] border border-line bg-surface p-3">
        {[
          { v: "", l: "Açık" },
          { v: "cozulmus", l: "Çözülmüş" },
        ].map((o) => (
          <Link
            key={o.l}
            href={hrefWith({ durum: o.v || undefined, son: sonBirSaat ? "1saat" : undefined })}
            aria-current={(o.v === "cozulmus") === cozulmusGoster ? "page" : undefined}
            className={`focus-ring press rounded-[9px] px-3 py-2 text-xs font-semibold transition ${
              (o.v === "cozulmus") === cozulmusGoster
                ? "bg-ink-950 text-white"
                : "border border-line text-text-muted hover:text-ink-950"
            }`}
          >
            {o.l}
          </Link>
        ))}
        <Link
          href={hrefWith({ durum: params.durum, son: sonBirSaat ? undefined : "1saat" })}
          aria-current={sonBirSaat ? "page" : undefined}
          className={`focus-ring press ml-auto inline-flex items-center gap-1.5 rounded-[9px] px-3 py-2 text-xs font-semibold transition ${
            sonBirSaat ? "bg-ink-950 text-white" : "border border-line text-text-muted hover:text-ink-950"
          }`}
        >
          <Clock3 className="h-3.5 w-3.5" /> Son 1 saat
        </Link>
      </nav>

      {rows.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-[18px] bg-mint-500/12 text-mint-600">
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
        <div className="space-y-3">
          {rows.map((r) => {
            const tenant = rel(r.tenant);
            return (
              <article key={r.id} className="surface-card rounded-[var(--radius-panel)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge variant={r.source === "server" ? "danger" : "warning"}>
                        {r.source === "server" ? "Sunucu" : "İstemci"}
                      </Badge>
                      {r.occurrences > 1 ? (
                        <span className="numeric rounded-full bg-danger-500/10 px-2.5 py-0.5 text-[11px] font-bold text-danger-600">
                          {r.occurrences}× tekrar
                        </span>
                      ) : null}
                      {r.tenant_id ? (
                        <Link
                          href={`/admin/tenants/${r.tenant_id}`}
                          className="text-xs font-semibold text-brand-600 transition hover:underline"
                        >
                          {tenant?.name ?? "Kiracı"}
                        </Link>
                      ) : (
                        <span className="text-xs text-text-muted">Kiracı bilinmiyor</span>
                      )}
                    </p>
                    <p className="mt-2 break-words font-semibold text-ink-950">{r.message}</p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-faint">
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
                    <Badge variant="success">Çözüldü</Badge>
                  ) : (
                    <ResolveErrorButton id={r.id} />
                  )}
                </div>
                {r.digest || r.stack ? (
                  <details className="group mt-3">
                    <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 text-[11px] font-semibold text-text-muted transition hover:text-ink-950 [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" /> Teknik detay
                    </summary>
                    <div className="mt-2 space-y-2 rounded-[10px] border border-line bg-canvas p-3">
                      {r.digest ? (
                        <p className="numeric break-all text-[11px] text-text-muted">
                          digest: <span className="font-semibold text-ink-950">{r.digest}</span>
                        </p>
                      ) : null}
                      {r.stack ? (
                        <pre className="numeric max-h-64 overflow-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-text-muted">
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
              hrefWith({ durum: params.durum, son: sonBirSaat ? "1saat" : undefined, sayfa: p })
            }
          />
        </div>
      )}

      <p className="flex items-start gap-2 rounded-[14px] border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-text-muted">
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
