/** Modülleri açıp kapatabilen roller: yalnız ofis sahibi ve genel müdür (RLS yazma politikasıyla aynı). */
export const MODULE_MANAGER_ROLES: readonly string[] = ["owner", "gm"];

export function canManageModules(role: string | null | undefined): boolean {
  return typeof role === "string" && MODULE_MANAGER_ROLES.includes(role);
}
