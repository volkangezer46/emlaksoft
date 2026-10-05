"use client";

/* eslint-disable @next/next/no-img-element -- yüklenen medya önizlemesi sandbox'lı rotadan <img>/<video> */
import { useState, type CSSProperties } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  allIds,
  blankFeatured,
  blankGroup,
  blankItem,
  canAddItem,
  moveGroup,
  moveInArray,
  moveItem,
  newId,
} from "@/lib/site-menu/editor-model";
import { FEATURED_PREVIEWS, FEATURED_RATIOS, LIMITS, type Issue, type MenuGroup, type MenuItem, type SiteMenuConfig } from "@/lib/site-menu/schema";
import type { MediaEntry } from "@/lib/site-menu/store";
import {
  Field,
  FieldIssue,
  IconPicker,
  InlineConfirm,
  MediaUploadButton,
  MOTION_ACCEPT,
  STILL_ACCEPT,
  assetUrl,
  btn,
  btnPrimary,
  iconBtn,
} from "./editor-ui";

export type Update = (fn: (draft: SiteMenuConfig) => void) => void;

type Props = {
  cfg: SiteMenuConfig;
  update: Update;
  issues: readonly Issue[];
  media: readonly MediaEntry[];
  addMedia: (m: MediaEntry) => void;
  readOnly: boolean;
};

const PREVIEW_LABELS: Record<(typeof FEATURED_PREVIEWS)[number], string> = {
  leak: "Kayıp-kaçak zaman çizgisi",
  valuation: "Emsal değer aralığı",
  signature: "Dijital imza akışı",
  plans: "Paket karşılaştırma",
  assistant: "AI asistan sohbeti",
};

const selectCls =
  "focus-ring surface-sunken h-10 w-full rounded-[var(--radius-control)] border border-hairline px-2.5 text-sm text-ink-950 disabled:opacity-60";

/** Önce imleç altındaki hedef (grup bırakma alanı dahil), yoksa en yakın merkez. */
const collision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length ? within : closestCenter(args);
};

function ItemRow({
  item,
  gi,
  ii,
  count,
  update,
  issues,
  addMedia,
  readOnly,
}: {
  item: MenuItem;
  gi: number;
  ii: number;
  count: number;
  update: Update;
  issues: readonly Issue[];
  addMedia: (m: MediaEntry) => void;
  readOnly: boolean;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: item.id, disabled: readOnly });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: item.id });
  const base = `groups.${gi}.items.${ii}`;
  const style: CSSProperties = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20, position: "relative" }
    : {};
  const set = (fn: (it: MenuItem) => void) => update((d) => fn(d.groups[gi].items[ii]));

  return (
    <li
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      style={style}
      className={`rounded-[var(--radius-card)] border bg-surface p-3 ${isOver && !isDragging ? "border-brand-500 ring-2 ring-brand-500/30" : "border-line"} ${isDragging ? "opacity-80 shadow-lg" : ""} ${item.hidden ? "opacity-70" : ""}`}
    >
      <div className="flex flex-wrap items-start gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          disabled={readOnly}
          aria-label={`${item.label || "Bağlantı"} taşı (Boşluk ile tut, ok tuşlarıyla taşı)`}
          className={`${iconBtn} cursor-grab touch-none active:cursor-grabbing`}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <IconPicker value={item.icon} onChange={(v) => set((it) => { it.icon = v; })} onMedia={addMedia} disabled={readOnly} />
        <div className="grid min-w-[10rem] flex-1 gap-2 sm:grid-cols-2">
          <Field label="Başlık">
            <Input value={item.label} maxLength={LIMITS.itemLabel + 20} disabled={readOnly} aria-invalid={!!issues.find((i) => i.path === `${base}.label` && i.level === "error")} onChange={(e) => set((it) => { it.label = e.target.value; })} />
            <FieldIssue issues={issues} path={`${base}.label`} />
          </Field>
          <Field label="Hedef (yol veya adres)">
            <Input list="site-menu-targets" value={item.href} disabled={readOnly} aria-invalid={!!issues.find((i) => i.path === `${base}.href` && i.level === "error")} onChange={(e) => set((it) => { it.href = e.target.value; })} placeholder="/fiyatlar, /#tur, https://..." />
            <FieldIssue issues={issues} path={`${base}.href`} />
          </Field>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className={iconBtn} disabled={readOnly || ii === 0} aria-label="Yukarı taşı" onClick={() => update((d) => { d.groups[gi].items = moveInArray(d.groups[gi].items, ii, ii - 1); })}>
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={iconBtn} disabled={readOnly || ii === count - 1} aria-label="Aşağı taşı" onClick={() => update((d) => { d.groups[gi].items = moveInArray(d.groups[gi].items, ii, ii + 1); })}>
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={iconBtn} disabled={readOnly} aria-pressed={item.hidden} aria-label={item.hidden ? "Göster" : "Gizle"} title={item.hidden ? "Gizli: sitede görünmez" : "Görünür"} onClick={() => set((it) => { it.hidden = !it.hidden; })}>
            {item.hidden ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_12rem_9rem_auto]">
        <Field label="Kısa açıklama">
          <Input value={item.text} disabled={readOnly} maxLength={LIMITS.itemText + 20} onChange={(e) => set((it) => { it.text = e.target.value; })} />
          <FieldIssue issues={issues} path={`${base}.text`} />
        </Field>
        <Field label="Sütun başlığı" hint="Aynı başlıklı bağlantılar bir sütunda toplanır.">
          <Input list={`sections-${gi}`} value={item.section} disabled={readOnly} maxLength={LIMITS.sectionTitle + 10} onChange={(e) => set((it) => { it.section = e.target.value; })} />
          <FieldIssue issues={issues} path={`${base}.section`} />
        </Field>
        <Field label="Rozet">
          <select className={selectCls} disabled={readOnly} value={item.badge ?? ""} onChange={(e) => set((it) => { it.badge = e.target.value === "yeni" || e.target.value === "populer" ? e.target.value : null; })}>
            <option value="">Yok</option>
            <option value="yeni">Yeni</option>
            <option value="populer">Popüler</option>
          </select>
        </Field>
        <div className="flex items-end">
          <InlineConfirm
            label="Sil"
            confirmLabel="Evet, sil"
            tone="danger"
            disabled={readOnly}
            icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            onConfirm={() => update((d) => { d.groups[gi].items.splice(ii, 1); })}
          />
        </div>
      </div>
      <FieldIssue issues={issues} path={`${base}.icon`} />
    </li>
  );
}

function FeaturedEditor({
  g,
  gi,
  update,
  issues,
  media,
  addMedia,
  readOnly,
}: {
  g: MenuGroup;
  gi: number;
  update: Update;
  issues: readonly Issue[];
  media: readonly MediaEntry[];
  addMedia: (m: MediaEntry) => void;
  readOnly: boolean;
}) {
  const f = g.featured;
  const base = `groups.${gi}.featured`;
  if (!f) {
    return (
      <button type="button" className={btn} disabled={readOnly} onClick={() => update((d) => { d.groups[gi].featured = blankFeatured(); })}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Öne çıkan kart ekle
      </button>
    );
  }
  const set = (fn: (x: NonNullable<MenuGroup["featured"]>) => void) => update((d) => { const x = d.groups[gi].featured; if (x) fn(x); });
  const m = f.media;
  const entry = (id: string | null | undefined) => (id ? media.find((x) => x.id === id) : undefined);
  const main = entry(m?.mediaId);
  const poster = entry(m?.posterId);

  return (
    <div className="rounded-[var(--radius-card)] border border-brand-200 bg-brand-600/[0.04] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-extrabold text-ink-950">Öne çıkan kart</h4>
        <div className="flex gap-2">
          <button type="button" className={btn} disabled={readOnly} aria-pressed={f.hidden} onClick={() => set((x) => { x.hidden = !x.hidden; })}>
            {f.hidden ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
            {f.hidden ? "Gizli" : "Görünür"}
          </button>
          <InlineConfirm label="Kartı kaldır" confirmLabel="Evet, kaldır" tone="danger" disabled={readOnly} onConfirm={() => update((d) => { d.groups[gi].featured = null; })} />
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Field label="Üst başlık (ör. En çok bakılan)">
          <Input value={f.eyebrow} disabled={readOnly} maxLength={LIMITS.featuredEyebrow + 10} onChange={(e) => set((x) => { x.eyebrow = e.target.value; })} />
          <FieldIssue issues={issues} path={`${base}.eyebrow`} />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-semibold text-ink-950">Kart ikonu</span>
          <IconPicker value={f.icon} onChange={(v) => set((x) => { x.icon = v.kind === "lucide" ? v : { kind: "none" }; })} onMedia={addMedia} disabled={readOnly} readOnlyMediaOk={false} />
          <FieldIssue issues={issues} path={`${base}.icon`} />
        </div>
        <Field label="Başlık">
          <Input value={f.title} disabled={readOnly} onChange={(e) => set((x) => { x.title = e.target.value; })} />
          <FieldIssue issues={issues} path={`${base}.title`} />
        </Field>
        <Field label="Düğme metni">
          <Input value={f.ctaLabel} disabled={readOnly} onChange={(e) => set((x) => { x.ctaLabel = e.target.value; })} />
          <FieldIssue issues={issues} path={`${base}.ctaLabel`} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Açıklama">
            <Input value={f.text} disabled={readOnly} onChange={(e) => set((x) => { x.text = e.target.value; })} />
            <FieldIssue issues={issues} path={`${base}.text`} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Hedef (yol veya adres)">
            <Input list="site-menu-targets" value={f.href} disabled={readOnly} onChange={(e) => set((x) => { x.href = e.target.value; })} />
            <FieldIssue issues={issues} path={`${base}.href`} />
          </Field>
        </div>
      </div>

      <div className="mt-3 sm:max-w-xs">
        <Field label="Mini ürün önizlemesi" hint="Medya yoksa kartta animasyonlu örnek ekran gösterilir; medya varsa medya öncelikli olur.">
          <select className={selectCls} disabled={readOnly} value={f.preview ?? ""} onChange={(e) => set((x) => { x.preview = (FEATURED_PREVIEWS as readonly string[]).includes(e.target.value) ? (e.target.value as (typeof FEATURED_PREVIEWS)[number]) : null; })}>
            <option value="">Yok</option>
            {FEATURED_PREVIEWS.map((k) => <option key={k} value={k}>{PREVIEW_LABELS[k]}</option>)}
          </select>
        </Field>
      </div>

      <div className="mt-3 rounded-[var(--radius-control)] border border-line bg-surface p-3">
        <p className="text-xs font-bold uppercase tracking-[0.08em] text-text-faint">Medya</p>
        {m && main ? (
          <div className="mt-2 grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div className="overflow-hidden rounded-md border border-line bg-white" style={{ aspectRatio: m.ratio.replace(":", " / ") }}>
              {m.kind === "video" ? (
                <video src={assetUrl(m.mediaId)} poster={poster ? assetUrl(poster.id) : undefined} muted loop autoPlay playsInline className="h-full w-full object-cover" aria-label="Medya önizlemesi" />
              ) : (
                <img src={assetUrl(m.mediaId)} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="grid gap-2">
              <p className="text-xs text-text-muted">
                {main.type.toUpperCase()} · {(main.bytes / 1024).toFixed(0)} KB · {m.kind === "video" ? "video döngü" : m.kind === "animated" ? "animasyonlu görsel" : "görsel"}
                {main.w && main.h ? ` · ${main.w}x${main.h}` : ""}
              </p>
              <Field label="En-boy oranı (zorunlu)" hint="Kutu bu orana sabitlenir; görsel kırpılarak sığar (düzen kayması olmaz).">
                <select className={selectCls} disabled={readOnly} value={m.ratio} onChange={(e) => set((x) => { if (x.media) x.media.ratio = e.target.value as (typeof FEATURED_RATIOS)[number]; })}>
                  {FEATURED_RATIOS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Görsel açıklaması (erişilebilirlik)">
                <Input value={m.alt} disabled={readOnly} onChange={(e) => set((x) => { if (x.media) x.media.alt = e.target.value; })} />
              </Field>
              {m.kind !== "image" ? (
                <div>
                  <p className="text-xs font-semibold text-ink-950">Poster kare (zorunlu)</p>
                  <p className="text-xs text-text-faint">Önce bu kare görünür; hareket azaltma ve veri tasarrufu açıkken yalnız bu kare gösterilir.</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {poster ? <img src={assetUrl(poster.id)} alt="Poster karesi" className="h-12 w-20 rounded border border-line object-cover" /> : null}
                    <MediaUploadButton role="image" label={poster ? "Posteri değiştir" : "Poster yükle"} accept={STILL_ACCEPT} disabled={readOnly} onDone={(p) => { addMedia(p); set((x) => { if (x.media) x.media.posterId = p.id; }); }} />
                  </div>
                  <FieldIssue issues={issues} path={`${base}.media.posterId`} />
                </div>
              ) : null}
              <div>
                <button type="button" className={btn} disabled={readOnly} onClick={() => set((x) => { x.media = null; })}>
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Medyayı kaldır
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-2">
            <MediaUploadButton
              role="featured"
              label="Görsel / animasyon / video yükle"
              accept={MOTION_ACCEPT}
              disabled={readOnly}
              hint="SVG, PNG, WebP (durağan ≤ 400 KB); GIF, WebP, APNG animasyonu veya WebM/MP4 döngü (≤ 2 MB). Türü dosya içeriğinden doğrulanır."
              onDone={(up) => {
                addMedia(up);
                set((x) => {
                  x.media = { mediaId: up.id, kind: up.kind, posterId: null, ratio: "16:9", alt: "" };
                });
              }}
            />
          </div>
        )}
        <FieldIssue issues={issues} path={`${base}.media`} />
      </div>
    </div>
  );
}

function GroupCard({
  g,
  gi,
  total,
  cfg,
  update,
  issues,
  media,
  addMedia,
  readOnly,
}: Props & { g: MenuGroup; gi: number; total: number }) {
  const { setNodeRef: setGroupDropRef, isOver: groupOver } = useDroppable({ id: `group:${g.id}`, disabled: g.kind === "link" });
  const gp = `groups.${gi}`;
  const set = (fn: (x: MenuGroup) => void) => update((d) => fn(d.groups[gi]));

  return (
    <section className={`rounded-[var(--radius-panel)] border bg-surface p-4 ${g.hidden ? "border-dashed border-line opacity-80" : "border-line"}`} aria-label={`Grup: ${g.label}`}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[9rem] flex-1">
          <Field label="Grup adı">
            <Input value={g.label} disabled={readOnly} aria-invalid={!!issues.find((i) => i.path === `${gp}.label` && i.level === "error")} onChange={(e) => set((x) => { x.label = e.target.value; })} />
            <FieldIssue issues={issues} path={`${gp}.label`} />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Tür">
            <select className={selectCls} disabled={readOnly} value={g.kind} onChange={(e) => set((x) => { x.kind = e.target.value === "link" ? "link" : "menu"; if (x.kind === "link" && !x.href) x.href = "/fiyatlar"; })}>
              <option value="menu">Açılır menü</option>
              <option value="link">Doğrudan bağlantı</option>
            </select>
          </Field>
        </div>
        {g.kind === "menu" ? null : (
          <div className="min-w-[10rem] flex-1">
            <Field label="Hedef">
              <Input list="site-menu-targets" value={g.href} disabled={readOnly} onChange={(e) => set((x) => { x.href = e.target.value; })} />
              <FieldIssue issues={issues} path={`${gp}.href`} />
            </Field>
          </div>
        )}
        <div className="flex items-center gap-1">
          <button type="button" className={iconBtn} disabled={readOnly || gi === 0} aria-label="Grubu sola taşı" onClick={() => update((d) => { d.groups = moveGroup(d, gi, -1).groups; })}>
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={iconBtn} disabled={readOnly || gi === total - 1} aria-label="Grubu sağa taşı" onClick={() => update((d) => { d.groups = moveGroup(d, gi, 1).groups; })}>
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" className={iconBtn} disabled={readOnly} aria-pressed={g.hidden} aria-label={g.hidden ? "Grubu göster" : "Grubu gizle"} onClick={() => set((x) => { x.hidden = !x.hidden; })}>
            {g.hidden ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          </button>
          <InlineConfirm label="Grubu sil" confirmLabel="Evet, sil" tone="danger" disabled={readOnly} icon={<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />} onConfirm={() => update((d) => { d.groups.splice(gi, 1); })} />
        </div>
      </div>
      <FieldIssue issues={issues} path={gp} />

      {g.kind === "menu" ? (
        <div className="mt-3 space-y-3">
          <datalist id={`sections-${gi}`}>
            {[...new Set(g.items.map((i) => i.section).filter(Boolean))].map((t) => <option key={t} value={t} />)}
          </datalist>
          <ul
            ref={setGroupDropRef}
            aria-label={`${g.label} bağlantıları`}
            className={`space-y-2 rounded-[var(--radius-card)] p-1 ${groupOver ? "bg-brand-600/[0.06] ring-2 ring-brand-500/30" : ""}`}
          >
            {g.items.map((it, ii) => (
              <ItemRow key={it.id} item={it} gi={gi} ii={ii} count={g.items.length} update={update} issues={issues} addMedia={addMedia} readOnly={readOnly} />
            ))}
            {g.items.length === 0 ? <li className="rounded-[var(--radius-card)] border border-dashed border-line p-4 text-center text-xs text-text-muted">Bu grupta bağlantı yok. Bağlantı ekleyin ya da başka bir gruptan sürükleyin.</li> : null}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={readOnly || !canAddItem(cfg, gi)}
              onClick={() => update((d) => { d.groups[gi].items.push(blankItem(newId("item", allIds(d)))); })}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Bağlantı ekle
            </button>
            <span className="text-xs text-text-faint">{g.items.length}/{LIMITS.maxItemsPerGroup}</span>
          </div>
          <FeaturedEditor g={g} gi={gi} update={update} issues={issues} media={media} addMedia={addMedia} readOnly={readOnly} />
        </div>
      ) : null}
    </section>
  );
}

export function MenuTab(props: Props) {
  const { cfg, update, readOnly } = props;
  const [live, setLive] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const labelOf = (id: string | number): string => {
    const sid = String(id);
    if (sid.startsWith("group:")) return cfg.groups.find((g) => `group:${g.id}` === sid)?.label ?? "grup";
    for (const g of cfg.groups) {
      const it = g.items.find((x) => x.id === sid);
      if (it) return it.label || "bağlantı";
    }
    return "öğe";
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `${labelOf(active.id)} tutuldu. Ok tuşlarıyla hedef seçin, Boşluk ile bırakın, Esc ile iptal edin.`,
    onDragOver: ({ active, over }) => (over ? `${labelOf(active.id)}, ${labelOf(over.id)} üzerinde.` : `${labelOf(active.id)} bırakma alanı dışında.`),
    onDragEnd: ({ active, over }) => (over ? `${labelOf(active.id)}, ${labelOf(over.id)} konumuna yerleştirildi.` : `${labelOf(active.id)} yerinde bırakıldı.`),
    onDragCancel: ({ active }) => `${labelOf(active.id)} taşıma iptal edildi.`,
  };

  const onDragEnd = (e: DragEndEvent) => {
    const over = e.over;
    if (!over || readOnly || over.id === e.active.id) return;
    const target = String(over.id).startsWith("group:")
      ? ({ kind: "group", id: String(over.id).slice(6) } as const)
      : ({ kind: "item", id: String(over.id) } as const);
    const next = moveItem(cfg, String(e.active.id), target);
    if (next === cfg) {
      setLive("Bu konuma taşınamadı (grup dolu olabilir).");
      return;
    }
    update((d) => { d.groups = next.groups; });
    setLive(`${labelOf(e.active.id)} taşındı.`);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">
        Bağlantıları sürükleyerek (veya tutamakta Boşluk + ok tuşlarıyla) sıralayın; yukarı/aşağı düğmeleri de aynı işi yapar. Bir bağlantıyı başka bir grubun kutusuna bırakarak taşıyabilirsiniz.
      </p>
      <p role="status" aria-live="polite" className="sr-only">{live}</p>
      <DndContext sensors={sensors} collisionDetection={collision} onDragEnd={onDragEnd} accessibility={{ announcements, screenReaderInstructions: { draggable: "Taşımak için Boşluk veya Enter'a basın, ok tuşlarıyla hedef seçin, Boşluk ile bırakın." } }}>
        <div className="space-y-4">
          {cfg.groups.map((g, gi) => (
            <GroupCard key={g.id} {...props} g={g} gi={gi} total={cfg.groups.length} />
          ))}
        </div>
      </DndContext>
      <button
        type="button"
        className={btnPrimary}
        disabled={readOnly || cfg.groups.length >= LIMITS.maxGroups}
        onClick={() => update((d) => { d.groups.push(blankGroup(newId("grup", allIds(d)))); })}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Grup ekle
      </button>
      <span className="ml-2 text-xs text-text-faint">{cfg.groups.length}/{LIMITS.maxGroups}</span>
    </div>
  );
}
