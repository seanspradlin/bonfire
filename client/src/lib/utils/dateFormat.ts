/**
 * Format a date as relative time (e.g., "2h ago", "Yesterday", "3d ago")
 */
export function formatRelativeTime(date: string | Date): string {
	const now = new Date();
	const past = new Date(date);
	const diffMs = now.getTime() - past.getTime();
	const diffMins = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMins < 1) return 'Just now';
	if (diffMins < 60) return `${diffMins}m ago`;
	if (diffHours < 24) return `${diffHours}h ago`;
	if (diffDays === 1) return 'Yesterday';
	if (diffDays < 7) return `${diffDays}d ago`;
	if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

	return past.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

/**
 * Format a date as "Mon YYYY" (e.g., "Jan 2024")
 */
export function formatJoinedDate(date: string | Date): string {
	const d = new Date(date);
	return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
