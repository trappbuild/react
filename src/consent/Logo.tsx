/** Trapp.build mark. The outer <svg> clips to its viewBox, so no clipPath (and no ids to collide). */
export function Logo({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 800 800"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="800" height="800" fill="#000" />
      <path
        d="M590.7 -10.1C593 -13 597.5 -10.1 595.7 -6.8L154.3 800L707.3 -7.3C709.3 -10.3 713.9 -7.9 712.6 -4.6L407.7 800L814.5 9.4C816.1 6.2 820.9 8 820.1 11.4L638.5 797.7C638.2 799 637 800 635.6 800H-19C-21.4 800 -22.8 797.2 -21.3 795.2L590.7 -10.1Z"
        fill="#00FF99"
      />
    </svg>
  );
}
