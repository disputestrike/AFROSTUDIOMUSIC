import { prisma } from './index';

async function main() {
  console.log('Seeding AfroHit Studio...');

  // A demo workspace + owner — replace clerkId with a real one once Clerk is wired.
  const workspace = await prisma.workspace.upsert({
    where: { slug: 'demo' },
    update: {},
    create: {
      name: 'Demo Studio',
      slug: 'demo',
      plan: 'PRO',
      creditsCents: 10_000_00, // $100 worth of credits in 1/100 cents
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'owner@demo.afrohit' },
    update: {},
    create: {
      clerkId: 'user_demo_owner',
      email: 'owner@demo.afrohit',
      fullName: 'Demo Owner',
    },
  });

  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    update: {},
    create: { workspaceId: workspace.id, userId: user.id, role: 'OWNER' },
  });

  // Demo artist with realistic Afro-fusion DNA
  const artist = await prisma.artist.create({
    data: {
      workspaceId: workspace.id,
      name: 'Demo',
      stageName: 'BENXP',
      bio: 'Afro-fusion artist with Pidgin/Yoruba/English delivery.',
      vocalRangeLow: 'A2',
      vocalRangeHigh: 'F5',
      vocalTone: ['smooth', 'airy', 'street-edge'],
      defaultBpmMin: 95,
      defaultBpmMax: 115,
      languages: ['pcm', 'yo', 'en'],
      laneSummary:
        'Smooth Afro-fusion with street pocket. Romantic + spiritual. Hooks lead.',
      references: [
        { name: 'Wizkid', lane: 'smooth/pocket', note: 'reference vibe only — no clone' },
        { name: 'Rema', lane: 'global hook simplicity', note: 'pattern study only' },
      ],
      slang: [
        { phrase: 'omo', meaning: 'man/exclamation', language: 'pcm' },
        { phrase: 'shey', meaning: 'do you?', language: 'yo' },
      ],
      cornyBanned: ['baby girl', 'shawty', 'lit fr'],
    },
  });

  // A starter project + brief
  const project = await prisma.project.create({
    data: {
      workspaceId: workspace.id,
      artistId: artist.id,
      title: 'Sweet Like Pawpaw',
      genre: 'afro_fusion',
      bpm: 103,
      keySignature: 'A minor',
      briefs: {
        create: {
          mood: 'romantic, danceable',
          topic: 'falling for a girl from Surulere who carries the room',
          language: ['pcm', 'yo'],
          audience: 'club + romantic',
          bpm: 103,
          notes: 'Hook should land before second 8. Repeatable, simple.',
        },
      },
    },
  });

  console.log({ workspace: workspace.slug, artist: artist.stageName, project: project.title });
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
