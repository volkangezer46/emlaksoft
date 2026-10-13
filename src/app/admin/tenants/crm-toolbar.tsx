"use client";

import Link from "@/components/ui/smart-link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Bookmark, BookmarkPlus, Filter, Tags, Trash2 } from "lucide-react";
import { createAdminSavedView, deleteAdminSavedView, deleteTenantTag, saveTenantTag } from "@/app/actions/platform-crm";
import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FilterSelect } from "@/components/ui/list-kit";
import { HEALTH_BAND_LABELS, HEALTH_GOOD_THRESHOLD } from "@/lib/admin/health-score";
import { LIFECYCLE_LABELS, LIFECYCLE_STAGES, TAG_COLOR_LABELS, TAG_COLORS, viewHref, type AdminSavedView, type CrmStaff, type CrmTag, type TagColor } from "@/lib/admin/platform-crm";
import { cn } from "@/lib/utils";

/**
 * Ofis listesi CRM araç çubuğu (AD5): etiket/sorumlu/aşama/skor süzgeci (GET form → URL → sunucu sorgusu; filtre
 * kontratı), kayıtlı görünümler (personel bazlı `admin_saved_views`) ve etiket tanımı yönetimi (süper admin + ops).
 */

export function CrmFilterForm({
  current,
  hidden,
  tags,
  staff,
  riskThreshold,
}: {
  current: { etiket?: string; sorumlu?: string; asama?: string; skor?: string };
  hidden: Record<string, string | undefined>;
  tags: CrmTag[];
  staff: CrmStaff[];
  riskThreshold: number;
}) {
  const good = Math.max(riskThreshold, HEALTH_GOOD_THRESHOLD);
  return (
    <form action="/admin/tenants" className="flex flex-wrap items-end gap-2" aria-label="CRM süzgeçleri">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <FilterSelect name="etiket" label="Etiket" value={current.etiket ?? ""} options={[{ value: "", label: "Tümü" }, ...tags.map((t) => ({ value: t.id, label: t.name }))]} className="min-w-[8.5rem]" />
      <FilterSelect
        name="sorumlu"
        label="Sorumlu"
        value={current.sorumlu ?? ""}
        options={[{ value: "", label: "Tümü" }, { value: "ben", label: "Ben" }, { value: "yok", label: "Atanmamış" }, ...staff.map((s) => ({ value: s.id, label: s.name }))]}
        className="min-w-[8.5rem]"
      />
      <FilterSelect name="asama" label="Aşama" value={current.asama ?? ""} options={[{ value: "", label: "Tümü" }, ...LIFECYCLE_STAGES.map((s) => ({ value: s, label: LIFECYCLE_LABELS[s] }))]} className="min-w-[8.5rem]" />
      <FilterSelect
        name="skor"
        label="Sağlık skoru"
        value={current.skor ?? ""}
        options={[
          { value: "", label: "Tümü" },
          { value: "riskli", label: `${HEALTH_BAND_LABELS.riskli} (<${riskThreshold})` },
          { value: "izlenmeli", label: `${HEALTH_BAND_LABELS.izlenmeli} (${riskThreshold}-${good - 1})` },
          { value: "saglikli", label: `${HEALTH_BAND_LABELS.saglikli} (${good}+)` },
        ]}
        className="min-w-[8.5rem]"
      />
      <Button type="submit" size="sm" variant="outline" icon={Filter}>
        Süz
      </Button>
    </form>
  );
}

export function SavedViewsMenu({ views, current }: { views: AdminSavedView[]; current: Record<string, string> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const canSave = Object.keys(current).length > 0;

  function save() {
    setMsg(null);
    start(async () => {
      const r = await createAdminSavedView("/admin/tenants", name, current);
      if (r.ok) {
        setName("");
        setMsg({ tone: "ok", text: r.message ?? "Kaydedildi." });
        router.refresh();
      } else setMsg({ tone: "error", text: r.error ?? "Kaydedilemedi." });
    });
  }
  function remove(id: string) {
    setMsg(null);
    start(async () => {
      const r = await deleteAdminSavedView(id);
      if (r.ok) router.refresh();
      else setMsg({ tone: "error", text: r.error ?? "Silinemedi." });
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" icon={Bookmark} aria-label="Kayıtlı görünümler">
          Görünümler{views.length ? ` (${views.length})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(20rem,calc(100vw-2rem))] p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-text-faint">Kayıtlı görünümler</p>
        {views.length === 0 ? (
          <p className="mt-2 text-sm text-text-muted">Henüz kayıtlı görünüm yok. Süzgeçleri seçip aşağıdan kaydedin.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {views.map((v) => (
              <li key={v.id} className="flex items-center gap-1">
                <Link href={viewHref("/admin/tenants", v.params)} className="focus-ring min-w-0 flex-1 truncate rounded-[var(--radius-control)] px-2 py-1.5 text-sm font-semibold hover:bg-surface-hover">
                  {v.name}
                </Link>
                <Button size="icon" variant="ghost" icon={Trash2} disabled={pending} aria-label={`Görünümü sil: ${v.name}`} onClick={() => remove(v.id)} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 border-t border-line pt-3">
          {canSave ? (
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Görünüm adı (ör. Kurumsal · benim)" maxLength={60} aria-label="Görünüm adı" className="h-8 text-sm" />
              <Button type="submit" size="sm" icon={BookmarkPlus} loading={pending} disabled={!name.trim()}>
                Kaydet
              </Button>
            </form>
          ) : (
            <p className="text-xs text-text-muted">Kaydetmek için önce bir süzgeç seçin.</p>
          )}
          {msg ? (
            <p role={msg.tone === "error" ? "alert" : "status"} className={cn("mt-2 text-xs font-semibold", msg.tone === "error" ? "text-[var(--pm-danger-text)]" : "text-[var(--pm-success-text)]")}>
              {msg.text}
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TagBadge({ tag, href }: { tag: Pick<CrmTag, "name" | "color">; href?: string }) {
  const cls = `adm-badge pm-t-${tag.color}`;
  return href ? (
    <Link href={href} className={`${cls} focus-ring`} title={`Yalnız "${tag.name}" etiketli ofisleri göster`}>
      {tag.name}
    </Link>
  ) : (
    <span className={cls}>{tag.name}</span>
  );
}

export function TagManager({ tags }: { tags: CrmTag[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("brand");
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      if (editing) fd.set("id", editing);
      fd.set("name", name);
      fd.set("color", color);
      const r = await saveTenantTag(fd);
      if (r.ok) {
        setName("");
        setEditing(null);
        setColor("brand");
        setMsg({ tone: "ok", text: r.message ?? "Kaydedildi." });
        router.refresh();
      } else setMsg({ tone: "error", text: r.error ?? "Kaydedilemedi." });
    });
  }
  async function remove(t: CrmTag) {
    setMsg(null);
    const fd = new FormData();
    fd.set("id", t.id);
    const r = await deleteTenantTag(fd);
    if (r.ok) router.refresh();
    setMsg({ tone: r.ok ? "ok" : "error", text: (r.ok ? r.message : r.error) ?? "" });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" icon={Tags}>
          Etiketler
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-2rem))] p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-text-faint">Ofis etiketleri</p>
        {tags.length === 0 ? <p className="mt-2 text-sm text-text-muted">Henüz etiket yok. İlk etiketi (ör. Kurumsal) aşağıdan ekleyin.</p> : null}
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <li key={t.id} className="inline-flex items-center gap-0.5">
              <FilterChip
                active={editing === t.id}
                title="Düzenle"
                onClick={() => {
                  setEditing(t.id);
                  setName(t.name);
                  setColor(t.color);
                }}
              >
                <TagBadge tag={t} />
              </FilterChip>
              <ConfirmDialog
                trigger={<Button size="icon" variant="ghost" icon={Trash2} disabled={pending} aria-label={`Etiketi sil: ${t.name}`} />}
                title={`"${t.name}" etiketi silinsin mi?`}
                description="Etiket tüm ofislerden kaldırılır; ofis kayıtları etkilenmez."
                confirmLabel="Etiketi sil"
                onConfirm={() => remove(t)}
              />
            </li>
          ))}
        </ul>
        <form
          className="mt-3 grid gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Etiket adı" maxLength={40} aria-label="Etiket adı" className="h-8 text-sm" />
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Renk">
            {TAG_COLORS.map((c) => (
              <FilterChip key={c} active={color === c} onClick={() => setColor(c)} aria-label={`Renk: ${TAG_COLOR_LABELS[c]}`}>
                <span className={`adm-badge pm-t-${c}`}>{TAG_COLOR_LABELS[c]}</span>
              </FilterChip>
            ))}
          </div>
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" loading={pending} disabled={!name.trim()}>
              {editing ? "Güncelle" : "Etiket ekle"}
            </Button>
            {editing ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setName("");
                  setColor("brand");
                }}
              >
                Vazgeç
              </Button>
            ) : null}
          </div>
          {msg?.text ? (
            <p role={msg.tone === "error" ? "alert" : "status"} className={cn("text-xs font-semibold", msg.tone === "error" ? "text-[var(--pm-danger-text)]" : "text-[var(--pm-success-text)]")}>
              {msg.text}
            </p>
          ) : null}
        </form>
      </PopoverContent>
    </Popover>
  );
}
