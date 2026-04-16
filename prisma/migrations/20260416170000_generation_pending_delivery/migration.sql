-- Redefine Generation: результат по умолчанию ожидает выгрузки админом
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Generation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "aspectRatio" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultUrl" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Generation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_Generation" ("id", "userId", "modelId", "modelName", "prompt", "aspectRatio", "status", "resultUrl", "errorMessage", "createdAt", "updatedAt")
SELECT "id", "userId", "modelId", "modelName", "prompt", "aspectRatio", "status", "resultUrl", "errorMessage", "createdAt", "updatedAt" FROM "Generation";

DROP TABLE "Generation";
ALTER TABLE "new_Generation" RENAME TO "Generation";

CREATE INDEX "Generation_userId_createdAt_idx" ON "Generation"("userId", "createdAt");

PRAGMA foreign_keys=ON;
