// Shared thin-stroke SVG icons — matches sidebar icon style
// Works in both server and client components (no hooks, no state)

type P = { size?: number; className?: string };

export function IconRadarTab({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7" r="3.5" stroke="currentColor" strokeWidth="1" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" />
      <line x1="7" y1="1" x2="7" y2="4.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function IconPipeline({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <path d="M1.5 2h11l-3.5 4.5v4.5l-4-1.5V6.5L1.5 2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFlag({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <line x1="3" y1="1.5" x2="3" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M3 3L11 5.5L3 8V3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDocument({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <path d="M2.5 1h6l3 3v9a.5.5 0 01-.5.5h-8.5a.5.5 0 01-.5-.5V1.5a.5.5 0 01.5-.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8.5 1v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <line x1="4" y1="7" x2="10" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <line x1="4" y1="9.5" x2="8" y2="9.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function IconBarChart({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <rect x="1" y="8" width="3" height="5" rx="1" fill="currentColor" />
      <rect x="5.5" y="5" width="3" height="8" rx="1" fill="currentColor" />
      <rect x="10" y="2" width="3" height="11" rx="1" fill="currentColor" />
    </svg>
  );
}

export function IconLineChart({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <polyline points="1,11 4.5,6 7,8.5 10,4 13,5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDiamond({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <path d="M7 1.5L12.5 7L7 12.5L1.5 7L7 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <line x1="1.5" y1="5" x2="12.5" y2="5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconTrendingUp({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <polyline points="1,11 4.5,6.5 7.5,9 12,3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="8.5,3 12,3 12,6.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconMerge({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <circle cx="4" cy="3.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10" cy="3.5" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5.5C4 8.5 7 10.5 7 10.5C7 10.5 10 8.5 10 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="7" y1="10.5" x2="7" y2="13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconXCircle({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="5" y1="5" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconBell({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <path d="M7 1.5a4 4 0 014 4c0 4-1.5 5-1.5 5h-5s-1.5-1-1.5-5a4 4 0 014-4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.5 10.5s.3 2 1.5 2 1.5-2 1.5-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconAlertTriangle({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <path d="M7 1.5L13 12.5H1L7 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <line x1="7" y1="6" x2="7" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="7" cy="11" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function IconGear({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.5 2.5l1.1 1.1M10.4 10.4l1.1 1.1M11.5 2.5l-1.1 1.1M3.6 10.4l-1.1 1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconSparkle({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <path d="M7 1L8.2 5.8L13 7L8.2 8.2L7 13L5.8 8.2L1 7L5.8 5.8L7 1Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

export function IconClock({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <polyline points="7,4 7,7 9.5,8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSearch({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2" />
      <line x1="9.2" y1="9.2" x2="13" y2="13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function IconTarget({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1" />
      <circle cx="7" cy="7" r="1" fill="currentColor" />
    </svg>
  );
}

export function IconFunding({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7 4v1.5M7 8.5V10M5 6.5s.2-1.5 2-1.5 2 1 2 1-0 1.5-2 2-2 1.5-2 1.5 .5 1.5 2 1.5 2-1 2-1" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

export function IconPerson({ size = 14, className = "" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className}>
      <circle cx="7" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 13c0-3 2.5-4.5 5.5-4.5S12.5 10 12.5 13" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
