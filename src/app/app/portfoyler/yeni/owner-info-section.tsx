"use client";

import { useState } from "react";
import { UserPlus, UserSearch } from "lucide-react";
import { searchCustomers } from "@/app/actions/lookup";
import { Combobox } from "@/components/ui/combobox";
import { EmailInput } from "@/components/ui/email-input";
import { PhoneInput } from "@/components/ui/phone-input";
import { FormField, FormInput, FormSelect, FormTextarea } from "@/components/ui/form-controls";
import {
  AUTHORIZATION_TYPES,
  COMMISSION_KINDS,
  DEED_STATUSES,
  LISTING_SOURCES,
  OWNER_RELATIONS,
} from "@/lib/property-owner/info";

const SECTION = "sm:col-span-2 rounded-[var(--radius-card)] border border-line bg-canvas/50 p-4";
const H = "mb-3 text-sm font-semibold text-ink-950";

/**
 * "İlan sahibi" sekmesi: ilanın sahibi/müşterisi ile ilgili tüm yapılandırılmış bilgiler.
 * Sahip ya mevcut müşteriden seçilir ya da yeni müşteri olarak açılır; kayıt `createProperty` içinde müşteri kaydına bağlanır.
 * Kimlik/vergi numarası BİLEREK toplanmaz (veri minimizasyonu). Zorunlu alanlar eksikse ilan taslak kalır, yayına alınamaz.
 */
export function OwnerInfoSection({ poolEnabled }: { poolEnabled: boolean }) {
  const [mode, setMode] = useState<"existing" | "new">("existing");

  return (
    <>
      <input type="hidden" name="owner_info_present" value="1" />

      <div className={SECTION}>
        <p className={H}>İlan sahibi (müşteri kaydı)</p>
        <div className="mb-3 inline-flex rounded-[var(--radius-control)] border border-line bg-surface p-0.5 text-xs font-semibold" role="group" aria-label="Sahip kaydı türü">
          <button
            type="button"
            aria-pressed={mode === "existing"}
            onClick={() => setMode("existing")}
            className={`focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 transition ${mode === "existing" ? "bg-ink-950 text-white" : "text-text-muted"}`}
          >
            <UserSearch className="h-3.5 w-3.5" /> Mevcut müşteri
          </button>
          <button
            type="button"
            aria-pressed={mode === "new"}
            onClick={() => setMode("new")}
            className={`focus-ring inline-flex items-center gap-1.5 rounded-[var(--radius-control)] px-3 py-1.5 transition ${mode === "new" ? "bg-ink-950 text-white" : "text-text-muted"}`}
          >
            <UserPlus className="h-3.5 w-3.5" /> Yeni müşteri
          </button>
        </div>

        {mode === "existing" ? (
          <FormField label="Müşteri ara" htmlFor="owner-customer" hint="Ad, telefon veya e-posta ile en az 2 karakter yazın." inject={false}>
            <Combobox
              id="owner-customer"
              name="owner_customer_id"
              options={[]}
              onSearch={searchCustomers}
              minSearchLength={2}
              clearable
              placeholder="Müşteri seçin"
              searchPlaceholder="Ad, telefon veya e-posta…"
              emptyText="Müşteri bulunamadı"
            />
          </FormField>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Ad soyad / unvan" htmlFor="owner-name" className="sm:col-span-2">
              <FormInput id="owner-name" name="owner_name" autoComplete="off" placeholder="Örn. Ayşe Yılmaz" />
            </FormField>
            <FormField label="Telefon" htmlFor="owner-phone">
              <PhoneInput id="owner-phone" name="owner_phone" />
            </FormField>
            <FormField label="E-posta" htmlFor="owner-email">
              <EmailInput id="owner-email" name="owner_email" placeholder="ornek@eposta.com" />
            </FormField>
          </div>
        )}
      </div>

      <FormField label="Sahiple ilişki" htmlFor="owner-relation">
        <FormSelect id="owner-relation" name="owner_relation" defaultValue="">
          <option value="">Seçin</option>
          {OWNER_RELATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="İlan kaynağı" htmlFor="listing-source">
        <FormSelect id="listing-source" name="listing_source" defaultValue="">
          <option value="">Seçin</option>
          {LISTING_SOURCES.map((s) => <option key={s}>{s}</option>)}
        </FormSelect>
      </FormField>

      <FormField label="Tapu durumu" htmlFor="deed-status">
        <FormSelect id="deed-status" name="deed_status" defaultValue="">
          <option value="">Seçin</option>
          {DEED_STATUSES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Tapu notu" htmlFor="deed-note" hint="İpotek, şerh, hisse bilgisi vb.">
        <FormInput id="deed-note" name="deed_note" maxLength={1000} />
      </FormField>

      <div className={SECTION}>
        <p className={H}>Yetki sözleşmesi</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Yetki türü" htmlFor="authorization-type">
            <FormSelect id="authorization-type" name="authorization_type" defaultValue="">
              <option value="">Seçin</option>
              {AUTHORIZATION_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Komisyon türü" htmlFor="commission-kind" hint="Oran/tutar “Fiyat ve komisyon” sekmesindeki komisyon alanıdır.">
            <FormSelect id="commission-kind" name="commission_kind" defaultValue="yuzde">
              {COMMISSION_KINDS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Yetki başlangıcı" htmlFor="authorization-start" hint="Tek yetkide zorunlu.">
            <FormInput id="authorization-start" name="authorization_start" type="date" />
          </FormField>
          <FormField label="Yetki bitişi" htmlFor="authorization-end" hint="Tek yetkide zorunlu.">
            <FormInput id="authorization-end" name="authorization_end" type="date" />
          </FormField>
          <FormField label="Yetki belgesi no (EİDS taşınmaz numarası)" htmlFor="eids-property-no" hint="Mal sahibi e-Devlet EİDS’te yetkiyi onaylayınca üretilir; portal ilanı bu numarayla yayınlanır. Yetki en az 3 ay olmalıdır. Resmî doğrulama değildir." className="sm:col-span-2">
            <FormInput id="eids-property-no" name="eids_property_no" maxLength={40} autoComplete="off" placeholder="Numara (isteğe bağlı)" />
          </FormField>
          <FormField label="Minimum fiyat" htmlFor="min-price" hint="Sahibin kabul edeceği en düşük fiyat; liste fiyatını aşamaz.">
            <FormInput id="min-price" name="min_price" inputMode="decimal" placeholder="6.000.000" />
          </FormField>
          <FormField label="Pazarlık payı (%)" htmlFor="negotiation-margin">
            <FormInput id="negotiation-margin" name="negotiation_margin_pct" inputMode="decimal" placeholder="5" />
          </FormField>
        </div>
      </div>

      <FormField label="Müşteri notları" htmlFor="owner-customer-notes" className="sm:col-span-2" hint="Sahibin beklentisi, satış nedeni, aciliyet…">
        <FormTextarea id="owner-customer-notes" name="owner_customer_notes" rows={3} maxLength={4000} />
      </FormField>
      <FormField label="Görüşme geçmişi" htmlFor="owner-contact-history" className="sm:col-span-2" hint="İlk görüşme tarihi, kimlerle konuşuldu, verilen sözler.">
        <FormTextarea id="owner-contact-history" name="owner_contact_history" rows={3} maxLength={4000} />
      </FormField>

      <div className={SECTION}>
        <p className={H}>KVKK ve iletişim izni</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="kvkk_consent" value="1" className="mt-1 h-4 w-4" />
          <span>
            İlan sahibine KVKK aydınlatma metni verildi ve verilerinin işlenmesine onay alındı{" "}
            <span className="text-xs font-semibold text-danger-600">(yayın için zorunlu)</span>
          </span>
        </label>
        <label className="mt-2 flex items-start gap-2 text-sm">
          <input type="checkbox" name="contact_permission" value="1" className="mt-1 h-4 w-4" />
          <span>Ticari elektronik ileti (SMS/e-posta/arama) izni var</span>
        </label>
      </div>

      {poolEnabled ? (
        <label className="sm:col-span-2 flex items-start gap-2 rounded-[var(--radius-card)] border border-line p-3 text-sm">
          <input type="checkbox" name="send_to_pool" value="1" className="mt-1 h-4 w-4" />
          <span>
            <span className="font-semibold text-ink-950">İlan havuzuna gönder</span>
            <span className="block text-xs text-text-muted">İlanı kendine almak yerine yönetimin uzmanlığa göre bir danışmana atamasını iste.</span>
          </span>
        </label>
      ) : null}

      <p className="sm:col-span-2 text-xs text-text-muted">
        Eksik zorunlu bilgi olan ilan <strong className="font-semibold text-ink-950">taslak kalır</strong>; yayına alınamaz. Fotoğraf, açıklama ve portal yayını
        detay sayfasında tamamlanır. Ofis yönetimi bu bilgilerin tamamını görür; diğer danışmanlar yalnız kendi ilanlarında görür.
      </p>
    </>
  );
}
