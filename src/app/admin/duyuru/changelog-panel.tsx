import Link from "@/components/ui/smart-link";
import { Pencil } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { now, toTrLocalInput } from "@/lib/clock";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";
import { ChangelogDelete, ChangelogForm, type ChangelogInit } from "./changelog-form";

type Entry = { id: string; title: string; body: string | null; category: string; href: string | null; published_at: string | null; created_at: string };

export const CHANGELOG_CATEGORY: Record<string, { label: string; cls: string }> = {
  yeni: { label: "Yeni", cls: "bg-mint-500/15 text-mint-600" },
  iyilestirme: { label: "İyileştirme", cls: "bg-brand-600/15 text-brand-600" },
  duzeltme: { label: "Düzeltme", cls: "bg-amber-400/15 text-amber-700" },
};

/** Yenilikler sekmesi: girdi formu + liste (yayında / planlı / taslak). */
export async function ChangelogPanel({ canEdit, isSuperAdmin, editId }: { canEdit: boolean; isSuperAdmin: boolean; editId?: string }) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("changelog_entries")
    .select("id, title, body, category, href, published_at, created_at")
    .order("published_at", { ascending: false, nullsFirst: true })
    .limit(60);
  if (error && isSchemaMissing(error)) {
    return <p className="rounded-[var(--radius-panel)] border border-amber-400/30 bg-amber-400/8 px-5 py-6 text-sm text-amber-700">Kurulum bekliyor: Yenilikler tablosu veritabanı güncellemesiyle (20261013004700) gelir.</p>;
  }
  const rows = (data ?? []) as Entry[];
  const t = now();
  const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
  const editing = editId ? rows.find((r) => r.id === editId) : undefined;
  const init: ChangelogInit | undefined = editing
    ? {
        id: editing.id,
        title: editing.title,
        body: editing.body,
        category: editing.category,
        href: editing.href,
        publishedLocal: editing.published_at ? toTrLocalInput(editing.published_at) : "",
        draft: !editing.published_at,
      }
    : undefined;

  return (
    <div className="space-y-5">
      {canEdit ? <ChangelogForm key={editing?.id ?? "yeni"} init={init} /> : null}
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display font-bold text-ink-950">Yenilikler</h2>
          <p className="mt-1 text-xs text-text-muted">Yayınlanan girdi ofis panelinin üst çubuğundaki &quot;Yenilikler&quot; düğmesinde okunmamış rozeti oluşturur; çekmece açılınca okundu sayılır.</p>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">Henüz girdi yok. Yayına giren özellikleri buradan ofislere duyurun.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => {
              const state = !r.published_at ? "Taslak" : new Date(r.published_at).getTime() > t ? `Planlı: ${fmt.format(new Date(r.published_at))}` : fmt.format(new Date(r.published_at));
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${CHANGELOG_CATEGORY[r.category]?.cls ?? ""}`}>{CHANGELOG_CATEGORY[r.category]?.label ?? r.category}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-950">{r.title}</p>
                    <p className="text-xs text-text-muted">{state}</p>
                  </div>
                  {canEdit ? (
                    <span className="flex items-center gap-2">
                      <Link href={`/admin/duyuru?sekme=yenilikler&duzenle=${r.id}#yenilik-formu`} className="inline-flex min-h-9 touch:min-h-11 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 text-xs font-semibold text-ink-950 hover:border-brand-600">
                        <Pencil className="h-3.5 w-3.5 text-brand-600" /> Düzenle
                      </Link>
                      {isSuperAdmin ? <ChangelogDelete id={r.id} /> : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
