import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function defaults(size: number, props: IconProps, viewBox = '0 0 16 16', strokeWidth = 1.5): SVGProps<SVGSVGElement> {
  const { size: _, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  };
}

export function BrainIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M12 18V5" />
      <path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4" />
      <path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5" />
      <path d="M17.997 5.125a4 4 0 0 1 2.526 5.77" />
      <path d="M18 18a4 4 0 0 0 2-7.464" />
      <path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517" />
      <path d="M6 18a4 4 0 0 1-2-7.464" />
      <path d="M6.003 5.125a4 4 0 0 0-2.526 5.77" />
    </svg>
  );
}

export function LightbulbIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </svg>
  );
}

export function SettingsIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function TrashIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function XIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}

export function StopIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </svg>
  );
}

export function CopyIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <rect width="13" height="13" x="9" y="9" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CheckIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function SearchIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props)}>
      <circle cx="7" cy="7" r="4.5" />
      <line x1="10.2" y1="10.2" x2="14" y2="14" />
    </svg>
  );
}

export function BranchIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props)}>
      <line x1="6" y1="3" x2="6" y2="13" />
      <circle cx="6" cy="3" r="2" />
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7c0 3-2 4-6 6" />
    </svg>
  );
}

export function MessagesSquareIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      <path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

export function BotIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props, '0 0 24 24', 2)}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}
