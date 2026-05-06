"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { openContactDialog } from "@/components/contact-dialog";

type Props = {
  children: ReactNode;
  className?: string;
};

export function ContactButton({ children, className }: Props) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={openContactDialog}
      className={className}
    >
      {children}
    </Button>
  );
}
