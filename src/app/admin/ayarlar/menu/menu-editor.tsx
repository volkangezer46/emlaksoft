"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, Lock, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/app/toast-provider";
import { resetNavMenuOverrides, saveNavMenuOverrides } from "@/app/actions/nav-menu";
import { applyNavOverride, type HubDef, type NavLayoutKey, type RoleNav, type RoleNavOverride } from "@/lib/nav-roles";
import type { MenuOverrides } from "@/lib/nav-overrides";
import type { AdminNavOverrides } from "@/lib/admin/nav";

export type EditorPage = { key: string; href: string; label: string; locked: boolean };
export type EditorHub = { id: string; label: string; group: string | null; required: boolean; pages: EditorPage[] };
export type EditorLayout = { key: NavLayoutKey; label: string; hubs: EditorHub[]; dock: EditorHub[]; visibleHrefs: string[] };
type AdminGroup = { id: string; title: string; required: boolean; items: { href: string; label: string }[] };

const LABEL_MAX = 40;

/** Editör satırları → `applyNavOverride`'ın beklediği düzen (önizleme sunucuyla AYNI kuralı kullanır; ikon önizlemede yok). */
function asLayout(l: EditorLayout): RoleNav {
  const hub = (h: EditorHub) => ({ id: h.id, label: h.label, icon: "dashboard", ...(h.group ? { group: h.group } : {}), pages: h.pages.map((p) => ({ href: p.href, label: p.label })) }) as unknown as HubDef;
  return { hubs: l.hubs.map(hub), dock: l.dock.map(hub), tools: [], mobile: [] };
}

const without = <T,>(xs: readonly T[] | undefined, x: T) => (xs ?? []).filter((v) => v !== x);
const toggleIn = <T,>(xs: readonly T[] | undefined, x: T, on: boolean) => (on ? [...without(xs, x), x] : without(xs, x));

/** Boş alanları atar (kaydedilen fark seyrek kalır; sunucu da ayrıca sadeleştirir). */
function compactRole(r: RoleNavOverride): RoleNavOverride | undefined {
  const out: RoleNavOverride = {
    ...(r.hidden?.length ? { hidden: r.hidden } : {}),
    ...(r.hiddenGroups?.length ? { hiddenGroups: r.hiddenGroups } : {}),
    ...(r.order?.length ? { order: r.order } : {}),
    ...(r.labels && Object.keys(r.labels).length ? { labels: r.labels } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/**
 * Menü yönetimi düzenleyicisi (istemci adası; yalnız bu sayfanın paketi). Solda düzenleme (grup başlığı · satırlar ·
 * alt sayfalar), sağda canlı önizleme (koyu yan menü görünümü, varsayılan yetkiyle süzülmüş). Durum = seyrek fark;
 * "Kaydet" tek eylemle yazar (gerekçe isteğe bağlı, geçmişe ve denetim izine düşer).
 */
export function MenuEditor({ layouts, adminGroups, initial, canEdit }: { layouts: EditorLayout[]; adminGroups: AdminGroup[]; initial: MenuOverrides; canEdit: boolean }) {
  const [ov, setOv] = useState<MenuOverrides>(initial);
  const [roleKey, setRoleKey] = useState<NavLayoutKey>(layouts[0]?.key ?? "manager");
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const { push } = useToast();
  const dirty = JSON.stringify(ov) !== JSON.stringify(initial);

  const layout = layouts.find((l) => l.key === roleKey) ?? layouts[0]!;
  const roleOv = ov.roles?.[roleKey];
  const r: RoleNavOverride = useMemo(() => roleOv ?? {}, [roleOv]);
  const setRole = (fn: (cur: RoleNavOverride) => RoleNavOverride) =>
    setOv((cur) => {
      const next = compactRole(fn(cur.roles?.[roleKey] ?? {}));
      const roles = { ...(cur.roles ?? {}) };
      if (next) roles[roleKey] = next;
      else delete roles[roleKey];
      return { ...cur, roles: Object.keys(roles).length ? roles : undefined };
    });
  const setAdmin = (fn: (cur: AdminNavOverrides) => AdminNavOverrides) =>
    setOv((cur) => {
      const a = fn(cur.admin ?? {});
      const next: AdminNavOverrides = { ...(a.hiddenGroups?.length ? { hiddenGroups: a.hiddenGroups } : {}), ...(a.groupOrder?.length ? { groupOrder: a.groupOrder } : {}) };
      return { ...cur, admin: Object.keys(next).length ? next : undefined };
    });

  // Düzenleme listesi: yalnız sıra uygulanmış TÜM satırlar (gizliler de listede kalır, soluk çizilir).
  const base = useMemo(() => asLayout(layout), [layout]);
  const ordered = useMemo(() => {
    const ids = applyNavOverride(base, r.order ? { order: r.order } : null).hubs.map((h) => h.id);
    return ids.map((id) => layout.hubs.find((h) => h.id === id)!);
  }, [base, layout, r.order]);

  // Önizleme: fark + varsayılan yetki süzgeci (sayfası kalmayan satır çıkar).
  const preview = useMemo(() => {
    const visible = new Set(layout.visibleHrefs);
    const applied = applyNavOverride(base, r);
    const keep = (hs: readonly HubDef[]) => hs.flatMap((h) => {
      const pages = h.pages.filter((p) => visible.has(p.href));
      return pages.length ? [{ ...h, pages }] : [];
    });
    return { hubs: keep(applied.hubs), dock: keep(applied.dock) };
  }, [base, layout, r]);

  const move = (id: string, dir: -1 | 1) => {
    const ids = ordered.map((h) => h.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length || ordered[j]!.group !== ordered[i]!.group) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setRole((c) => ({ ...c, order: ids }));
  };
  const setLabel = (key: string, value: string) =>
    setRole((c) => {
      const labels = { ...(c.labels ?? {}) };
      const v = value.slice(0, LABEL_MAX);
      if (v.trim()) labels[key] = v;
      else delete labels[key];
      return { ...c, labels };
    });
  const isHidden = (key: string) => (r.hidden ?? []).includes(key);
  const groupHidden = (g: string | null) => Boolean(g && (r.hiddenGroups ?? []).includes(g));

  const adminOrdered = useMemo(() => {
    const order = ov.admin?.groupOrder ?? [];
    const rank = (id: string, i: number) => (order.includes(id) ? order.indexOf(id) : order.length + i);
    return adminGroups.map((g, i) => ({ g, r: rank(g.id, i) })).sort((a, b) => a.r - b.r).map((x) => x.g);
  }, [adminGroups, ov.admin?.groupOrder]);
  const moveAdmin = (id: string, dir: -1 | 1) => {
    const ids = adminOrdered.map((g) => g.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    setAdmin((a) => ({ ...a, groupOrder: ids }));
  };

  const save = () =>
    start(async () => {
      const res = await saveNavMenuOverrides({ overrides: ov, reason });
      push(res.error ?? res.message ?? "Kaydedildi.", res.error ? "err" : "ok");
      if (!res.error) setReason("");
    });
  const resetAll = () =>
    start(async () => {
      const res = await resetNavMenuOverrides({ reason });
      push(res.error ?? res.message ?? "Varsayılana dönüldü.", res.error ? "err" : "ok");
      if (!res.error) setOv({});
    });

  const renderHubRow = (h: EditorHub, idx: number, list: EditorHub[], movable: boolean) => {
    const hidden = isHidden(h.id) || groupHidden(h.group);
    const expanded = open === `${roleKey}:${h.id}`;
    const prevSame = movable && idx > 0 && list[idx - 1]!.group === h.group;
    const nextSame = movable && idx < list.length - 1 && list[idx + 1]!.group === h.group;
    return (
      <li key={h.id} className={`rounded-[var(--radius-control)] border border-line bg-surface ${hidden ? "opacity-60" : ""}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-2.5 py-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(expanded ? null : `${roleKey}:${h.id}`)} aria-expanded={expanded} aria-label={`${h.label} alt sayfaları`}>
            <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} aria-hidden />
          </Button>
          <Input
            aria-label={`${h.label} görünen adı`}
            value={r.labels?.[h.id] ?? ""}
            placeholder={h.label}
            maxLength={LABEL_MAX}
            disabled={!canEdit}
            onChange={(e) => setLabel(h.id, e.target.value)}
            className="h-9 min-w-0 flex-1 basis-40"
          />
          {r.labels?.[h.id] ? (
            <Button type="button" variant="ghost" size="icon" aria-label="Varsayılan ada dön" title={`Varsayılan: ${h.label}`} disabled={!canEdit} onClick={() => setLabel(h.id, "")}>
              <RotateCcw className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
          {movable ? (
            <span className="flex shrink-0 items-center gap-1">
              <Button type="button" variant="ghost" size="icon" aria-label={`${h.label} yukarı`} disabled={!canEdit || !prevSame} onClick={() => move(h.id, -1)}>
                <ArrowUp className="h-4 w-4" aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`${h.label} aşağı`} disabled={!canEdit || !nextSame} onClick={() => move(h.id, 1)}>
                <ArrowDown className="h-4 w-4" aria-hidden />
              </Button>
            </span>
          ) : null}
          {h.required ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs text-text-muted" title="Zorunlu satır: gizlenemez">
              <Lock className="h-3.5 w-3.5" aria-hidden /> Zorunlu
            </span>
          ) : (
            <Switch
              aria-label={`${h.label} menüde görünsün`}
              checked={!isHidden(h.id)}
              disabled={!canEdit}
              onCheckedChange={(on) => setRole((c) => ({ ...c, hidden: toggleIn(c.hidden, h.id, !on) }))}
            />
          )}
        </div>
        {expanded ? (
          <ul className="space-y-1 border-t border-line px-3 py-2" aria-label={`${h.label} alt sayfaları`}>
            {h.pages.map((p) => (
              <li key={p.key} className="flex min-w-0 flex-wrap items-center gap-2">
                <Input
                  aria-label={`${p.label} görünen adı`}
                  value={r.labels?.[p.key] ?? ""}
                  placeholder={p.label}
                  maxLength={LABEL_MAX}
                  disabled={!canEdit}
                  onChange={(e) => setLabel(p.key, e.target.value)}
                  className="h-8 min-w-0 flex-1 basis-40 text-xs"
                />
                <span className="hidden max-w-[12rem] truncate text-xs text-text-faint md:block" title={p.href}>
                  {p.href}
                </span>
                {r.labels?.[p.key] ? (
                  <Button type="button" variant="ghost" size="icon" aria-label="Varsayılan ada dön" disabled={!canEdit} onClick={() => setLabel(p.key, "")}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                ) : null}
                {p.locked ? (
                  <Lock className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-label="Zorunlu sayfa" />
                ) : (
                  <Switch
                    aria-label={`${p.label} görünsün`}
                    checked={!isHidden(p.key)}
                    disabled={!canEdit}
                    onCheckedChange={(on) => setRole((c) => ({ ...c, hidden: toggleIn(c.hidden, p.key, !on) }))}
                  />
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    );
  };

  // Grup blokları: ardışık aynı gruplu satırlar (grup başlığı + "Grubu gizle").
  const blocks: { group: string | null; hubs: EditorHub[]; start: number }[] = [];
  ordered.forEach((h, i) => {
    const last = blocks.at(-1);
    if (last && last.group === h.group) last.hubs.push(h);
    else blocks.push({ group: h.group, hubs: [h], start: i });
  });

  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Rol düzeni" className="flex flex-wrap gap-2">
        {layouts.map((l) => {
          const changed = Boolean(ov.roles?.[l.key]);
          return (
            <Button key={l.key} type="button" role="tab" aria-selected={l.key === roleKey} variant={l.key === roleKey ? "primary" : "outline"} size="lg" onClick={() => setRoleKey(l.key)}>
              <span className="max-w-[14rem] truncate" title={l.label}>{l.label}</span>
              {changed ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-label="değiştirildi" /> : null}
            </Button>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label={`${layout.label} menüsü`} className="min-w-0 space-y-4">
          {blocks.map((b) => (
            <div key={`${b.group ?? "-"}-${b.start}`} className="space-y-2">
              {b.group ? (
                <div className="flex items-center gap-3">
                  <h3 className="truncate text-xs font-bold uppercase tracking-[0.12em] text-text-muted" title={b.group}>{b.group}</h3>
                  <span className="h-px flex-1 bg-line" aria-hidden />
                  <label className="inline-flex shrink-0 items-center gap-2 text-xs text-text-muted">
                    {groupHidden(b.group) ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                    Grup görünsün
                    <Switch
                      aria-label={`${b.group} grubu görünsün`}
                      checked={!groupHidden(b.group)}
                      disabled={!canEdit}
                      onCheckedChange={(on) => setRole((c) => ({ ...c, hiddenGroups: toggleIn(c.hiddenGroups, b.group!, !on) }))}
                    />
                  </label>
                </div>
              ) : null}
              <ul className="space-y-2">{b.hubs.map((h, k) => renderHubRow(h, b.start + k, ordered, true))}</ul>
            </div>
          ))}
          {layout.dock.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-bold uppercase tracking-[0.12em] text-text-muted">Alt sabit bölüm</h3>
                <span className="h-px flex-1 bg-line" aria-hidden />
              </div>
              <ul className="space-y-2">{layout.dock.map((h, i) => renderHubRow(h, i, layout.dock, false))}</ul>
            </div>
          ) : null}
        </section>

        <aside aria-label="Canlı önizleme" className="min-w-0 xl:sticky xl:top-24 xl:self-start">
          <p className="mb-2 text-xs font-semibold text-text-muted">Canlı önizleme · {layout.label}</p>
          <div className="sb-surface overflow-hidden rounded-[var(--radius-card)] p-3 text-white">
            {preview.hubs.map((h, i) => {
              const head = h.group && h.group !== preview.hubs[i - 1]?.group;
              return (
                <div key={h.id}>
                  {head ? <p className="truncate px-2 pb-1 pt-3 text-xs font-bold uppercase tracking-[0.12em] text-white/55" title={h.group}>{h.group}</p> : null}
                  <div className="flex min-h-8 items-center gap-2 rounded-[var(--radius-control)] px-2 text-sm text-white/85" title={h.pages.map((p) => p.label).join(", ")}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/50" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{h.label}</span>
                    {h.pages.length > 1 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-white/45" aria-hidden /> : null}
                  </div>
                </div>
              );
            })}
            {preview.dock.length > 0 ? (
              <div className="mt-3 border-t border-white/10 pt-2">
                {preview.dock.map((h) => (
                  <div key={h.id} className="flex min-h-8 items-center gap-2 px-2 text-sm text-white/75">
                    <span className="min-w-0 flex-1 truncate" title={h.label}>{h.label}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-text-muted">Önizleme varsayılan yetkiyle süzülür; ofisin kendi yetki, modül ve paket kuralları ayrıca uygulanır.</p>
        </aside>
      </div>

      <section aria-labelledby="admin-groups-title" className="space-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
        <div>
          <h2 id="admin-groups-title" className="font-display text-base font-bold text-[var(--heading)]">Admin menüsü grupları</h2>
          <p className="text-sm text-text-muted">Platform yan menüsündeki grupların sırası ve görünürlüğü. Genel bakış ve Yönetim gizlenemez; gizlenen gruptaki sayfalar Ctrl K ile açılır.</p>
        </div>
        <ol className="space-y-2">
          {adminOrdered.map((g, i) => {
            const hidden = (ov.admin?.hiddenGroups ?? []).includes(g.id);
            return (
              <li key={g.id} className={`flex min-w-0 flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 ${hidden ? "opacity-60" : ""}`}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--heading)]" title={g.title}>{g.title}</span>
                  <span className="block truncate text-xs text-text-muted" title={g.items.map((x) => x.label).join(", ")}>{g.items.map((x) => x.label).join(" · ")}</span>
                </span>
                <Button type="button" variant="ghost" size="icon" aria-label={`${g.title} yukarı`} disabled={!canEdit || i === 0} onClick={() => moveAdmin(g.id, -1)}>
                  <ArrowUp className="h-4 w-4" aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label={`${g.title} aşağı`} disabled={!canEdit || i === adminOrdered.length - 1} onClick={() => moveAdmin(g.id, 1)}>
                  <ArrowDown className="h-4 w-4" aria-hidden />
                </Button>
                {g.required ? (
                  <span className="inline-flex items-center gap-1 text-xs text-text-muted"><Lock className="h-3.5 w-3.5" aria-hidden /> Zorunlu</span>
                ) : (
                  <Switch
                    aria-label={`${g.title} grubu görünsün`}
                    checked={!hidden}
                    disabled={!canEdit}
                    onCheckedChange={(on) => setAdmin((a) => ({ ...a, hiddenGroups: toggleIn(a.hiddenGroups, g.id, !on) }))}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4">
          <label className="min-w-0 flex-1 basis-64 text-sm">
            <span className="mb-1 block font-semibold text-ink-900">Gerekçe (isteğe bağlı)</span>
            <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Ör. muhasebe menüsü sadeleştirildi" />
          </label>
          <Button type="button" variant="outline" disabled={pending || (!initial.roles && !initial.admin && !dirty)} onClick={resetAll}>
            <RotateCcw className="h-4 w-4" aria-hidden /> Varsayılana dön
          </Button>
          <Button type="button" disabled={pending || !dirty} onClick={save}>
            {pending ? "Kaydediliyor…" : "Kaydet"}
          </Button>
        </div>
      ) : (
        <p role="status" className="text-sm text-text-muted">Salt okunur: menüleri yalnız süper admin düzenleyebilir.</p>
      )}
    </div>
  );
}
