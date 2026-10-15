"use client";

import { useState, useTransition } from "react";
import { MapPinned, Plus, Trash2 } from "lucide-react";
import { saveNearbyPlaces } from "@/app/actions/property-nearby";
import { useToast } from "@/components/app/toast-provider";
import { Button } from "@/components/ui/button";
import { FormInput, FormSelect } from "@/components/ui/form-controls";
import {
  NEARBY_CATEGORIES,
  NEARBY_MAX_ITEMS,
  formatDistance,
  nearbyCategoryLabel,
  type NearbyPlace,
} from "@/lib/vitrin/nearby";

type Row = { key: number; c: string; n: string; m: string };

let seq = 0;
const toRow = (p?: NearbyPlace): Row => ({ key: ++seq, c: p?.c ?? "okul", n: p?.n ?? "", m: p ? String(p.m) : "" });
const emptyRow = (c: string): Row => ({ key: ++seq, c, n: "", m: "" });

/**
 * Portföy "Çevrede neler var" düzenleyicisi (PUB-8): okul, metro, hastane, market ... ad ve mesafe (m ya da "1,2 km").
 * Vitrin ilan detayında kategori başına en yakın 3 yer gösterilir. Dış harita servisi kullanılmaz (anahtar ve kota yok).
 */
export function NearbyPlacesCard({
  propertyId,
  initial,
  canEdit,
  available,
}: {
  propertyId: string;
  initial: NearbyPlace[];
  canEdit: boolean;
  available: boolean;
}) {
  const [saved, setSaved] = useState<NearbyPlace[]>(initial);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { push } = useToast();
  const editing = rows !== null;

  function begin() {
    setError(null);
    // İlk kez: en çok sorulan iki tür hazır gelir (okul, metro); boş bırakılan satır kaydedilmez.
    setRows(saved.length ? saved.map((p) => toRow(p)) : [emptyRow("okul"), emptyRow("metro")]);
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function save() {
    if (!rows) return;
    setError(null);
    start(async () => {
      const res = await saveNearbyPlaces(
        propertyId,
        rows.map(({ c, n, m }) => ({ c, n, m })),
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved(res.places ?? []);
      setRows(null);
      push("Çevre bilgisi kaydedildi; vitrin ilanında görünür.", "ok");
    });
  }

  return (
    <section className="surface-card rounded-[var(--radius-panel)] p-5" aria-labelledby="cevre-noktalari-baslik">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="cevre-noktalari-baslik" className="flex items-center gap-2 font-display font-bold text-ink-950">
            <MapPinned className="h-4 w-4 text-brand-600" aria-hidden /> Çevrede neler var
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Okul, metro, hastane, market gibi yakın yerler ve mesafeleri. Vitrin ilanında alıcıya gösterilir.
          </p>
        </div>
        {!editing && canEdit ? (
          <Button size="sm" variant="secondary" onClick={begin}>
            {saved.length ? "Düzenle" : "Ekle"}
          </Button>
        ) : null}
      </div>

      {!available ? (
        <p className="mt-3 rounded-[var(--radius-card)] bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-700">
          Bu özellik için veritabanı güncellemesi bekleniyor.
        </p>
      ) : null}

      {!editing && available ? (
        saved.length ? (
          <ul className="mt-3 divide-y divide-line">
            {saved.map((p, i) => (
              <li key={`${p.c}-${p.n}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold text-ink-950">{p.n}</span>
                  <span className="ml-2 text-xs text-text-muted">{nearbyCategoryLabel(p.c)}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-text-muted">{formatDistance(p.m)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-text-muted">Henüz yer eklenmedi; vitrin ilanında bu bölüm görünmez.</p>
        )
      ) : null}

      {editing ? (
        <div className="mt-4 space-y-3">
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-[var(--radius-card)] border border-line p-2.5 sm:grid-cols-[11rem_1fr_7rem_auto] sm:border-0 sm:p-0">
              <FormSelect
                aria-label={`${i + 1}. yer türü`}
                value={r.c}
                onChange={(e) => update(r.key, { c: e.target.value })}
                className="col-span-2 sm:col-span-1"
              >
                {NEARBY_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </FormSelect>
              <FormInput
                aria-label={`${i + 1}. yerin adı`}
                value={r.n}
                maxLength={60}
                placeholder="Örn. Moda İlkokulu"
                onChange={(e) => update(r.key, { n: e.target.value })}
                className="col-span-2 sm:col-span-1"
              />
              <FormInput
                aria-label={`${i + 1}. yerin mesafesi (metre ya da km)`}
                value={r.m}
                inputMode="decimal"
                placeholder="Örn. 450 ya da 1,2 km"
                onChange={(e) => update(r.key, { m: e.target.value })}
              />
              <Button
                size="icon"
                variant="ghost"
                icon={Trash2}
                aria-label={`${i + 1}. yeri kaldır`}
                onClick={() => setRows((rs) => (rs ?? []).filter((x) => x.key !== r.key))}
              />
            </div>
          ))}
          {rows.length < NEARBY_MAX_ITEMS ? (
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setRows((rs) => [...(rs ?? []), emptyRow("market")])}>
              Yer ekle
            </Button>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs font-semibold text-danger-600">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setRows(null)} disabled={pending}>
              Vazgeç
            </Button>
            <Button onClick={save} loading={pending}>
              Kaydet
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
