import { soundBrief } from './packages/ai/dist/sound-dna/index.js';
const genres = ['afrobeats','amapiano','afro-pop','highlife','gospel','hip-hop','rnb','afro-fusion'];
for (const g of genres) {
  const b = soundBrief(g)?.brief ?? '';
  console.log('dna '+g+' len='+b.length);
}
