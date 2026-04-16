-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "maintenanceEnabled" INTEGER NOT NULL DEFAULT 0,
    "maintenanceMessage" TEXT NOT NULL DEFAULT 'Ведутся технические работы. Генерация временно недоступна.',
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO "AppSettings" ("id", "maintenanceEnabled", "maintenanceMessage", "updatedAt")
VALUES ('global', 0, 'Ведутся технические работы. Генерация временно недоступна.', CURRENT_TIMESTAMP);
