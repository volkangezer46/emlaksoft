"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AcikEvError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Açık ev" />;
}
