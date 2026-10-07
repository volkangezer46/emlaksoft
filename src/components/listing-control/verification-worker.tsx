"use client";

import Link from "@/components/ui/smart-link";
import { useEffect, useRef, useState } from "react";
import { RadioTower } from "lucide-react";
import { daysAgoIso, now } from "@/lib/clock";
import {
  BRIDGE_DEFER_ERRORS,
  BRIDGE_RESPONSE_SOURCE,
  bridgeAutorun,
  bridgeInstalled,
  bridgePaused,
  parseBridgeMessage,
  requestProbe,
} from "@/lib/listing-control/worker/bridge";
import { EXTENSION_INSTALL_PATH } from "@/lib/listing-control/worker/extension-copy";
import { nextDelayMs, replyToReport, workerGate, WORKER_LIMITS, type StepOutcome } from "@/lib/listing-control/worker/core";
import { workerClaim, workerComplete, workerRegister, workerRelease } from "@/app/actions/listing-control-worker";

/**
 * Tarayıcı doğrulama işçisi (görünmez döngü + küçük durum satırı). Kullanıcı İlan Kontrol bölümünü açık tuttuğu sürece,
 * sekme görünürken ve çevrimiçiyken, yavaş hızda (iş arası >= 20 sn, saatte <= 60) kendi tarayıcısından portal
 * ilanlarını teyit eder. Kural ve sınırlar `lib/listing-control/worker/core.ts`; sunucu tarafı `lc_worker_*` RPC'leri
 * (kullanıcı JWT'si). Köprü (tarayıcı eklentisi) yoksa HİÇ iş talep edilmez: sahte doğrulama üretilmez; durum satırı
 * kurulum sayfasına bağlanır. Eklenti otomatik kontrolü KENDİSİ yürütüyorsa (`autorun`, herhangi bir EmlakSoft
 * sayfasında) bu işçi iş talep etmez (çift kontrol yok); duraklatılmışsa hiçbir şey yapmaz.
 * Portal sayfası sunucudan çekilmez; CAPTCHA/hız sınırı aşılmaz (engel = "blocked", ASLA "ilan yok" değil).
 */

const DEVICE_KEY = "es-lc-device-key";

function deviceKey(): string | null {
  try {
    let k = window.localStorage.getItem(DEVICE_KEY);
    if (!k || k.length < 16) {
      k = `${crypto.randomUUID()}`;
      window.localStorage.setItem(DEVICE_KEY, k);
    }
    return k;
  } catch {
    return null;
  }
}

type Status = { text: string; active: boolean; install?: boolean };

export function VerificationWorker() {
  const [status, setStatus] = useState<Status>({ text: "Doğrulama yardımcısı denetleniyor", active: false });
  const clientId = useRef<string | null>(null);
  const bridgeVersion = useRef<string>("0");
  const sessionCount = useRef(0);
  const jobTimes = useRef<number[]>([]);
  const errors = useRef(0);
  const timer = useRef<number | null>(null);
  const running = useRef(false);
  const bridgeReady = useRef(false);

  useEffect(() => {
    let cancelled = false;
    bridgeReady.current = bridgeInstalled();

    const schedule = (ms: number) => {
      if (cancelled) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void tick(), ms);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if ((event.data as { source?: string } | null)?.source !== BRIDGE_RESPONSE_SOURCE) return;
      const msg = parseBridgeMessage(event.data);
      if (msg?.type === "ready") {
        bridgeReady.current = true;
        bridgeVersion.current = msg.version;
        schedule(1_000);
      }
    };

    const step = async (): Promise<StepOutcome> => {
      if (bridgeInstalled() && bridgePaused()) {
        setStatus({ text: "Tarayıcı eklentisi duraklatıldı: kontrol yapılmıyor", active: false });
        return "idle";
      }
      if (bridgeInstalled() && bridgeAutorun()) {
        setStatus({ text: "Tarayıcı eklentisi EmlakSoft açıkken ilanları otomatik kontrol ediyor", active: true });
        return "idle";
      }
      const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
      const gate = workerGate({
        visible: document.visibilityState === "visible",
        online: navigator.onLine,
        saveData: Boolean(nav.connection?.saveData),
        bridgeReady: bridgeReady.current,
        sessionCount: sessionCount.current,
        recentJobTimesMs: jobTimes.current,
        nowMs: now(),
      });
      if (!gate.run) {
        const text: Record<string, string> = {
          hidden: "Doğrulama yardımcısı beklemede (sekme arka planda)",
          offline: "Doğrulama yardımcısı beklemede (çevrimdışı)",
          save_data: "Doğrulama yardımcısı kapalı (veri tasarrufu açık)",
          no_bridge: "Doğrulama yardımcısı kapalı: tarayıcı eklentisi bulunamadı",
          session_cap: "Doğrulama yardımcısı bu oturum için tamamlandı",
          hour_cap: "Doğrulama yardımcısı saatlik sınıra ulaştı",
        };
        setStatus({ text: text[gate.reason] ?? "Doğrulama yardımcısı beklemede", active: false, install: gate.reason === "no_bridge" });
        return "idle";
      }

      if (!clientId.current) {
        const key = deviceKey();
        if (!key) return "client_invalid";
        const reg = await workerRegister(key, "Tarayıcı", bridgeVersion.current);
        if (!reg.ok) return reg.error === "forbidden" ? "client_invalid" : "error";
        clientId.current = reg.clientId;
      }

      const claim = await workerClaim(clientId.current);
      if (!claim.ok) {
        if (claim.error === "client_invalid" || claim.outcome === "client_invalid") clientId.current = null;
        return "error";
      }
      if (claim.status === "busy") return "busy";
      if (claim.status === "rate_limited") return "rate_limited";
      const job = claim.jobs[0];
      if (!job) {
        setStatus({ text: "Doğrulama yardımcısı çalışıyor: bekleyen kontrol yok", active: true });
        return "idle";
      }

      setStatus({ text: `Doğrulama yardımcısı bir ilanı kontrol ediyor (${job.portal})`, active: true });
      jobTimes.current = [...jobTimes.current.filter((t) => t > now() - 3_600_000), now()];
      sessionCount.current += 1;

      if (!job.url) {
        await workerRelease(clientId.current, job.jobId, "no_url");
        return "done";
      }
      const reply = await requestProbe({ id: job.jobId, portal: job.portal, url: job.url, externalId: job.externalId }, WORKER_LIMITS.probeTimeoutMs);
      const replyError = (reply as { error?: unknown } | null)?.error;
      if (typeof replyError === "string" && BRIDGE_DEFER_ERRORS.includes(replyError)) {
        // Eklenti şimdi yapamadı (kendi hız kuralı) ya da duraklatıldı: gözlem değil, iş geri bırakılır.
        await workerRelease(clientId.current, job.jobId, `bridge_${replyError}`);
        return "busy";
      }
      const report = replyToReport(reply, daysAgoIso(0));
      const done = await workerComplete({ clientId: clientId.current, jobId: job.jobId, result: report.result, observed: report.observed });
      if (!done.ok) return "error";
      errors.current = 0;
      setStatus({ text: "Doğrulama yardımcısı çalışıyor: son kontrol işlendi", active: true });
      return "done";
    };

    const tick = async () => {
      if (cancelled || running.current) return;
      running.current = true;
      let outcome: StepOutcome = "error";
      try {
        outcome = await step();
      } catch {
        outcome = "error";
      }
      running.current = false;
      if (outcome === "error") errors.current += 1;
      else if (outcome === "done") errors.current = 0;
      if (outcome === "client_invalid") setStatus({ text: "Doğrulama yardımcısı kapalı", active: false });
      schedule(nextDelayMs(outcome, errors.current, Math.random()));
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") schedule(2_000);
    };

    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    schedule(3_000);
    return () => {
      cancelled = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <p role="status" className="mt-6 flex flex-wrap items-center gap-2 text-xs text-text-muted">
      <RadioTower aria-hidden="true" className={`h-3.5 w-3.5 ${status.active ? "text-brand-600" : ""}`} />
      {status.text}
      {status.install ? (
        <Link href={EXTENSION_INSTALL_PATH} className="focus-ring rounded font-semibold text-accent-text hover:underline">
          Eklentiyi kur
        </Link>
      ) : null}
    </p>
  );
}
