interface MantaRayIconProps {
  size?: number;
  className?: string;
}

export const MantaRayIcon = ({ size = 32, className }: MantaRayIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 80"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    {/* Main body + wings */}
    <path d="M50,18 C46,13 38,10 22,13 C6,16 1,28 4,40 C7,50 24,55 50,53 C76,55 93,50 96,40 C99,28 94,16 78,13 C62,10 54,13 50,18 Z" />
    {/* Left cephalic fin (horn) */}
    <path d="M39,20 C35,13 33,6 36,2 C39,5 41,13 40,20 Z" />
    {/* Right cephalic fin (horn) */}
    <path d="M61,20 C65,13 67,6 64,2 C61,5 59,13 60,20 Z" />
    {/* Tail */}
    <path
      d="M49,53 C48,62 47,70 49,74"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      fill="none"
    />
    <path
      d="M51,53 C52,62 53,70 51,74"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      fill="none"
    />
    {/* Eyes */}
    <circle cx="41" cy="30" r="3" fill="white" opacity="0.9" />
    <circle cx="59" cy="30" r="3" fill="white" opacity="0.9" />
    <circle cx="42" cy="31" r="1.2" fill="#1e293b" />
    <circle cx="60" cy="31" r="1.2" fill="#1e293b" />
    {/* Smile */}
    <path
      d="M46,38 Q50,42 54,38"
      stroke="white"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="none"
      opacity="0.7"
    />
  </svg>
);
