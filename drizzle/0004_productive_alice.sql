CREATE TABLE `media_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_type` text NOT NULL,
	`media_id` integer NOT NULL,
	`label` text NOT NULL,
	`file_path` text NOT NULL,
	`file_size` integer,
	`mime_type` text,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_files_media_idx` ON `media_files` (`media_type`,`media_id`);--> statement-breakpoint
DROP INDEX `watch_progress_unq`;--> statement-breakpoint
ALTER TABLE `watch_progress` ADD `version_id` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `watch_progress_unq` ON `watch_progress` (`profile_id`,`playable_kind`,`playable_id`,`version_id`);