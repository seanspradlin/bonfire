ALTER TABLE `documents` ADD `parent_id` text;
CREATE INDEX `documents_parent_id_idx` ON `documents` (`parent_id`);
