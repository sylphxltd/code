-- Step-based message architecture migration
-- Creates new tables for steps, moves content from messages to steps

-- Create message_steps table
CREATE TABLE `message_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`step_index` integer NOT NULL,
	`provider` text,
	`model` text,
	`duration` integer,
	`finish_reason` text,
	`status` text DEFAULT 'completed' NOT NULL,
	`metadata` text,
	`start_time` integer,
	`end_time` integer,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_message_steps_message` ON `message_steps` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_message_steps_step_index` ON `message_steps` (`message_id`,`step_index`);--> statement-breakpoint
CREATE INDEX `idx_message_steps_status` ON `message_steps` (`status`);--> statement-breakpoint

-- Create step_usage table
CREATE TABLE `step_usage` (
	`step_id` text PRIMARY KEY NOT NULL,
	`prompt_tokens` integer NOT NULL,
	`completion_tokens` integer NOT NULL,
	`total_tokens` integer NOT NULL,
	FOREIGN KEY (`step_id`) REFERENCES `message_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- Create step_todo_snapshots table
CREATE TABLE `step_todo_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`step_id` text NOT NULL,
	`todo_id` integer NOT NULL,
	`content` text NOT NULL,
	`active_form` text NOT NULL,
	`status` text NOT NULL,
	`ordering` integer NOT NULL,
	FOREIGN KEY (`step_id`) REFERENCES `message_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_step_todo_snapshots_step` ON `step_todo_snapshots` (`step_id`);--> statement-breakpoint

-- Create step_parts table
CREATE TABLE `step_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`step_id` text NOT NULL,
	`ordering` integer NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	FOREIGN KEY (`step_id`) REFERENCES `message_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_step_parts_step` ON `step_parts` (`step_id`);--> statement-breakpoint
CREATE INDEX `idx_step_parts_ordering` ON `step_parts` (`step_id`,`ordering`);--> statement-breakpoint
CREATE INDEX `idx_step_parts_type` ON `step_parts` (`type`);--> statement-breakpoint

-- Migrate existing message_parts to step_parts (via message_steps)
-- For each message, create step-0 and migrate parts
INSERT INTO `message_steps` (`id`, `message_id`, `step_index`, `status`, `metadata`, `start_time`, `end_time`)
SELECT
  `message_id` || '-step-0',
  `message_id`,
  0,
  'completed',
  NULL,
  NULL,
  NULL
FROM `message_parts`
GROUP BY `message_id`;
--> statement-breakpoint

-- Migrate parts to new step_parts table
INSERT INTO `step_parts` (`id`, `step_id`, `ordering`, `type`, `content`)
SELECT
  `id`,
  `message_id` || '-step-0',
  `ordering`,
  `type`,
  `content`
FROM `message_parts`;
--> statement-breakpoint

-- Drop old message_parts table
DROP TABLE `message_parts`;--> statement-breakpoint

-- Drop old message_todo_snapshots table (replaced by step_todo_snapshots)
DROP TABLE IF EXISTS `message_todo_snapshots`;--> statement-breakpoint

-- Remove metadata column from messages (moved to steps)
CREATE TABLE `__new_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`timestamp` integer NOT NULL,
	`ordering` integer NOT NULL,
	`finish_reason` text,
	`status` text DEFAULT 'completed' NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_messages` SELECT `id`, `session_id`, `role`, `timestamp`, `ordering`, `finish_reason`, `status` FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;--> statement-breakpoint
CREATE INDEX `idx_messages_session` ON `messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_ordering` ON `messages` (`session_id`,`ordering`);--> statement-breakpoint
CREATE INDEX `idx_messages_timestamp` ON `messages` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_messages_status` ON `messages` (`status`);
