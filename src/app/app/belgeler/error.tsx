"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function BelgelerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Belgeler" />;
}
