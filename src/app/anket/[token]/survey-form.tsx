"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, HeartHandshake, Loader2, PartyPopper, Phone, Send } from "lucide-react";
import { submitSurveyByToken } from "@/app/actions/survey-public";

/**
 * NPS puan formu + puana göre değişen teşekkür ekranı.
 *
 * NEDEN CLIENT: server action sonucu sayfa yenilenmeden gösterilir
 * (checkin-form deseni). Puan butonları dokunmatik için büyük (min 44px)
 * ve NPS bantlarına göre renklenir: 0-6 kırmızı, 7-8 amber, 9-10 mint.
 */
export function SurveyForm({
  token,
  office,
  officePhone,
}: {
  token: string;
  office: string;
  officePhone: string | null;
}) {
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState<null | { score: number; alreadyAnswered: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toneClasses(n: number, selected: boolean): string {
    if (n <= 6) {
      return selected
        ? "border-danger-500 bg-danger-500 text-white"
        : "border-danger-500/30 bg-danger-500/8 text-danger-500 hover:border-danger-500/60";
    }
    if (n <= 8) {
      return selected
        ? "border-amber-500 bg-amber-500 text-white"
        : "border-amber-500/35 bg-amber-500/10 text-amber-600 hover:border-amber-500/70";
    }
    return selected
      ? "border-mint-600 bg-mint-600 text-white"
      : "border-mint-500/35 bg-mint-500/10 text-mint-600 hover:border-mint-500/70";
  }

  function submit() {
    if (score === null) {
      setError("Lütfen 0-10 arası bir puan seçin.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("token", token);
    fd.set("score", String(score));
    fd.set("comment", comment);
    startTransition(async () => {
      const res = await submitSurveyByToken(fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      setDone({ score, alreadyAnswered: res.alreadyAnswered === true });
    });
  }

  if (done) {
    if (done.alreadyAnswered) {
      return (
        <div className="rounded-[14px] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-500/15 text-mint-600">
            <CheckCircle2 className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm font-bold text-ink-950">Yanıtınız alınmış.</p>
          <p className="mt-1 text-xs text-text-muted">
            Bu anket daha önce cevaplandı — değerlendirmeniz için teşekkür ederiz.
          </p>
        </div>
      );
    }
    // Teşekkür ekranı puana göre değişir: destekleyen → tavsiye isteği + ofis
    // telefonu; kötüleyen → telafi arama izni tonu; pasif → sade teşekkür.
    if (done.score >= 9) {
      return (
        <div className="rounded-[14px] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-500/15 text-mint-600">
            <PartyPopper className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm font-bold text-ink-950">Çok teşekkür ederiz!</p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            Memnuniyetiniz bizim için en büyük ödül. Bizi tavsiye eder misiniz? Çevrenizde
            emlak arayışında olan biri varsa {office} her zaman yanında.
          </p>
          {officePhone ? (
            <a
              href={`tel:${officePhone.replace(/\s/g, "")}`}
              className="focus-ring press mt-4 inline-flex items-center gap-2 rounded-[12px] bg-mint-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-mint-700"
            >
              <Phone className="h-4 w-4" /> {officePhone}
            </a>
          ) : null}
        </div>
      );
    }
    if (done.score <= 6) {
      return (
        <div className="rounded-[14px] border border-amber-500/30 bg-amber-500/8 px-4 py-8 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-amber-500/15 text-amber-600">
            <HeartHandshake className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm font-bold text-ink-950">Geri bildiriminiz için teşekkürler.</p>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            Beklentinizi karşılayamadığımız için üzgünüz. Deneyiminizi iyileştirmek için sizi
            arayabilir miyiz? Ekibimiz en kısa sürede sizinle iletişime geçecek.
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-[14px] border border-mint-500/30 bg-mint-500/8 px-4 py-8 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-mint-500/15 text-mint-600">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="mt-3 text-sm font-bold text-ink-950">Teşekkür ederiz!</p>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">
          Değerlendirmeniz kaydedildi. Daha iyi bir deneyim için sürekli çalışıyoruz.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Honeypot — gerçek kullanıcılar görmez; botlar doldurursa kayıt sessizce yutulur */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <div>
        <p className="text-center text-sm font-bold text-ink-950">
          Hizmetimizi 0-10 arası puanlar mısınız?
        </p>
        <div className="mt-3 grid grid-cols-6 gap-2 sm:grid-cols-11" role="radiogroup" aria-label="Puan seçimi">
          {Array.from({ length: 11 }, (_, n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={score === n}
              onClick={() => {
                setScore(n);
                setError(null);
              }}
              className={`focus-ring press grid h-11 min-w-11 place-items-center rounded-[12px] border text-sm font-extrabold tabular-nums transition ${toneClasses(n, score === n)}`}
            >
              {n}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between px-0.5 text-[11px] text-text-faint">
          <span>Hiç memnun kalmadım</span>
          <span>Çok memnun kaldım</span>
        </div>
      </div>

      <div>
        <label htmlFor="survey-comment" className="mb-1.5 block text-xs font-semibold text-text-muted">
          Eklemek istedikleriniz (isteğe bağlı)
        </label>
        <textarea
          id="survey-comment"
          rows={3}
          maxLength={2000}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Deneyiminizi birkaç cümleyle anlatabilirsiniz…"
          className="w-full resize-none rounded-[12px] border border-line bg-canvas px-3.5 py-3 text-sm text-ink-950 placeholder:text-text-faint outline-none transition focus:border-brand-400"
        />
      </div>

      {error ? (
        <p
          className="rounded-[10px] border border-danger-500/25 bg-danger-500/5 px-3 py-2 text-center text-xs font-semibold text-danger-500"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={submit}
        disabled={pending || score === null}
        className="btn-shine focus-ring press inline-flex w-full items-center justify-center gap-2 rounded-[12px] bg-brand-600 px-4 py-3.5 text-sm font-bold text-white transition hover:bg-brand-700 disabled:pointer-events-none disabled:opacity-55"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Gönder
      </button>

      <p className="text-center text-[11px] leading-relaxed text-text-faint">
        Yanıtınız yalnızca hizmet kalitesini değerlendirmek amacıyla işlenir.{" "}
        <Link
          href="/kvkk-aydinlatma"
          target="_blank"
          className="font-semibold text-brand-600 underline-offset-2 hover:underline"
        >
          KVKK aydınlatma metni
        </Link>
      </p>
    </div>
  );
}
