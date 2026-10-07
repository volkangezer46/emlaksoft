"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function RaporlarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Raporlar" />;
}
