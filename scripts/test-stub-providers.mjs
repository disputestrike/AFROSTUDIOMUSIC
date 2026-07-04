// Direct adapter test — verifies stub providers return well-formed ProviderJobResult.
process.env.MUSIC_PROVIDER = 'stub';
process.env.VOICE_PROVIDER = 'stub';
process.env.VIDEO_PROVIDER = 'stub';
process.env.IMAGE_PROVIDER = 'stub';

import { musicAdapter, voiceAdapter, videoAdapter, imageAdapter } from '../packages/ai/dist/providers/index.js';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); pass++; }
  else { console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`); fail++; }
}

console.log('=== STUB providers ===');

// Music
const m = musicAdapter();
check('music adapter name=stub', m.name === 'stub');
const mr = await m.generate({ genre: 'afro_fusion', bpm: 103, durationS: 30, withStems: true });
check('music generate status=succeeded', mr.status === 'succeeded');
check('music has mainAudioUrl', !!mr.output?.mainAudioUrl);
check('music returns stems when requested', Array.isArray(mr.output?.stems) && mr.output.stems.length > 0);
check('music returns durationS', mr.output?.durationS === 30);

// Voice
const v = voiceAdapter();
check('voice adapter name=stub', v.name === 'stub');
const vp = await v.createProfile({ voiceProfileId: 'vp_1', name: 'demo', sampleUrls: ['x'] });
check('voice profile create succeeded', vp.status === 'succeeded');
check('voice profile returns providerVoiceId', vp.output?.providerVoiceId?.startsWith('stub_'));
const vr = await v.render({ providerVoiceId: 'stub_vp_1', lyricBody: 'test', role: 'lead' });
check('voice render succeeded', vr.status === 'succeeded');
check('voice render has audioUrl', !!vr.output?.audioUrl);

// Video
const vd = videoAdapter();
check('video adapter name=stub', vd.name === 'stub');
const vdr = await vd.renderShot({ prompt: 'x', durationS: 5, aspectRatio: '9:16' });
check('video render succeeded', vdr.status === 'succeeded');
check('video has videoUrl', !!vdr.output?.videoUrl);
check('video format=mp4', vdr.output?.format === 'mp4');

// Image
const i = imageAdapter();
check('image adapter name=stub', i.name === 'stub');
const ir = await i.generate({ prompt: 'cover', size: '1024x1024', quality: 'low' });
check('image generate succeeded', ir.status === 'succeeded');
check('image has imageUrl', !!ir.output?.imageUrl);
check('image width/height set', ir.output?.width === 1024 && ir.output?.height === 1024);

console.log(`---\nSTUB providers: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
