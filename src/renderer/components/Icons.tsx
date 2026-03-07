import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function defaults(size: number, props: IconProps): SVGProps<SVGSVGElement> {
  const { size: _, ...rest } = props;
  return {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...rest,
  };
}

export function BrainIcon({ size = 16, ...props }: IconProps) {
  return (
    <svg {...defaults(size, props)}>
      <path d="M8 14V8" />
      <path d="M4.5 9.5C3 9.5 2 8.4 2 7s1-2.5 2.5-2.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5c1.5 0 2.5 1.1 2.5 2.5s-1 2.5-2.5 2.5" />
      <path d="M5.5 12c0 1.1.9 2 2.5 2s2.5-.9 2.5-2" />
      <path d="M5.5 9.5v2.5M10.5 9.5v2.5" />
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
