import Link from "@/components/ui/smart-link";
import { MailCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { DAY_MS, now as clockNow } from "@/lib/clock";
import { relativeTimeTR } from "@/lib/admin-format";
import { fetchAllRowsKeepError } from "@/lib/supabase/fetch-all";
import { FORWARDING_LABELS, forwardingState, maskSampleForAdmin, type ForwardingState } from "@/lib/eids/actions-core";

/**
 * EİDS ALIMI paneli (Sistem > Entegrasyonlar): ofis bazında iletme durumu, doğrulama dağılımı (son 90 gün), unknown_format
 * sayısı ve platform genelinde son maskeli örnek, SMTP alıcı sağlığı. Platform geneli salt okuma (kapı: IntegrationsView).
 * GİZLİLİK: malik adı/özeti hiçbir sütunda OKUNMAZ; örnek metin EP3'te maskeli saklanır ve burada ikinci kez maskelenir.
 * Tablolar yoksa (EP3 migration'ı uygulanmamış) "kurulum bekliyor" der.
 */
type Msg = { tenant_id: string; auth_result: string; parse_kind: string | null; received_via: string; received_at: string };
type Addr = { tenant_id: string; created_at: string; last_received_at: string | null };
type Counts = { verified: number; arc: number; unverified: number; rejected: number; unknown: number };

const STATE_CLS: Record<ForwardingState, string> = {
  bagli: "bg-mint-500/12 text-mint-700",
  sessiz: "bg-danger-500/10 text-danger-600",
  kurulmadi: "bg-ink-950/[0.06] text-text-muted",
};

export async function EidsIntakePanel() {
  const admin = createAdminClient();
  const nowMs = clockNow();
  const since = new Date(nowMs - 90 * DAY_MS).toISOString();
  const [msgRes, addrRes, sampleRes] = await Promise.all([
    fetchAllRowsKeepError<Msg, { message: string; code?: string }>(
      (from, to) =>
        admin
          .from("eids_inbound_messages")
          .select("tenant_id, auth_result, parse_kind, received_via, received_at")
          .gte("received_at", since)
          .order("received_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to),
      1000,
      20,
    ),
    admin.from("eids_inbound_addresses").select("tenant_id, created_at, last_received_at").is("revoked_at", null).limit(1000),
    admin.from("eids_inbound_messages").select("sample_masked, received_at").eq("parse_kind", "unknown").not("sample_masked", "is", null).order("received_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (msgRes.error || addrRes.error) {
    return (
      <section id="eids-alim" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
          <MailCheck className="h-3.5 w-3.5" /> EİDS e-posta alımı
        </p>
        <p className="mt-2 text-sm text-text-muted">Kurulum bekliyor: Bakanlık e-postası alım tabloları bu ortamda henüz yok.</p>
      </section>
    );
  }

  const msgs = (msgRes.data ?? []) as Msg[];
  const addrs = (addrRes.data ?? []) as Addr[];
  const by = new Map<string, Counts>();
  for (const m of msgs) {
    const c = by.get(m.tenant_id) ?? { verified: 0, arc: 0, unverified: 0, rejected: 0, unknown: 0 };
    if (m.auth_result === "verified") c.verified += 1;
    else if (m.auth_result === "verified_via_arc") c.arc += 1;
    else if (m.auth_result === "unverified") c.unverified += 1;
    else if (m.auth_result === "rejected") c.rejected += 1;
    if (m.parse_kind === "unknown") c.unknown += 1;
    by.set(m.tenant_id, c);
  }
  const addrBy = new Map<string, Addr>();
  for (const a of addrs) {
    const cur = addrBy.get(a.tenant_id);
    if (!cur || Date.parse(a.created_at) > Date.parse(cur.created_at)) addrBy.set(a.tenant_id, a);
  }
  const tenantIds = [...new Set([...by.keys(), ...addrBy.keys()])];
  const { data: tenants } = tenantIds.length ? await admin.from("tenants").select("id, name").in("id", tenantIds.slice(0, 500)) : { data: [] };
  const nameOf = new Map(((tenants ?? []) as { id: string; name: string | null }[]).map((t) => [t.id, t.name ?? "Ofis"]));

  const smtp = msgs.filter((m) => m.received_via === "smtp");
  const lastSmtp = smtp[0]?.received_at ?? null;
  const smtp24h = smtp.filter((m) => nowMs - Date.parse(m.received_at) < DAY_MS).length;
  const unknownTotal = msgs.filter((m) => m.parse_kind === "unknown").length;
  const sample = maskSampleForAdmin((sampleRes.data as { sample_masked?: string | null } | null)?.sample_masked ?? null);

  return (
    <section id="eids-alim" className="scroll-mt-24 rounded-[var(--radius-panel)] border border-line bg-surface p-5">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
        <MailCheck className="h-3.5 w-3.5" /> EİDS e-posta alımı
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-control)] border border-line p-3">
          <p className="text-xs text-text-muted">SMTP alıcı: son e-posta</p>
          <p className={`mt-1 text-sm font-semibold ${lastSmtp && nowMs - Date.parse(lastSmtp) < 7 * DAY_MS ? "text-mint-600" : "text-danger-500"}`}>
            {lastSmtp ? relativeTimeTR(lastSmtp) : "Hiç alınmadı"}
          </p>
          <p className="text-xs text-text-muted">Son 24 saatte {smtp24h} e-posta</p>
        </div>
        <div className="rounded-[var(--radius-control)] border border-line p-3">
          <p className="text-xs text-text-muted">Bağlı ofis (90 gün)</p>
          <p className="mt-1 text-sm font-semibold text-ink-950">
            {[...addrBy.values()].filter((a) => forwardingState(a, nowMs) === "bagli").length} / {addrBy.size}
          </p>
          <p className="text-xs text-text-muted">Alma adresi kurulu ofisler</p>
        </div>
        <div className="rounded-[var(--radius-control)] border border-line p-3">
          <p className="text-xs text-text-muted">Kalıba uymayan (unknown_format, 90 gün)</p>
          <p className={`mt-1 text-sm font-semibold ${unknownTotal > 0 ? "text-amber-700" : "text-mint-600"}`}>{unknownTotal}</p>
          <p className="text-xs text-text-muted">Şablon değişmiş olabilir</p>
        </div>
      </div>

      {sample ? (
        <div className="mt-3 rounded-[var(--radius-control)] border border-dashed border-line-strong p-3">
          <p className="text-xs font-semibold text-text-muted">Son kalıba uymayan e-posta (maskeli)</p>
          <p className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-ink-950">{sample}</p>
        </div>
      ) : null}

      {tenantIds.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="adm-tbl-m w-full md:min-w-[36rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="py-2 font-medium">Ofis</th>
                <th className="py-2 font-medium">İletme</th>
                <th className="py-2 font-medium">Doğrulanmış</th>
                <th className="py-2 font-medium">ARC ile</th>
                <th className="py-2 font-medium">Doğrulanamadı</th>
                <th className="py-2 font-medium">Reddedildi</th>
                <th className="py-2 font-medium">Kalıp dışı</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tenantIds.map((id) => {
                const c = by.get(id) ?? { verified: 0, arc: 0, unverified: 0, rejected: 0, unknown: 0 };
                const st = forwardingState(addrBy.get(id) ?? null, nowMs);
                return (
                  <tr key={id}>
                    <td className="py-2">
                      <Link href={`/admin/tenants/${id}`} className="focus-ring font-semibold text-brand-600 hover:underline">
                        {nameOf.get(id) ?? "Ofis"}
                      </Link>
                    </td>
                    <td data-label="İletme" className="py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATE_CLS[st]}`}>{FORWARDING_LABELS[st]}</span>
                    </td>
                    <td data-label="Doğrulanmış" className="py-2 tabular-nums">{c.verified}</td>
                    <td data-label="ARC ile" className="py-2 tabular-nums">{c.arc}</td>
                    <td data-label="Doğrulanamadı" className="py-2 tabular-nums">{c.unverified}</td>
                    <td data-label="Reddedildi" className="py-2 tabular-nums">{c.rejected}</td>
                    <td data-label="Kalıp dışı" className={`py-2 tabular-nums ${c.unknown > 0 ? "font-semibold text-amber-700" : ""}`}>{c.unknown}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-muted">Henüz hiçbir ofis Bakanlık e-postası iletmedi.</p>
      )}
    </section>
  );
}
