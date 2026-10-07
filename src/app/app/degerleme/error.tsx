"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function DegerlemeError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Değerleme" />;
}
