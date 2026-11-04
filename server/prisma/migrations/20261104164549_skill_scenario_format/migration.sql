-- AlterTable
ALTER TABLE "TestScenario" ADD COLUMN "steps" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ScenarioWorkbook" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "crId" TEXT NOT NULL,
    "agentTaskId" TEXT,
    "version" INTEGER NOT NULL,
    "model" TEXT,
    "documents" TEXT NOT NULL,
    "dimensions" TEXT NOT NULL,
    "wip" TEXT NOT NULL,
    "enhancement" TEXT NOT NULL,
    "decisionTables" TEXT NOT NULL,
    "requirementCoverage" TEXT NOT NULL,
    "wipCoverage" TEXT NOT NULL,
    "enhancementCoverage" TEXT NOT NULL,
    "clarifications" TEXT NOT NULL,
    "selfReview" TEXT NOT NULL,
    "checks" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'APP_V1',
    "spec" TEXT,
    "columns" TEXT,
    "design" TEXT,
    "auditResult" TEXT,
    "auditReport" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ScenarioWorkbook_crId_fkey" FOREIGN KEY ("crId") REFERENCES "ChangeRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScenarioWorkbook" ("agentTaskId", "checks", "clarifications", "crId", "createdAt", "decisionTables", "dimensions", "documents", "enhancement", "enhancementCoverage", "id", "model", "requirementCoverage", "selfReview", "version", "wip", "wipCoverage") SELECT "agentTaskId", "checks", "clarifications", "crId", "createdAt", "decisionTables", "dimensions", "documents", "enhancement", "enhancementCoverage", "id", "model", "requirementCoverage", "selfReview", "version", "wip", "wipCoverage" FROM "ScenarioWorkbook";
DROP TABLE "ScenarioWorkbook";
ALTER TABLE "new_ScenarioWorkbook" RENAME TO "ScenarioWorkbook";
CREATE UNIQUE INDEX "ScenarioWorkbook_crId_version_key" ON "ScenarioWorkbook"("crId", "version");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
