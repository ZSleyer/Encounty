/**
 * NavTab.tsx: Single tab in the application header navigation.
 *
 * Derives its active state from the current route rather than from a prop so
 * the header does not have to thread the location through every tab.
 */
import { Link, useLocation } from "react-router";

/** Props for the NavTab component. */
interface NavTabProps {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

/** Header navigation tab that marks itself as the current page when its route is active. */
export function NavTab({ to, icon, children }: Readonly<NavTabProps>) {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      aria-current={isActive ? "page" : undefined}
      className={`relative shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-none text-xs 2xl:text-sm font-medium uppercase tracking-[0.18em] transition-colors outline-none focus-visible:ring-1 focus-visible:ring-accent-blue ${
        isActive ? "text-accent-blue" : "text-text-muted hover:text-text-primary hover:bg-bg-hover"
      }`}
    >
      {icon}
      {children}
      {isActive && <span className="absolute bottom-0 left-2 right-2 h-px bg-accent-blue" />}
    </Link>
  );
}
