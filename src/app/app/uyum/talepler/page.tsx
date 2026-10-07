import Link from "@/components/ui/smart-link";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { now } from "@/lib/clock";
import {
  KVKK_REQUEST_LABELS,
  KVKK_STATUS_LABELS,
  daysLeft,
  isKvkkStatus,
  type KvkkRequestType,
} from "@/lib/compliance/kvkk-requests";
import { NewRequestForm, StatusForm } from "./request-forms";

export const metadata = { title: "KVKK talepleri" };

type Row = {
  id: string;
  request_type: KvkkRequestType;
  status: string;
  requester_name: string | null;
  note: string | null;
  due_at: string;
  resolution_note: string | null;
  created_at: string;
  customer: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
};

/** KVKK veri sahibi talepleri + ofis hesap kapatma / veri indirme talepleri (kayıt ve süre takibi). */
export default async function KvkkRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string }>;
}) {
  const { perms, role } = await requireModulePage("compliance", "/app/uyum");
  const sp = (await searchParams) ?? {};
  const durum = isKvkkStatus(sp.durum) ? sp.durum : "";
  const canCreate = (perms.compliance ?? []).includes("create");
  const canEdit = (perms.compliance ?? []).includes("edit");
  const supabase = await createClient();

  const [reqRes] = await Promise.all([
    supabase
      .from("kvkk_requests")
      .select(
        "id, request_type, status, requester_name, note, due_at, resolution_note, created_at, customer:customers!kvkk_requests_customer_id_fkey(id, full_name)",
      )
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const supported = !reqRes.error;
  const all = (reqRes.data ?? []) as unknown as Row[];
  const rows = durum ? all.filter((r) => r.status === durum) : all;
  const nowMs = now();
  const open = all.filter((r) => r.status === "open" || r.status === "in_progress");
  const overdue = open.filter((r) => daysLeft(r.due_at, nowMs) < 0);

  return (
    <div className="space-y-6">
      <Link href="/app/uyum" className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" /> KVKK ve uyum
      </Link>
      <PageHeader
        title="KVKK talepleri"
        eyebrow="Veri sahibi başvuruları"
        icon={<ClipboardList className="h-6 w-6" />}
        description="Erişim, taşınabilirlik, düzeltme, itiraz ve silme taleplerini; ofis hesabı kapatma ve veri indirme taleplerini süresiyle kaydedin."
        className="mb-0"
      />

      {!supported ? (
        <Alert tone="warning" title="Talep kaydı bu ortamda henüz etkin değil">
          Veritabanı güncellemesi uygulandığında bu sayfa otomatik çalışır; mevcut KVKK silme paneli etkilenmez.
        </Alert>
      ) : (
        <>
          <StatRow
            items={[
              { label: "Tüm talepler", value: all.length, href: "/app/uyum/talepler" },
              { label: "Açık / işlemde", value: open.length, href: "/app/uyum/talepler?durum=open" },
              { label: "Süresi geçen", value: overdue.length, href: "/app/uyum/talepler?durum=open", attention: true },
              { label: "Tamamlanan", value: all.filter((r) => r.status === "completed").length, href: "/app/uyum/talepler?durum=completed" },
            ]}
          />

          {canCreate ? (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Yeni talep</CardTitle>
                  <CardDescription>Silme / anonimleştirme işlemi için KVKK ve uyum sayfasındaki panel kullanılır; burada yalnız talep kaydı tutulur.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <NewRequestForm canOfficeLevel={role === "owner" || role === "gm"} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Talepler{durum ? ` · ${KVKK_STATUS_LABELS[durum]}` : ""}</CardTitle>
                {durum ? (
                  <CardDescription>
                    <Link href="/app/uyum/talepler" className="font-semibold text-brand-600 hover:underline">Filtreyi temizle</Link>
                  </CardDescription>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              {rows.length === 0 ? (
                <EmptyState
                  variant="compact"
                  bare
                  icon={ClipboardList}
                  tone={durum ? "brand" : "mint"}
                  title={durum ? `${KVKK_STATUS_LABELS[durum]} durumunda talep yok` : "Henüz KVKK talebi kaydı yok"}
                  description={
                    durum
                      ? "Süzgeci kaldırıp tüm talepleri görün."
                      : "Veri sahibi size erişim, düzeltme veya silme başvurusu yaptığında yukarıdaki formdan kaydedin; yasal 30 günlük süre otomatik izlenir."
                  }
                  action={durum ? { href: "/app/uyum/talepler", label: "Filtreyi temizle" } : { href: "/app/uyum", label: "KVKK ve uyum merkezi" }}
                />
              ) : (
                <ul className="divide-y divide-line">
                  {rows.map((r) => {
                    const cust = Array.isArray(r.customer) ? r.customer[0] : r.customer;
                    const left = daysLeft(r.due_at, nowMs);
                    const active = r.status === "open" || r.status === "in_progress";
                    return (
                      <li key={r.id} className="grid gap-3 py-3 md:grid-cols-[1.2fr_1fr_auto] md:items-start">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink-950">{KVKK_REQUEST_LABELS[r.request_type] ?? r.request_type}</p>
                          <p className="mt-0.5 text-xs text-text-muted">
                            {cust ? (
                              <Link href={`/app/musteriler/${cust.id}`} className="font-semibold text-brand-600 hover:underline">{cust.full_name}</Link>
                            ) : (
                              r.requester_name ?? "Ofis talebi"
                            )}
                            {" · "}
                            {new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(r.created_at))}
                          </p>
                          {r.note ? <p className="mt-1 text-xs text-text-muted">{r.note}</p> : null}
                          {r.resolution_note ? <p className="mt-1 text-xs text-text">Çözüm: {r.resolution_note}</p> : null}
                        </div>
                        <p className={`text-xs font-semibold ${active && left < 0 ? "text-danger-600" : "text-text-muted"}`}>
                          {active
                            ? left < 0
                              ? `Süre ${Math.abs(left)} gün önce doldu`
                              : `${left} gün kaldı`
                            : KVKK_STATUS_LABELS[r.status as keyof typeof KVKK_STATUS_LABELS] ?? r.status}
                        </p>
                        <StatusForm id={r.id} status={r.status} canEdit={canEdit} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
