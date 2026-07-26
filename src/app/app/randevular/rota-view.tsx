"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowDown,
  CalendarDays,
  Clock3,
  ExternalLink,
  MapPin,
  MapPinOff,
  Navigation,
  Route,
  UserRound,
} from "lucide-react";
import { EmptyState } from "@/components/app/empty-state";
import { RotaMap, type RotaMarker } from "./rota-map";

/**
 * Günün rotası — seçili günün iptal edilmemiş randevuları saat sırasıyla
 * dikey durak listesi + koordinatlı duraklar için numaralı harita.
 *
 * Sıralama SABİT saat sırasıdır (randevular saatlidir, gezgin satıcı
 * optimizasyonu yapılmaz); duraklar arası kuş uçuşu mesafe/tahmini yol
 * süresi bilgi olarak gösterilir, boşluk yetmiyorsa "Sıkışık geçiş" uyarısı.
 * Hesaplar: src/lib/route-plan.ts (saf fonksiyonlar + vitest).
 */

export type RotaLeg = {
  distanceKm: number;
  travelMin: number;
  gapMin: number;
  tight: boolean;
};

export type RotaDurak = {
  id: string;
  /** 1 tabanlı sıra numarası (saat sırası). */
  order: number;
  /** Server'da tr-TR formatlanmış saat — hydration güvenli. */
  timeLabel: string;
  typeLabel: string;
  typeToneCls: string;
  customerId: string | null;
  customerName: string;
  propertyId: string | null;
  propertyName: string | null;
  location: string | null;
  durationMin: number | null;
  lat: number | null;
  lng: number | null;
  /** Google Maps yol tarifi (koordinat > konum metni; ikisi de yoksa null). */
  directionsHref: string | null;
  /** Önceki koordinatlı duraktan bu durağa varış bacağı (yoksa null). */
  leg: RotaLeg | null;
};

export type RotaAdvisor = { id: string; name: string };

export function RotaView({
  gun,
  gunLabel,
  bugunHref,
  yarinHref,
  stops,
  totalKm,
  tightCount,
  advisors,
  selectedAdvisorId,
  advisorBaseQuery,
  newAppointmentSlot,
}: {
  gun: "bugun" | "yarin";
  /** "27 Temmuz Pazartesi" gibi — server'da formatlanır. */
  gunLabel: string;
  bugunHref: string;
  yarinHref: string;
  stops: RotaDurak[];
  totalKm: number;
  tightCount: number;
  /** Yönetici değilse null — seçici gizlenir. */
  advisors: RotaAdvisor[] | null;
  selectedAdvisorId: string;
  /** danisman dışındaki korunacak paramların query string'i. */
  advisorBaseQuery: string;
  /** Boş durum CTA'sı — sayfadaki NewAppointmentDialog buraya geçilir. */
  newAppointmentSlot?: React.ReactNode;
}) {
  const router = useRouter();

  const markers: RotaMarker[] = stops
    .filter((s): s is RotaDurak & { lat: number; lng: number } => s.lat != null && s.lng != null)
    .map((s) => ({
      id: s.id,
      order: s.order,
      label: s.propertyName ?? s.customerName,
      timeLabel: s.timeLabel,
      lat: s.lat,
      lng: s.lng,
      href: s.propertyId ? `/app/portfoyler/${s.propertyId}` : null,
    }));

  function onAdvisorChange(id: string) {
    const q = new URLSearchParams(advisorBaseQuery);
    if (id) q.set("danisman", id);
    router.push(`/app/randevular?${q.toString()}`);
  }

  return (
    <div className="space-y-4">
      {/* Gün seçici + danışman filtresi + özet */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { key: "bugun", label: "Bugün", href: bugunHref },
            { key: "yarin", label: "Yarın", href: yarinHref },
          ] as const
        ).map((g) => (
          <Link
            key={g.key}
            href={g.href}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              gun === g.key
                ? "bg-brand-600 text-white"
                : "border border-line bg-surface text-text-muted hover:border-brand-400 hover:text-brand-600"
            }`}
          >
            {g.label}
          </Link>
        ))}
        {advisors ? (
          <label className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
            <UserRound className="h-3.5 w-3.5 text-brand-600" />
            <select
              value={selectedAdvisorId}
              onChange={(e) => onAdvisorChange(e.target.value)}
              className="focus-ring rounded-[10px] border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-950"
              aria-label="Danışman seç"
            >
              {advisors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {stops.length > 0 ? (
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-brand-600/10 px-3 py-1.5 text-[11px] font-bold text-brand-600">
            <Route className="h-3.5 w-3.5" />
            {stops.length} durak
            {totalKm > 0 ? ` · ~${totalKm < 1 ? "<1" : Math.round(totalKm)} km kuş uçuşu` : ""}
            {tightCount > 0 ? ` · ${tightCount} sıkışık geçiş` : ""}
          </span>
        ) : null}
      </div>

      {stops.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={gun === "bugun" ? "Bugün randevun yok" : "Yarın için randevu yok"}
          description={`${gunLabel} için planlanmış randevu bulunmuyor. Yeni bir yer gösterme veya görüşme planlayınca rota burada oluşur.`}
          tone="mint"
          action={newAppointmentSlot ? { node: newAppointmentSlot } : undefined}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
          {/* Durak listesi — saat sırası */}
          <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
                  <Route className="h-4 w-4" /> Günün rotası
                </p>
                <h2 className="mt-1 font-display font-bold text-ink-950">{gunLabel}</h2>
              </div>
              <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">
                {stops.length} durak
              </span>
            </div>
            <ol className="px-5 py-4">
              {stops.map((s, i) => (
                <li key={s.id}>
                  {/* Bacak bilgisi — önceki koordinatlı duraktan geçiş */}
                  {i > 0 ? (
                    <div className="flex items-center gap-2 py-1.5 pl-3.5 text-[11px] text-text-faint">
                      <ArrowDown className="h-3.5 w-3.5 shrink-0" />
                      {s.leg ? (
                        <>
                          <span className="tabular-nums">
                            {s.leg.distanceKm < 0.1 ? "<0,1" : s.leg.distanceKm.toFixed(1)} km kuş uçuşu · ~{s.leg.travelMin} dk yol ·{" "}
                            {s.leg.gapMin < 0 ? "randevular örtüşüyor" : `${s.leg.gapMin} dk boşluk`}
                          </span>
                          {s.leg.tight ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-600">
                              <AlertTriangle className="h-3 w-3" /> Sıkışık geçiş
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span>mesafe bilinmiyor (koordinat yok)</span>
                      )}
                    </div>
                  ) : null}

                  <article className="group relative flex gap-3 rounded-[14px] border border-line bg-canvas p-3.5 transition hover:border-brand-300">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-600 text-[12px] font-extrabold text-white">
                      {s.order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-sm font-extrabold tabular-nums text-ink-950">
                          {s.timeLabel}
                        </span>
                        {s.customerId ? (
                          <Link
                            href={`/app/musteriler/${s.customerId}`}
                            className="truncate text-sm font-semibold text-ink-950 transition hover:text-brand-600 hover:underline"
                          >
                            {s.customerName}
                          </Link>
                        ) : (
                          <span className="truncate text-sm font-semibold text-ink-950">{s.customerName}</span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.typeToneCls}`}>
                          {s.typeLabel}
                        </span>
                      </div>
                      {s.propertyId ? (
                        <Link
                          href={`/app/portfoyler/${s.propertyId}`}
                          className="mt-1 inline-block max-w-full truncate align-top text-xs text-text-muted transition hover:text-brand-600 hover:underline"
                        >
                          {s.propertyName}
                        </Link>
                      ) : s.propertyName ? (
                        <p className="mt-1 truncate text-xs text-text-muted">{s.propertyName}</p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-faint">
                        {s.location ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {s.location}
                          </span>
                        ) : null}
                        {s.durationMin ? (
                          <span className="flex items-center gap-1">
                            <Clock3 className="h-3 w-3" /> {s.durationMin} dk
                          </span>
                        ) : null}
                        {s.lat == null || s.lng == null ? (
                          <span className="flex items-center gap-1">
                            <MapPinOff className="h-3 w-3" /> Haritada yok (koordinat girilmemiş)
                          </span>
                        ) : null}
                      </div>
                    </div>
                    {s.directionsHref ? (
                      <a
                        href={s.directionsHref}
                        target="_blank"
                        rel="noreferrer"
                        className="focus-ring press inline-flex h-fit shrink-0 items-center gap-1 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-brand-600 transition hover:border-brand-300"
                      >
                        <Navigation className="h-3 w-3" /> Yol tarifi
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : null}
                  </article>
                </li>
              ))}
            </ol>
          </section>

          {/* Harita — koordinatlı durak yoksa gizlenir, bilgi notu kalır */}
          {markers.length > 0 ? (
            <div className="space-y-2">
              <RotaMap markers={markers} />
              {markers.length < stops.length ? (
                <p className="flex items-center gap-1.5 text-[11px] text-text-faint">
                  <MapPinOff className="h-3.5 w-3.5" />
                  {stops.length - markers.length} durak haritada gösterilemiyor — bağlı portföyde koordinat yok.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="grid place-items-center rounded-[20px] border border-dashed border-line-strong bg-surface p-8 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-[16px] bg-amber-400/15 text-amber-600">
                  <MapPinOff className="h-7 w-7" />
                </span>
                <h3 className="mt-3 font-display font-bold text-ink-950">Harita gösterilemiyor</h3>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-text-muted">
                  Bu günün duraklarında koordinatlı portföy yok. Portföy detayından harita konumu
                  işaretlerseniz rota haritada çizilir; &quot;Yol tarifi&quot; butonları konum metniyle yine çalışır.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
