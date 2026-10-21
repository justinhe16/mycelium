ALTER TABLE `transactions` ADD `transfer_tag` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `unmatched` integer DEFAULT false NOT NULL;