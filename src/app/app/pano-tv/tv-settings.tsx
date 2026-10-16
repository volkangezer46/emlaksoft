"use client";

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { saveTvConfigAction } from "@/app/actions/tv-config";
import { Button } from "@/components/ui/button";
import { SCENE_SECONDS, TV_SCENE_META, type TvConfig, type TvSceneSetting } from "@/lib/tv/tv-logic";

const ico = { width: "1em", height: "1em" } as const;

/**
 * Pano TV ayar çekmecesi (ofis sahibi / müdür). Ofis ayarına (`office.tv.config`) yazar: ofisin BÜTÜN ekranları bir
 * sonraki yenilemede aynı düzeni alır. Eşleşmiş cihazda açılmaz. Yetki sunucuda (`settings:edit` + TV rolü).
 */
export function TvSettingsDrawer({
  config,
  moneyPossible,
  onClose,
  onSaved,
}: {
  config: TvConfig;
  moneyPossible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<TvConfig>(() => structuredClone(config));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, start] = useTransition();

  const setScene = (i: number, patch: Partial<TvSceneSetting>) =>
    setDraft((d) => ({ ...d, scenes: d.scenes.map((s, k) => (k === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = i + dir;
      if (j < 0 || j >= d.scenes.length) return d;
      const scenes = [...d.scenes];
      [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
      return { ...d, scenes };
    });

  const save = () =>
    start(async () => {
      const res = await saveTvConfigAction(draft);
      if (res.error) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: "Kaydedildi. Ofisin bütün TV ekranları bir sonraki yenilemede yeni düzeni alır." });
        onSaved();
      }
    });

  const onCount = draft.scenes.filter((s) => s.on).length;

  return (
    <div className="tv-drawer" role="dialog" aria-modal="true" aria-label="TV ayarları" onClick={(e) => e.stopPropagation()}>
      <div className="tv-drawer-head">
        <h3>TV ayarları</h3>
        <Button type="button" variant="ghost" className="tv-icon-btn h-auto" onClick={onClose} aria-label="Kapat">
          <X style={ico} />
        </Button>
      </div>
      <p className="tv-drawer-note">Ofis ayarı olarak kaydedilir; ofisin bütün ekranlarında geçerlidir.</p>

      <fieldset className="tv-fieldset">
        <legend>Sahneler · sıra ve süre</legend>
        <ol className="tv-scene-list">
          {draft.scenes.map((s, i) => (
            <li key={s.id} data-off={!s.on}>
              <label className="tv-switch">
                <input type="checkbox" checked={s.on} disabled={s.on && onCount === 1} onChange={(e) => setScene(i, { on: e.target.checked })} />
                <span>
                  <b>{TV_SCENE_META[s.id].label}</b>
                  <small>{TV_SCENE_META[s.id].hint}</small>
                </span>
              </label>
              <select aria-label={`${TV_SCENE_META[s.id].label} süresi`} value={s.sec} onChange={(e) => setScene(i, { sec: Number(e.target.value) })} disabled={!s.on}>
                {[...new Set([...SCENE_SECONDS, s.sec])]
                  .sort((a, b) => a - b)
                  .map((sec) => (
                    <option key={sec} value={sec}>
                      {sec} sn
                    </option>
                  ))}
              </select>
              <span className="tv-move">
                <Button type="button" variant="ghost" className="tv-icon-btn h-auto" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${TV_SCENE_META[s.id].label} yukarı`}>
                  <ArrowUp style={ico} />
                </Button>
                <Button type="button" variant="ghost" className="tv-icon-btn h-auto" onClick={() => move(i, 1)} disabled={i === draft.scenes.length - 1} aria-label={`${TV_SCENE_META[s.id].label} aşağı`}>
                  <ArrowDown style={ico} />
                </Button>
              </span>
            </li>
          ))}
        </ol>
        <small>İçeriği olmayan sahne (ör. duyuru yoksa) yayında kendiliğinden atlanır. Sabah 11:00&apos;e kadar &quot;Bugün&quot;, 16:00&apos;dan sonra &quot;Danışman ligi&quot; biraz daha uzun kalır.</small>
      </fieldset>

      <fieldset className="tv-fieldset">
        <legend>Görünüm</legend>
        <div className="tv-seg" role="radiogroup" aria-label="Tema">
          {(["dark", "light"] as const).map((t) => (
            <label key={t} data-on={draft.theme === t}>
              <input type="radio" name="tv-theme" checked={draft.theme === t} onChange={() => setDraft((d) => ({ ...d, theme: t }))} />
              {t === "dark" ? "Koyu" : "Açık"}
            </label>
          ))}
        </div>
        <label className="tv-switch">
          <input type="checkbox" checked={draft.nightMode} onChange={(e) => setDraft((d) => ({ ...d, nightMode: e.target.checked }))} />
          <span>
            <b>Gece modu</b>
            <small>22:00–07:00 arası yalnız saat, düşük parlaklık (ekran ömrü).</small>
          </span>
        </label>
        <label className="tv-switch">
          <input type="checkbox" checked={draft.showMoney} onChange={(e) => setDraft((d) => ({ ...d, showMoney: e.target.checked }))} />
          <span>
            <b>Tutarları göster (ciro, kazanç)</b>
            <small>
              Varsayılan kapalı; odadaki herkes görür. Yalnız tüm kazançları görme izni olan oturumda çalışır, eşleşmiş TV cihazında hiç gösterilmez
              {draft.showMoney && !moneyPossible ? " (bu hesapta izin yok)." : "."}
            </small>
          </span>
        </label>
      </fieldset>

      {msg ? (
        <p className="tv-drawer-msg" data-ok={msg.ok} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      ) : null}
      <div className="tv-drawer-actions">
        <Button type="button" variant="ghost" className="tv-btn h-auto" onClick={onClose}>
          Vazgeç
        </Button>
        <Button type="button" variant="ghost" className="tv-btn h-auto" data-primary="true" onClick={save} disabled={saving}>
          {saving ? "Kaydediliyor…" : "Kaydet"}
        </Button>
      </div>
    </div>
  );
}
