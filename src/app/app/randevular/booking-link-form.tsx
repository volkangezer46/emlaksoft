"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Check, Copy, ExternalLink, Loader2, RefreshCw, Save } from "lucide-react";
import { regenerateBookingToken, upsertBookingSettings } from "@/app/actions/booking";
import { WEEKDAY_LABELS, type WeekdayHours } from "@/lib/booking-slots";
import { useToast } from "@/components/app/toast-provider";

export type BookingSettingsView = {
  /** Ayar hiç kaydedilmediyse null — link henüz üretilmemiştir. */
  token: string | null;
  isActive: boolean;
  weekdayHours: WeekdayHours;
  slotMinutes: number;
  bufferMinutes: number;
  maxDaysAhead: number;
  minHoursNotice: number;
  note: string;
};

// origin değişmez — abonelik gerekmez (calendar-subscribe-card deseni).
function subscribeNoop() {
  return () => {};
}

const inputCls =
  "w-full rounded-[10px] border border-line bg-canvas px-2.5 py-2 text-xs text-ink-950 outline-none transition focus:border-brand-400";

const SLOT_OPTIONS = [15, 20, 30, 45, 60, 90, 120];

type DayState = { open: boolean; start: string; end: string };

/**
 * Online randevu linki ayar formu.
 *
 * NEDEN CLIENT: gün açık/kapalı anahtarları saat alanlarını anında etkinleştirir
 * ve link kopyalama pano API'si gerektirir. Kaydetme server action ile
 * (upsertBookingSettings), sonuç toast + router.refresh.
 */
export function BookingLinkForm({ settings }: { settings: BookingSettingsView }) {
  const { push } = useToast();
  const router = useRouter();
  const [saving, startSave] = useTransition();
  const [regenerating, startRegen] = useTransition();
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState(settings.isActive);
  const [days, setDays] = useState<Record<string, DayState>>(() => {
    const out: Record<string, DayState> = {};
    for (const { key } of WEEKDAY_LABELS) {
      const hours = settings.weekdayHours[key];
      out[key] = Array.isArray(hours) && hours.length >= 2
        ? { open: true, start: hours[0]!, end: hours[1]! }
        : { open: false, start: "09:00", end: "18:00" };
    }
    return out;
  });

  const origin = useSyncExternalStore(
    subscribeNoop,
    () => window.location.origin,
    () => null,
  );
  const publicUrl = settings.token && origin ? `${origin}/randevu-al/${settings.token}` : null;

  async function copy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      push("Randevu linki kopyalandı", "ok");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      push("Link panoya kopyalanamadı", "err");
    }
  }

  function save(fd: FormData) {
    startSave(async () => {
      const res = await upsertBookingSettings(fd);
      if (res.ok) {
        push(active ? "Online randevu linkin açık" : "Ayarlar kaydedildi", "ok");
        router.refresh();
      } else {
        push(res.error ?? "Ayar kaydedilemedi", "err");
      }
    });
  }

  function regenerate() {
    startRegen(async () => {
      const res = await regenerateBookingToken();
      if (res.ok) {
        push("Randevu linki yenilendi — eski link artık çalışmaz", "ok");
        router.refresh();
      } else {
        push(res.error ?? "Link yenilenemedi", "err");
      }
    });
  }

  return (
    <section className="dashboard-panel rounded-[20px] border border-line bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-[11px] bg-mint-500/12 text-mint-600">
            <CalendarPlus className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-semibold text-mint-600">Online randevu</p>
            <h2 className="font-display font-bold text-ink-950">Online randevu linkin</h2>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            settings.isActive ? "bg-mint-500/12 text-mint-600" : "bg-ink-950/8 text-text-muted"
          }`}
        >
          {settings.isActive ? "AÇIK" : "KAPALI"}
        </span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-text-muted">
        Bu linki WhatsApp&apos;tan gönderin; müşteri müsait saatlerinizden birini seçsin. Randevu
        otomatik takviminize düşer, size bildirim gelir.
      </p>

      <form action={save} className="mt-4 space-y-4">
        {/* Aç / kapa */}
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-[12px] border border-line bg-canvas px-3.5 py-3">
          <span className="text-xs font-semibold text-ink-950">
            Online randevu almayı aç
            <span className="mt-0.5 block font-normal text-[11px] text-text-faint">
              Kapalıyken link &quot;şu anda randevu alınamıyor&quot; gösterir.
            </span>
          </span>
          <input
            type="checkbox"
            name="is_active"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-brand-600"
          />
        </label>

        {/* Çalışma saatleri */}
        <div>
          <p className="mb-2 text-xs font-semibold text-text-muted">Çalışma saatleri</p>
          <div className="space-y-1.5">
            {WEEKDAY_LABELS.map(({ key, label }) => {
              const d = days[key]!;
              return (
                <div
                  key={key}
                  className="flex items-center gap-2 rounded-[10px] border border-line bg-canvas px-2.5 py-2"
                >
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      name={`gun_${key}_acik`}
                      checked={d.open}
                      onChange={(e) => setDays((s) => ({ ...s, [key]: { ...s[key]!, open: e.target.checked } }))}
                      className="h-4 w-4 shrink-0 accent-brand-600"
                    />
                    <span className={`truncate text-xs font-medium ${d.open ? "text-ink-950" : "text-text-faint"}`}>
                      {label}
                    </span>
                  </label>
                  <input
                    type="time"
                    name={`gun_${key}_baslangic`}
                    value={d.start}
                    disabled={!d.open}
                    onChange={(e) => setDays((s) => ({ ...s, [key]: { ...s[key]!, start: e.target.value } }))}
                    aria-label={`${label} başlangıç saati`}
                    className="w-[92px] shrink-0 rounded-[8px] border border-line bg-surface px-2 py-1.5 text-xs tabular-nums text-ink-950 outline-none transition focus:border-brand-400 disabled:opacity-40"
                  />
                  <span className="shrink-0 text-[11px] text-text-faint">—</span>
                  <input
                    type="time"
                    name={`gun_${key}_bitis`}
                    value={d.end}
                    disabled={!d.open}
                    onChange={(e) => setDays((s) => ({ ...s, [key]: { ...s[key]!, end: e.target.value } }))}
                    aria-label={`${label} bitiş saati`}
                    className="w-[92px] shrink-0 rounded-[8px] border border-line bg-surface px-2 py-1.5 text-xs tabular-nums text-ink-950 outline-none transition focus:border-brand-400 disabled:opacity-40"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Slot kuralları */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="booking-slot" className="mb-1 block text-[11px] font-semibold text-text-muted">
              Randevu süresi
            </label>
            <select id="booking-slot" name="slot_minutes" defaultValue={settings.slotMinutes} className={inputCls}>
              {SLOT_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} dakika
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="booking-buffer" className="mb-1 block text-[11px] font-semibold text-text-muted">
              Randevular arası boşluk
            </label>
            <select id="booking-buffer" name="buffer_minutes" defaultValue={settings.bufferMinutes} className={inputCls}>
              {[0, 15, 30, 45, 60].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? "Yok" : `${m} dakika`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="booking-days" className="mb-1 block text-[11px] font-semibold text-text-muted">
              Kaç gün ileriye
            </label>
            <input
              id="booking-days"
              name="max_days_ahead"
              type="number"
              min={1}
              max={90}
              defaultValue={settings.maxDaysAhead}
              className={`${inputCls} numeric`}
            />
          </div>
          <div>
            <label htmlFor="booking-notice" className="mb-1 block text-[11px] font-semibold text-text-muted">
              En az kaç saat önce
            </label>
            <input
              id="booking-notice"
              name="min_hours_notice"
              type="number"
              min={0}
              max={168}
              defaultValue={settings.minHoursNotice}
              className={`${inputCls} numeric`}
            />
          </div>
        </div>

        <div>
          <label htmlFor="booking-note" className="mb-1 block text-[11px] font-semibold text-text-muted">
            Müşteriye not (isteğe bağlı)
          </label>
          <textarea
            id="booking-note"
            name="note"
            rows={2}
            maxLength={500}
            defaultValue={settings.note}
            placeholder="Örn. Görüşmeler ofisimizde yapılır. Kimlik getirmeyi unutmayın."
            className={`${inputCls} resize-none`}
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="btn-shine focus-ring press inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-brand-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-brand-700 disabled:opacity-55"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? "Kaydediliyor…" : "Ayarları kaydet"}
        </button>
      </form>

      {/* Public link — ancak ayar bir kez kaydedildikten sonra vardır */}
      {settings.token ? (
        <>
          <div className="mt-4 flex items-center gap-2 rounded-[11px] border border-line bg-canvas px-3 py-2">
            <code className="min-w-0 flex-1 truncate text-[11px] text-text-muted" title={publicUrl ?? undefined}>
              {publicUrl ?? "…"}
            </code>
            <button
              type="button"
              disabled={!publicUrl}
              onClick={copy}
              title="Randevu linkini kopyala"
              className="focus-ring press inline-flex shrink-0 items-center gap-1 rounded-[8px] border border-line bg-surface px-2 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600 disabled:opacity-50"
            >
              {copied ? <Check className="h-3 w-3 text-mint-600" /> : <Copy className="h-3 w-3" />}
              Kopyala
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <a
              href={`/randevu-al/${settings.token}`}
              target="_blank"
              rel="noopener noreferrer"
              className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
            >
              <ExternalLink className="h-3 w-3" /> Önizle
            </a>
            <button
              type="button"
              onClick={regenerate}
              disabled={regenerating}
              title="Yeni link üretir; eski link artık çalışmaz"
              className="focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-[11px] font-semibold text-warn-500 transition hover:border-warn-500/40 disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
              {/* Aynı sayfada takvim kartının da yenileme butonu var — isim ayırt edici olmalı */}
              {regenerating ? "Yenileniyor…" : "Rezervasyon linkini yenile"}
            </button>
          </div>
        </>
      ) : (
        <p className="mt-4 rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-[11px] leading-relaxed text-text-faint">
          Ayarları ilk kez kaydettiğinizde size özel rezervasyon linkiniz burada oluşacak.
        </p>
      )}
    </section>
  );
}
