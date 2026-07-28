"use client";

import { useState } from "react";

/**
 * Renders a real service logo pulled from Google's favicon service (a
 * reliable proxy that normalizes each domain's favicon to a consistent
 * size). Falls back to the provider's emoji if the fetch fails — so the
 * app still looks OK offline or if the network is flaky.
 */
interface Props {
  domain: string;
  emoji: string;
  label: string;
  size?: number;
  className?: string;
}

export function ProviderIcon({ domain, emoji, label, size = 20, className }: Props) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span aria-label={label} className={className} style={{ fontSize: size - 2 }}>
        {emoji}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
      alt={label}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded ${className ?? ""}`}
    />
  );
}
