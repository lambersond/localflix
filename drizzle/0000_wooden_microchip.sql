CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `collection_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` integer NOT NULL,
	`media_type` text NOT NULL,
	`media_id` integer NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `collections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collections_slug_unique` ON `collections` (`slug`);--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`tmdb_episode_number` integer NOT NULL,
	`name` text,
	`overview` text,
	`still_path` text,
	`runtime_minutes` integer,
	`air_date` text,
	`file_path` text NOT NULL,
	`file_size` integer,
	`mime_type` text,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_season_number_unq` ON `episodes` (`season_id`,`tmdb_episode_number`);--> statement-breakpoint
CREATE TABLE `genres` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text DEFAULT (CURRENT_TIMESTAMP),
	`finished_at` text,
	`summary` text
);
--> statement-breakpoint
CREATE TABLE `movie_cast` (
	`movie_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`ord` integer,
	PRIMARY KEY(`movie_id`, `person_id`),
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `movie_genres` (
	`movie_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	PRIMARY KEY(`movie_id`, `genre_id`),
	FOREIGN KEY (`movie_id`) REFERENCES `movies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `movies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_id` integer NOT NULL,
	`title` text NOT NULL,
	`overview` text,
	`poster_path` text,
	`backdrop_path` text,
	`release_date` text,
	`runtime_minutes` integer,
	`certification` text,
	`tmdb_collection_id` integer,
	`file_path` text NOT NULL,
	`file_size` integer,
	`mime_type` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movies_tmdb_id_unique` ON `movies` (`tmdb_id`);--> statement-breakpoint
CREATE INDEX `movies_title_idx` ON `movies` (`title`,`id`);--> statement-breakpoint
CREATE TABLE `people` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`profile_path` text
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`avatar_path` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer NOT NULL,
	`tmdb_season_number` integer NOT NULL,
	`name` text,
	`overview` text,
	`poster_path` text,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_show_number_unq` ON `seasons` (`show_id`,`tmdb_season_number`);--> statement-breakpoint
CREATE TABLE `show_cast` (
	`show_id` integer NOT NULL,
	`person_id` integer NOT NULL,
	`ord` integer,
	PRIMARY KEY(`show_id`, `person_id`),
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `show_genres` (
	`show_id` integer NOT NULL,
	`genre_id` integer NOT NULL,
	PRIMARY KEY(`show_id`, `genre_id`),
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_id` integer NOT NULL,
	`name` text NOT NULL,
	`overview` text,
	`poster_path` text,
	`backdrop_path` text,
	`first_air_date` text,
	`certification` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shows_tmdb_id_unique` ON `shows` (`tmdb_id`);--> statement-breakpoint
CREATE INDEX `shows_name_idx` ON `shows` (`name`,`id`);--> statement-breakpoint
CREATE TABLE `watch_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`playable_kind` text NOT NULL,
	`playable_id` integer NOT NULL,
	`position_seconds` real DEFAULT 0 NOT NULL,
	`duration_seconds` real,
	`completed` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watch_progress_unq` ON `watch_progress` (`profile_id`,`playable_kind`,`playable_id`);--> statement-breakpoint
CREATE TABLE `watchlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`media_type` text NOT NULL,
	`media_id` integer NOT NULL,
	`added_at` text DEFAULT (CURRENT_TIMESTAMP),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `watchlist_unq` ON `watchlist` (`profile_id`,`media_type`,`media_id`);