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

# The DSP stack ("the ear"). Pinned: numpy<2.1 + numba/llvmlite pinned so a numpy-2
# pull can never sneak in. scikit-learn = KMeans for sectionBoundaries' Laplacian
# clustering; pyloudnorm = momentary-LUFS energyCurve (soft-required, RMS fallback).
# --break-system-packages is required on Debian bookworm (PEP 668); single-purpose
# image so it's safe. All have manylinux wheels (no gcc / build-essential needed).
RUN pip3 install --break-system-packages --no-cache-dir \
  numpy==1.26.4 scipy==1.13.1 soundfile==0.12.1 \
  llvmlite==0.43.0 numba==0.60.0 librosa==0.10.2.post1 \
  scikit-learn==1.5.1 pyloudnorm==0.1.1

# A3-4 — LOCAL DEMUCS (htdemucs, CPU): the nightly stem separations that fed
# deep-measure were paying Replicate per track — the largest steady drain.
# CPU-only torch (no GPU on Railway) + demucs, pinned; weights pre-baked into
# the image so runs never re-download (~80MB) at 3am. Slow is fine at night;
# cash cost ≈ $0.
RUN pip3 install --break-system-packages --no-cache-dir \
  torch==2.4.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cpu \
  && pip3 install --break-system-packages --no-cache-dir demucs==4.0.1 \
  && python3 -c "from demucs.pretrained import get_model; get_model('htdemucs')"

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

# Runtime media tools do not require root. Keep the writable surface to normal
# temporary directories even if a codec receives a hostile input file.
USER node

# Railway's railway.json startCommand overrides this; kept as a sane default.
CMD ["pnpm", "--filter", "@afrohit/worker", "start"]
