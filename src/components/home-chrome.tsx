"use client";

import { useState } from "react";

import { RebrandBanner } from "@/components/rebrand-banner";
import { SiteHeader } from "@/components/site-header";

// Banner + header travel together: while the banner is up, the sticky
// header pins 40px down; once dismissed it pins back to the very top.
export function HomeChrome({
  variant = "company",
}: {
  variant?: "company" | "freelancer";
}) {
  const [bannerVisible, setBannerVisible] = useState(true);

  return (
    <>
      {bannerVisible && (
        <RebrandBanner onDismiss={() => setBannerVisible(false)} />
      )}
      <SiteHeader
        variant={variant}
        theme="light"
        offsetForBanner={bannerVisible}
      />
    </>
  );
}
