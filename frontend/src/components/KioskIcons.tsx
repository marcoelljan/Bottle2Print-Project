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

export function SignalIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="M4 18h2M8 14h2M12 10h2M16 6h2" strokeWidth={2.4} />
    </svg>
  );
}

export function SearchIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 4.5 4.5" />
    </svg>
  );
}

export function RulerIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="m4 17 13-13 3 3L7 20H4v-3Z" />
      <path d="m8 13 2 2M11 10l2 2M14 7l2 2" />
    </svg>
  );
}

export function ScaleIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="M12 4v16M7 20h10M5 7h14" />
      <path d="m5 7-3 6a3 3 0 0 0 6 0L5 7ZM19 7l-3 6a3 3 0 0 0 6 0l-3-6Z" />
    </svg>
  );
}

export function CheckCircleIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}

export function XCircleIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  );
}

export function ClockIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function AlertTriangleIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="m12 3 9 17H3L12 3Z" />
      <path d="M12 9v4M12 16h.01" />
    </svg>
  );
}

export function StarIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
    </svg>
  );
}

export function SettingsIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.4 1.4-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L9 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H7.6v-2h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L9 9l1.4-1.4.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2h2v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L20 9l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v2h-.2a1.7 1.7 0 0 0-1.8 1Z" />
    </svg>
  );
}

export function WrenchIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="M14.7 5.3a4 4 0 0 0-5.2 5.2L4 16a2.1 2.1 0 1 0 3 3l5.5-5.5a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.2-.5-.5-2.2 2.1-2.7Z" />
    </svg>
  );
}

export function LogOutIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="M14 4H5v16h9M11 12h9M17 8l4 4-4 4" />
    </svg>
  );
}

export function EditIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="m4 16-.8 4.8L8 20l11.5-11.5a2.1 2.1 0 0 0-3-3L4 16Z" />
      <path d="m14.5 7.5 2 2" />
    </svg>
  );
}

export function KeyIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8M16 7l2 2M14 9l2 2" />
    </svg>
  );
}

export function InfoIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

export function CloseIcon({ size = 24, color = "currentColor", style }: IconProps) {
  return (
    <svg {...baseProps(size, color, style)}>
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}
