"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AyarlarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Ayarlar" />;
}
