import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  CalendarDays,
  DoorOpen,
  MapPin,
  Users,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { getOpenHouse, listOpenHouseVisitors } from "@/app/actions/targets-openhouse-sources";
import { Badge } from "@/components/ui/badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";
import { VisitorForm } from "./visitor-form";

export const metadata = { title: "Açık ev detayı" };

const STATUS_LABELS: Record<string, string> = {
  planned: "Planlandı",
  active: "Devam ediyor",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

const STATUS_VARIANT: Record<string, "info" | "success" | "default" | "danger"> = {
  planned: "info",
  active: "success",
  completed: "default",
  cancelled: "danger",
};

function rel<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function money(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(Number(n)) + " ₺";
}

/**
 * Açık ev detayı — ziyaretçi listesi.
 *
 * NEDEN VAR: `open_house_visitors` tablosu YALNIZCA YAZILIYORDU. Kayıt
 * açılıyordu ama hiçbir ekran bu satırları okumuyordu; kartlarda yalnızca
 * "N ziyaretçi" sayacı görünüyordu. Danışman açık evde topladığı isimleri bir
 * daha göremiyordu — yani açık evin asıl çıktısı olan lead listesi sistemde
 * ÖLÜ VERİYDİ.
 *
 * Bu sayfa hem listeyi gösteriyor hem de kapıda hızlı kayıt için formu
 * doğrudan sayfaya koyuyor (dialog değil — gerekçesi visitor-form.tsx'te).
 */
export default async function OpenHouseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { perms } = await requireModulePage("open_house");
  const { id } = await params;

  const [event, visitors] = await Promise.all([getOpenHouse(id), listOpenHouseVisitors(id)]);
  if (!event) notFound();

  // supabase-js gömülü ilişkiyi dizi olarak tipliyor; `rel` iki biçimi de
  // karşılıyor ama TS'in doğrudan dönüşüme izin vermesi için önce unknown.
  const property = rel(
    event.property as unknown as
      | { id: string; property_code: string; title: string | null; address_line: string | null; list_price: number | null }
      | null,
  );
  const date = new Date(event.scheduled_at);
  const gecmis = date < new Date();

  // `visitor_count` sayacı RPC ile artıyor; gerçek satır sayısıyla ayrışabilir
  // (silinen kayıt, yarım kalan işlem). Listeyi gerçek satırdan sayıyoruz ve
  // fark varsa sessizce geçmiyoruz — sayaç bozuksa görünür olsun.
  const gercekSayi = visitors.length;
  const sayac = event.visitor_count ?? 0;
  const sayacTutarsiz = sayac !== gercekSayi;

  const telefonlu = visitors.filter((v) => v.phone).length;
  const musteriyeDonusen = visitors.filter((v) => v.created_customer_id).length;
  const canCreate = (perms.open_house ?? perms.appointments ?? []).includes("create");

  return (
    <div className="space-y-6">
      <Link
        href="/app/acik-ev"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Açık ev listesine dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-brand-600/30 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <DoorOpen className="h-3.5 w-3.5" /> Açık ev günü
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">
            {property?.title ?? property?.property_code ?? "Açık ev"}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/60">
            <span className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              {date.toLocaleString("tr-TR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
              {event.duration_min ? ` · ${event.duration_min} dk` : ""}
            </span>
            {event.location ? (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> {event.location}
              </span>
            ) : null}
          </p>

          <div className="relative mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Ziyaretçi", value: String(gercekSayi), icon: Users },
              { label: "Telefonu alınan", value: String(telefonlu), icon: Users },
              { label: "Müşteriye dönüşen", value: String(musteriyeDonusen), icon: ArrowUpRight },
              {
                label: "Kapasite",
                value: event.max_visitors ? `${gercekSayi} / ${event.max_visitors}` : "Sınırsız",
                icon: DoorOpen,
              },
            ].map((k) => (
              <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
                <k.icon className="h-4 w-4 text-mint-400" />
                <p className="numeric mt-2 font-display text-lg font-extrabold text-white">{k.value}</p>
                <p className="text-[10px] text-white/45 sm:text-xs">{k.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={STATUS_VARIANT[event.status] ?? "default"}>
          {STATUS_LABELS[event.status] ?? event.status}
        </Badge>
        {gecmis && event.status === "planned" ? (
          <span className="text-xs text-text-muted">Tarihi geçmiş ama durumu hâlâ &quot;Planlandı&quot;.</span>
        ) : null}
        {sayacTutarsiz ? (
          <span className="text-xs text-amber-600" role="status">
            Sayaç {sayac} diyor, kayıtlı ziyaretçi {gercekSayi}. Listedeki gerçek satır sayısı gösteriliyor.
          </span>
        ) : null}
      </div>

      {property ? (
        <Link
          href={`/app/portfoyler/${property.id}`}
          className="lift-hover focus-ring group surface-card flex items-start justify-between gap-3 rounded-[var(--radius-panel)] p-5 transition hover:border-brand-300"
        >
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-600">
              <Building2 className="h-3.5 w-3.5" /> {property.property_code}
            </p>
            <p className="mt-1 truncate font-semibold text-ink-950">{property.title ?? "Başlıksız"}</p>
            {property.address_line ? (
              <p className="mt-0.5 truncate text-xs text-text-muted">{property.address_line}</p>
            ) : null}
            <p className="numeric mt-2 font-display text-lg font-extrabold text-ink-950">
              {money(property.list_price)}
            </p>
          </div>
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-canvas text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </Link>
      ) : null}

      {canCreate ? (
        <section className="surface-card rounded-[var(--radius-panel)] p-5">
          <h2 className="font-display font-bold text-ink-950">Ziyaretçi kaydet</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Kapıda hızlı giriş için; kaydettikten sonra imleç ada geri döner.
          </p>
          <VisitorForm openHouseId={event.id} />
        </section>
      ) : null}

      <section className="surface-card rounded-[var(--radius-panel)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
            <Users className="h-4 w-4 text-brand-600" /> Ziyaretçiler
          </h2>
          <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-xs font-semibold text-brand-600">
            {gercekSayi} kayıt
          </span>
        </div>

        {visitors.length === 0 ? (
          <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-10 text-center text-sm text-text-muted">
            Henüz ziyaretçi kaydı yok. Açık ev günü kapıda topladığınız isimleri buradan girin — her biri
            takip edilebilir bir aday olur.
          </p>
        ) : (
          <TableFrame className="mt-3" minWidth={620}>
            <Table>
              <THead>
                <TR>
                  <TH>Ad soyad</TH>
                  <TH>Telefon</TH>
                  <TH className="hidden md:table-cell">E-posta</TH>
                  <TH className="hidden md:table-cell">Not</TH>
                  <TH>Kayıt</TH>
                </TR>
              </THead>
              <TBody>
                {visitors.map((v) => {
                  const tel = toTelHref(v.phone);
                  return (
                    <TR key={v.id}>
                      <TD className="font-semibold text-ink-950">
                        {v.created_customer_id ? (
                          <Link
                            href={`/app/musteriler/${v.created_customer_id}`}
                            className="focus-ring inline-flex items-center gap-1 hover:text-brand-600 hover:underline"
                          >
                            {v.full_name} <ArrowUpRight className="h-3 w-3" />
                          </Link>
                        ) : (
                          v.full_name
                        )}
                      </TD>
                      <TD>
                        {tel ? (
                          <a href={tel} className="focus-ring numeric hover:text-brand-600 hover:underline">
                            {formatTurkishPhone(v.phone)}
                          </a>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
                      </TD>
                      <TD className="hidden text-text-muted md:table-cell">
                        {v.email ?? "—"}
                      </TD>
                      <TD className="hidden text-text-muted md:table-cell">
                        {v.notes ?? "—"}
                      </TD>
                      <TD className="text-text-muted">
                        {v.registered_at
                          ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(
                              new Date(v.registered_at),
                            )
                          : "—"}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableFrame>
        )}

        {event.notes ? (
          <p className="hairline-t mt-4 whitespace-pre-line pt-3 text-sm text-text-muted">{event.notes}</p>
        ) : null}
      </section>
    </div>
  );
}
