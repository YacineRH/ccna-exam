import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    ...rest,
  };
}

export const LogoMark = ({ size = 20, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden focusable={false} {...rest}>
    <circle cx="14" cy="14" r="4.5" />
    <path d="M14 1v7M14 20v7M1 14h7M20 14h7" />
  </svg>
);

export const IconDashboard = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);
export const IconTimer = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2.5 2M9 2h6" />
  </svg>
);
export const IconTrend = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 19V5M4 19h16M8 15l4-4 3 3 5-6" />
  </svg>
);
export const IconHistory = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 8v5l3 2" />
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3 9M3 4v5h5" />
  </svg>
);
export const IconGrid = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 12h18M12 3v18" />
  </svg>
);
export const IconTerminal = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9l3 3-3 3M12 15h5" />
  </svg>
);
export const IconPlay = ({ size = 16, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable={false} {...rest}>
    <path d="M7 4l13 8-13 8z" />
  </svg>
);
export const IconBookmark = (p: IconProps) => (
  <svg {...base({ size: 16, strokeWidth: 2, ...p })}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </svg>
);
export const IconChevronDown = (p: IconProps) => (
  <svg {...base({ size: 14, strokeWidth: 2, ...p })}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const IconUp = (p: IconProps) => (
  <svg {...base({ size: 16, strokeWidth: 2, ...p })}>
    <path d="M6 15l6-6 6 6" />
  </svg>
);
export const IconDown = (p: IconProps) => (
  <svg {...base({ size: 16, strokeWidth: 2, ...p })}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const IconMenu = (p: IconProps) => (
  <svg {...base({ size: 20, strokeWidth: 2, ...p })}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
export const IconClose = (p: IconProps) => (
  <svg {...base({ size: 20, strokeWidth: 2, ...p })}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconLogout = (p: IconProps) => (
  <svg {...base({ size: 16, ...p })}>
    <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
  </svg>
);
export const IconAlert = (p: IconProps) => (
  <svg {...base({ size: 18, strokeWidth: 2, ...p })}>
    <path d="M12 3l9.5 17h-19z" />
    <path d="M12 10v4M12 17.5v.01" />
  </svg>
);
export const IconTarget = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
  </svg>
);
