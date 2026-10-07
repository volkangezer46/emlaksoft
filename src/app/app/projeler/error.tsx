"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function ProjelerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Projeler" />;
}
