/** Short relative time for inbox rows (e.g. "2m", "3h", "Mon"). */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';

  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 604800) {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
