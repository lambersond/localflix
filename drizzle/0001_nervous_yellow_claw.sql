CREATE TABLE `keywords` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `movie_keywords` (
	`movie_id` integer NOT NULL,
	`keyword_id` integer NOT NULL,
	PRIMARY KEY(`movie_id`, `keyword_id`),
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `movie_keywords_keyword_idx` ON `movie_keywords` (`keyword_id`);--> statement-breakpoint
CREATE TABLE `show_keywords` (
	`show_id` integer NOT NULL,
	`keyword_id` integer NOT NULL,
	PRIMARY KEY(`show_id`, `keyword_id`),
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`keyword_id`) REFERENCES `keywords`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `show_keywords_keyword_idx` ON `show_keywords` (`keyword_id`);--> statement-breakpoint
ALTER TABLE `movies` ADD `vote_average` real;--> statement-breakpoint
ALTER TABLE `movies` ADD `vote_count` integer;--> statement-breakpoint
ALTER TABLE `movies` ADD `trailer_key` text;--> statement-breakpoint
ALTER TABLE `shows` ADD `vote_average` real;--> statement-breakpoint
ALTER TABLE `shows` ADD `vote_count` integer;--> statement-breakpoint
ALTER TABLE `shows` ADD `trailer_key` text;