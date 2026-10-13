import { Mail, MapPin, Phone } from "lucide-react";
import type { ContactBlock } from "../schema-core";
import { Container } from "./shared";

/** Sayfaya basılabilir kurum iletişim bilgisi: /admin/seo kurum bilgisinden (organization) SALT OKUNUR gelir. */
export type ContactInfo = { email: string; phone: string; address: string };

const telHref = (v: string) => `tel:${(v.trim().startsWith("+") ? "+" : "") + v.replace(/\D/g, "")}`;

/** İletişim bloğu: yalnız girilmiş (doğrulanabilir) bilgi gösterilir; uydurma numara/adres yazılmaz. Hiç bilgi yoksa çizilmez. */
export function ContactBlockView({ block, info }: { block: ContactBlock; info: ContactInfo }) {
  const rows: Array<{ key: string; icon: React.ReactNode; label: string; value: string; href?: string }> = [];
  if (block.showEmail && info.email) rows.push({ key: "e", icon: <Mail aria-hidden className="h-5 w-5" />, label: "E-posta", value: info.email, href: `mailto:${info.email}` });
  if (block.showPhone && info.phone) rows.push({ key: "p", icon: <Phone aria-hidden className="h-5 w-5" />, label: "Telefon", value: info.phone, href: telHref(info.phone) });
  if (block.showAddress && info.address) rows.push({ key: "a", icon: <MapPin aria-hidden className="h-5 w-5" />, label: "Adres", value: info.address });
  if (rows.length === 0) return null;
  return (
    <section className="py-10 sm:py-14">
      <Container narrow>
        {block.heading ? <h2 className="font-display text-2xl font-extrabold text-ink-950 sm:text-3xl">{block.heading}</h2> : null}
        <ul className={`${block.heading ? "mt-6" : ""} grid gap-3 sm:grid-cols-2`}>
          {rows.map((r) => (
            <li key={r.key} className="flex gap-3 rounded-[var(--radius-card)] border border-line bg-surface-2 p-4">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] bg-brand-600/10 text-brand-700">{r.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink-950">{r.label}</p>
                {r.href ? (
                  <a href={r.href} className="mt-1 inline-flex min-h-11 items-center break-all text-sm font-semibold text-brand-700 hover:underline">
                    {r.value}
                  </a>
                ) : (
                  <p className="mt-1 whitespace-pre-line text-sm text-text-muted">{r.value}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
