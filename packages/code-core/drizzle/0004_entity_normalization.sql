-- Entity Normalization Migration
-- Adds normalized entity relationship fields to existing tables

-- Add new columns to sessions table
ALTER TABLE `sessions` ADD COLUMN `enabled_tool_ids` text;
--> statement-breakpoint
ALTER TABLE `sessions` ADD COLUMN `enabled_mcp_server_ids` text;

-- Add new columns to todos table
ALTER TABLE `todos` ADD COLUMN `created_by_tool_id` text;
--> statement-breakpoint
ALTER TABLE `todos` ADD COLUMN `created_by_step_id` text;
--> statement-breakpoint
ALTER TABLE `todos` ADD COLUMN `related_files` text;
--> statement-breakpoint
ALTER TABLE `todos` ADD COLUMN `metadata` text;

-- Create index on created_by_step_id for efficient lookups
CREATE INDEX IF NOT EXISTS `idx_todos_created_by_step` ON `todos` (`created_by_step_id`);
