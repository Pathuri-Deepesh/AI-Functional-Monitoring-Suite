interface Props {
  size?: number;
  inline?: boolean;
}

export function Spinner({ size = 12, inline = true }: Props) {
  return (
    <svg
      className={`spinner ${inline ? "spinner-inline" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        opacity="0.25"
      />
      <path
        d="M12 3 a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
