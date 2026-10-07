"use client";

import { useState, useTransition } from "react";
import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { ChevronRight, GitMerge, Lightbulb, MoveRight, Pencil, Power, Tag, X } from "lucide-react";
import {
  addGeoAlias,
  loadGeoAliases,
  loadGeoImpact,
  mergeGeoEntity,
  moveGeoEntity,
  removeGeoAlias,
  setGeoActive,
  submitGeoSuggestion,
  updateGeoEntity,
  type GeoActionResult,
  type GeoImpact,
} from "@/app/actions/geo-admin";
import { listDistricts, type GeoOption } from "@/app/actions/geo";
import type { GeoLevel } from "@/lib/geo/types";

export type EntityRowData = {
  id: string;
  name: string;
  parentId: string | null;
  isActive: boolean;
  lat: number | null;
  lng: number | null;
  postalCode: string | null;
  population: number | null;
  usage: number | null;
  /** Alt kayıt sayısı (ilçe için mahalle sayısı) — varsa alt sayfaya bağlanır. */
  childCount?: number;
};

type Panel = null | "edit" | "deactivate" | "alias" | "move" | "merge" | "suggest";

const input =
  "rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-brand-400";
const ghostBtn =
  "focus-ring inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] px-2 text-xs font-semibold text-text-muted hover:bg-canvas";

type Props = {
  level: GeoLevel;
  rows: EntityRowData[];
  canWrite: boolean;
  provinceId?: string;
  provinceOptions: GeoOption[];
  /** Alt sayfa kök yolu (satır kimliği eklenir): ilçe → mahalleler. Sunucudan işlev geçilemez. */
  childBase?: string;
  childLabel?: string;
};

function ImpactSummary({ impact }: { impact: GeoImpact | null }) {
  if (!impact) return <p className="text-xs text-text-muted">Etki hesaplanıyor…</p>;
  if (!impact.usage) {
    return <p className="text-xs text-text-muted">Kullanım sayımı bu ortamda etkin değil (geo migration uygulanmamış); referanslar yine de korunur.</p>;
  }
  const rest = impact.usage.filter((u) => !u.table.startsWith("geo_"));
  return (
    <div className="text-xs text-text-muted">
      <p className="font-semibold text-ink-950">{impact.path}</p>
      {rest.length === 0 ? (
        <p>Hiçbir kayıt bu bölgeyi kullanmıyor.</p>
      ) : (
        <p>
          Kullanan kayıtlar:{" "}
          {rest.map((u, i) => (
            <span key={`${u.table}.${u.column}`}>
              {i ? ", " : ""}
              <b>{u.n}</b> {u.label}
            </span>
          ))}
        </p>
      )}
      {impact.childCount ? <p>Bağlı alt bölge: <b>{impact.childCount}</b></p> : null}
    </div>
  );
}

function Row({ level, row, siblings, canWrite, provinceOptions, childHref, childLabel, selected, onToggle }: {
  level: GeoLevel;
  row: EntityRowData;
  siblings: EntityRowData[];
  canWrite: boolean;
  provinceOptions: GeoOption[];
  childHref?: (row: EntityRowData) => string;
  childLabel?: string;
  selected: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [impact, setImpact] = useState<GeoImpact | null>(null);
  const [aliases, setAliases] = useState<Array<{ id: string; alias: string; kind: string; validTo: string | null }> | null>(null);
  const [aliasesAvailable, setAliasesAvailable] = useState(true);
  const [moveProvince, setMoveProvince] = useState("");
  const [moveDistricts, setMoveDistricts] = useState<GeoOption[]>([]);
  const [target, setTarget] = useState("");

  function open(p: Exclude<Panel, null>) {
    setMsg(null);
    setPanel(p);
    setTarget("");
    if (p === "deactivate" || p === "merge" || p === "move") {
      setImpact(null);
      start(async () => setImpact(await loadGeoImpact(level, row.id)));
    }
    if (p === "alias") {
      start(async () => {
        const r = await loadGeoAliases(level, row.id);
        setAliasesAvailable(r.aliases !== null);
        setAliases(r.aliases ?? []);
      });
    }
  }

  function run(fn: () => Promise<GeoActionResult>, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (r.ok) {
        setMsg({ ok: true, text: r.message ?? "Kaydedildi." });
        after?.();
        router.refresh();
      } else setMsg({ ok: false, text: r.error ?? "İşlem yapılamadı." });
    });
  }

  const fd = (entries: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  };

  const close = () => { setPanel(null); setMsg(null); };

  return (
    <div className={`border-b border-line ${row.isActive ? "" : "bg-canvas/60"}`}>
      <div className="grid gap-3 px-5 py-3 transition hover:bg-canvas/60 lg:grid-cols-[auto_1fr_auto_auto] lg:items-center">
        {canWrite ? (
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`${row.name} seç`} className="h-4 w-4" />
        ) : <span />}
        <div>
          <p className={`font-display text-sm font-bold ${row.isActive ? "text-ink-950" : "text-text-muted line-through"}`}>
            {childHref ? (
              <Link href={childHref(row)} className="transition hover:text-brand-600">{row.name}</Link>
            ) : row.name}
            {!row.isActive ? <span className="ml-2 rounded-full bg-danger-500/10 px-2 py-0.5 text-xs font-bold text-danger-500 no-underline">Pasif</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {row.usage === null ? (
              <span>Kullanım: —</span>
            ) : (
              <Link
                href={`/admin/geo/kullanim?level=${level}&id=${row.id}`}
                className="font-semibold transition hover:text-brand-600 hover:underline"
              >
                {row.usage.toLocaleString("tr-TR")} kayıt kullanıyor
              </Link>
            )}
            {row.postalCode ? ` · PK ${row.postalCode}` : ""}
            {row.population ? ` · ${row.population.toLocaleString("tr-TR")} nüfus` : ""}
            {typeof row.childCount === "number" && childHref ? (
              <>
                {" · "}
                <Link href={childHref(row)} className="transition hover:text-brand-600 hover:underline">{row.childCount} {childLabel}</Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          {canWrite ? (
            <>
              <button type="button" className={ghostBtn} onClick={() => open("edit")} aria-label={`${row.name} düzenle`}><Pencil className="h-3.5 w-3.5" /> Düzenle</button>
              <button type="button" className={ghostBtn} onClick={() => open("alias")} aria-label={`${row.name} takma adları`}><Tag className="h-3.5 w-3.5" /> Takma ad</button>
              {level !== "province" ? (
                <>
                  <button type="button" className={ghostBtn} onClick={() => open("move")} aria-label={`${row.name} taşı`}><MoveRight className="h-3.5 w-3.5" /> Taşı</button>
                  <button type="button" className={ghostBtn} onClick={() => open("merge")} aria-label={`${row.name} birleştir`}><GitMerge className="h-3.5 w-3.5" /> Birleştir</button>
                </>
              ) : null}
              <button type="button" className={ghostBtn} onClick={() => open("deactivate")} aria-label={`${row.name} ${row.isActive ? "pasife al" : "etkinleştir"}`}>
                <Power className="h-3.5 w-3.5" /> {row.isActive ? "Pasife al" : "Etkinleştir"}
              </button>
            </>
          ) : (
            <button type="button" className={ghostBtn} onClick={() => open("suggest")}><Lightbulb className="h-3.5 w-3.5" /> Düzeltme öner</button>
          )}
        </div>
        {childHref ? (
          <Link href={childHref(row)} className="inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-400 hover:text-brand-600">
            {childLabel ?? "Alt"} <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : <span />}
      </div>

      {panel ? (
        <div className="space-y-3 border-t border-line bg-brand-600/[0.03] px-5 py-4">
          <div className="flex justify-end">
            <button type="button" onClick={close} aria-label="Paneli kapat" className="focus-ring grid h-7 w-7 place-items-center rounded-[var(--radius-control)] text-text-muted hover:bg-canvas"><X className="h-4 w-4" /></button>
          </div>

          {panel === "edit" ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                f.set("level", level);
                f.set("id", row.id);
                run(() => updateGeoEntity(f), close);
              }}
            >
              <input name="name" required defaultValue={row.name} aria-label="Ad" className={`${input} min-w-[200px] flex-1 font-semibold`} />
              <input name="lat" defaultValue={row.lat ?? ""} placeholder="Enlem" aria-label="Enlem" className={`${input} w-28`} />
              <input name="lng" defaultValue={row.lng ?? ""} placeholder="Boylam" aria-label="Boylam" className={`${input} w-28`} />
              {level === "neighborhood" ? <input name="postal_code" defaultValue={row.postalCode ?? ""} placeholder="Posta kodu" aria-label="Posta kodu" className={`${input} w-28`} /> : null}
              <input name="description" placeholder="Açıklama (ops.)" aria-label="Açıklama" className={`${input} min-w-[160px] flex-1`} />
              <button type="submit" disabled={pending} className="rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">{pending ? "Kaydediliyor…" : "Kaydet"}</button>
              <p className="w-full text-xs text-text-muted">Ad değişirse eski ad otomatik takma ad olur; eski kayıtlar ve yazımlar bulunabilir kalır.</p>
            </form>
          ) : null}

          {panel === "deactivate" ? (
            <div className="space-y-2">
              <ImpactSummary impact={impact} />
              <p className="text-xs text-text-muted">
                {row.isActive
                  ? "Pasife alınan kayıt yeni seçimlerde görünmez; ilan/talep/müşteri gibi mevcut kayıtlarda korunur. Silme yoktur."
                  : "Etkinleştirilen kayıt yeni seçimlerde yeniden görünür."}
              </p>
              <button
                type="button"
                disabled={pending || !impact}
                onClick={() => run(() => setGeoActive(fd({ level, ids: row.id, active: row.isActive ? "false" : "true" })), close)}
                className={`rounded-[var(--radius-control)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60 ${row.isActive ? "bg-danger-500" : "bg-brand-600"}`}
              >
                {row.isActive ? "Pasife almayı onayla" : "Etkinleştirmeyi onayla"}
              </button>
            </div>
          ) : null}

          {panel === "alias" ? (
            <div className="space-y-2">
              {!aliasesAvailable ? (
                <p className="text-xs text-text-muted">Takma ad altyapısı bu ortamda etkin değil (geo migration uygulanmamış).</p>
              ) : (
                <>
                  <ul className="flex flex-wrap gap-2">
                    {(aliases ?? []).map((a) => (
                      <li key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs">
                        <span className="font-semibold">{a.alias}</span>
                        <span className="text-text-muted">{a.kind === "old_name" ? "eski ad" : a.kind === "merged" ? "birleşen" : "varyant"}{a.validTo ? ` · ${a.validTo}` : ""}</span>
                        <button type="button" aria-label={`${a.alias} takma adını sil`} className="text-text-muted hover:text-danger-500" onClick={() => run(() => removeGeoAlias(fd({ alias_id: a.id })), () => setAliases((l) => (l ?? []).filter((x) => x.id !== a.id)))}><X className="h-3 w-3" /></button>
                      </li>
                    ))}
                    {(aliases ?? []).length === 0 ? <li className="text-xs text-text-muted">Takma ad yok.</li> : null}
                  </ul>
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const f = new FormData(form);
                      f.set("level", level);
                      f.set("id", row.id);
                      run(() => addGeoAlias(f), () => {
                        form.reset();
                        start(async () => setAliases((await loadGeoAliases(level, row.id)).aliases ?? []));
                      });
                    }}
                  >
                    <input name="alias" required minLength={2} placeholder="Takma ad / yazım varyantı" aria-label="Takma ad" className={`${input} min-w-[200px] flex-1`} />
                    <select name="kind" aria-label="Tür" className={input} defaultValue="variant">
                      <option value="variant">Yazım varyantı</option>
                      <option value="old_name">Eski ad</option>
                    </select>
                    <input name="valid_to" type="date" aria-label="Eski ad geçerlilik sonu" className={input} />
                    <button type="submit" disabled={pending} className="rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">Ekle</button>
                  </form>
                </>
              )}
            </div>
          ) : null}

          {panel === "move" && level !== "province" ? (
            <div className="space-y-2">
              <ImpactSummary impact={impact} />
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Hedef il"
                  value={moveProvince}
                  className={input}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMoveProvince(v);
                    setTarget(level === "district" ? v : "");
                    setMoveDistricts([]);
                    if (level === "neighborhood" && v) start(async () => setMoveDistricts(await listDistricts(v)));
                  }}
                >
                  <option value="">Hedef il…</option>
                  {provinceOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {level === "neighborhood" ? (
                  <select aria-label="Hedef ilçe" value={target} onChange={(e) => setTarget(e.target.value)} className={input} disabled={moveDistricts.length === 0}>
                    <option value="">Hedef ilçe…</option>
                    {moveDistricts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                ) : null}
                <button type="button" disabled={pending || !target} onClick={() => run(() => moveGeoEntity(fd({ level, id: row.id, new_parent_id: target })), close)} className="rounded-[var(--radius-control)] bg-ink-950 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
                  Taşımayı onayla
                </button>
              </div>
              <p className="text-xs text-text-muted">Bağlı ilan/talep/müşterilerin il ve ilçe sütunları aynı işlemde güncellenir.</p>
            </div>
          ) : null}

          {panel === "merge" && level !== "province" ? (
            <div className="space-y-2">
              <ImpactSummary impact={impact} />
              <div className="flex flex-wrap items-center gap-2">
                <select aria-label="Birleştirilecek hedef kayıt" value={target} onChange={(e) => setTarget(e.target.value)} className={input}>
                  <option value="">Hedef kayıt (bunun içine birleşir)…</option>
                  {siblings.filter((s) => s.id !== row.id && s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button type="button" disabled={pending || !target} onClick={() => run(() => mergeGeoEntity(fd({ level, from_id: row.id, to_id: target })), close)} className="rounded-[var(--radius-control)] bg-danger-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60">
                  Birleştirmeyi onayla
                </button>
              </div>
              <p className="text-xs text-text-muted">
                {row.name} kaydını kullanan tüm ilan/talep/müşteri/danışman bölgesi kayıtları tek işlemde hedefe taşınır; {row.name} takma ad + pasif olarak kalır ve Sürümler ekranından geri alınabilir.
              </p>
            </div>
          ) : null}

          {panel === "suggest" ? (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                f.set("level", level);
                f.set("id", row.id);
                run(() => submitGeoSuggestion(f), close);
              }}
            >
              <input name="note" required minLength={3} maxLength={500} placeholder="Ne düzeltilmeli? (süper admin kuyruğuna gider)" aria-label="Düzeltme önerisi" className={`${input} min-w-[260px] flex-1`} />
              <button type="submit" disabled={pending} className="rounded-[var(--radius-control)] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">Öneriyi gönder</button>
            </form>
          ) : null}

          {msg && !msg.ok ? <p role="alert" className="text-xs text-danger-500">{msg.text}</p> : null}
          {msg?.ok ? <p role="status" className="text-xs text-success-600">{msg.text}</p> : null}
        </div>
      ) : msg ? (
        <p role="status" className={`px-5 pb-2 text-xs ${msg.ok ? "text-success-600" : "text-danger-500"}`}>{msg.text}</p>
      ) : null}
    </div>
  );
}

export function GeoEntityList({ level, rows, canWrite, provinceOptions, childBase, childLabel }: Props) {
  const router = useRouter();
  const childHref = childBase ? (r: EntityRowData) => `${childBase}/${r.id}` : undefined;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<null | boolean>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allSelected = rows.length > 0 && selected.size === rows.length;

  function bulk(active: boolean) {
    const f = new FormData();
    f.set("level", level);
    f.set("ids", [...selected].join(","));
    f.set("active", String(active));
    start(async () => {
      const r = await setGeoActive(f);
      if (r.ok) {
        setSelected(new Set());
        setConfirm(null);
        setMsg(r.message ?? "Güncellendi.");
        router.refresh();
      } else setMsg(r.error ?? "İşlem yapılamadı.");
    });
  }

  return (
    <div>
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-canvas/40 px-5 py-2.5">
          <label className="flex items-center gap-2 text-xs font-semibold text-text-muted">
            <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} className="h-4 w-4" />
            Tümünü seç ({selected.size}/{rows.length})
          </label>
          {selected.size > 0 ? (
            confirm === null ? (
              <>
                <button type="button" onClick={() => setConfirm(false)} className="rounded-[var(--radius-control)] border border-danger-500/40 px-2.5 py-1 text-xs font-semibold text-danger-500">Seçilenleri pasife al</button>
                <button type="button" onClick={() => setConfirm(true)} className="rounded-[var(--radius-control)] border border-line px-2.5 py-1 text-xs font-semibold text-text-muted">Seçilenleri etkinleştir</button>
              </>
            ) : (
              <span className="flex items-center gap-2 text-xs">
                <b>{selected.size}</b> kayıt {confirm ? "etkinleştirilecek" : "pasife alınacak (silinmez, mevcut kayıtlar korunur)"}.
                <button type="button" disabled={pending} onClick={() => bulk(confirm)} className="rounded-[var(--radius-control)] bg-ink-950 px-2.5 py-1 font-bold text-white disabled:opacity-60">Onayla</button>
                <button type="button" onClick={() => setConfirm(null)} className="rounded-[var(--radius-control)] border border-line px-2 py-1 text-text-muted">Vazgeç</button>
              </span>
            )
          ) : null}
          {msg ? <span role="status" className="text-xs text-text-muted">{msg}</span> : null}
        </div>
      ) : null}
      {rows.map((r) => (
        <Row
          key={r.id}
          level={level}
          row={r}
          siblings={rows}
          canWrite={canWrite}
          provinceOptions={provinceOptions}
          childHref={childHref}
          childLabel={childLabel}
          selected={selected.has(r.id)}
          onToggle={() => toggle(r.id)}
        />
      ))}
      {rows.length === 0 ? <p className="px-5 py-12 text-center text-sm text-text-muted">Eşleşen kayıt bulunamadı.</p> : null}
    </div>
  );
}
