"use client";

import { useState } from "react";

/**
 * Renders a real branded logo for each ingest provider.
 *
 * Logos are checked into the repo under public/logos/ (SVG where the
 * upstream publishes one, ICO where they don't). They're served as static
 * assets — no external fetch at runtime, works offline. Loading them via
 * <img src="..."> puts the browser into image-sandbox mode for SVGs, which
 * disables script execution entirely (belt-and-suspenders on top of a
 * manual scrub done at check-in time).
 *
 * If the image file is somehow missing, we fall back to the provider's
 * emoji so the layout doesn't break.
 */
interface Props {
  /** Provider id — matches the filename in /public/logos/. */
  id?: string;
  emoji: string;
  label: string;
  size?: number;
  className?: string;
}

/** Filenames under public/logos/. Only providers listed here get an image. */
const LOGO_FILES: Record<string, string> = {
  jira: "/logos/jira.svg",
  slack: "/logos/slack.svg",
  gcal: "/logos/gcal.svg",
  gdoc: "/logos/gdoc.svg",
  granola: "/logos/granola.svg",
  fellow: "/logos/fellow.png",
  lattice: "/logos/lattice.png",
};

export function ProviderIcon({ id, emoji, label, size = 20, className }: Props) {
  const [failed, setFailed] = useState(false);
  const src = id ? LOGO_FILES[id] : undefined;

  if (!src || failed) {
    return (
      <span aria-label={label} className={className} style={{ fontSize: size - 2 }}>
        {emoji}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={label}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded ${className ?? ""}`}
    />
  );
}
