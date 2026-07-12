CREATE TABLE `videos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_type` text NOT NULL,
	`media_id` integer NOT NULL,
	`youtube_key` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`official` integer DEFAULT 0 NOT NULL,
	`published_at` text,
	`position` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `videos_unq` ON `videos` (`media_type`,`media_id`,`youtube_key`);--> statement-breakpoint
CREATE INDEX `videos_media_idx` ON `videos` (`media_type`,`media_id`);--> statement-breakpoint
ALTER TABLE `movies` DROP COLUMN `trailer_key`;--> statement-breakpoint
ALTER TABLE `shows` DROP COLUMN `trailer_key`;