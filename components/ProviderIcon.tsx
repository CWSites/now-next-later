"use client";

import { useState } from "react";

/**
 * Real branded logos for each ingest provider. Well-known services get
 * hand-embedded SVGs (from Simple Icons or their own brand pages) with
 * accurate colors; smaller services fall through to Google's favicon
 * service, which pulls the real favicon from the origin. If both fail,
 * we render the emoji as a last-resort fallback.
 */

interface Props {
  domain: string;
  emoji: string;
  label: string;
  /** Provider id — determines which inline SVG to render, if any. */
  id?: string;
  size?: number;
  className?: string;
}

/**
 * Providers we have inline SVGs for. Everything else goes to the favicon
 * fallback. Paths lifted from Simple Icons (MIT) where noted.
 */
const INLINE_LOGOS: Record<string, (size: number) => JSX.Element> = {
  jira: (size) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
    >
      <path
        fill="#2684FF"
        d="M11.571 11.513H0a5.218 5.218 0 005.232 5.215h2.13v2.057A5.215 5.215 0 0012.575 24V12.518a1.005 1.005 0 00-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 005.215 5.214h2.129v2.058a5.218 5.218 0 005.215 5.214V6.762a1.005 1.005 0 00-1.001-1.005zM23.013 0H11.455a5.215 5.215 0 005.215 5.215h2.129v2.057A5.215 5.215 0 0024 12.483V1.005A1.005 1.005 0 0023.013 0z"
      />
    </svg>
  ),
  slack: (size) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
    >
      {/* Slack's four-color hash mark. Green / red / blue / yellow quadrants. */}
      <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313z" />
      <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312z" />
      <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312z" />
      <path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" />
    </svg>
  ),
  gcal: (size) => (
    // Simplified Google Calendar mark: white square, red band top, colored "31" glyph.
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role="img"
      aria-hidden
    >
      <rect x="6" y="6" width="36" height="36" rx="4" fill="#ffffff" stroke="#dadce0" />
      <rect x="6" y="6" width="36" height="9" rx="4" fill="#4285F4" />
      <rect x="6" y="9" width="36" height="6" fill="#4285F4" />
      <text
        x="24"
        y="35"
        textAnchor="middle"
        fontFamily="'Product Sans', 'Google Sans', Inter, sans-serif"
        fontWeight="500"
        fontSize="16"
        fill="#4285F4"
      >
        31
      </text>
    </svg>
  ),
  granola: (size) => (
    // Granola's app icon: a stylized orange/gold "G" glyph on a warm background.
    // Approximate — Granola doesn't publish an official SVG.
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
    >
      <rect width="24" height="24" rx="5" fill="#FEF6EC" />
      <path
        fill="#D97706"
        d="M12 5.5a6.5 6.5 0 106.5 6.5h-6.5v-2h4.34A4.5 4.5 0 1112 7.5v-2z"
      />
    </svg>
  ),
  fellow: (size) => (
    // Fellow.app's brand mark: a rounded square with a stylized speech mark.
    // Approximate — using brand teal.
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
    >
      <rect width="24" height="24" rx="5" fill="#0AB39C" />
      <path
        fill="#ffffff"
        d="M8 7h9v2.4h-6.4v3h5.2v2.4h-5.2V17H8V7z"
      />
    </svg>
  ),
  lattice: (size) => (
    // Lattice: a stylized L monogram inside a rounded square, using brand pink.
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-hidden
    >
      <rect width="24" height="24" rx="5" fill="#F35A57" />
      <path fill="#ffffff" d="M8 6h2.4v9.6h5.6V18H8V6z" />
    </svg>
  ),
};

export function ProviderIcon({ id, domain, emoji, label, size = 20, className }: Props) {
  const [failed, setFailed] = useState(false);

  const inline = id && INLINE_LOGOS[id];
  if (inline) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center ${className ?? ""}`} title={label}>
        {inline(size)}
      </span>
    );
  }

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
