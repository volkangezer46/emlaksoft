import Link from "@/components/ui/smart-link";
import { ArrowLeft, Inbox } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { Pagination, pageRange } from "@/app/admin/_components/pagination";
import { isSchemaMissing } from "@/lib/platform-announcements/queue";
import { describeSegment, parseSegment } from "@/lib/platform-announcements/segment";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { DeliveryActions } from "./delivery-actions";
import { Megaphone } from "lucide-react";

const STATUS_FILTERS = [
  { id: "", label: "Tümü" },
  { id: "sent", label: "Teslim" },
  { id: "okundu", label: "Okundu" },
  { id: "tiklandi", label: "Tıklandı" },
  { id: "pending", label: "Kuyrukta" },
  { id: "failed", label: "Başarısız" },
  { id: "skipped", label: "Atlandı" },
  { id: "expired", label: "Gitmedi (iptal/bitiş)" },
] as const;

const CHANNEL_FILTERS = [
  { id: "", label: "Tüm kanallar" },
  { id: "in_app", label: "Uygulama içi" },
  { id: "email", label: "E-posta" },
  { id: "push", label: "Push" },
] as const;

const STATUS_LABEL: Record<string, string> = {
  pending: "Kuyrukta",
  sending: "Gönderiliyor",
  sent: "Teslim",
  failed: "Başarısız",
  skipped: "Atlandı",
  expired: "Gitmedi",
};
const STATUS_CLS: Record<string, string> = {
  sent: "bg-mint-500/10 text-mint-600",
  failed: "bg-danger-500/10 text-danger-600",
  skipped: "bg-canvas text-text-muted",
  expired: "bg-canvas text-text-muted",
  pending: "bg-brand-600/10 text-brand-600",
  sending: "bg-brand-600/10 text-brand-600",
};
const CHANNEL_LABEL: Record<string, string> = { in_app: "Uygulama içi", email: "E-posta", push: "Push" };

type Delivery = {
  id: string;
  channel: string;
  status: string;
  error: string | null;
  attempts: number;
  sent_at: string | null;
  read_at: string | null;
  clicked_at: string | null;
  tenant_id: string;
  user_id: string;
  tenant: { name?: string } | { name?: string }[] | null;
  user: { full_name?: string | null } | { full_name?: string | null }[] | null;
};

const nameOf = <T extends Record<string, unknown>>(v: T | T[] | null, k: keyof T) => {
  const o = Array.isArray(v) ? v[0] : v;
  return (o?.[k] as string | null | undefined) ?? null;
};

/** Duyurunun alıcı bazında teslim listesi: durum/kanal filtresi (URL), sayfalama, yeniden dene. */
export async function DeliveryDetail({ id, status, channel, page, canEdit }: { id: string; status?: string; channel?: string; page: number; canEdit: boolean }) {
  const admin = createAdminClient();
  const st = STATUS_FILTERS.find((f) => f.id === status)?.id ?? "";
  const ch = CHANNEL_FILTERS.find((f) => f.id === channel)?.id ?? "";
  let q = admin
    .from("platform_announcement_deliveries")
    .select("id, channel, status, error, attempts, sent_at, read_at, clicked_at, tenant_id, user_id, tenant:tenants(name), user:profiles!platform_announcement_deliveries_user_id_fkey(full_name)", { count: "exact" })
    .eq("announcement_id", id);
  if (st === "okundu") q = q.not("read_at", "is", null);
  else if (st === "tiklandi") q = q.not("clicked_at", "is", null);
  else if (st === "pending") q = q.in("status", ["pending", "sending"]);
  else if (st) q = q.eq("status", st);
  if (ch) q = q.eq("channel", ch);

  const [{ data: a }, list] = await Promise.all([
    admin
      .from("platform_announcements")
      .select("id, title, body, status, channels, segment_json, recipient_count, delivered_count, failed_count, read_count, click_count, tenant:tenants(name)")
      .eq("id", id)
      .maybeSingle(),
    q.order("status").order("created_at").range(...pageRange(page)),
  ]);
  const href = (p: { durum?: string; kanal?: string; sayfa?: number }) => {
    const sp = new URLSearchParams({ duyuru: id });
    const d = p.durum ?? st;
    const k = p.kanal ?? ch;
    if (d) sp.set("durum", d);
    if (k) sp.set("kanal", k);
    if (p.sayfa && p.sayfa > 1) sp.set("sayfa", String(p.sayfa));
    return `/admin/duyuru?${sp.toString()}`;
  };

  if (!a) {
    return (
      <div className="space-y-4">
        <Link href="/admin/duyuru" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
          <ArrowLeft className="h-4 w-4" /> Duyurulara dön
        </Link>
        <p className="rounded-[var(--radius-panel)] border border-line bg-surface px-5 py-10 text-center text-sm text-text-muted">Duyuru bulunamadı.</p>
      </div>
    );
  }
  const ann = a as unknown as { id: string; title: string; status: string; segment_json: unknown; recipient_count: number; delivered_count: number; failed_count: number; read_count: number; click_count: number; tenant: { name?: string } | null };
  const seg = parseSegment(ann.segment_json);
  const rows = (list.data ?? []) as unknown as Delivery[];
  const fmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" });
  const schemaMissing = list.error && isSchemaMissing(list.error);

  return (
    <div className="space-y-5">
      <Link href="/admin/duyuru" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Duyurulara dön
      </Link>
      <AdminPageHeader
        art="megaphone"
        eyebrow="Teslim raporu"
        icon={Megaphone}
        title={ann.title}
        description={`${seg.ok ? describeSegment(seg.value, { tenant: nameOf(ann.tenant as Record<string, unknown> | null, "name") }) : "Segment"} · ${ann.recipient_count} alıcı · ${ann.delivered_count} teslim · ${ann.failed_count} başarısız · ${ann.read_count} okundu · ${ann.click_count} tıklandı`}
      />
      {canEdit ? <DeliveryActions id={ann.id} status={ann.status} failed={ann.failed_count} /> : null}

      <nav aria-label="Teslim filtresi" className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link
            key={f.id || "tum"}
            href={href({ durum: f.id, sayfa: 1 })}
            aria-current={f.id === st ? "page" : undefined}
            className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition ${f.id === st ? "border-brand-600 bg-brand-600/10 text-brand-600" : "border-line text-text-muted hover:text-ink-950"}`}
          >
            {f.label}
          </Link>
        ))}
        <span className="mx-1 w-px bg-line" aria-hidden />
        {CHANNEL_FILTERS.map((f) => (
          <Link
            key={f.id || "tum-kanal"}
            href={href({ kanal: f.id, sayfa: 1 })}
            aria-current={f.id === ch ? "page" : undefined}
            className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold transition ${f.id === ch ? "border-brand-600 bg-brand-600/10 text-brand-600" : "border-line text-text-muted hover:text-ink-950"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        {schemaMissing ? (
          <p className="px-5 py-10 text-center text-sm text-text-muted">Teslim kayıtları için veritabanı güncellemesi bekleniyor.</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-sm text-text-muted">
            <Inbox className="h-6 w-6 text-text-faint" />
            Bu filtrede alıcı yok.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line bg-canvas/60 text-left text-xs text-text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Ofis</th>
                  <th className="px-4 py-2 font-semibold">Kullanıcı</th>
                  <th className="px-4 py-2 font-semibold">Kanal</th>
                  <th className="px-4 py-2 font-semibold">Durum</th>
                  <th className="px-4 py-2 font-semibold">Teslim</th>
                  <th className="px-4 py-2 font-semibold">Okundu / tıklandı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td className="px-4 py-2">
                      <Link href={`/admin/tenants/${d.tenant_id}`} className="font-semibold text-brand-600 hover:underline">
                        {nameOf(d.tenant as Record<string, unknown> | null, "name") ?? "Ofis"}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-ink-950">{nameOf(d.user as Record<string, unknown> | null, "full_name") ?? "Kullanıcı"}</td>
                    <td className="px-4 py-2 text-text-muted">{CHANNEL_LABEL[d.channel] ?? d.channel}</td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_CLS[d.status] ?? "bg-canvas text-text-muted"}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
                      {d.error ? <span className="mt-0.5 block max-w-xs truncate text-xs text-text-muted" title={d.error}>{d.error}</span> : null}
                    </td>
                    <td className="px-4 py-2 text-xs text-text-muted">{d.sent_at ? fmt.format(new Date(d.sent_at)) : "—"}{d.attempts > 1 ? ` · ${d.attempts}. deneme` : ""}</td>
                    <td className="px-4 py-2 text-xs text-text-muted">
                      {d.read_at ? `Okundu ${fmt.format(new Date(d.read_at))}` : "—"}
                      {d.clicked_at ? ` · Tıklandı ${fmt.format(new Date(d.clicked_at))}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 pb-4">
          <Pagination page={page} total={list.count ?? 0} hrefFor={(p) => href({ sayfa: p })} />
        </div>
      </section>
    </div>
  );
}
