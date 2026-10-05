"use client";

import { useState, useTransition } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlugZap, RotateCw, Save, Trash2 } from "lucide-react";
import {
  clearEmlakFiyatiKey,
  deletePreviousEmlakFiyatiKey,
  saveEmlakFiyatiKey,
  setEmlakFiyatiOrtakFlag,
  testEmlakFiyatiConnection,
  testEmlakFiyatiOrtak,
  type EmlakFiyatiOrtakProbeResult,
} from "@/app/actions/platform-emlakfiyati";
import { EMLAKFIYATI_KEY_PREFIX } from "@/lib/integrations/emlakfiyati/policy";

const field =
  "focus-ring h-10 w-full rounded-[var(--radius-control)] border border-line bg-canvas px-3 font-mono text-sm text-ink-950 outline-none focus:border-brand-300";
const btn =
  "focus-ring press inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3.5 py-2 text-xs font-semibold disabled:opacity-60";

const PROBE_LABEL: Record<string, { text: string; good: boolean }> = {
  connected: { text: "Bağlı: anahtar geçerli, uç yanıt veriyor.", good: true },
  auth: { text: "401: anahtar geçersiz veya iptal edilmiş.", good: false },
  forbidden: { text: "403: bu anahtarın yetki kapsamı yok.", good: false },
  rate_limited: { text: "429: istek sınırı aşıldı, biraz sonra deneyin.", good: false },
  server: { text: "Sunucu hatası (5xx): EmlakFiyati tarafında geçici sorun olabilir.", good: false },
  network: { text: "Ağ hatası: EmlakFiyati'na ulaşılamadı.", good: false },
  disabled: { text: "Anahtar tanımlı değil.", good: false },
};

const ORTAK_PROBE_LABEL: Record<string, { text: string; good: boolean }> = {
  connected: { text: "Bağlı: ortak uçlar yanıt veriyor (GET /kullanim 2xx).", good: true },
  auth: { text: "401: anahtar geçersiz, iptal edilmiş veya izinli IP listesi dışında.", good: false },
  forbidden: { text: "403: ortak uçlar için yetki yok.", good: false },
  rate_limited: { text: "429: istek sınırı aşıldı, biraz sonra deneyin.", good: false },
  server: { text: "Sunucu hatası (5xx/503): EmlakFiyati tarafında geçici sorun olabilir.", good: false },
  network: { text: "Ağ hatası veya zaman aşımı: ortak uçlara ulaşılamadı.", good: false },
  disabled: { text: "Anahtar tanımlı değil.", good: false },
  invalid_response: { text: "Beklenmeyen yanıt biçimi: ortak uç şemaya uymuyor.", good: false },
  other: { text: "Yoklama tamamlanamadı.", good: false },
};

const ORTAK_CODE_LABEL: Record<string, string> = {
  kapsam_yok: "Anahtarda ortak kapsamı (ortak:value / ortak:report) yok.",
  ortak_bagi_yok: "Anahtar EmlakFiyati'nda Emlaksoft ortak kaydına bağlı değil.",
  ortak_pasif: "Ortak kaydı pasif.",
  kimlik_gerekli: "Kimlik reddedildi.",
  probe_kaydedilemedi: "Yoklama başarılı ama kayıt yazılamadı.",
};

const ERROR_CLASS_LABEL: Record<string, string> = {
  auth: "401 anahtar reddedildi",
  forbidden: "403 kapsam yok",
  rate_limited: "429 istek sınırı",
  server: "5xx sunucu hatası",
  network: "ağ hatası",
  invalid_response: "geçersiz yanıt",
};

export type EmlakFiyatiPanelProps = {
  canEdit: boolean;
  secretsEnabled: boolean;
  /** Şifreleme anahtarının kaynağı (anahtarın kendisi ASLA gelmez). */
  secretsKeySource: "env" | "derived" | "none";
  configured: boolean;
  source: "admin" | "env" | "none";
  masked: string | null;
  decryptFailed: boolean;
  changedAtLabel: string | null;
  lastOkLabel: string | null;
  lastErrorClass: string | null;
  lastErrorLabel: string | null;
  authAlarm: boolean;
  previousPresent: boolean;
  previousDaysLeft: number | null;
  previousUsedLabel: string | null;
  ortakFlagOn: boolean;
  ortakEndpointsVerified: boolean;
  ortakProbeOkLabel: string | null;
  ortakProbeInfo: {
    ortakAd: string | null;
    tarifeSurum: string | null;
    sinirlar: { istekDakika: number | null; pdfDakika: number | null; eszPdf: number | null; eszDegerleme: number | null };
  } | null;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-canvas/60 px-3 py-2.5 text-sm">
      <span className="font-semibold text-ink-950">{label}</span>
      <span className="text-right text-text-muted">{value}</span>
    </div>
  );
}

export function EmlakFiyatiPanel(props: EmlakFiyatiPanelProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [probe, setProbe] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "clear" | "previous" | "ortak-on" | "ortak-off">(null);
  const [ortakProbe, setOrtakProbe] = useState<EmlakFiyatiOrtakProbeResult["probe"] | null>(null);
  const { canEdit, secretsEnabled } = props;

  function submitKey(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await saveEmlakFiyatiKey(fd);
      form.reset(); // girilen değer bileşende tutulmaz
      if (res.error) {
        setError(res.error);
        return;
      }
      setNotice(res.rotated ? "Yeni anahtar kaydedildi; eski anahtar 7 gün geçerli kalır." : "Anahtar kaydedildi.");
      router.refresh();
    });
  }

  function run(fn: () => Promise<{ error?: string }>, okText: string) {
    setConfirm(null);
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setNotice(okText);
        router.refresh();
      }
    });
  }

  function runProbe() {
    setError(null);
    setNotice(null);
    setProbe(null);
    start(async () => {
      const res = await testEmlakFiyatiConnection();
      if (res.error) setError(res.error);
      else setProbe(res.state ?? "network");
      router.refresh();
    });
  }

  function runOrtakProbe() {
    setError(null);
    setNotice(null);
    setOrtakProbe(null);
    start(async () => {
      const res = await testEmlakFiyatiOrtak();
      if (res.error) setError(res.error);
      else setOrtakProbe(res.probe ?? null);
      router.refresh();
    });
  }

  const sourceLabel =
    props.source === "admin" ? "Admin (şifreli kayıt)" : props.source === "env" ? "Ortam değişkeni (yedek)" : "Yok";
  const probeInfo = probe ? PROBE_LABEL[probe] : null;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 className="font-display font-bold text-ink-950">Durum</h2>
        {props.authAlarm ? (
          <p role="alert" className="mt-3 rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-sm font-semibold text-danger-600">
            EmlakFiyati anahtarı reddedildi (401). İstekler durduruldu; yeni anahtar girin.
          </p>
        ) : null}
        {props.decryptFailed ? (
          <p role="alert" className="mt-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800">
            Admin&apos;de kayıtlı anahtar çözülemedi (PLATFORM_SECRETS_KEY eksik veya değişmiş). Anahtarı yeniden girin.
          </p>
        ) : null}
        <div className="mt-4 space-y-2">
          <Row label="Anahtar" value={props.configured ? (props.masked ?? "tanımlı") : "tanımlı değil"} />
          <Row label="Kaynak" value={sourceLabel} />
          <Row label="Son değişiklik" value={props.changedAtLabel ?? "kayıt yok"} />
          <Row label="Son başarılı çağrı" value={props.lastOkLabel ?? "yok"} />
          <Row
            label="Son hata sınıfı"
            value={
              props.lastErrorClass
                ? `${ERROR_CLASS_LABEL[props.lastErrorClass] ?? props.lastErrorClass}${props.lastErrorLabel ? ` · ${props.lastErrorLabel}` : ""}`
                : "yok"
            }
          />
          {props.previousPresent ? (
            <Row
              label="Eski anahtar"
              value={`${props.previousDaysLeft ?? 0} gün daha geçerli${props.previousUsedLabel ? ` · kullanıldı: ${props.previousUsedLabel}` : ""}`}
            />
          ) : null}
        </div>
        {canEdit ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={runProbe} disabled={pending || !props.configured} className={`${btn} border border-line bg-surface text-ink-950`}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Bağlantıyı dene
            </button>
            {props.previousPresent ? (
              confirm === "previous" ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-amber-800">
                  Eski anahtar silinsin mi?
                  <button type="button" onClick={() => run(deletePreviousEmlakFiyatiKey, "Eski anahtar silindi.")} className={`${btn} bg-ink-950 text-white`}>Evet, sil</button>
                  <button type="button" onClick={() => setConfirm(null)} className={`${btn} border border-line bg-surface text-ink-950`}>Vazgeç</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirm("previous")} disabled={pending} className={`${btn} border border-line text-danger-500`}>
                  <Trash2 className="h-3.5 w-3.5" /> Eskiyi şimdi sil
                </button>
              )
            ) : null}
            {props.source === "admin" ? (
              confirm === "clear" ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-amber-800">
                  Admin&apos;deki anahtar silinsin mi?
                  <button type="button" onClick={() => run(clearEmlakFiyatiKey, "Admin anahtarı silindi.")} className={`${btn} bg-ink-950 text-white`}>Evet, sil</button>
                  <button type="button" onClick={() => setConfirm(null)} className={`${btn} border border-line bg-surface text-ink-950`}>Vazgeç</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirm("clear")} disabled={pending} className={`${btn} border border-line text-danger-500`}>
                  <Trash2 className="h-3.5 w-3.5" /> Kaldır
                </button>
              )
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-xs text-text-faint">Anahtar yalnız süper admin tarafından yönetilir.</p>
        )}
        {probeInfo ? (
          <p role="status" className={`mt-3 text-sm font-medium ${probeInfo.good ? "text-mint-700" : "text-danger-600"}`}>
            {probeInfo.text}
          </p>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <h2 className="font-display font-bold text-ink-950">{props.configured ? "Yeni anahtar gir (rotasyon)" : "Anahtar gir"}</h2>
        <p className="mt-1 text-xs text-text-muted">
          Girilen değer şifreli kaydedilir ve bir daha gösterilmez. Yeni anahtar geçerli olur; eskisi 7 gün yedek olarak kalır.
        </p>
        {!secretsEnabled ? (
          <p role="status" className="mt-3 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-800">
            Etkin değil: şifreleme anahtarı oluşturulamadı (ne PLATFORM_SECRETS_KEY ne de OTP_HMAC_SECRET tanımlı). Kayıt yapılamaz; ortam değişkeni yedeği çalışmaya devam eder.
          </p>
        ) : props.secretsKeySource === "derived" ? (
          <p role="note" className="mt-3 rounded-[var(--radius-card)] border border-line bg-canvas px-3 py-2 text-xs text-text-muted">
            Şifreleme anahtarı sunucu sırrından türetildi. Daha güçlü ayrım için Vercel&apos;e PLATFORM_SECRETS_KEY (openssl rand -hex 32) eklenebilir;
            eklenince eski kayıtlar da çözülmeye devam eder. Kaynak sunucu sırrı döndürülürse bu anahtarı yeniden girmeniz gerekir.
          </p>
        ) : null}
        {canEdit ? (
          <form onSubmit={submitKey} className="mt-3 space-y-2">
            <input
              name="api_key"
              type="password"
              required
              maxLength={160}
              autoComplete="off"
              spellCheck={false}
              disabled={!secretsEnabled}
              placeholder={`${EMLAKFIYATI_KEY_PREFIX}…`}
              aria-label="EmlakFiyati API anahtarı"
              className={field}
            />
            <button type="submit" disabled={pending || !secretsEnabled} className={`${btn} bg-ink-950 text-white`}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : props.configured ? <RotateCw className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
              {props.configured ? "Anahtarı değiştir" : "Kaydet"}
            </button>
          </form>
        ) : null}
        {error ? <p role="alert" className="mt-2 text-xs font-medium text-danger-600">{error}</p> : null}
        {notice ? <p role="status" className="mt-2 text-xs font-medium text-mint-700">{notice}</p> : null}

        <div className="mt-6 border-t border-line pt-4">
          <h3 className="text-sm font-bold text-ink-950">Ortak uçlar (değerleme / rapor / PDF)</h3>
          <p className="mt-1 text-xs text-text-muted">
            Uçlar canlıda doğrulanmadı: önce yoklama başarılı olmalı, sonra bayrak açılabilir. Bayrak kapalıyken hiçbir ortak çağrı yapılmaz.
          </p>
          <div className="mt-3 space-y-2">
            <Row label="Son başarılı yoklama" value={props.ortakProbeOkLabel ?? "yok (bayrak açılamaz)"} />
            <Row label="Bayrak" value={props.ortakFlagOn ? "açık" : "kapalı"} />
            {props.ortakProbeInfo ? (
              <>
                <Row label="Tarife sürümü" value={props.ortakProbeInfo.tarifeSurum ?? "bildirilmedi"} />
                <Row
                  label="Sınırlar"
                  value={
                    [
                      props.ortakProbeInfo.sinirlar.istekDakika !== null ? `${props.ortakProbeInfo.sinirlar.istekDakika} istek/dk` : null,
                      props.ortakProbeInfo.sinirlar.pdfDakika !== null ? `${props.ortakProbeInfo.sinirlar.pdfDakika} PDF/dk` : null,
                      props.ortakProbeInfo.sinirlar.eszDegerleme !== null ? `${props.ortakProbeInfo.sinirlar.eszDegerleme} eşzamanlı değerleme` : null,
                      props.ortakProbeInfo.sinirlar.eszPdf !== null ? `${props.ortakProbeInfo.sinirlar.eszPdf} eşzamanlı PDF` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "bildirilmedi"
                  }
                />
              </>
            ) : null}
          </div>
          {canEdit ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={runOrtakProbe} disabled={pending || !props.configured} className={`${btn} border border-line bg-surface text-ink-950`}>
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />} Ortak bağlantıyı dene
              </button>
              {props.ortakFlagOn ? (
                confirm === "ortak-off" ? (
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-amber-800">
                    Ortak uçlar kapatılsın mı?
                    <button type="button" onClick={() => run(() => setEmlakFiyatiOrtakFlag(false), "Ortak uçlar kapatıldı.")} className={`${btn} bg-ink-950 text-white`}>Evet, kapat</button>
                    <button type="button" onClick={() => setConfirm(null)} className={`${btn} border border-line bg-surface text-ink-950`}>Vazgeç</button>
                  </span>
                ) : (
                  <button type="button" onClick={() => setConfirm("ortak-off")} disabled={pending} className={`${btn} border border-line text-danger-500`}>
                    Ortak uçları kapat
                  </button>
                )
              ) : confirm === "ortak-on" ? (
                <span className="inline-flex flex-wrap items-center gap-2 text-xs font-semibold text-amber-800">
                  Canlı kullanıcı verisiyle kullanım için EmlakFiyati sözleşmesi imzalı mı? Etkinleştirilsin mi?
                  <button type="button" onClick={() => run(() => setEmlakFiyatiOrtakFlag(true), "Ortak uçlar etkinleştirildi.")} className={`${btn} bg-ink-950 text-white`}>Evet, etkinleştir</button>
                  <button type="button" onClick={() => setConfirm(null)} className={`${btn} border border-line bg-surface text-ink-950`}>Vazgeç</button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirm("ortak-on")}
                  disabled={pending || !props.ortakProbeOkLabel}
                  title={props.ortakProbeOkLabel ? undefined : "Önce başarılı ortak yoklaması gerekir"}
                  className={`${btn} bg-ink-950 text-white`}
                >
                  Ortak uçları etkinleştir
                </button>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-text-faint">Ortak uçlar yalnız süper admin tarafından yönetilir.</p>
          )}
          {ortakProbe ? (
            <div role="status" className={`mt-3 text-sm font-medium ${ORTAK_PROBE_LABEL[ortakProbe.state]?.good ? "text-mint-700" : "text-danger-600"}`}>
              <p>{ORTAK_PROBE_LABEL[ortakProbe.state]?.text ?? "Yoklama tamamlanamadı."}</p>
              {ortakProbe.code ? <p className="text-xs">{ORTAK_CODE_LABEL[ortakProbe.code] ?? `Kod: ${ortakProbe.code}`}</p> : null}
              {ortakProbe.requestId ? <p className="text-xs text-text-muted">İstek kodu (destek için): {ortakProbe.requestId}</p> : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
