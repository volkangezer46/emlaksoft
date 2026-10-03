/** Ofis (tenant) rol anahtarı -> Türkçe etiket. Ham anahtar ("branch_manager") arayüzde gösterilmez. */
export const ROLE_LABELS: Record<string, string> = {
  owner: "Ofis sahibi",
  gm: "Genel müdür",
  branch_manager: "Şube müdürü",
  team_lead: "Takım lideri",
  advisor: "Danışman",
  call_center: "Çağrı merkezi",
  accounting: "Muhasebe",
  readonly: "Salt okunur",
};

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "";
  return ROLE_LABELS[role] ?? ROLE_LABELS[role.toLowerCase()] ?? role.replace(/_/g, " ");
}
