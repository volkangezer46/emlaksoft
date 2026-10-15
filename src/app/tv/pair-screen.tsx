"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { now } from "@/lib/clock";

type PairResponse =
  | { state: "paired" }
  | { state: "pending"; code: string; expiresAt: string }
  | { state: "none" }
  | { state: "unavailable" }
  | { state: "limited" };

const POLL_MS = 3_000;

/**
 * TV eşleştirme ekranı (OA6): büyük kod + yönerge; 3 sn'de bir durum sorar, eşleşince sayfayı yeniden yükler (pano
 * sunucuda çerezle açılır). Kodun süresi dolunca kendiliğinden yenisini ister. Uzaktan okunacak boyutlar, klavyesiz
 * TV'de de tek düğme.
 */
export function TvPairScreen() {
  const [state, setState] = useState<PairResponse | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  const requesting = useRef(false);

  const requestCode = useCallback(async () => {
    if (requesting.current) return;
    requesting.current = true;
    try {
      const res = await fetch("/api/tv/pair", { method: "POST", cache: "no-store", credentials: "same-origin" });
      setState((await res.json()) as PairResponse);
    } catch {
      setState({ state: "unavailable" });
    } finally {
      requesting.current = false;
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/tv/pair", { cache: "no-store", credentials: "same-origin" });
      const next = (await res.json()) as PairResponse;
      if (next.state === "paired") {
        window.location.reload();
        return;
      }
      if (next.state === "none") {
        await requestCode();
        return;
      }
      setState(next);
    } catch {
      /* ağ yok: sonraki turda yeniden denenir */
    }
  }, [requestCode]);

  useEffect(() => {
    const first = setTimeout(() => void poll(), 0);
    const id = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [poll]);

  useEffect(() => {
    if (state?.state !== "pending") return;
    const exp = Date.parse(state.expiresAt);
    const tick = () => setLeft(Math.max(0, Math.round((exp - now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);

  const code = state?.state === "pending" ? state.code : null;
  return (
    <main className="tv-pair">
      <div className="tv-pair-card">
        <h1>Ofis panosunu bu TV&apos;de açın</h1>
        {code ? (
          <>
            <p>EmlakSoft&apos;ta Pano TV &gt; TV ekranları bölümünü açın ve bu kodu girin.</p>
            <div className="tv-pair-code" aria-label={`Eşleştirme kodu ${code.split("").join(" ")}`}>
              {code}
            </div>
            <p aria-live="polite">
              {left !== null && left > 0 ? `Kod ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} dakika geçerli.` : "Yeni kod hazırlanıyor…"}
            </p>
          </>
        ) : state?.state === "unavailable" ? (
          <p>TV eşleştirme şu an kullanılamıyor. Lütfen biraz sonra yeniden deneyin.</p>
        ) : state?.state === "limited" ? (
          <p>Çok fazla kod istendi. Birkaç dakika sonra yeniden deneyin.</p>
        ) : (
          <p aria-live="polite">Kod hazırlanıyor…</p>
        )}
        <button type="button" className="tv-pair-btn" onClick={() => void requestCode()}>
          Yeni kod al
        </button>
        <p>Bu ekran oturum açmaz; yalnız ofis panosunu gösterir. Bağlantıyı ofis yöneticisi istediği an kaldırabilir.</p>
      </div>
    </main>
  );
}
