import React from "react";

interface BrandLogoProps {
  compact?: boolean;
}

export const BrandLogoMark: React.FC<{ size?: number; className?: string }> = ({
  size = 28,
  className = "",
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 1024 1024"
    width={size}
    height={size}
    className={className}
    aria-hidden="true"
  >
    <rect x="64" y="64" width="896" height="896" rx="210" ry="210" fill="#262522" />
    <path
      d="M 244 316 L 378 708"
      fill="none"
      stroke="#E2DDD3"
      strokeWidth="104"
      strokeLinecap="round"
    />
    <path
      d="M 244 316 L 340 597"
      fill="none"
      stroke="#FAF9F6"
      strokeWidth="104"
      strokeLinecap="round"
    />
    <path
      d="M 512 348 L 646 708"
      fill="none"
      stroke="#C26142"
      strokeWidth="104"
      strokeLinecap="round"
    />
    <path
      d="M 540 423 L 614 622"
      fill="none"
      stroke="#D97757"
      strokeWidth="104"
      strokeLinecap="round"
    />
    <path
      d="M 378 708 L 512 348"
      fill="none"
      stroke="#262522"
      strokeWidth="136"
      strokeLinecap="round"
    />
    <path
      d="M 378 708 L 512 348"
      fill="none"
      stroke="#D97757"
      strokeWidth="104"
      strokeLinecap="round"
    />
    <path
      d="M 646 708 L 780 316"
      fill="none"
      stroke="#262522"
      strokeWidth="136"
      strokeLinecap="round"
    />
    <path
      d="M 646 708 L 780 316"
      fill="none"
      stroke="#FAF9F6"
      strokeWidth="104"
      strokeLinecap="round"
    />
  </svg>
);

export const BrandLogo: React.FC<BrandLogoProps> = ({ compact = false }) => {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <div className="shrink-0 rounded-lg ring-1 ring-black/10 dark:ring-white/15 overflow-hidden shadow-sm">
        <BrandLogoMark size={compact ? 26 : 32} />
      </div>
      {!compact && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 132 34"
          className="h-[30px] w-auto overflow-visible"
          role="img"
          aria-label="WeekLoom"
        >
          <defs>
            <linearGradient id="wl-ink-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{ stopColor: "var(--logo-ink-start)" }} />
              <stop offset="100%" style={{ stopColor: "var(--logo-ink-end)" }} />
            </linearGradient>
            <linearGradient id="wl-accent-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style={{ stopColor: "var(--logo-accent-start)" }} />
              <stop offset="100%" style={{ stopColor: "var(--logo-accent-end)" }} />
            </linearGradient>
          </defs>

          {/* Editorial artistic logotype: crisp upright serif "Week" + calligraphic italic "Loom" */}
          <text
            x="0"
            y="23"
            fontFamily="'Palatino Linotype', 'Book Antiqua', 'Baskerville', 'Georgia', serif"
            fontSize="22"
            letterSpacing="-0.4"
          >
            <tspan fill="url(#wl-ink-grad)" fontWeight="600">
              Week
            </tspan>
            <tspan
              fill="url(#wl-accent-grad)"
              fontWeight="600"
              fontStyle="italic"
              dx="0.5"
            >
              Loom
            </tspan>
          </text>

          {/* Subtle woven thread flourish beneath wordmark */}
          <path
            d="M 2 29.5 Q 34 26.2, 66 29.5 T 118 28.2"
            fill="none"
            stroke="url(#wl-accent-grad)"
            strokeWidth="1.35"
            strokeLinecap="round"
            opacity="0.72"
          />
          <circle cx="122.5" cy="27.5" r="1.5" fill="url(#wl-accent-grad)" opacity="0.85" />
        </svg>
      )}
    </div>
  );
};
