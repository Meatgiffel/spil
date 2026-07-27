CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `bgg_cache` (
	`query_hash` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`bgg_id` integer,
	`year` integer,
	`min_players` integer,
	`max_players` integer,
	`thumbnail_path` text,
	`updated_at` integer NOT NULL,
	`server_seq` integer NOT NULL,
	`deleted_at` integer,
	`updated_by` text
);
--> statement-breakpoint
CREATE INDEX `game_server_seq_idx` ON `game` (`server_seq`);--> statement-breakpoint
CREATE TABLE `group` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL,
	`server_seq` integer NOT NULL,
	`deleted_at` integer,
	`updated_by` text
);
--> statement-breakpoint
CREATE INDEX `group_server_seq_idx` ON `group` (`server_seq`);--> statement-breakpoint
CREATE TABLE `group_member` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`player_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`updated_at` integer NOT NULL,
	`server_seq` integer NOT NULL,
	`deleted_at` integer,
	`updated_by` text,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_member_unique_idx` ON `group_member` (`group_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `group_member_player_idx` ON `group_member` (`player_id`);--> statement-breakpoint
CREATE INDEX `group_member_server_seq_idx` ON `group_member` (`server_seq`);--> statement-breakpoint
CREATE TABLE `invite_key` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`label` text,
	`max_uses` integer DEFAULT 1 NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`expires_at` integer,
	`revoked_at` integer,
	`created_by` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_key_key_hash_unique` ON `invite_key` (`key_hash`);--> statement-breakpoint
CREATE INDEX `invite_key_created_by_idx` ON `invite_key` (`created_by`);--> statement-breakpoint
CREATE TABLE `invite_key_use` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_key_id` text NOT NULL,
	`user_id` text,
	`used_at` integer NOT NULL,
	FOREIGN KEY (`invite_key_id`) REFERENCES `invite_key`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `invite_key_use_key_idx` ON `invite_key_use` (`invite_key_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invite_key_use_user_idx` ON `invite_key_use` (`user_id`);--> statement-breakpoint
CREATE TABLE `photo` (
	`id` text PRIMARY KEY NOT NULL,
	`play_id` text NOT NULL,
	`file_path` text NOT NULL,
	`width` integer,
	`height` integer,
	`taken_at` integer,
	`updated_at` integer NOT NULL,
	`server_seq` integer NOT NULL,
	`deleted_at` integer,
	`updated_by` text,
	FOREIGN KEY (`play_id`) REFERENCES `play`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photo_play_idx` ON `photo` (`play_id`);--> statement-breakpoint
CREATE INDEX `photo_server_seq_idx` ON `photo` (`server_seq`);--> statement-breakpoint
CREATE TABLE `play` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`game_id` text NOT NULL,
	`played_at` integer NOT NULL,
	`location` text,
	`duration_minutes` integer,
	`notes` text,
	`coop_result` text,
	`updated_at` integer NOT NULL,
	`server_seq` integer NOT NULL,
	`deleted_at` integer,
	`updated_by` text,
	FOREIGN KEY (`group_id`) REFERENCES `group`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`game_id`) REFERENCES `game`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `play_group_idx` ON `play` (`group_id`);--> statement-breakpoint
CREATE INDEX `play_played_at_idx` ON `play` (`played_at`);--> statement-breakpoint
CREATE INDEX `play_server_seq_idx` ON `play` (`server_seq`);--> statement-breakpoint
CREATE TABLE `play_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`play_id` text NOT NULL,
	`player_id` text NOT NULL,
	`placement` integer,
	`score` integer,
	`updated_at` integer NOT NULL,
	`server_seq` integer NOT NULL,
	`deleted_at` integer,
	`updated_by` text,
	FOREIGN KEY (`play_id`) REFERENCES `play`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`player_id`) REFERENCES `player`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `play_participant_unique_idx` ON `play_participant` (`play_id`,`player_id`);--> statement-breakpoint
CREATE INDEX `play_participant_player_idx` ON `play_participant` (`player_id`);--> statement-breakpoint
CREATE INDEX `play_participant_server_seq_idx` ON `play_participant` (`server_seq`);--> statement-breakpoint
CREATE TABLE `player` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`updated_at` integer NOT NULL,
	`server_seq` integer NOT NULL,
	`deleted_at` integer,
	`updated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `player_user_id_idx` ON `player` (`user_id`);--> statement-breakpoint
CREATE INDEX `player_server_seq_idx` ON `player` (`server_seq`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text,
	`count` integer,
	`last_request` integer
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `sync_op` (
	`op_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`applied_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sync_op_applied_at_idx` ON `sync_op` (`applied_at`);--> statement-breakpoint
CREATE TABLE `sync_seq` (
	`id` integer PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text DEFAULT 'user' NOT NULL,
	`banned` integer DEFAULT false NOT NULL,
	`ban_reason` text,
	`ban_expires` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);