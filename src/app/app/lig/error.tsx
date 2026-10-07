"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function LigError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Lig" />;
}
