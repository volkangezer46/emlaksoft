"use client";

import { buttonClass } from "@/components/ui/button";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Sparkles } from "lucide-react";
import {
  grantEfCreditAction,
  saveEfPacks,
  saveEfTariff,
  type EfKontorResult,
} from "./actions";
import {
  efPackSchema,
  efPackUnitPriceTry,
  efPackWarnings,
  type EfPack,
  type EfTariff,
} from "@/lib/ef-credits/config";
import {
  ADMIN_GRANT_KINDS,
  ADMIN_GRANT_KIND_LABEL,
  EF_PACK_PRESET_NOTE,
  examplePackPreset,
  packIdFromName,
} from "@/lib/ef-credits/admin-grant";

const field =
  "min-h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-sm text-ink-950 disabled:opacity-60";
const lbl = "block text-xs font-semibold text-text-muted";
const primary = buttonClass({ variant: "primary", size: "md" });
const ghost = buttonClass({ variant: "outline", size: "md" });
const fmt2 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Satır içi iki adımlı onay (popup yok): Kaydet -> Onayla / Vazgeç. */
function ConfirmSave({
  label,
  disabled,
  run,
  summary,
}: {
  label: string;
  disabled?: boolean;
  run: () => Promise<EfKontorResult>;
  summary?: ReactNode;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-line bg-canvas/60 p-3">
          <p className="text-xs font-semibold text-ink-950">{summary ?? "Değişiklikler kaydedilsin mi?"}</p>
          <button
            type="button"
            disabled={pending}
            className={primary}
            onClick={() =>
              start(async () => {
                const r = await run();
                setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Kaydedildi." });
                if (!r.error) {
                  setConfirming(false);
                  router.refresh();
                }
              })
            }
          >
            Onayla
          </button>
          <button type="button" disabled={pending} className={ghost} onClick={() => setConfirming(false)}>
            Vazgeç
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          className={primary}
          onClick={() => {
            setMsg(null);
            setConfirming(true);
          }}
        >
          {label}
        </button>
      )}
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function TariffForm({ tariff, canWrite }: { tariff: EfTariff; canWrite: boolean }) {
  const [v, setV] = useState({
    valuationArsa: String(tariff.valuationArsa),
    valuationKonut: String(tariff.valuationKonut),
    pdfFirst: String(tariff.pdfFirst),
    reportDetail: String(tariff.reportDetail),
    valuationTicari: String(tariff.valuationTicari),
    listingAnalysis: String(tariff.listingAnalysis),
  });
  const items: { k: keyof typeof v; label: string; hint?: string }[] = [
    { k: "valuationArsa", label: "Arsa değerlemesi" },
    { k: "valuationKonut", label: "Konut değerlemesi" },
    { k: "valuationTicari", label: "Ticari değerlemesi" },
    { k: "listingAnalysis", label: "İlan analizi", hint: "Hızlı tahmin; varsayılan 1 kontör." },
    { k: "pdfFirst", label: "PDF (ilk indirme)", hint: "Varsayılan 0: rapor bedeline dahil. Tekrar indirme her zaman 0." },
    { k: "reportDetail", label: "Rapor detayı (JSON)", hint: "Ürün kararı: varsayılan 0." },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {items.map((i) => (
          <label key={i.k} className="space-y-1">
            <span className={lbl}>{i.label} (kontör)</span>
            <input
              type="number"
              min={0}
              max={10000}
              step={1}
              inputMode="numeric"
              disabled={!canWrite}
              value={v[i.k]}
              onChange={(e) => setV({ ...v, [i.k]: e.target.value })}
              className={field}
            />
            {i.hint ? <span className="block text-xs text-text-faint">{i.hint}</span> : null}
          </label>
        ))}
      </div>
      {canWrite ? (
        <ConfirmSave
          label="Tarifeyi kaydet"
          summary="Yeni tarife bundan sonraki işlemlere uygulanır. Kaydedilsin mi?"
          run={() => {
            const fd = new FormData();
            for (const [k, val] of Object.entries(v)) fd.set(k, val);
            return saveEfTariff(fd);
          }}
        />
      ) : (
        <p className="text-xs text-text-muted">Yalnız süper admin değiştirebilir (salt okunur).</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
type Draft = EfPack & { isNew?: boolean };

export function PacksEditor({ initial, tariff, canWrite }: { initial: EfPack[]; tariff: EfTariff; canWrite: boolean }) {
  const [rows, setRows] = useState<Draft[]>(initial);
  const [presetNote, setPresetNote] = useState(false);
  const update = (i: number, patch: Partial<Draft>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next.map((x, k) => ({ ...x, order: (k + 1) * 10 }));
    });
  function add() {
    setRows((r) => {
      let n = r.length + 1;
      while (r.some((x) => x.id === `paket-${n}`)) n++;
      return [...r, { id: `paket-${n}`, name: `Paket ${n}`, units: 10, priceNetTry: 100, active: false, order: (r.length + 1) * 10, isNew: true }];
    });
  }
  const clean: EfPack[] = rows.map((r) => ({
    id: r.id,
    name: r.name.trim(),
    units: Number(r.units),
    priceNetTry: Number(r.priceNetTry),
    active: r.active,
    popular: r.popular ? true : undefined,
    order: r.order,
  }));
  const invalid = clean.some((p) => !efPackSchema.safeParse(p).success) || new Set(clean.map((p) => p.id)).size !== clean.length;
  const warnings = invalid ? [] : efPackWarnings(clean);
  const retailUnits = tariff.valuationKonut;

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={ghost}
            onClick={() => {
              setRows(examplePackPreset());
              setPresetNote(true);
            }}
          >
            <Sparkles className="h-4 w-4" /> Önerilen kataloğu uygula (5 paket)
          </button>
          <button type="button" className={ghost} onClick={add} disabled={rows.length >= 12}>
            <Plus className="h-4 w-4" /> Paket ekle
          </button>
        </div>
      ) : null}
      {presetNote ? (
        <p role="status" className="rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-700">
          Önerilen katalog TASLAĞA uygulandı, henüz KAYDEDİLMEDİ. {EF_PACK_PRESET_NOTE}
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
          Katalog boş: ofisler kontör satın alamaz. Fiyat sahibin kararıdır; &quot;Paket ekle&quot; ile başlayın ya da örnek ön ayarı taslak olarak görün.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r, i) => {
            const unit = efPackUnitPriceTry({ units: Number(r.units), priceNetTry: Number(r.priceNetTry) });
            return (
              <li key={r.id} className={`rounded-[var(--radius-card)] border p-3 ${r.active ? "border-line bg-canvas/50" : "border-line bg-canvas/20 opacity-80"}`}>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
                  <label className="space-y-1">
                    <span className={lbl}>Ad ({r.id})</span>
                    <input
                      disabled={!canWrite}
                      value={r.name}
                      maxLength={60}
                      onChange={(e) =>
                        update(i, {
                          name: e.target.value,
                          ...(r.isNew && !rows.some((x, j) => j !== i && x.id === packIdFromName(e.target.value)) ? { id: packIdFromName(e.target.value) } : {}),
                        })
                      }
                      className={field}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className={lbl}>Kontör</span>
                    <input type="number" min={1} max={100000} disabled={!canWrite} value={r.units} onChange={(e) => update(i, { units: Number(e.target.value) })} className={field} />
                  </label>
                  <label className="space-y-1">
                    <span className={lbl}>Net fiyat, KDV hariç (₺)</span>
                    <input type="number" min={1} step="0.01" disabled={!canWrite} value={r.priceNetTry} onChange={(e) => update(i, { priceNetTry: Number(e.target.value) })} className={field} />
                  </label>
                  <div className="flex items-end gap-1">
                    <button type="button" aria-label="Yukarı taşı" disabled={!canWrite || i === 0} onClick={() => move(i, -1)} className={ghost}>
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label="Aşağı taşı" disabled={!canWrite || i === rows.length - 1} onClick={() => move(i, 1)} className={ghost}>
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-muted">
                  <label className="inline-flex items-center gap-1.5 font-semibold">
                    <input type="checkbox" disabled={!canWrite} checked={r.active} onChange={(e) => update(i, { active: e.target.checked })} /> Satışta (aktif)
                  </label>
                  <label className="inline-flex items-center gap-1.5 font-semibold">
                    <input
                      type="checkbox"
                      disabled={!canWrite}
                      checked={Boolean(r.popular)}
                      onChange={(e) => setRows((all) => all.map((x, j) => ({ ...x, popular: j === i ? e.target.checked : false })))}
                    />{" "}
                    Popüler
                  </label>
                  <span className="numeric">Kontör başı net: {fmt2.format(unit)} ₺</span>
                  <span>
                    1 değerleme = {retailUnits} kontör ≈ {fmt2.format(unit * retailUnits)} ₺ net (bu paketten). Karşılaştırma için EmlakFiyati perakende fiyatına bakın; bilgi amaçlıdır.
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {invalid ? (
        <p role="alert" className="text-xs font-semibold text-danger-600">Eksik/geçersiz alan var (ad en az 2 karakter, kontör ve net fiyat en az 1, kimlikler benzersiz).</p>
      ) : null}
      {warnings.length > 0 ? (
        <ul role="status" className="space-y-1 rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-700">
          {warnings.map((w) => (
            <li key={w}>Uyarı: {w}</li>
          ))}
        </ul>
      ) : null}
      {canWrite ? (
        <ConfirmSave
          label="Kataloğu kaydet"
          disabled={invalid}
          summary={`${clean.length} paket (${clean.filter((p) => p.active).length} aktif) kaydedilsin mi? Yeni fiyatlar hemen ofis ekranlarına yansır.`}
          run={() => {
            const fd = new FormData();
            fd.set("packs", JSON.stringify(clean));
            return saveEfPacks(fd);
          }}
        />
      ) : (
        <p className="text-xs text-text-muted">Yalnız süper admin değiştirebilir (salt okunur).</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function GrantForm({ tenantId, tenantName, disabledReason }: { tenantId: string; tenantName: string; disabledReason: string | null }) {
  const router = useRouter();
  const [units, setUnits] = useState("");
  const [kind, setKind] = useState<(typeof ADMIN_GRANT_KINDS)[number]>("admin");
  const [reason, setReason] = useState("");
  // Tek kullanımlık idempotency anahtarı: girdi değişince ve başarılı yüklemeden sonra yenilenir; aynı gönderim tekrarında aynı kalır.
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const off = Boolean(disabledReason);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || off) return;
        if (!confirming) {
          setMsg(null);
          setConfirming(true);
          return;
        }
        const fd = new FormData();
        fd.set("tenantId", tenantId);
        fd.set("units", units);
        fd.set("kind", kind);
        fd.set("reason", reason);
        fd.set("idemKey", idemKey);
        start(async () => {
          const r = await grantEfCreditAction(fd);
          setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Yüklendi." });
          setConfirming(false);
          if (!r.error) {
            setUnits("");
            setReason("");
            setIdemKey(crypto.randomUUID());
            router.refresh();
          }
        });
      }}
    >
      {disabledReason ? <p className="text-xs font-semibold text-amber-700">{disabledReason}</p> : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
        <label className="space-y-1">
          <span className={lbl}>Tür</span>
          <select disabled={off} value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setIdemKey(crypto.randomUUID()); }} className={field}>
            {ADMIN_GRANT_KINDS.map((k) => (
              <option key={k} value={k}>{ADMIN_GRANT_KIND_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className={lbl}>Kontör (yalnız artı)</span>
          <input type="number" min={1} max={100000} step={1} disabled={off} value={units} onChange={(e) => { setUnits(e.target.value); setIdemKey(crypto.randomUUID()); setConfirming(false); }} className={field} required />
        </label>
        <label className="space-y-1">
          <span className={lbl}>Gerekçe (zorunlu, denetim kaydına yazılır)</span>
          <input disabled={off} value={reason} maxLength={300} onChange={(e) => { setReason(e.target.value); setIdemKey(crypto.randomUUID()); setConfirming(false); }} className={field} required minLength={10} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <p className="text-xs font-semibold text-ink-950">{tenantName} ofisine {units} kontör ({ADMIN_GRANT_KIND_LABEL[kind]}) yüklensin mi?</p>
            <button type="submit" disabled={pending} className={primary}>Onayla</button>
            <button type="button" disabled={pending} className={ghost} onClick={() => setConfirming(false)}>Vazgeç</button>
          </>
        ) : (
          <button type="submit" disabled={off || pending || !units || reason.trim().length < 10} className={primary}>Yükle</button>
        )}
      </div>
      {msg ? (
        <p role={msg.ok ? "status" : "alert"} className={`text-xs font-semibold ${msg.ok ? "text-mint-700" : "text-danger-600"}`}>{msg.text}</p>
      ) : null}
    </form>
  );
}
