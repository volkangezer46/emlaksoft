import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Geriye uyumlu ad: tek kaynak `@/lib/format`.
export { formatTry } from "@/lib/format";
