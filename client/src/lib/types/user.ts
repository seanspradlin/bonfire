/**
 * Frontend representation of a user with display-ready fields
 */
export interface User {
	id: string;
	name: string;
	email: string;
	role: 'admin' | 'editor' | 'viewer' | string;
	status: 'Active' | 'Inactive';
	joined: string; // formatted date (e.g., "Jan 2024")
	lastSeen: string; // relative time (e.g., "2h ago")
	banned: boolean;
	emailVerified: boolean;
}

/**
 * Raw user from API response
 */
export interface ApiUser {
	id: string;
	name: string;
	email: string;
	role: string;
	banned: boolean;
	emailVerified: boolean;
	createdAt: string | Date;
	updatedAt: string | Date;
	image?: string;
	username?: string;
}
