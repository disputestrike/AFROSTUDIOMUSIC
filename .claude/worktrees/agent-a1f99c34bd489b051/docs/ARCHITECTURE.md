# Architecture

```
                              ┌────────────────────────────────────────┐
                              │              PayPal                    │
                              └─────────────┬──────────────────────────┘
                                            │ webhook (subscription, capture)
                                            ▼
┌─────────────┐    HTTPS    ┌───────────────────────────┐    BullMQ    ┌────────────────┐
│  Next.js    │────────────▶│  Fastify API (api)        │─────────────▶│  Worker        │
│  (web)      │  bearer JWT │  - routes/                │  via Redis   │  - processors/ │
│  Clerk auth │   from      │  - chat.ts (tool calls)   │              │  - FFmpeg      │
│  Studio Chat│   Clerk     │  - middleware/credits     │              │  - storage I/O │
└─────────────┘             │  - middleware/auth        │              └─────┬──────────┘
        ▲                   └────┬───────────┬──────────┘                    │
        │                        │           │                                ▼
        │                        ▼           ▼                       ┌────────────────────┐
        │              ┌──────────────┐  ┌──────────────┐             │   OpenAI / Eleven  │
        │              │ PostgreSQL   │  │  Redis       │             │   Stable Audio /   │
        │              │ + PostGIS    │  │  BullMQ      │             │   Mubert / Veo /   │
        │              │ + pgvector   │  │              │             │   Sora             │
        │              └──────────────┘  └──────────────┘             └────────────────────┘
        │                                                                      │
        └─── public /s/:code redirect ──── posts to /api/v1/share/events ◀─────┘
             (PostGIS heatmap fed here)
```

## The five flows

### 1. Chat → tool → artifact

```
user types → /api/v1/chat/messages
                ↓
          chatWithTools()  (OpenAI Responses API)
                ↓
   model returns tool_calls[ ]
                ↓
   runChatTool() per call, server-side, with credit charge
                ↓
   second model turn — summarize for user
                ↓
   web app updates with ArtifactCards
```

### 2. Long-running media

```
POST /beats/generate → enqueue(music) → ProviderJob.QUEUED
                                              ↓
                              Worker pulls → markRunning
                                              ↓
                                 musicAdapter().generate()
                                              ↓
                            poll until status==succeeded
                                              ↓
                       ingestRemoteFile() → S3/R2
                                              ↓
                  prisma.beatAsset.create() + markSucceeded
                                              ↓
                  Web polls GET /jobs/:id → renders new asset
```

### 3. Voice consent → profile → render

```
POST /voices/consents (signed disclosure)
         ↓
POST /voices  (samples + consentId → voice profile, status PENDING)
         ↓
worker: setup-voice-profile → provider voice ID → status READY
         ↓
POST /vocals/render (lyricId + voiceProfileId) → status QUEUED → READY
```

### 4. Approval gates

```
brief → hook → lyrics → beat → voice → mix → rights → release
```

Every `/X/approve` endpoint writes an Approval row. The export route checks for a recent successful RightsReceipt; without it, returns 412 PRECONDITION_FAILED.

### 5. Share + PostGIS heatmap

```
POST /share/links (workspace creates short code)
         ↓
public link /s/:code → GET /share/redirect/:code → 302 → targetUrl
                          ↓ also writes ShareEvent
                          
POST /share/events (client beacons for plays/downloads with optional lat/lng)
         ↓
PostGIS ST_MakePoint set via raw SQL
         ↓
GET /share/heatmap → ST_Centroid by country/region
```

## Why these choices

- **Prisma over Drizzle**: schema-driven migrations, batteries-included for our many relations.
- **Fastify over Express**: faster, better TS, native schema validation through Zod.
- **BullMQ over SQS**: simpler local dev (Redis already in stack), Railway-native.
- **Clerk over Auth.js**: production-grade SSO + webhooks for free, saves us 3 weeks.
- **PostGIS native types in Prisma `Unsupported(...)`**: gives us geography(Point) without giving up Prisma elsewhere. We pay a small price (raw SQL for `location`), and it's worth it.
- **Provider-agnostic adapters**: every external AI call goes through a 30-line file with one interface. Swapping providers is 1 PR.

## What's intentionally NOT included in MVP

- WebSocket/SSE streaming for chat (it's request/response — streaming is a follow-up).
- Audio fingerprinting against a copyrighted-music corpus (heuristic + LLM only).
- ASCAP/PRO registration automation.
- Multi-workspace switching UI (we resolve the user's first workspace).
- Royalty splitting between collaborators (the data model supports it; UI is TBD).

These are listed because the architecture is built to grow into them, not because they're missing in a sloppy way.
