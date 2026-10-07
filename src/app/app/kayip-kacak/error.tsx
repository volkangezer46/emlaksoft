"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function KayipKacakError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Kayıp-kaçak kalkanı" />;
}
