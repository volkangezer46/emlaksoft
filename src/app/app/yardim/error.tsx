"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function YardimError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Yardım" />;
}
