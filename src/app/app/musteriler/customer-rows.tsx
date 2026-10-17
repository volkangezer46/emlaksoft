import { Eye, MessageCircle, Phone } from "lucide-react";
import { toWhatsAppMsisdn } from "@/lib/phone";
import { SpriteIcon } from "@/components/ui/icon-sprite";
import { IntentLink } from "@/components/app/intent-link";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  EntityThumb,
  RowActionAnchor,
  rowActionClass,
  RowActionLink,
  RowActions,
  StatusPill,
  type Density,
  type PillTone,
} from "@/components/ui/list-kit";
import { CustomerRowCheckbox, CustomerSelectAllCheckbox } from "./customer-bulk-actions";
import { CustomerRowMore } from "./customer-row-delete";
import { customerTypeTone } from "./customer-list-logic";
import { CallOutcomeStrip } from "@/components/app/call-outcome";

/** Sayfanın hazırladığı, sunuma hazır müşteri satır modeli. */
export type CustomerVM = {
  id: string;
  name: string;
  href: string;
  types: string[];
  tags: string[];
  heat: { label: string; short: string; tone: PillTone; title: string } | null;
  /** Müşteri durumu okuyucusunun riski (yalnız yüksek risk gösterilir); yoksa null. */
  risk?: { label: string; title: string } | null;
  blacklist: boolean;
  sourceLabel: string | null;
  /** Başvuru kanalı rozeti (customers.lead_channel); kanaldan gelmeyen kayıtta null. */
  channelLabel?: string | null;
  phone: string | null;
  phoneDisplay: string | null;
  telHref: string | null;
  waHref: string | null;
  email: string | null;
  province: string;
  advisor: string | null;
  lastContact: string | null;
  addedLabel: string;
  createdLabel: string;
};

function TypeCell({ types, tags }: { types: string[]; tags: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {types.length > 0 ? (
        <StatusPill tone={customerTypeTone(types[0]!)} dot={false}>
          {types[0]}
        </StatusPill>
      ) : (
        <span className="text-text-faint">—</span>
      )}
      {types.length > 1 ? (
        <span className="text-xs font-semibold text-text-faint" title={types.slice(1).join(", ")}>
          +{types.length - 1}
        </span>
      ) : null}
      {tags.slice(0, 2).map((t) => (
        <span key={t} className="rounded-full border border-line px-2 py-0.5 text-xs font-medium text-text-muted max-md:hidden">
          {t}
        </span>
      ))}
      {tags.length > 2 ? (
        <span className="text-xs font-semibold text-text-faint max-md:hidden" title={tags.slice(2).join(", ")}>
          +{tags.length - 2}
        </span>
      ) : null}
    </div>
  );
}

function HeatCell({ c, simple }: { c: CustomerVM; simple: boolean }) {
  if (c.blacklist) return <StatusPill tone="danger">Kara liste</StatusPill>;
  return (
    <div className="flex items-center gap-1.5">
      {c.heat ? (
        <span title={simple ? undefined : c.heat.title}>
          <StatusPill tone={c.heat.tone}>{simple ? c.heat.short : c.heat.label}</StatusPill>
        </span>
      ) : null}
      {c.risk ? (
        <span title={c.risk.title}>
          <StatusPill tone="danger">{c.risk.label}</StatusPill>
        </span>
      ) : null}
    </div>
  );
}

/**
 * md+ tablo görünümü; <768 px'te kompakt kart (list-page.css `.tbl-stack`): kimlik + eylemler bir satır, tür/sıcaklık/
 * telefon ikinci satır. Etiketler ve e-posta kartta gizli (detayda var) — 390×844'te ilk ekranda ≥4 müşteri.
 */
export function CustomerTable({
  rows,
  ids,
  canBulk,
  canEdit,
  canDelete,
  density,
  sortHeader,
  simple = false,
}: {
  rows: CustomerVM[];
  ids: string[];
  canBulk: boolean;
  canEdit: boolean;
  canDelete: boolean;
  density: Density;
  /** Sıralanabilir başlık hücreleri (sayfa üretir: sıralama linkleri URL kontratına bağlı). */
  sortHeader: { name: React.ReactNode; created: React.ReactNode; nameSort?: "ascending" | "descending"; createdSort?: "ascending" | "descending" };
  /**
   * Sade görünüm (C15): telefon kartında yalnız ad, tür ve son temas + tek "Ara" düğmesi; sıcaklık puansız etiket.
   * WhatsApp ve "⋮" telefonda gizli (müşteri kartında var), geniş ekranda aynen durur.
   */
  simple?: boolean;
}) {
  const mobileHide = simple ? "max-md:hidden" : undefined;
  return (
    <div>
      {/* Rahat yoğunlukta satır 10 px dikey boşlukla ~58 px: 1366×768'de ilk 5 müşteri ilk ekranda (P1 9). */}
      <TableFrame stack minWidth={canBulk ? 980 : 940} density={density} maxHeight="75vh" className={density === "kompakt" ? undefined : "md:[&_td]:py-2.5"}>
        <Table>
          <THead sticky>
            <TR>
              {canBulk ? (
                <TH className="w-10">
                  <CustomerSelectAllCheckbox ids={ids} />
                </TH>
              ) : null}
              <TH aria-sort={sortHeader.nameSort}>{sortHeader.name}</TH>
              <TH>Tür</TH>
              <TH>Sıcaklık</TH>
              <TH>İletişim</TH>
              <TH className="hidden 2xl:table-cell">Danışman</TH>
              {/* 2xl altında sütun yok (F5: 1366'da yapışkan eylem hücresinin altında kırpılıyordu); değer adın altında. */}
              <TH className="hidden 2xl:table-cell">Son temas</TH>
              <TH className="hidden 2xl:table-cell" aria-sort={sortHeader.createdSort}>
                {sortHeader.created}
              </TH>
              <TH align="right">
                <span className="sr-only">İşlemler</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((c) => (
              <TR key={c.id} interactive>
                {canBulk ? (
                  <TD className="w-10">
                    <CustomerRowCheckbox id={c.id} name={c.name} />
                  </TD>
                ) : null}
                <TD primary>
                  <IntentLink href={c.href} className="absolute inset-0" aria-label={`${c.name} detayları`} />
                  <div className="flex items-center gap-3">
                    {/* Kartta (<768 px) baş harf avatarı gizli: üç eylem düğmesinin yanında ada yer kalsın. */}
                    <EntityThumb alt="" name={c.name} size="sm" className="max-md:hidden" />
                    <div className="min-w-0">
                      <p className="max-w-[14rem] truncate font-semibold text-text">{c.name}</p>
                      {simple ? (
                        <p className="mt-0.5 truncate text-sm text-text-muted md:hidden">
                          {c.lastContact ? `Son temas: ${c.lastContact.toLocaleLowerCase("tr-TR")}` : "Henüz temas yok"}
                        </p>
                      ) : null}
                      <p className="mt-0.5 hidden truncate text-xs text-text-muted md:block 2xl:hidden">
                        {c.lastContact ? `Son temas: ${c.lastContact.toLocaleLowerCase("tr-TR")}` : "Henüz temas yok"}
                      </p>
                      <p className={`mt-0.5 flex items-center gap-1.5 truncate text-xs text-text-muted ${simple ? "max-md:hidden" : ""}`}>
                        <span className="inline-flex items-center gap-1">
                          <SpriteIcon name="map-pin" className="h-3 w-3 text-text-faint" />
                          {c.province}
                        </span>
                        {c.sourceLabel ? <span>· {c.sourceLabel}</span> : null}
                        {c.channelLabel ? (
                          <span className="rounded-full bg-brand-600/8 px-1.5 py-0.5 font-semibold text-brand-700" title="Başvuru kanalı">
                            {c.channelLabel}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                </TD>
                <TD>
                  <TypeCell types={c.types} tags={c.tags} />
                </TD>
                <TD className={mobileHide}>
                  <HeatCell c={c} simple={simple} />
                </TD>
                <TD className={mobileHide}>
                  {c.phoneDisplay ? (
                    <p className="numeric flex items-center gap-1.5 text-text-muted">
                      <SpriteIcon name="phone" className="h-3.5 w-3.5 text-brand-600" />
                      {c.phoneDisplay}
                    </p>
                  ) : (
                    <p className="text-text-faint">—</p>
                  )}
                  {c.email ? (
                    <p className="mt-0.5 flex max-w-[14rem] items-center gap-1.5 truncate text-xs text-text-faint max-md:hidden">
                      <SpriteIcon name="mail" className="h-3 w-3 shrink-0" />
                      <span className="truncate">{c.email}</span>
                    </p>
                  ) : null}
                </TD>
                <TD stackHide className="hidden text-text-muted 2xl:table-cell">{c.advisor ?? <span className="text-text-faint">Atanmadı</span>}</TD>
                <TD stackHide className="hidden text-text-muted 2xl:table-cell">
                  {c.lastContact ?? <span className="text-text-faint">Temas yok</span>}
                </TD>
                <TD stackHide className="numeric hidden text-text-muted 2xl:table-cell">{c.createdLabel}</TD>
                <TD actions>
                  <RowActions>
                    <RowActionLink href={c.href} label={`${c.name} detayını aç`} icon={Eye} hideWhenStacked />
                    {/* Temas sonrası sonuç kaydı: bu kapsayıcıdaki tel:/WhatsApp tıklaması arama sonucu şeridini açar. */}
                    <span className="contents" data-contact-outcome="" data-customer-id={c.id} data-customer-name={c.name} data-phone={c.phone ?? ""}>
                      {c.telHref ? (
                        simple ? (
                          // Sade görünüm: etiketli "Ara" — masaüstünde 32 px çerçeveli, telefon kartında 44 px dolgulu (WP3).
                          <a href={c.telHref} aria-label={`${c.name} numarasını ara`} className={rowActionClass({ phonePrimary: true, className: "touch:h-11" })}>
                            <Phone className="h-4 w-4" aria-hidden /> Ara
                          </a>
                        ) : (
                          <RowActionAnchor href={c.telHref} label={`${c.name} numarasını ara`} icon={Phone} />
                        )
                      ) : null}
                      {c.waHref ? (
                        <span className={simple ? "contents max-md:hidden" : "contents"}>
                          <RowActionLink href={c.waHref} label={`${c.name} ile WhatsApp görüşmesi`} icon={MessageCircle} external tone="success" />
                        </span>
                      ) : null}
                    </span>
                    <span className={simple ? "contents max-md:hidden" : "contents"}>
                      <CustomerRowMore customerId={c.id} name={c.name} waMsisdn={toWhatsAppMsisdn(c.phone) || null} canEdit={canEdit} canDelete={canDelete} />
                    </span>
                  </RowActions>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableFrame>
      <CallOutcomeStrip />
    </div>
  );
}

