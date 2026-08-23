import type { CSSProperties } from "react";

export type IconProps = {
  size?: number;
  color?: string;
  style?: CSSProperties;
};

const baseProps = (size: number, color: string, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: color,
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  style,
  "aria-hidden": true,
});

export function PrintIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="M7 9V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V9" />
      <path d="M6 9h12a2 2 0 0 1 2 2v4.5a1.5 1.5 0 0 1-1.5 1.5H15v-3H9v3H6.5A1.5 1.5 0 0 1 5 15.5V11a2 2 0 0 1 1-1.75Z" />
      <path d="M9 15h6" />
      <path d="M9 18h6" />
    </svg>
  );
}

export function AccountCircleIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 18c1.5-2.8 4-4.2 7-4.2S17.5 15.2 19 18" />
    </svg>
  );
}

export function RecyclingIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="M7 8h10l-1.6 4.2L7 8Z" />
      <path d="M8 8l-2.6 2.5L7 13" />
      <path d="M16 8l2.6 2.5L17 13" />
      <path d="M9 14.5 7 18h10l-2-3.5" />
      <path d="M12 5.5V3" />
    </svg>
  );
}

export function CreditCardIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18" />
      <path d="M7 14h3" />
    </svg>
  );
}

export function ChatIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="M6 17.5 4 20V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H8l-2 1.5Z" />
      <path d="M8 9h8M8 12h6" />
    </svg>
  );
}

export function LockPersonIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <rect x="5" y="10" width="14" height="9" rx="2" />
      <path d="M8.5 10V8.5A3.5 3.5 0 1 1 15.5 8.5V10" />
      <circle cx="12" cy="15" r="1.6" />
      <path d="M12 16.8v1.2" />
    </svg>
  );
}

export function CreditCardOffIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v11A2.5 2.5 0 0 1 18.5 20H5.5A2.5 2.5 0 0 1 3 17.5v-11Z" />
      <path d="M3 9h18" />
      <path d="m7 15 3-3" />
      <path d="m13 15 5-5" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function ArrowBackIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="M15 18 9 12l6-6" />
    </svg>
  );
}
