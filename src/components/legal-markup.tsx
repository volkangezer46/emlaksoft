import Link from "next/link";
import type { SupportContact } from "@/lib/contact-info";
import type { LegalEntityField } from "@/lib/legal-entity";
import { groupSections, parseLegalMarkup, type Block, type Inline } from "@/lib/legal-docs/core";

/**
 * DB'deki yasal belge metnini (yasal işaretleme, src/lib/legal-docs/core.ts) koddaki sürümle AYNI görsel düzende çizer:
 * numaralı bölüm başlığı + paragraf/madde. Ham HTML yoktur; bağlantılar güvenli adres süzgecinden geçmiştir.
 * Hem herkese açık sayfa hem admin önizlemesi kullanır (sunucu bileşeni; durum yok).
 */
const LINK = "font-semibold text-brand-600";

function InlineView({ nodes, contact }: { nodes: readonly Inline[]; contact: SupportContact }) {
  return (
    <>
      {nodes.map((n, i) => {
        if (n.t === "text") return <span key={i}>{n.v}</span>;
        if (n.t === "bold") return <b key={i}><InlineView nodes={n.v} contact={contact} /></b>;
        if (n.t === "token") return <a key={i} className={LINK} href={contact.mailto}>{contact.email}</a>;
        if (n.href.startsWith("/") && !n.href.startsWith("//")) return <Link key={i} className={LINK} href={n.href}>{n.v}</Link>;
        const external = n.href.startsWith("https://");
        return (
          <a key={i} className={LINK} href={n.href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            {n.v}
          </a>
        );
      })}
    </>
  );
}

function BlockView({ b, contact, entity }: { b: Block; contact: SupportContact; entity: readonly LegalEntityField[] }) {
  if (b.t === "para") return <p><InlineView nodes={b.v} contact={contact} /></p>;
  if (b.t === "list") {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {b.items.map((it, i) => <li key={i}><InlineView nodes={it} contact={contact} /></li>)}
      </ul>
    );
  }
  if (b.t === "entity") {
    // Şirket kimliği ayar defterinden (boş alan gösterilmez) + isteğe bağlı destek hatları.
    return (
      <ul className="list-disc space-y-1 pl-5">
        {entity.map((f) => <li key={f.key}><b>{f.label}:</b> {f.value}</li>)}
        {contact.phone && contact.tel ? <li><b>Destek telefonu:</b> <a className={LINK} href={contact.tel}>{contact.phone}</a></li> : null}
        {contact.whatsapp && contact.whatsappUrl ? (
          <li><b>WhatsApp:</b> <a className={LINK} href={contact.whatsappUrl} target="_blank" rel="noopener noreferrer">{contact.whatsapp}</a></li>
        ) : null}
      </ul>
    );
  }
  return null;
}

export function LegalMarkupBody({ body, contact, entity }: { body: string; contact: SupportContact; entity: readonly LegalEntityField[] }) {
  const sections = groupSections(parseLegalMarkup(body));
  return (
    <>
      {sections.map((s, i) => (
        <section key={i}>
          {s.title ? (
            <h2 className="flex items-baseline gap-2.5 font-display text-lg font-bold text-ink-950">
              {s.no ? <span className="text-sm font-extrabold text-brand-600">{s.no}</span> : null}
              {s.title}
            </h2>
          ) : null}
          <div className={`${s.title ? "mt-2.5 " : ""}space-y-3 text-sm leading-relaxed text-ink-800`}>
            {s.blocks.map((b, j) => <BlockView key={j} b={b} contact={contact} entity={entity} />)}
          </div>
        </section>
      ))}
    </>
  );
}
