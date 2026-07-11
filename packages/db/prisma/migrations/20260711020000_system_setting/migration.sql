-- Live operator toggles (autonomy on/off, etc.) without a redeploy.
CREATE TABLE "SystemSetting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);
