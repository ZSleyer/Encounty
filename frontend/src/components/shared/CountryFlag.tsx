/**
 * CountryFlag — Lightweight inline SVG country flags.
 *
 * Replaces emoji flags with proper SVG icons that render consistently
 * across all platforms and browsers.
 */
import React from "react";

interface FlagProps {
  className?: string;
}

function DE({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="20" height="4.67" fill="#000" />
      <rect y="4.67" width="20" height="4.67" fill="#D00" />
      <rect y="9.33" width="20" height="4.67" fill="#FFCE00" />
    </svg>
  );
}

function GB({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="20" height="14" fill="#012169" />
      <path d="M0 0L20 14M20 0L0 14" stroke="#fff" strokeWidth="2.8" />
      <path d="M0 0L20 14M20 0L0 14" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M10 0V14M0 7H20" stroke="#fff" strokeWidth="4.6" />
      <path d="M10 0V14M0 7H20" stroke="#C8102E" strokeWidth="2.8" />
    </svg>
  );
}

function FR({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="6.67" height="14" fill="#002395" />
      <rect x="6.67" width="6.67" height="14" fill="#fff" />
      <rect x="13.33" width="6.67" height="14" fill="#ED2939" />
    </svg>
  );
}

function IT({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="6.67" height="14" fill="#009246" />
      <rect x="6.67" width="6.67" height="14" fill="#fff" />
      <rect x="13.33" width="6.67" height="14" fill="#CE2B37" />
    </svg>
  );
}

function ES({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="20" height="3.5" fill="#AA151B" />
      <rect y="3.5" width="20" height="7" fill="#F1BF00" />
      <rect y="10.5" width="20" height="3.5" fill="#AA151B" />
    </svg>
  );
}

function MX({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="6.67" height="14" fill="#006847" />
      <rect x="6.67" width="6.67" height="14" fill="#fff" />
      <rect x="13.33" width="6.67" height="14" fill="#CE1126" />
    </svg>
  );
}

function BR({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="20" height="14" fill="#009B3A" />
      <path d="M10 2L18 7L10 12L2 7Z" fill="#FEDF00" />
      <circle cx="10" cy="7" r="2.8" fill="#002776" />
    </svg>
  );
}

function JP({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="20" height="14" fill="#fff" />
      <circle cx="10" cy="7" r="4" fill="#BC002D" />
    </svg>
  );
}

function KR({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="20" height="14" fill="#fff" />
      {/* Taeguk: blue base circle, red upper half via clip, blue/red small circles for S-curve */}
      <circle cx="10" cy="7" r="3.5" fill="#0047A0" />
      <clipPath id="kr-top">
        <rect x="6" y="3" width="8" height="4" />
      </clipPath>
      <circle cx="10" cy="7" r="3.5" fill="#CD2E3A" clipPath="url(#kr-top)" />
      <circle cx="10" cy="5.25" r="1.75" fill="#CD2E3A" />
      <circle cx="10" cy="8.75" r="1.75" fill="#0047A0" />
      {/* Trigram bars — simplified 3-line groups in each corner */}
      {/* Top-left (☰ Geon) */}
      <g transform="translate(2.5,1.5) rotate(56)">
        <rect width="3.5" height=".6" fill="#000" />
        <rect y="1" width="3.5" height=".6" fill="#000" />
        <rect y="2" width="3.5" height=".6" fill="#000" />
      </g>
      {/* Bottom-right (☷ Gon) */}
      <g transform="translate(14,10) rotate(56)">
        <rect width="1.4" height=".6" fill="#000" />
        <rect x="2.1" width="1.4" height=".6" fill="#000" />
        <rect y="1" width="1.4" height=".6" fill="#000" />
        <rect x="2.1" y="1" width="1.4" height=".6" fill="#000" />
        <rect y="2" width="1.4" height=".6" fill="#000" />
        <rect x="2.1" y="2" width="1.4" height=".6" fill="#000" />
      </g>
      {/* Top-right (☵ Gam) */}
      <g transform="translate(14.5,1.5) rotate(-56)">
        <rect width="3.5" height=".6" fill="#000" />
        <rect y="1" width="1.4" height=".6" fill="#000" />
        <rect x="2.1" y="1" width="1.4" height=".6" fill="#000" />
        <rect y="2" width="3.5" height=".6" fill="#000" />
      </g>
      {/* Bottom-left (☲ Ri) */}
      <g transform="translate(2,10) rotate(-56)">
        <rect width="1.4" height=".6" fill="#000" />
        <rect x="2.1" width="1.4" height=".6" fill="#000" />
        <rect y="1" width="3.5" height=".6" fill="#000" />
        <rect y="2" width="1.4" height=".6" fill="#000" />
        <rect x="2.1" y="2" width="1.4" height=".6" fill="#000" />
      </g>
    </svg>
  );
}

function CN({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="20" height="14" fill="#DE2910" />
      <path d="M3 2.5L3.6 4.3H5.5L4 5.4L4.6 7.2L3 6.1L1.4 7.2L2 5.4L0.5 4.3H2.4Z" fill="#FFDE00" />
    </svg>
  );
}

function TW({ className }: Readonly<FlagProps>) {
  return (
    <svg viewBox="0 0 20 14" className={className}>
      <rect width="20" height="14" fill="#FE0000" />
      <rect width="10" height="7" fill="#000095" />
      <circle cx="5" cy="3.5" r="2" fill="#fff" />
      <circle cx="5" cy="3.5" r="1.5" fill="#000095" />
    </svg>
  );
}

const FLAG_MAP: Record<string, (props: FlagProps) => React.JSX.Element> = {
  de: DE,
  en: GB,
  fr: FR,
  it: IT,
  es: ES,
  "es-es": ES,
  "es-419": MX,
  "pt-br": BR,
  ja: JP,
  ko: KR,
  "zh-hans": CN,
  "zh-hant": TW,
};

/** Renders a country flag SVG for the given language code. */
export function CountryFlag({
  code,
  className = "w-5 h-3.5",
}: Readonly<{
  code: string;
  className?: string;
}>) {
  const Flag = FLAG_MAP[code];
  if (!Flag) return null;
  return (
    <span className="inline-flex items-center shrink-0 rounded-xs overflow-hidden border border-white/10">
      <Flag className={className} />
    </span>
  );
}
