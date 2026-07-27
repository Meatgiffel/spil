ALTER TABLE `game` ADD `default_outcome_type` text;--> statement-breakpoint
ALTER TABLE `game` ADD `low_score_wins` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `play` ADD `outcome_type` text DEFAULT 'ranking' NOT NULL;--> statement-breakpoint
ALTER TABLE `play` ADD `winning_team` text;--> statement-breakpoint
ALTER TABLE `play` ADD `milestone` text;--> statement-breakpoint
ALTER TABLE `play` ADD `time_remaining_seconds` integer;--> statement-breakpoint
ALTER TABLE `play` ADD `difficulty` text;--> statement-breakpoint
ALTER TABLE `play` ADD `abandoned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `play_participant` ADD `team` text;