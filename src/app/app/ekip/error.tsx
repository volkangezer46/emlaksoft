"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function EkipError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Ekip" />;
}
