import { prisma } from '@afrohit/db';

/**
 * The "listen & learn" retrieval: pull the most recent deep-analyzed reference
 * songs (that the artist owns/fed in) for a genre and return a rich production
 * brief to inject into generation — so new songs rebuild the REAL drums,
 * percussion, log-drum, bass, groove and flow it heard, not a generic version.
 * Empty string when nothing has been learned yet (graceful no-op).
 */
export async function learnedReferenceBrief(workspaceId: string, genre?: string | null): Promise<string> {
  if (!genre) return '';
  const refs = await prisma.soundReference.findMany({
    where: { workspaceId, genre },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { title: true, summary: true },
  });
  const lines = refs
    .map((r) => (r.summary ? `• ${r.title ? r.title + ': ' : ''}${r.summary.slice(0, 700)}` : ''))
    .filter(Boolean);
  if (!lines.length) return '';
  return (
    'LEARNED FROM THE ARTIST\'S OWN REFERENCE SONGS — rebuild THIS real, layered sound (the drums, ' +
    'percussion/log-drum, bass, groove and vocal flow it heard); make it this rich and complex, never generic:\n' +
    lines.join('\n')
  );
}
