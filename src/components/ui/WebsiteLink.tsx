// Works in both server and client components — no event handlers
export function WebsiteLink({
  url,
  className = "",
}: {
  url?: string | null;
  className?: string;
}) {
  if (!url) return null;
  const href = url.startsWith("http") ? url : `https://${url}`;
  const display = href.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Visitar ${display}`}
      className={`inline-flex items-center gap-1 text-slate hover:text-orange transition-colors ${className}`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
        <polyline points="15,3 21,3 21,9"/>
        <line x1="10" y1="14" x2="21" y2="3"/>
      </svg>
      <span className="text-[10px] font-medium">{display}</span>
    </a>
  );
}
