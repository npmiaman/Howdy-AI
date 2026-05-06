"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { openHireDialog } from "@/components/hire-dialog";

type Props = {
  children: ReactNode;
  className?: string;
};

export function HireButton({ children, className }: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={openHireDialog}
      className={className}
    >
      {children}
    </Button>
  );
}
