import Link from "@/components/ui/smart-link";
import { Pencil } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { now, toTrLocalInput } from "@/lib/clock";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";
import { describeSegment, parseSegment } from "@/lib/platform-announcements/segment";
import { BannerForm, BannerToggle, type BannerInit } from "./banner-form";
import type { SegmentInit, SegmentOptions } from "./segment-builder";

type BannerRow = {
  id: string;
  title: string;
  body: string | null;
  level: string;
  display: string;
  dismissible: boolean;
  href: string | null;
  starts_at: string;
  ends_at: string | null;
  tenant_ids: string[] | null;
  segment_json: unknown;
  is_active: boolean;
};

const LEVEL: Record<string, { label: string; cls: string }> = {
  info: { label: "Bilgi", cls: "bg-brand-600/15 text-brand-600" },
  warning: { label: "Uyarı", cls: "bg-amber-400/15 text-amber-700" },
  critical: { label: "Kritik", cls: "bg-danger-500/15 text-danger-600" },
};

/** Banner sekmesi: form (yeni ya da `duzenle=<id>`) + tüm banner'lar (yayında / planlı / bitti / kaldırıldı). */
export async function BannerPanel({
  options,
  canEdit,
  minLocal,
  editId,
  segInit,
}: {
  options: SegmentOptions;
  canEdit: boolean;
  minLocal: string;
  editId?: string;
  segInit?: SegmentInit;
}) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_banners")
    .select("id, title, body, level, display, dismissible, href, starts_at, ends_at, tenant_ids, segment_json, is_active")
    .order("starts_at", { ascending: false })
    .limit(50);
  if (error && isSchemaMissing(error)) {
    return <p className="rounded-[var(--radius-panel)] border border-amber-400/30 bg-amber-400/8 px-5 py-6 text-sm text-amber-700">Kurulum bekliyor: banner tablosu veritabanı güncellemesiyle (20261013004700) gelir.</p>;
  }
  const rows = (data ?? []) as BannerRow[];
  const t = now();
  const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Istanbul" });
  const stateOf = (b: BannerRow) =>
    !b.is_active ? "Kaldırıldı" : new Date(b.starts_at).getTime() > t ? "Planlı" : b.ends_at && new Date(b.ends_at).getTime() <= t ? "Bitti" : "Yayında";
  const editing = editId ? rows.find((b) => b.id === editId) : undefined;
  const init: BannerInit | undefined = editing
    ? {
        id: editing.id,
        title: editing.title,
        body: editing.body,
        level: editing.level,
        display: editing.display,
        dismissible: editing.dismissible,
        href: editing.href,
        startsLocal: toTrLocalInput(editing.starts_at),
        endsLocal: editing.ends_at ? toTrLocalInput(editing.ends_at) : "",
      }
    : undefined;
  const editSeg = editing ? parseSegment(editing.segment_json) : null;
  const editSegInit: SegmentInit | undefined =
    editSeg && editSeg.ok
      ? {
          plans: editSeg.value.plans,
          statuses: editSeg.value.statuses,
          trialDays: editSeg.value.trialEndsWithinDays?.toString(),
          loginMode: editSeg.value.lastLogin?.mode,
          loginDays: editSeg.value.lastLogin?.days.toString(),
          city: editSeg.value.cities?.join(", "),
          module: editSeg.value.module?.key,
          moduleState: editSeg.value.module ? (editSeg.value.module.enabled ? "on" : "off") : "on",
          tenant: editSeg.value.tenantIds?.length === 1 ? editSeg.value.tenantIds[0] : undefined,
        }
      : undefined;

  return (
    <div className="space-y-5">
      {canEdit ? <BannerForm key={editing?.id ?? "yeni"} options={options} init={init} segInit={editSegInit ?? segInit} minLocal={minLocal} /> : null}
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-display font-bold text-ink-950">Banner&apos;lar</h2>
          <p className="mt-1 text-xs text-text-muted">Ofis panelinde aynı anda en çok 3 banner görünür (kritik önce). Hedef ofis listesi kayıt anında segmentten çözülür.</p>
        </div>
        {rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">Henüz banner yok. Bakım, kesinti ya da önemli bir değişikliği ofis panelinin üstünde duyurmak için yukarıdan oluşturun.</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((b) => {
              const seg = parseSegment(b.segment_json);
              const st = stateOf(b);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${LEVEL[b.level]?.cls ?? ""}`}>{LEVEL[b.level]?.label ?? b.level}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-950">{b.title}</p>
                    <p className="text-xs text-text-muted">
                      {st} · {b.display === "modal" ? "Modal" : "Şerit"} · {b.dismissible ? "kapatılabilir" : "kapatılamaz"} · {fmt.format(new Date(b.starts_at))}
                      {b.ends_at ? ` – ${fmt.format(new Date(b.ends_at))}` : " – süresiz"} ·{" "}
                      {b.tenant_ids ? `${b.tenant_ids.length} ofis${seg.ok ? ` (${describeSegment(seg.value)})` : ""}` : "Tüm ofisler"}
                    </p>
                  </div>
                  {canEdit ? (
                    <span className="flex items-center gap-2">
                      <Link href={`/admin/duyuru?sekme=banner&duzenle=${b.id}#banner-formu`} className="inline-flex min-h-9 items-center gap-1 rounded-[var(--radius-control)] border border-line px-2.5 text-xs font-semibold text-ink-950 hover:border-brand-600">
                        <Pencil className="h-3.5 w-3.5 text-brand-600" /> Düzenle
                      </Link>
                      <BannerToggle id={b.id} active={b.is_active} />
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
