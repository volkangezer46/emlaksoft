"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarCheck2, CalendarPlus, CheckCircle2, Clock3, Loader2, Phone } from "lucide-react";
import { createPublicBooking } from "@/app/actions/booking-public";
import { formatTrDayParts, type BookingDay } from "@/lib/booking-slots";
import { googleCalendarAddUrl } from "@/lib/calendar";
import { sanitizeTurkishPhoneInput, TR_MOBILE_PLACEHOLDER } from "@/lib/phone";

const inputCls =
  "w-full rounded-[12px] border border-line bg-canvas px-3.5 py-3 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-400";

/**
 * Slot seçimi → bilgi formu → teşekkür ekranı (üç adım, tek bileşen).
 *
 * NEDEN CLIENT: server action sonucu sayfa yenilenmeden gösterilir
 * (checkin-form deseni) ve slot seçimi anında forma geçirir.
 *
 * TAKVİME EKLEME KARARI: teşekkür ekranında ".ics indirme" yerine GOOGLE
 * TAKVİM linki kullanıldı — public sayfa çoğunlukla telefonda WhatsApp
 * içi tarayıcıdan açılıyor ve orada indirilen .ics dosyası çoğu Android
 * cihazda takvim uygulamasına gitmiyor; Google linki tek dokunuşla çalışıyor.
 */
export function BookingForm({
  token,
  days,
  slotMinutes,
  office,
  officePhone,
  advisorName,
}: {
  token: string;
  days: BookingDay[];
  slotMinutes: number;
  office: string;
  officePhone: string | null;
  advisorName: string;
}) {
  const [activeDay, setActiveDay] = useState(days[0]?.dateKey ?? "");
  const [slot, setSlot] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [kvkk, setKvkk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { startIso: string; durationMin: number }>(null);
  const [pending, startTransition] = useTransition();

  const day = days.find((d) => d.dateKey === activeDay) ?? days[0]!;

  const fmtDateTime = (iso: string) =>
    new Intl.DateTimeFormat("tr-TR", {
      day: "numeric",
      month: "long",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Istanbul",
    }).format(new Date(iso));

  function submit(fd: FormData) {
    if (!slot) {
      setError("Lütfen bir saat seçin.");
      return;
    }
    setError(null);
    fd.set("token", token);
    fd.set("slot", slot);
    startTransition(async () => {
      const res = await createPublicBooking(fd);
      if (res.error) {
        setError(res.error);
        // Slot yarışta kaybedildiyse seçimi düşür ki müşteri başka saat seçsin.
        if (res.slotTaken) setSlot(null);
        return;
      }
      setDone({ startIso: res.startIso ?? slot, durationMin: res.durationMin ?? slotMinutes });
    });
  }

  // ---- 3. adım: teşekkür ----
  if (done) {
    const start = new Date(done.startIso);
    const calendarUrl = googleCalendarAddUrl({
      uid: done.startIso,
      title: `${office} — randevu (${advisorName})`,
      description: `${advisorName} ile randevunuz.${officePhone ? ` İptal/değişiklik için: ${officePhone}` : ""}`,
      startAt: start,
      endAt: new Date(start.getTime() + done.durationMin * 60_000),
    });
    return (
      <div className="rounded-[14px] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-500/15 text-mint-600">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="mt-3 text-sm font-bold text-ink-950">Randevunuz alındı!</p>
        <p className="mt-2 text-sm font-semibold text-ink-950">{fmtDateTime(done.startIso)}</p>
        <p className="mt-0.5 flex items-center justify-center gap-1.5 text-xs text-text-muted">
          <Clock3 className="h-3.5 w-3.5" /> {done.durationMin} dakika · {advisorName}
        </p>

        <a
          href={calendarUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-ring press mt-4 inline-flex items-center gap-2 rounded-[12px] bg-brand-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-brand-700"
        >
          <CalendarPlus className="h-4 w-4" /> Takviminize ekleyin
        </a>

        <p className="mt-4 text-xs leading-relaxed text-text-muted">
          İptal veya saat değişikliği için bizi arayabilirsiniz.
        </p>
        {officePhone ? (
          <a
            href={`tel:${officePhone.replace(/\s/g, "")}`}
            className="focus-ring press mt-2 inline-flex items-center gap-2 rounded-[11px] border border-line bg-surface px-3.5 py-2 text-xs font-bold text-ink-950 transition hover:border-brand-300"
          >
            <Phone className="h-3.5 w-3.5" /> {officePhone}
          </a>
        ) : null}
      </div>
    );
  }

  // ---- 2. adım: bilgi formu ----
  if (slot) {
    return (
      <form action={submit} className="space-y-3">
        {/* Honeypot — gerçek kullanıcılar görmez; botlar doldurursa kayıt sessizce yutulur */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute left-[-9999px] h-0 w-0 opacity-0"
        />

        <div className="flex items-center justify-between gap-3 rounded-[12px] border border-brand-400/40 bg-brand-600/[0.06] px-4 py-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-brand-600">
              <CalendarCheck2 className="h-3.5 w-3.5" /> Seçtiğiniz saat
            </p>
            <p className="mt-0.5 truncate text-sm font-bold text-ink-950">{fmtDateTime(slot)}</p>
            <p className="text-[11px] text-text-muted">{slotMinutes} dakika</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSlot(null);
              setError(null);
            }}
            className="focus-ring press inline-flex shrink-0 items-center gap-1 rounded-[9px] border border-line bg-surface px-2.5 py-1.5 text-[11px] font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
          >
            <ArrowLeft className="h-3 w-3" /> Değiştir
          </button>
        </div>

        <div>
          <label htmlFor="booking-name" className="mb-1.5 block text-xs font-semibold text-text-muted">
            Ad soyad *
          </label>
          <input
            id="booking-name"
            name="full_name"
            required
            autoComplete="name"
            placeholder="Örn. Ayşe Yıldız"
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor="booking-phone" className="mb-1.5 block text-xs font-semibold text-text-muted">
            Cep telefonu *
          </label>
          <input
            id="booking-phone"
            name="phone"
            required
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder={TR_MOBILE_PLACEHOLDER}
            value={phone}
            onChange={(e) => setPhone(sanitizeTurkishPhoneInput(e.target.value))}
            className={`${inputCls} numeric`}
          />
        </div>

        <div>
          <label htmlFor="booking-email" className="mb-1.5 block text-xs font-semibold text-text-muted">
            E-posta (isteğe bağlı)
          </label>
          <input
            id="booking-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="ornek@eposta.com"
            className={inputCls}
          />
        </div>

        <div>
          <label htmlFor="booking-subject" className="mb-1.5 block text-xs font-semibold text-text-muted">
            Konu / notunuz (isteğe bağlı)
          </label>
          <textarea
            id="booking-subject"
            name="note"
            rows={3}
            maxLength={1000}
            placeholder="Örn. Kadıköy'de 2+1 kiralık daire arıyorum."
            className={`${inputCls} resize-none`}
          />
        </div>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-[12px] border border-line bg-canvas/60 px-3.5 py-3 text-[12px] leading-relaxed text-text-muted transition hover:border-brand-300">
          <input
            type="checkbox"
            name="kvkk"
            required
            checked={kvkk}
            onChange={(e) => setKvkk(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
          />
          <span>
            Kişisel verilerimin randevu kaydı ve iletişim amacıyla işlenmesine onay veriyorum.{" "}
            <Link
              href="/kvkk-aydinlatma"
              target="_blank"
              className="font-semibold text-brand-600 underline-offset-2 hover:underline"
            >
              Aydınlatma metni
            </Link>
          </span>
        </label>

        {error ? (
          <p
            className="rounded-[10px] border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-center text-xs font-semibold text-danger-500"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending || !kvkk}
          className="btn-shine focus-ring press inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-55"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck2 className="h-4 w-4" />}
          Randevumu oluştur
        </button>
      </form>
    );
  }

  // ---- 1. adım: gün + saat seçimi ----
  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-text-muted">Uygun bir gün ve saat seçin</p>

      {/* Gün şeridi — yalnız boş saati olan günler listelenir */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {days.map((d) => {
          const active = d.dateKey === day.dateKey;
          const { dayNum, month, weekday } = formatTrDayParts(d.dateKey);
          return (
            <button
              key={d.dateKey}
              type="button"
              onClick={() => setActiveDay(d.dateKey)}
              aria-pressed={active}
              className={`focus-ring press flex min-w-[74px] shrink-0 flex-col items-center gap-0.5 rounded-[12px] border px-2.5 py-2 transition ${
                active
                  ? "border-brand-400 bg-brand-600/10 text-brand-600"
                  : "border-line bg-canvas text-text-muted hover:border-brand-300"
              }`}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.06em]">{weekday}</span>
              <span className="font-display text-lg font-extrabold tabular-nums text-ink-950">{dayNum}</span>
              <span className="text-[10px]">{month}</span>
              <span className="text-[10px] font-semibold opacity-70">{d.slots.length} saat</span>
            </button>
          );
        })}
      </div>

      {/* Saat ızgarası — dokunmatik için min 44px yükseklik (anket deseni) */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {day.slots.map((s) => (
          <button
            key={s.startIso}
            type="button"
            onClick={() => {
              setSlot(s.startIso);
              setError(null);
            }}
            className="focus-ring press grid h-11 place-items-center rounded-[11px] border border-line bg-canvas text-sm font-bold tabular-nums text-ink-950 transition hover:border-brand-400 hover:bg-brand-600/[0.06] hover:text-brand-600"
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="text-center text-[11px] text-text-faint">
        Her randevu {slotMinutes} dakikadır. Saati seçtikten sonra iletişim bilgilerinizi alacağız.
      </p>

      {error ? (
        <p
          className="rounded-[10px] border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-center text-xs font-semibold text-danger-500"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
