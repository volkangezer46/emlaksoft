"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AgError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Emlakçı ağı" />;
}
