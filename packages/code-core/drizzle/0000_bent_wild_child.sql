CREATE TABLE `codebase_files` (
	`path` text PRIMARY KEY NOT NULL,
	`mtime` integer NOT NULL,
	`hash` text NOT NULL,
	`content` text,
	`language` text,
	`size` integer,
	`indexed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_codebase_files_mtime` ON `codebase_files` (`mtime`);--> statement-breakpoint
CREATE INDEX `idx_codebase_files_hash` ON `codebase_files` (`hash`);--> statement-breakpoint
CREATE TABLE `codebase_metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`channel` text NOT NULL,
	`type` text NOT NULL,
	`timestamp` integer NOT NULL,
	`sequence` integer NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_channel_cursor` ON `events` (`channel`,`timestamp`,`sequence`);--> statement-breakpoint
CREATE INDEX `idx_events_timestamp` ON `events` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_events_channel` ON `events` (`channel`);--> statement-breakpoint
CREATE TABLE `file_contents` (
	`id` text PRIMARY KEY NOT NULL,
	`step_id` text NOT NULL,
	`ordering` integer NOT NULL,
	`relative_path` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`content` text NOT NULL,
	`is_text` integer NOT NULL,
	`text_content` text,
	`sha256` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`step_id`) REFERENCES `message_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_file_contents_step_ordering` ON `file_contents` (`step_id`,`ordering`);--> statement-breakpoint
CREATE INDEX `idx_file_contents_type` ON `file_contents` (`media_type`);--> statement-breakpoint
CREATE INDEX `idx_file_contents_path` ON `file_contents` (`relative_path`);--> statement-breakpoint
CREATE INDEX `idx_file_contents_sha256` ON `file_contents` (`sha256`);--> statement-breakpoint
CREATE TABLE `memory` (
	`key` text NOT NULL,
	`namespace` text DEFAULT 'default' NOT NULL,
	`value` text NOT NULL,
	`timestamp` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`key`, `namespace`)
);
--> statement-breakpoint
CREATE INDEX `idx_memory_namespace` ON `memory` (`namespace`);--> statement-breakpoint
CREATE INDEX `idx_memory_timestamp` ON `memory` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_memory_key` ON `memory` (`key`);--> statement-breakpoint
CREATE TABLE `message_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`path` text NOT NULL,
	`relative_path` text NOT NULL,
	`size` integer,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_message_attachments_message` ON `message_attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `idx_message_attachments_path` ON `message_attachments` (`path`);--> statement-breakpoint
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
CREATE TABLE `messages` (
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
CREATE INDEX `idx_messages_session` ON `messages` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_ordering` ON `messages` (`session_id`,`ordering`);--> statement-breakpoint
CREATE INDEX `idx_messages_timestamp` ON `messages` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_messages_status` ON `messages` (`status`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`model_id` text,
	`provider` text,
	`model` text,
	`agent_id` text DEFAULT 'coder' NOT NULL,
	`enabled_rule_ids` text DEFAULT '[]' NOT NULL,
	`enabled_tool_ids` text,
	`enabled_mcp_server_ids` text,
	`next_todo_id` integer DEFAULT 1 NOT NULL,
	`created` integer NOT NULL,
	`updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_updated` ON `sessions` (`updated`);--> statement-breakpoint
CREATE INDEX `idx_sessions_created` ON `sessions` (`created`);--> statement-breakpoint
CREATE INDEX `idx_sessions_model_id` ON `sessions` (`model_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_provider` ON `sessions` (`provider`);--> statement-breakpoint
CREATE INDEX `idx_sessions_title` ON `sessions` (`title`);--> statement-breakpoint
CREATE TABLE `step_usage` (
	`step_id` text PRIMARY KEY NOT NULL,
	`prompt_tokens` integer NOT NULL,
	`completion_tokens` integer NOT NULL,
	`total_tokens` integer NOT NULL,
	FOREIGN KEY (`step_id`) REFERENCES `message_steps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tfidf_documents` (
	`file_path` text PRIMARY KEY NOT NULL,
	`magnitude` real NOT NULL,
	`term_count` integer NOT NULL,
	`raw_terms` text NOT NULL,
	FOREIGN KEY (`file_path`) REFERENCES `codebase_files`(`path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tfidf_idf` (
	`term` text PRIMARY KEY NOT NULL,
	`idf_value` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tfidf_terms` (
	`file_path` text NOT NULL,
	`term` text NOT NULL,
	`frequency` real NOT NULL,
	FOREIGN KEY (`file_path`) REFERENCES `codebase_files`(`path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tfidf_terms_term` ON `tfidf_terms` (`term`);--> statement-breakpoint
CREATE INDEX `idx_tfidf_terms_file` ON `tfidf_terms` (`file_path`);--> statement-breakpoint
CREATE TABLE `todos` (
	`id` integer NOT NULL,
	`session_id` text NOT NULL,
	`content` text NOT NULL,
	`active_form` text NOT NULL,
	`status` text NOT NULL,
	`ordering` integer NOT NULL,
	`created_by_tool_id` text,
	`created_by_step_id` text,
	`related_files` text,
	`metadata` text,
	PRIMARY KEY(`session_id`, `id`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_todos_session` ON `todos` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_todos_status` ON `todos` (`status`);--> statement-breakpoint
CREATE INDEX `idx_todos_ordering` ON `todos` (`session_id`,`ordering`);--> statement-breakpoint
CREATE INDEX `idx_todos_created_by_step` ON `todos` (`created_by_step_id`);