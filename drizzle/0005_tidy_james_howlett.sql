ALTER TABLE `profiles` ADD `is_kids` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `allowed_certifications` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `allow_unrated` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `blocked_genre_ids` text;--> statement-breakpoint
CREATE INDEX `movie_genres_genre_idx` ON `movie_genres` (`genre_id`);--> statement-breakpoint
CREATE INDEX `show_genres_genre_idx` ON `show_genres` (`genre_id`);