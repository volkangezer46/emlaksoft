"use client";

import { useActionState, useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { listTvDevices, pairTvDevice, revokeTvDevice, type TvDeviceRow, type TvDevicesResult } from "@/app/actions/tv-devices";

const init: TvDevicesResult = {};
const seenFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });

/**
 * TV ekranları paneli (OA6): ofis TV'sinde /tv açılır, ekrandaki kod burada girilir; TV oturum açmadan yalnız panoyu
 * gösterir (gelir kapalı, müşteri adı kısaltılmış). Bağlantı buradan anında kaldırılır. Pano TV'nin içinde, aynı
 * görsel dilde (tv-panel) açılır; dokunma hedefleri TV ölçeğinde büyüktür.
 */
export function TvDevicesPanel({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<{ available: boolean; devices: TvDeviceRow[]; error?: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const [paired, pair, pairing] = useActionState(pairTvDevice, init);
  const [revoked, revoke, revoking] = useActionState(revokeTvDevice, init);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    startLoading(async () => setList(await listTvDevices()));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, paired, revoked]);

  const message = paired.error ?? revoked.error ?? paired.info ?? revoked.info ?? list?.error ?? null;
  const isError = Boolean(paired.error ?? revoked.error ?? list?.error);
  const active = (list?.devices ?? []).filter((d) => !d.revokedAt);
  const origin = typeof window === "undefined" ? "" : window.location.host;

  return (
    <div className="tv-panel" role="dialog" aria-label="TV ekranları" onClick={(e) => e.stopPropagation()}>
      <h3>TV ekranları</h3>
      <small>
        Ofis TV&apos;sinin tarayıcısında <strong>{origin ? `${origin}/tv` : "/tv"}</strong> adresini açın ve ekrandaki kodu girin. TV oturum
        açmaz; yalnız bu panoyu gösterir, gelir gösterilmez.
      </small>
      {list && !list.available ? (
        <p className="tv-cap" style={{ marginTop: "0.8em" }}>
          TV eşleştirme bu ortamda henüz etkin değil (kurulum bekliyor).
        </p>
      ) : (
        <form action={pair} style={{ marginTop: "0.8em", display: "grid", gap: "0.6em" }}>
          <label style={{ flexDirection: "column", alignItems: "stretch" }}>
            <span className="tv-cap">TV kodu</span>
            <input className="tv-input touch:min-h-11"
              name="code"
              required
              maxLength={7}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Ör. K7M2QX"
              style={{ letterSpacing: "0.3em", textTransform: "uppercase" }}
            />
          </label>
          <label style={{ flexDirection: "column", alignItems: "stretch" }}>
            <span className="tv-cap">Ekran adı</span>
            <input className="tv-input touch:min-h-11" name="name" maxLength={60} defaultValue="Ofis TV" />
          </label>
          <Button type="submit" variant="ghost" className="tv-btn h-auto" data-primary="true" disabled={pairing}>
            {pairing ? "Eşleştiriliyor…" : "Eşleştir"}
          </Button>
        </form>
      )}
      {message ? (
        <p role={isError ? "alert" : "status"} style={{ marginTop: "0.6em", fontWeight: 700 }}>
          {message}
        </p>
      ) : null}
      <fieldset style={{ marginTop: "1em" }}>
        <legend className="tv-cap">Bağlı ekranlar {loading ? "· yükleniyor…" : `(${active.length})`}</legend>
        {active.length === 0 && !loading ? <small>Henüz bağlı ekran yok.</small> : null}
        {active.map((d) => (
          <div key={d.id} style={{ display: "flex", alignItems: "center", gap: "0.6em", justifyContent: "space-between" }}>
            <span style={{ minWidth: 0 }}>
              <strong>{d.name}</strong>
              <br />
              <small>{d.lastSeenAt ? `Son görülme: ${seenFmt.format(new Date(d.lastSeenAt))}` : "Henüz bağlanmadı"}</small>
            </span>
            {confirmId === d.id ? (
              <form
                action={(fd) => {
                  fd.set("id", d.id);
                  setConfirmId(null);
                  revoke(fd);
                }}
              >
                <Button type="submit" variant="ghost" className="tv-btn h-auto" disabled={revoking}>
                  Evet, kaldır
                </Button>
              </form>
            ) : (
              <Button type="button" variant="ghost" className="tv-btn h-auto" onClick={() => setConfirmId(d.id)} aria-label={`${d.name} ekranının bağlantısını kaldır`}>
                Kaldır
              </Button>
            )}
          </div>
        ))}
      </fieldset>
      <Button type="button" variant="ghost" className="tv-btn h-auto" onClick={onClose}>
        Kapat
      </Button>
    </div>
  );
}
