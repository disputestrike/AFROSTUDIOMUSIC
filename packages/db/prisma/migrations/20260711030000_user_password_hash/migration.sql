-- Email+password auth for AUTH_MODE=jwt (scrypt "salt:hex").
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
