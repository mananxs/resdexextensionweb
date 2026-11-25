-- AlterTable
ALTER TABLE "User" ADD COLUMN     "geminiKeysEnc" TEXT,
ADD COLUMN     "groqKeysEnc" TEXT,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "useSharedKeys" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "rubricHash" TEXT;

-- AlterTable
ALTER TABLE "Candidate" ADD COLUMN     "scoredRubricHash" TEXT;

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resume" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "candidateId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "extractedText" TEXT NOT NULL,
    "guessedName" TEXT,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreCache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "candidateKey" TEXT NOT NULL,
    "rubricHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "resultJson" JSONB NOT NULL,
    "displayName" TEXT,
    "profileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "stateJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchHit" (
    "searchSessionId" TEXT NOT NULL,
    "scoreCacheId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchHit_pkey" PRIMARY KEY ("searchSessionId","scoreCacheId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Resume_userId_createdAt_idx" ON "Resume"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Resume_userId_jobId_idx" ON "Resume"("userId", "jobId");

-- CreateIndex
CREATE INDEX "Resume_candidateId_idx" ON "Resume"("candidateId");

-- CreateIndex
CREATE UNIQUE INDEX "Resume_userId_sha256_key" ON "Resume"("userId", "sha256");

-- CreateIndex
CREATE INDEX "ScoreCache_userId_jobId_rubricHash_score_idx" ON "ScoreCache"("userId", "jobId", "rubricHash", "score");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreCache_userId_jobId_candidateKey_rubricHash_kind_key" ON "ScoreCache"("userId", "jobId", "candidateKey", "rubricHash", "kind");

-- CreateIndex
CREATE INDEX "SearchSession_userId_lastSeenAt_idx" ON "SearchSession"("userId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchSession_userId_jobId_signature_key" ON "SearchSession"("userId", "jobId", "signature");

-- CreateIndex
CREATE INDEX "SearchHit_scoreCacheId_idx" ON "SearchHit"("scoreCacheId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resume" ADD CONSTRAINT "Resume_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreCache" ADD CONSTRAINT "ScoreCache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreCache" ADD CONSTRAINT "ScoreCache_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSession" ADD CONSTRAINT "SearchSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchSession" ADD CONSTRAINT "SearchSession_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchHit" ADD CONSTRAINT "SearchHit_searchSessionId_fkey" FOREIGN KEY ("searchSessionId") REFERENCES "SearchSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchHit" ADD CONSTRAINT "SearchHit_scoreCacheId_fkey" FOREIGN KEY ("scoreCacheId") REFERENCES "ScoreCache"("id") ON DELETE CASCADE ON UPDATE CASCADE;

