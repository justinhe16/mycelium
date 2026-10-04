CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`official_name` text,
	`mask` text,
	`type` text NOT NULL,
	`subtype` text,
	`current_balance` real,
	`available_balance` real,
	`credit_limit` real,
	`iso_currency` text,
	`is_liability` integer DEFAULT false NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `plaid_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `accounts_item_idx` ON `accounts` (`item_id`);--> statement-breakpoint
CREATE TABLE `daily_snapshots` (
	`day` text NOT NULL,
	`account_id` text NOT NULL,
	`balance` real NOT NULL,
	`is_liability` integer NOT NULL,
	`recorded_at` text NOT NULL,
	PRIMARY KEY(`day`, `account_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `daily_snapshots_account_idx` ON `daily_snapshots` (`account_id`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`account_id` text NOT NULL,
	`security_id` text NOT NULL,
	`ticker` text,
	`name` text,
	`security_type` text,
	`quantity` real NOT NULL,
	`price` real,
	`value` real NOT NULL,
	`cost_basis` real,
	`iso_currency` text,
	`as_of` text NOT NULL,
	PRIMARY KEY(`account_id`, `security_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plaid_items` (
	`id` text PRIMARY KEY NOT NULL,
	`institution_id` text,
	`institution_name` text DEFAULT 'Unknown institution' NOT NULL,
	`access_token_enc` text NOT NULL,
	`products` text DEFAULT '[]' NOT NULL,
	`tx_cursor` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text NOT NULL,
	`last_synced_at` text
);
--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`stats` text DEFAULT '{}' NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`authorized_date` text,
	`name` text NOT NULL,
	`merchant_name` text,
	`amount` real NOT NULL,
	`iso_currency` text,
	`pending` integer DEFAULT false NOT NULL,
	`category_primary` text,
	`category_detailed` text,
	`payment_channel` text,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transactions_date_idx` ON `transactions` (`date`);--> statement-breakpoint
CREATE INDEX `transactions_account_idx` ON `transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `transactions_kind_idx` ON `transactions` (`kind`);