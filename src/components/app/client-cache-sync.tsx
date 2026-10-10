"use client";

import { Suspense, startTransition, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { now } from "@/lib/clock";
import { decideArrival, isGateRedirectAfterRefresh, isGatePath } from "@/lib/client-cache-policy";
import {
  clearClientCacheState,
  getFetchedAt,
  getLastBgRefreshAt,
  markBgRefresh,
  markFetched,
  noteClientCacheRefreshed,
} from "@/lib/client-cache-state";
import { resetPrefetchState } from "@/lib/client-prefetch";
import { SCOPE_CHANGE_EVENT } from "@/lib/ui/use-nav-role";

/**
 * Önce göster, sonra tazele (stale-while-revalidate) — /app VE /admin layout'unda bağlıdır.
 *
 * staleTimes.dynamic=300 sayesinde tıklanan sayfa istemci önbelleğinden ANINDA açılır. Bu bileşen güvenliği ve
 * tazeliği sağlar:
 *  (a) önbellekten gösterilen ve >20 sn eski sayfa için sessiz arka plan tazelemesi (`router.refresh()`,
 *      startTransition içinde: etkileşimi bloklamaz, kaydırma/form durumu korunur); iki tazeleme arası ≥15 sn,
 *      sekme arkadayken yapılmaz;
 *  (b) kapı reddi: tazeleme proxy kapısından geçemezse (askı / giriş / 2FA) tam sayfa yüklemesi yapılır → bellek
 *      önbelleği tamamen sıfırlanır; başka hesabın/kapsamın verisi görünmez;
 *  (c) kimlik (kullanıcı+ofis) değişince ve kapsam (Ofis geneli / Benim işlerim) değişince önbellek temizlenir
 *      (router.refresh TÜM segment önbelleğini geçersiz kılar); çıkışta (cookie değişen sunucu eylemi) Next
 *      önbelleği zaten düşürür, ayrıca modül durumu burada sıfırlanır.
 */

function Inner({ identity }: { identity: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const key = `${pathname}?${search}`;
  const prevIdentity = useRef(identity);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Geçiş/kapı: arka plan tazelemesi kapı sayfasına düştüyse tam yükleme.
  useEffect(() => {
    if (isGateRedirectAfterRefresh(pathname, getLastBgRefreshAt(), now())) {
      window.location.replace(window.location.pathname + window.location.search);
    }
  }, [pathname]);

  // Adrese varış: önbellekten eski veri gösterildiyse sessizce tazele.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const decision = decideArrival({
      fetchedAt: getFetchedAt(key),
      nowMs: now(),
      lastBgRefreshAt: getLastBgRefreshAt(),
      hidden: document.visibilityState === "hidden",
    });
    if (decision === "mark") {
      markFetched(key);
    } else if (decision === "refresh") {
      // Gezinme geçişi otursun diye kısa gecikme; yine de kullanıcıyı bloklamaz.
      timer.current = setTimeout(() => {
        markBgRefresh();
        noteClientCacheRefreshed(key);
        startTransition(() => router.refresh());
      }, 250);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, router]);

  // Kimlik değişti (kullanıcı / ofis / vekil oturum): eski kimliğin önbelleği kalmasın.
  useEffect(() => {
    if (prevIdentity.current === identity) return;
    prevIdentity.current = identity;
    clearClientCacheState();
    resetPrefetchState();
    startTransition(() => router.refresh());
  }, [identity, router]);

  // Kapsam değişti (Ofis geneli <-> Benim işlerim): başka kapsamın sayfa verisi gösterilmesin.
  useEffect(() => {
    const onScope = () => {
      clearClientCacheState();
      resetPrefetchState();
      setTimeout(() => startTransition(() => router.refresh()), 0);
    };
    window.addEventListener(SCOPE_CHANGE_EVENT, onScope);
    return () => window.removeEventListener(SCOPE_CHANGE_EVENT, onScope);
  }, [router]);

  // Layout'tan çıkış (çıkış yapma / giriş sayfasına yönlenme): durum sıfırlanır; kapıya düşüldüyse tam yükleme.
  useEffect(() => {
    return () => {
      const last = getLastBgRefreshAt();
      const wasBg = last !== null && now() - last < 15_000;
      clearClientCacheState();
      resetPrefetchState();
      setTimeout(() => {
        if (wasBg && isGatePath(window.location.pathname)) window.location.replace(window.location.href);
      }, 0);
    };
  }, []);

  return null;
}

export function ClientCacheSync({ identity }: { identity: string }) {
  return (
    <Suspense fallback={null}>
      <Inner identity={identity} />
    </Suspense>
  );
}
