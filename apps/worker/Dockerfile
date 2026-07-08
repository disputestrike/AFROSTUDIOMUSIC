# Worker image — needs the ffmpeg binary for real mix/master, which Railpack
# can't install. Single-stage on purpose: `prisma generate` and the app run in
# the SAME image, so the Prisma query engine auto-matches the runtime platform
# (no binaryTargets needed). Build context is the repo root (pnpm workspace).
FROM node:20-bookworm-slim

# ffmpeg = mix/master; openssl + ca-certificates = Prisma engine + TLS
# python3 + libsndfile1 = "the ear" (Phase 0 audio measurement via librosa);
# ffmpeg doubles as librosa's audioread backend so mp3/m4a decode without extra deps.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates python3 python3-pip libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

# The DSP stack. Pinned + numpy<2.1 for numba/librosa compat. --break-system-packages
# is required on Debian bookworm (PEP 668); this image is single-purpose so it's safe.
RUN pip3 install --break-system-packages --no-cache-dir \
  numpy==1.26.4 scipy==1.13.1 soundfile==0.12.1 librosa==0.10.2.post1

RUN npm install -g pnpm@9.12.0

WORKDIR /app

# Copy the whole monorepo (workspace root) so pnpm filters resolve.
COPY . .

# Install with dev deps (tsc/prisma live there), then build in dependency order.
RUN pnpm install --frozen-lockfile --prod=false \
  && pnpm --filter @afrohit/db generate \
  && pnpm --filter @afrohit/shared build \
  && pnpm --filter @afrohit/db build \
  && pnpm --filter @afrohit/ai build \
  && pnpm --filter @afrohit/worker build

ENV NODE_ENV=production

# Railway's railway.json startCommand overrides this; kept as a sane default.
CMD ["pnpm", "--filter", "@afrohit/worker", "start"]
