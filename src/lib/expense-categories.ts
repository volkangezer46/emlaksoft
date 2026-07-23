/** Gider kategorileri — client ve server tarafında kullanılabilir */
export const EXPENSE_CATEGORIES = [
  { value: "reklam",          label: "Reklam & Pazarlama" },
  { value: "ofis",            label: "Ofis Giderleri" },
  { value: "ulasim",          label: "Ulaşım" },
  { value: "egitim",          label: "Eğitim & Gelişim" },
  { value: "komisyon_gider",  label: "Komisyon Gideri" },
  { value: "diger",           label: "Diğer" },
] as const;

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]["value"];
