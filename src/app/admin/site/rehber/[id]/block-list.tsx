"use client";

import { useState, type CSSProperties } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Txt } from "@/app/admin/site-icerik/editor-fields";
import type { Issue } from "@/lib/site-menu/schema-core";
import {
  CALLOUT_TONES,
  CALLOUT_TONE_LABEL,
  RICH_BLOCK_LABEL,
  RICH_LIMITS as L,
  TOOL_EMBED_SLUGS,
  moveBlock,
  type CalloutTone,
  type RichBlock,
  type ToolEmbedSlug,
} from "@/lib/rich-text/core";
import { TOOLS } from "@/lib/tools/registry";

/**
 * Blok editörü listesi: ekleme/silme/sıralama. Sıralama sürükle-bırak (@dnd-kit; tutamakta Boşluk + ok tuşları) ve
 * yukarı/aşağı düğmeleriyle aynı işi yapar. Kütüphane yalnız /admin/site/rehber düzenleyici parçasında yüklenir.
 */

export type BlockRow = { key: string; block: RichBlock };

type Props = {
  rows: BlockRow[];
  onChange: (rows: BlockRow[]) => void;
  issues: readonly Issue[];
  readOnly: boolean;
};

const INLINE_HINT = "Biçim: **kalın**, *italik*, [bağlantı metni](/yol veya https://...)";
const selectCls = "h-11 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 text-sm";
const toolTitle = (slug: ToolEmbedSlug) => TOOLS.find((t) => t.slug === slug)?.title ?? slug;

export function BlockList({ rows, onChange, issues, readOnly }: Props) {
  const [live, setLive] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const labelOf = (key: string | number) => {
    const i = rows.findIndex((r) => r.key === String(key));
    return i === -1 ? "blok" : `${i + 1}. ${RICH_BLOCK_LABEL[rows[i]!.block.type]}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${labelOf(active.id)} tutuldu. Ok tuşlarıyla hedef seçin, Boşluk ile bırakın, Esc ile iptal edin.`,
    onDragOver: ({ active, over }) => (over ? `${labelOf(active.id)}, ${labelOf(over.id)} üzerinde.` : `${labelOf(active.id)} bırakma alanı dışında.`),
    onDragEnd: ({ active, over }) => (over ? `${labelOf(active.id)}, ${labelOf(over.id)} konumuna yerleştirildi.` : `${labelOf(active.id)} yerinde bırakıldı.`),
    onDragCancel: ({ active }) => `${labelOf(active.id)} taşıma iptal edildi.`,
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || readOnly || e.over.id === e.active.id) return;
    const from = rows.findIndex((r) => r.key === String(e.active.id));
    const to = rows.findIndex((r) => r.key === String(e.over?.id));
    if (from === -1 || to === -1) return;
    onChange(moveBlock(rows, from, to));
    setLive(`${labelOf(e.active.id)} taşındı.`);
  };
  const setBlock = (i: number, block: RichBlock) => onChange(rows.map((r, n) => (n === i ? { ...r, block } : r)));

  return (
    <div>
      <p role="status" aria-live="polite" className="sr-only">{live}</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements, screenReaderInstructions: { draggable: "Taşımak için Boşluk veya Enter'a basın, ok tuşlarıyla hedef seçin, Boşluk ile bırakın." } }}>
        <ol className="space-y-3">
          {rows.map((r, i) => (
            <BlockRowCard
              key={r.key}
              row={r}
              index={i}
              count={rows.length}
              issues={issues}
              readOnly={readOnly}
              onChange={(b) => setBlock(i, b)}
              onMove={(to) => onChange(moveBlock(rows, i, to))}
              onRemove={() => onChange(rows.filter((_, n) => n !== i))}
            />
          ))}
        </ol>
      </DndContext>
    </div>
  );
}

function BlockRowCard({
  row,
  index: i,
  count,
  issues,
  readOnly,
  onChange,
  onMove,
  onRemove,
}: {
  row: BlockRow;
  index: number;
  count: number;
  issues: readonly Issue[];
  readOnly: boolean;
  onChange: (b: RichBlock) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: row.key, disabled: readOnly });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: row.key });
  const style: CSSProperties = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20, position: "relative" } : {};
  const blockIssue = issues.find((x) => x.path === `body.${i}` && x.level === "error");
  return (
    <li
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      style={style}
      className={`rounded-[var(--radius-panel)] border bg-surface p-4 ${isOver && !isDragging ? "border-brand-500 ring-2 ring-brand-500/30" : "border-line"} ${isDragging ? "opacity-80 shadow-lg" : ""}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {!readOnly ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              ref={setActivatorNodeRef}
              {...listeners}
              {...attributes}
              aria-label={`${i + 1}. bloğu sürükle`}
              className="cursor-grab touch-none"
            >
              <GripVertical className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
          <p className="truncate text-sm font-bold text-ink-950">
            {i + 1}. {RICH_BLOCK_LABEL[row.block.type]}
          </p>
        </div>
        {!readOnly ? (
          <div className="flex shrink-0 gap-1">
            <Button type="button" variant="outline" size="icon" aria-label="Yukarı taşı" disabled={i === 0} onClick={() => onMove(i - 1)}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label="Aşağı taşı" disabled={i === count - 1} onClick={() => onMove(i + 1)}>
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label={`${i + 1}. bloğu sil`} onClick={onRemove}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </div>
      {blockIssue ? <p role="alert" className="mb-2 text-xs font-semibold text-danger-500">{blockIssue.message}</p> : null}
      <BlockFields block={row.block} path={`body.${i}`} issues={issues} readOnly={readOnly} onChange={onChange} />
    </li>
  );
}

function BlockFields({ block: b, path, issues, readOnly, onChange }: { block: RichBlock; path: string; issues: readonly Issue[]; readOnly: boolean; onChange: (b: RichBlock) => void }) {
  const t = (label: string, key: string, value: string, set: (v: string) => void, opts: { max?: number; multiline?: boolean; hint?: string } = {}) => (
    <Txt label={label} value={value} max={opts.max ?? L.text} multiline={opts.multiline} onChange={set} issues={issues} path={`${path}.${key}`} readOnly={readOnly} hint={opts.hint} />
  );
  switch (b.type) {
    case "p":
      return t("Paragraf", "text", b.text, (v) => onChange({ ...b, text: v }), { multiline: true, hint: INLINE_HINT });
    case "h2":
    case "h3":
      return t(b.type === "h2" ? "Ara başlık (içindekilerde görünür)" : "Alt başlık", "text", b.text, (v) => onChange({ ...b, text: v }), { max: 160 });
    case "ul":
    case "ol":
      return (
        <div className="space-y-2">
          {b.items.map((it, n) => (
            <div key={n} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Txt label={`${n + 1}. madde`} value={it} max={L.text} onChange={(v) => onChange({ ...b, items: b.items.map((x, k) => (k === n ? v : x)) })} issues={issues} path={`${path}.items.${n}`} readOnly={readOnly} hint={n === 0 ? INLINE_HINT : undefined} />
              </div>
              {!readOnly ? (
                <Button type="button" variant="outline" size="icon" className="mt-5" aria-label={`${n + 1}. maddeyi sil`} disabled={b.items.length <= 1} onClick={() => onChange({ ...b, items: b.items.filter((_, k) => k !== n) })}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ))}
          {!readOnly ? (
            <Button type="button" variant="outline" size="sm" disabled={b.items.length >= L.maxListItems} onClick={() => onChange({ ...b, items: [...b.items, ""] })}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Madde ekle
            </Button>
          ) : null}
        </div>
      );
    case "quote":
      return (
        <div className="grid gap-3">
          {t("Alıntı", "text", b.text, (v) => onChange({ ...b, text: v }), { multiline: true, hint: INLINE_HINT })}
          {t("Kaynak (isteğe bağlı)", "cite", b.cite ?? "", (v) => onChange({ ...b, cite: v || undefined }), { max: 160 })}
        </div>
      );
    case "callout":
      return (
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <label className="text-xs font-semibold text-ink-950">
            Tür
            <select value={b.tone} disabled={readOnly} onChange={(e) => onChange({ ...b, tone: e.target.value as CalloutTone })} className={`mt-1 block font-normal ${selectCls}`}>
              {CALLOUT_TONES.map((tone) => (
                <option key={tone} value={tone}>{CALLOUT_TONE_LABEL[tone]}</option>
              ))}
            </select>
          </label>
          {t("Kutu başlığı (isteğe bağlı)", "title", b.title ?? "", (v) => onChange({ ...b, title: v || undefined }), { max: 160 })}
          <div className="sm:col-span-2">{t("Kutu metni", "text", b.text, (v) => onChange({ ...b, text: v }), { multiline: true, hint: INLINE_HINT })}</div>
        </div>
      );
    case "table":
      return <TableFields block={b} path={path} issues={issues} readOnly={readOnly} onChange={onChange} />;
    case "faq":
      return (
        <div className="grid gap-3">
          {b.items.map((it, n) => (
            <div key={n} className="grid gap-2 rounded-[var(--radius-card)] border border-line p-3 sm:grid-cols-[1fr_auto]">
              <div className="grid gap-2">
                <Txt label={`${n + 1}. soru`} value={it.q} max={300} onChange={(v) => onChange({ ...b, items: b.items.map((x, k) => (k === n ? { ...x, q: v } : x)) })} issues={issues} path={`${path}.items.${n}.q`} readOnly={readOnly} />
                <Txt label="Cevap" value={it.a} max={L.text} multiline onChange={(v) => onChange({ ...b, items: b.items.map((x, k) => (k === n ? { ...x, a: v } : x)) })} issues={issues} path={`${path}.items.${n}.a`} readOnly={readOnly} hint={INLINE_HINT} />
              </div>
              {!readOnly ? (
                <Button type="button" variant="outline" size="icon" aria-label={`${n + 1}. soruyu sil`} disabled={b.items.length <= 1} onClick={() => onChange({ ...b, items: b.items.filter((_, k) => k !== n) })}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ))}
          {!readOnly ? (
            <div>
              <Button type="button" variant="outline" size="sm" disabled={b.items.length >= L.maxFaq} onClick={() => onChange({ ...b, items: [...b.items, { q: "Soru", a: "Cevap" }] })}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Soru ekle
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-text-faint">Sorular sayfada açılır liste olarak görünür ve FAQPage yapılandırılmış verisine aynen girer.</p>
        </div>
      );
    case "toolEmbed":
      return (
        <label className="block text-xs font-semibold text-ink-950">
          Araç
          <select value={b.slug} disabled={readOnly} onChange={(e) => onChange({ ...b, slug: e.target.value as ToolEmbedSlug })} className={`mt-1 block font-normal ${selectCls}`}>
            {TOOL_EMBED_SLUGS.map((s) => (
              <option key={s} value={s}>{toolTitle(s)}</option>
            ))}
          </select>
          <span className="mt-1 block font-normal text-text-faint">Sayfada araca giden kart olarak görünür.</span>
        </label>
      );
  }
}

function TableFields({ block: b, path, issues, readOnly, onChange }: { block: Extract<RichBlock, { type: "table" }>; path: string; issues: readonly Issue[]; readOnly: boolean; onChange: (b: RichBlock) => void }) {
  const cols = b.head.length;
  const setCell = (ri: number, ci: number, v: string) => onChange({ ...b, rows: b.rows.map((r, n) => (n === ri ? r.map((c, k) => (k === ci ? v : c)) : r)) });
  return (
    <div className="space-y-3">
      <Txt label="Tablo başlığı (isteğe bağlı)" value={b.caption ?? ""} max={L.caption} onChange={(v) => onChange({ ...b, caption: v || undefined })} issues={issues} path={`${path}.caption`} readOnly={readOnly} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <thead>
            <tr>
              {b.head.map((h, ci) => (
                <th key={ci} scope="col" className="p-1 text-left align-top">
                  <Txt label={`${ci + 1}. sütun`} value={h} max={300} onChange={(v) => onChange({ ...b, head: b.head.map((x, k) => (k === ci ? v : x)) })} issues={issues} path={`${path}.head.${ci}`} readOnly={readOnly} />
                </th>
              ))}
              {!readOnly ? <th className="w-12 p-1" aria-label="Satır işlemi" /> : null}
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} className="p-1 align-top">
                    <Txt label={`${ri + 1}. satır, ${ci + 1}. hücre`} value={c} max={300} onChange={(v) => setCell(ri, ci, v)} issues={issues} path={`${path}.rows.${ri}.${ci}`} readOnly={readOnly} />
                  </td>
                ))}
                {!readOnly ? (
                  <td className="p-1 align-bottom">
                    <Button type="button" variant="outline" size="icon" aria-label={`${ri + 1}. satırı sil`} onClick={() => onChange({ ...b, rows: b.rows.filter((_, n) => n !== ri) })}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" disabled={b.rows.length >= L.maxRows} onClick={() => onChange({ ...b, rows: [...b.rows, Array.from({ length: cols }, () => "")] })}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Satır ekle
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={cols >= L.maxColumns} onClick={() => onChange({ ...b, head: [...b.head, `Sütun ${cols + 1}`], rows: b.rows.map((r) => [...r, ""]) })}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Sütun ekle ({cols}/{L.maxColumns})
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={cols <= 1} onClick={() => onChange({ ...b, head: b.head.slice(0, -1), rows: b.rows.map((r) => r.slice(0, -1)) })}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Son sütunu sil
          </Button>
        </div>
      ) : null}
      <p className="text-xs text-text-faint">Hücreler düz metindir (biçim işlenmez).</p>
    </div>
  );
}
