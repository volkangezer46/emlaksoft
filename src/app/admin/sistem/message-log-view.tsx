import Link from "@/components/ui/smart-link";
import { MessageSquareText } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Pagination, parsePage } from "@/app/admin/_components/pagination";
import {
  MESSAGE_ACCOUNT_LABEL,
  MESSAGE_AUDIENCE_LABEL,
  MESSAGE_CHANNEL_LABEL,
  MESSAGE_STATUSES,
  MESSAGE_STATUS_LABEL,
  MESSAGE_STATUS_TONE,
  isMessageChannel,
  isMessageStatus,
  loadMessageLog,
  messageSourceLabel,
} from "@/lib/messaging/message-log-read";
import type { MessageChannel, MessageLogStatus } from "@/lib/messaging/message-log";
import { formatDateTimeTr } from "@/lib/format";

const PAGE_SIZE = 50;
const BASE = "/admin/sistem";
const ANCHOR = "mesaj-gunlugu";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TONE_VARIANT: Record<string, BadgeVariant> = { success: "success", warn: "warning", danger: "danger", info: "info", neutral: "neutral" };
const CHANNELS: MessageChannel[] = ["sms", "whatsapp"];

export type MessageLogSearch = { kanal?: string; durum?: string; ofis?: string; sayfa?: string };

const chipCls = (active: boolean) =>
  `focus-ring press inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition touch:h-11 ${
    active ? "border-brand-500 bg-brand-500/10 text-brand-700" : "border-line bg-surface text-text-muted hover:border-brand-400"
  }`;

/**
 * SMS ve WhatsApp gönderim günlüğü (SN3; Entegrasyon merkezi bölümü `#mesaj-gunlugu`). Süzgeçler URL'de
 * (kanal · durum · ofis · sayfa), sunucu süzgeci + gerçek sayfalama; durum çipleri o kümeyi listeler. Alıcı yalnız maskeli,
 * mesaj gövdesi saklanmaz. Teslim/başarısız durumu Netgsm iletim raporu ve Meta durum webhook'uyla güncellenir.
 */
export async function MessageLogView({ sp }: { sp: MessageLogSearch }) {
  const channel = isMessageChannel(sp.kanal) ? sp.kanal : undefined;
  const status = isMessageStatus(sp.durum) ? sp.durum : undefined;
  const tenantId = sp.ofis && UUID_RE.test(sp.ofis) ? sp.ofis : undefined;
  const page = parsePage(sp.sayfa);
  const data = await loadMessageLog({ channel, status, tenantId, page, pageSize: PAGE_SIZE });

  const href = (over: Partial<Record<"kanal" | "durum" | "ofis" | "sayfa", string | undefined>>) => {
    const p = new URLSearchParams({ sekme: "entegrasyonlar" });
    const merged = { kanal: channel, durum: status, ofis: tenantId, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `${BASE}?${p.toString()}#${ANCHOR}`;
  };
  const variant = (s: MessageLogStatus) => TONE_VARIANT[MESSAGE_STATUS_TONE[s]] ?? "neutral";

  return (
    <section id={ANCHOR} className="scroll-mt-24 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
      <div className="border-b border-line px-5 py-3.5">
        <p className="flex items-center gap-2 text-xs font-semibold text-brand-600">
          <MessageSquareText className="h-4 w-4" aria-hidden /> SMS ve WhatsApp
        </p>
        <h2 className="mt-1 font-display font-bold text-ink-950">Gönderim günlüğü</h2>
        <p className="mt-0.5 text-xs text-text-muted">
          Platformun ve ofislerin gönderdiği her SMS ve WhatsApp mesajı. Teslim bilgisi Netgsm iletim raporu ve Meta durum bildirimiyle güncellenir.
        </p>
      </div>

      {!data.installed ? (
        <p className="px-5 py-4 text-sm text-text-muted">
          Günlük kurulum bekliyor: tablo (migration 20261014023000) henüz uygulanmadı. Gönderimler sürer, kayıt tutulmaz.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <Link href={href({ kanal: undefined, sayfa: undefined })} aria-current={!channel ? "true" : undefined} className={chipCls(!channel)}>
              Tüm kanallar
            </Link>
            {CHANNELS.map((c) => (
              <Link key={c} href={href({ kanal: channel === c ? undefined : c, sayfa: undefined })} aria-current={channel === c ? "true" : undefined} className={chipCls(channel === c)}>
                {MESSAGE_CHANNEL_LABEL[c]}
              </Link>
            ))}
            <span className="mx-1 h-5 w-px bg-line" aria-hidden />
            {MESSAGE_STATUSES.map((s) => (
              <Link key={s} href={href({ durum: status === s ? undefined : s, sayfa: undefined })} aria-current={status === s ? "true" : undefined} className={chipCls(status === s)}>
                {MESSAGE_STATUS_LABEL[s]} <span className="numeric text-ink-950">{data.statusCounts[s] ?? 0}</span>
              </Link>
            ))}
            {tenantId ? (
              <Link href={href({ ofis: undefined, sayfa: undefined })} className="text-xs font-semibold text-brand-600 hover:underline">
                Ofis süzgecini kaldır ({data.tenantNames.get(tenantId) ?? "seçili ofis"}) ×
              </Link>
            ) : null}
            <p className="ml-auto text-xs text-text-muted">
              <span className="numeric font-semibold text-ink-950">{data.total}</span> kayıt
            </p>
          </div>

          {data.rows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-text-muted">
              Bu süzgeçte gönderim yok. Netgsm ya da WhatsApp üzerinden giden her mesaj (giriş kodu, kampanya, hatırlatma, test) burada görünür.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="adm-tbl-m w-full md:min-w-[820px] text-left text-xs">
                <thead className="text-text-muted">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-semibold">Zaman</th>
                    <th className="px-4 py-2 font-semibold">Kanal</th>
                    <th className="px-4 py-2 font-semibold">Alıcı</th>
                    <th className="px-4 py-2 font-semibold">Akış</th>
                    <th className="px-4 py-2 font-semibold">Ofis</th>
                    <th className="px-4 py-2 font-semibold">Durum</th>
                    <th className="px-4 py-2 font-semibold">Maliyet</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.rows.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-2 text-text-muted">{formatDateTimeTr(r.created_at)}</td>
                      <td data-label="Kanal" className="px-4 py-2">
                        <Link href={href({ kanal: r.channel, sayfa: undefined })} className="font-semibold text-ink-950 hover:text-brand-600">
                          {MESSAGE_CHANNEL_LABEL[r.channel] ?? r.channel}
                        </Link>
                        <p className="text-text-faint">{MESSAGE_ACCOUNT_LABEL[r.account] ?? r.account}</p>
                      </td>
                      <td data-label="Alıcı" className="numeric px-4 py-2 text-ink-950">{r.to_masked}</td>
                      <td data-label="Akış" className="px-4 py-2">
                        <span className="font-semibold text-ink-950">{messageSourceLabel(r.source)}</span>
                        <p className="text-text-faint">{MESSAGE_AUDIENCE_LABEL[r.audience] ?? r.audience}</p>
                      </td>
                      <td data-label="Ofis" className="px-4 py-2">
                        {r.tenant_id ? (
                          <Link href={`/admin/tenants/${r.tenant_id}?sekme=zaman&kategori=iletisim`} className="font-semibold text-brand-600 hover:underline">
                            {data.tenantNames.get(r.tenant_id) ?? "Ofis"}
                          </Link>
                        ) : (
                          <span className="text-text-faint">—</span>
                        )}
                      </td>
                      <td data-label="Durum" className="px-4 py-2">
                        <Link href={href({ durum: r.status, sayfa: undefined })}>
                          <Badge variant={variant(r.status)} size="sm">
                            {MESSAGE_STATUS_LABEL[r.status] ?? r.status}
                          </Badge>
                        </Link>
                        {r.error ? <p className="mt-1 max-w-[260px] text-text-muted">{r.error}</p> : null}
                        {r.delivered_at && r.status !== "delivered" ? <p className="mt-1 text-text-faint">Teslim: {formatDateTimeTr(r.delivered_at)}</p> : null}
                      </td>
                      <td data-label="Maliyet" className="whitespace-nowrap px-4 py-2 text-text-muted">
                        {r.channel === "sms" ? (r.segments ? `${r.segments} SMS kredisi` : "—") : r.pricing_category ? `Meta: ${r.pricing_category}` : "Meta faturası"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="px-5 py-3">
            <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} hrefFor={(p) => href({ sayfa: p > 1 ? String(p) : undefined })} />
          </div>
        </>
      )}
      <p className="border-t border-line px-5 py-3 text-xs text-text-faint">
        Numara yalnız son iki hanesiyle gösterilir, mesaj metni saklanmaz. Kayıtlar 400 gün sonra silinir. Netgsm rapor adresi:
        /api/webhooks/netgsm-rapor (gizli anahtarla).
      </p>
    </section>
  );
}
