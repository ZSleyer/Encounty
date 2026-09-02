/**
 * DashboardLoader.tsx: Spinner shown while the WebSocket is still connecting.
 */

/** Loading spinner shown while the WebSocket connection is pending. */
export function DashboardLoader({ label }: Readonly<{ label: string }>) {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="w-12 h-12 border-2 border-accent-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-text-muted">{label}</p>
      </div>
    </div>
  );
}
