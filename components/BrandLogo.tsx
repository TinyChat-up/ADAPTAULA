import type { HTMLAttributes } from "react";

type BrandLogoProps = HTMLAttributes<HTMLDivElement> & {
  compact?: boolean;
};

export default function BrandLogo({
  className = "",
  compact = false,
  ...props
}: BrandLogoProps) {
  const sizeClass = compact ? "text-[1.55rem]" : "text-[1.8rem]";
  return (
    <div
      className={`inline-flex items-baseline font-extrabold tracking-tight ${sizeClass} ${className}`}
      {...props}
    >
      <span className="text-[#0B4FB3]">Adapt</span>
      <span className="text-[#68C63E]">a</span>
      <span className="text-[#F59E0B]">u</span>
      <span className="text-[#FF3B6B]">la</span>
    </div>
  );
}
