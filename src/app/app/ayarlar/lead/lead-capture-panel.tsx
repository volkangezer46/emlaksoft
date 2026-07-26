"use client";

import { useState, useTransition } from "react";
import { Check, Copy, ExternalLink, Link2, Power, RefreshCw, Store, Webhook } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { regenerateLeadToken, setLeadCaptureEnabled } from "@/app/actions/lead-intake";

function CopyRow({ label, value, icon: Icon }: { label: string; value: string; icon: React.ComponentType<{ className?: string }> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-[14px] border border-line bg-canvas p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-text-muted">
        <Icon className="h-3.5 w-3.5" /> {label}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-[10px] border border-line bg-surface px-3 py-2 text-xs text-ink-950">
          {value}
        </code>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[10px] border border-line bg-surface px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-mint-600" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
    </div>
  );
}

export function LeadCapturePanel({
  token,
  enabled,
  baseUrl,
  vitrinUrl,
}: {
  token: string;
  enabled: boolean;
  baseUrl: string;
  vitrinUrl?: string;
}) {
  const [pending, startTransition] = useTransition();
  const formUrl = `${baseUrl}/lead/${token}`;
  const webhookUrl = `${baseUrl}/api/leads/${token}`;

  const embed = `<!-- EmlakSoft aday formu -->
<form action="${webhookUrl}" method="POST">
  <input name="full_name" placeholder="Ad soyad" required />
  <input name="phone" placeholder="Telefon" />
  <input name="email" placeholder="E-posta" />
  <select name="transaction_type">
    <option value="satilik">Satılık</option>
    <option value="kiralik">Kiralık</option>
  </select>
  <textarea name="message" placeholder="Mesajınız"></textarea>
  <button type="submit">Gönder</button>
</form>`;

  const curl = `curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -d '{"full_name":"Ahmet Yılmaz","phone":"05551112233","transaction_type":"satilik","source":"reklam"}'`;

  return (
    <div className="space-y-5">
      <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-ink-950">Form durumu</h2>
            <p className="mt-1 text-xs text-text-muted">
              Kapatıldığında genel form ve bağlantı yeni aday kabul etmez.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${enabled ? "bg-mint-500/12 text-mint-600" : "bg-ink-950/8 text-text-muted"}`}>
              {enabled ? "Açık" : "Kapalı"}
            </span>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const fd = new FormData();
                fd.set("enabled", String(!enabled));
                startTransition(() => setLeadCaptureEnabled(fd));
              }}
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-300 disabled:opacity-60"
            >
              <Power className="h-3.5 w-3.5" /> {enabled ? "Kapat" : "Aç"}
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display font-bold text-ink-950">Bağlantılar</h2>
          <div className="flex items-center gap-2">
            <a
              href={formUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
            >
              <ExternalLink className="h-3.5 w-3.5" /> Formu aç
            </a>
            <ConfirmDialog
              title="Anahtarı yenile"
              description="Anahtar yenilenirse mevcut form ve bağlantı uç noktası çalışmaz; sitenize gömdüğünüz formu yeni adresle güncellemeniz gerekir."
              confirmLabel="Yenile"
              onConfirm={async () => {
                await regenerateLeadToken();
              }}
              trigger={
                <button
                  type="button"
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-danger-500 transition hover:border-danger-500/40 disabled:opacity-60"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Anahtarı yenile
                </button>
              }
            />
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          {vitrinUrl ? <CopyRow label="Herkese açık portföy vitrini" value={vitrinUrl} icon={Store} /> : null}
          <CopyRow label="Paylaşılabilir form bağlantısı" value={formUrl} icon={Link2} />
          <CopyRow label="Bağlantı uç noktası (POST)" value={webhookUrl} icon={Webhook} />
        </div>
        {vitrinUrl ? (
          <a
            href={vitrinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-canvas px-3 py-2 text-xs font-semibold text-brand-600 transition hover:border-brand-300"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Vitrini önizle
          </a>
        ) : null}
      </section>

      <section className="rounded-[20px] border border-line bg-surface p-5 shadow-[var(--shadow-xs)]">
        <h2 className="font-display font-bold text-ink-950">Kendi sitenize gömün</h2>
        <p className="mt-1 text-xs text-text-muted">
          Aşağıdaki HTML formunu web sitenize yapıştırın; gelen talepler doğrudan CRM&apos;e düşer ve danışmana atanır.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-[12px] border border-line bg-canvas p-4 text-[11px] leading-relaxed text-ink-800">
          <code>{embed}</code>
        </pre>
        <h3 className="mt-4 text-sm font-bold text-ink-950">API ile (cURL)</h3>
        <pre className="mt-2 overflow-x-auto rounded-[12px] border border-line bg-canvas p-4 text-[11px] leading-relaxed text-ink-800">
          <code>{curl}</code>
        </pre>
        <ul className="mt-3 space-y-1 text-xs text-text-muted">
          <li>• Desteklenen alanlar: full_name, phone, email, message, source, transaction_type, property_type, province_id, budget_min, budget_max, rooms</li>
          <li>• Aynı telefon numarası tekrar gelirse mevcut müşteriye eşlenir (mükerrer kayıt önlenir).</li>
          <li>• Her aday, en az yüklü aktif danışmana otomatik atanır ve anında bildirim gönderilir.</li>
        </ul>
      </section>
    </div>
  );
}
