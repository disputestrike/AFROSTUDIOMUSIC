# Unit economics — cost model

All AI provider costs are **per-call estimates**. Real numbers will drift as providers update pricing — keep `packages/shared/src/credits.ts` as the source of truth.

## Per-action provider cost vs price-to-user

| Action | Provider est. | Charged credits | Margin |
|---|---|---|---|
| Polish a free-form brief | $0.01 | $0.05 | 5× |
| Generate 20 hooks | $0.04 | $0.15 | ~4× |
| Score 50 hooks (taste) | $0.06 | $0.20 | 3.3× |
| Full lyric draft | $0.10 | $0.30 | 3× |
| Cover art (low quality) | $0.006 | $0.30 | 50× |
| Cover art (high quality) | $0.21 | $2.50 | ~12× |
| 30-sec beat idea | $0.30-$1 | $2.50 | 2.5–8× |
| Full song (with stems) | $1-$3 | $7.50 | 2.5–7.5× |
| Stems export | $1-$2 | $5 | 2.5–5× |
| Voice profile setup | $0-$2 | $20 | one-time fee |
| 30-sec voice render | $0.10-$0.30 | $3 | 10–30× |
| Full-song voice | $0.50-$1.50 | $8 | 5–16× |
| Mix preset (FFmpeg, our compute) | ~$0.05 | $1 | 20× |
| Master preset | ~$0.05 | $1.50 | 30× |
| 8-second video (Veo Fast) | ~$0.80 | $10 | 12× |
| 20-second video | ~$2-$8 | $25 | 3–12× |
| Release export bundle | ~$0.05 | $0.50 | 10× |

## Plan-level math

Assume Pro Artist ($149/mo), heavy use:

- 60 demo songs × $7.50 credits = $450 of credit value covered? No — that's why credits are bought separately.
- A Pro plan **includes** ~60 demos and 100 voice renders / month — i.e. ~$450 + $300 worth of generation at retail. We pay providers ~$120-$180 for that. So gross margin is ~80%.
- PayPal fee ~3.49% + $0.49 per transaction (~$5.70/mo on Pro). Net contribution per Pro ~$108-$118/mo.
- 1,000 Pros = ~$120k/mo gross. Subtract infra ($30-$300/mo until 5,000 active workspaces) and OpenAI/text/embeddings (~$1,500-$3,000/mo at that scale).

## Limits to bake in from day one

- **Hard daily cap per workspace**: 30× monthly cap / 30. Stops a leak from burning the credit balance overnight.
- **Per-action rate limit**: 1 video render every 30 seconds per workspace, 3 in-flight at a time. Prevents accidental loops.
- **Free tier**: $5 onboarding credit (one-time) when the workspace is created by Clerk webhook. No recurring free credits.

## When to switch the provider

- Music provider commercial-use terms change → swap in `packages/ai/src/providers/music.ts` and redeploy worker.
- Video provider price spikes → switch `VIDEO_PROVIDER` env var. The DB schema captures provider per asset; you don't lose anything.
- OpenAI model deprecations → update `MODELS` in `packages/ai/src/openai-client.ts`.
