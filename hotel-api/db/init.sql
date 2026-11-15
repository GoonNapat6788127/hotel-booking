-- =====================================================================
-- Hotel Booking API - MySQL 8 schema + seed (standalone, no Prisma needed)
-- Identical to prisma/migrations/20261011000000_init/migration.sql plus
-- CHECK constraints and seed data.  Run:
--     mysql -u root -p < database/schema.sql
-- Default admin:  admin@hotel.com / Admin1234!   (change it!)
-- =====================================================================
DROP DATABASE IF EXISTS hotel_booking;
CREATE DATABASE IF NOT EXISTS hotel_booking DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hotel_booking;

-- (optional) reset:
-- SET FOREIGN_KEY_CHECKS = 0;
-- DROP TABLE IF EXISTS `RevokedToken`, `Notification`, `Booking`, `Room`, `User`;
-- SET FOREIGN_KEY_CHECKS = 1;

-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('USER', 'ADMIN') NOT NULL DEFAULT 'USER',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Room` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `capacity` INTEGER NOT NULL,
    `pricePerNight` DECIMAL(10, 2) NOT NULL,
    `imageUrl` VARCHAR(500) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Booking` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `roomId` INTEGER NOT NULL,
    `checkIn` DATETIME(3) NOT NULL,
    `checkOut` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'CANCELLED', 'PAID') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Booking_roomId_checkIn_checkOut_idx`(`roomId`, `checkIn`, `checkOut`),
    INDEX `Booking_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Notification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `bookingId` INTEGER NOT NULL,
    `type` ENUM('BOOKING_CREATED', 'BOOKING_CANCELLED') NOT NULL,
    `message` VARCHAR(255) NOT NULL,
    `isRead` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Notification_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RevokedToken` (
    `jti` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RevokedToken_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`jti`)
) ENGINE = InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Notification` ADD CONSTRAINT `Notification_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `Booking`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data-integrity checks the database enforces on its own (MySQL 8.0.16+)
ALTER TABLE `Room`    ADD CONSTRAINT `Room_capacity_check`  CHECK (`capacity` >= 1);
ALTER TABLE `Room`    ADD CONSTRAINT `Room_price_check`     CHECK (`pricePerNight` > 0);
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_dates_check`  CHECK (`checkIn` < `checkOut`);

-- Seed data (the admin gets id 1)
INSERT INTO `User` (`name`, `email`, `passwordHash`, `role`)
VALUES ('Admin', 'admin@hotel.com', '$2b$10$nYCyayGpI4jzmclKvAfDQebY.hV/fXxPpl/uS50jh7MKKHQ/ZqeNm', 'ADMIN');

INSERT INTO `Room` (`name`, `capacity`, `pricePerNight`) VALUES
  ('Standard 101',     2, 1200.00),
  ('Deluxe 201',       3, 2200.00),
  ('Family Suite 301', 5, 3800.00);
  
select * from `User`;
SHOW TABLES;
