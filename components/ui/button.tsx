import type { ButtonHTMLAttributes } from "react";

/**
 * Shared button primitive (roadmap #2.3) — replaces the primary/secondary class
 * string that was copy-pasted (with drifting padding) across ~10 files.
 */
type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "rounded-full bg-black text-white hover:bg-zinc-800",
  secondary: "rounded-full border border-zinc-300 text-zinc-700 hover:bg-zinc-50",
  ghost: "rounded-md text-zinc-600 hover:bg-zinc-100",
  danger: "rounded-md text-red-600 hover:bg-red-50",
};

const SIZE: Record<Size, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 font-medium transition-colors disabled:opacity-50 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...props}
    />
  );
}
