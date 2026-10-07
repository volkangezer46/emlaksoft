"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function OtomasyonlarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Otomasyonlar" />;
}
