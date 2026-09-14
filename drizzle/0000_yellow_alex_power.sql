CREATE TABLE `records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`date` text DEFAULT '' NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`type` text DEFAULT '' NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`target` integer DEFAULT 0 NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
