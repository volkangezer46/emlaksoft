"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function KazancimError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Kazancım" />;
}
