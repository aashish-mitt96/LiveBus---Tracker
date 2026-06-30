export const BusIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 6v6" /><path d="M15 6v6" /><path d="M2 12h19.6" />
    <path d="M18 18h3s.5-1.7.8-2.8c.1-.4.2-.8.2-1.2 0-.4-.1-.8-.2-1.2l-1.4-5c-.3-1.1-1.3-1.8-2.4-1.8H4c-1.1 0-2.1.7-2.4 1.8l-1.4 5c-.1.4-.2.8-.2 1.2 0 .4.1.8.2 1.2C.5 16.3 1 18 1 18h3" />
    <circle cx="7" cy="18" r="2" /><circle cx="15" cy="18" r="2" />
  </svg>
);

export const LocationPin = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
  </svg>
);

export const ArrowRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
);

export const SignalIcon = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="16" width="3" height="6" rx="1" fill={active ? "#16a34a" : "#cbd5e1"} />
    <rect x="7" y="12" width="3" height="10" rx="1" fill={active ? "#16a34a" : "#cbd5e1"} />
    <rect x="12" y="7" width="3" height="15" rx="1" fill={active ? "#16a34a" : "#cbd5e1"} />
    <rect x="17" y="2" width="3" height="20" rx="1" fill={active ? "#16a34a" : "#cbd5e1"} />
  </svg>
);