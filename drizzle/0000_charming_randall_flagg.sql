CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`embedding` blob,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
