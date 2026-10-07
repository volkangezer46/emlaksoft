/** Ayarlar sayfasının tek ofis satırı (başlık + Marka/kimlik sekmesi aynı sorgudan). */
export type SettingsTenant = {
  name: string;
  plan: string;
  tax_office: string | null;
  tax_number: string | null;
  license_no: string | null;
  brand_color: string | null;
  iban: string | null;
  phone: string | null;
  address_line: string | null;
  city: string | null;
  province_id: string | null;
  district_id: string | null;
  logo_url: string | null;
  website: string | null;
  sample_seeded_at: string | null;
};

export const SETTINGS_TENANT_COLUMNS =
  "name, plan, tax_office, tax_number, license_no, brand_color, iban, phone, address_line, city, province_id, district_id, logo_url, website, sample_seeded_at";

export const EMPTY_SETTINGS_TENANT: SettingsTenant = {
  name: "", plan: "office", tax_office: null, tax_number: null, license_no: null, brand_color: null, iban: null, phone: null,
  address_line: null, city: null, province_id: null, district_id: null, logo_url: null, website: null, sample_seeded_at: null,
};
