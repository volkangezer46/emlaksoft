"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AbonelikError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Abonelik" />;
}
