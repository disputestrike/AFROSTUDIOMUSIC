/**
 * CATALOGUE CONTAMINATION DETECTOR — the HARD block the owner demanded
 * (2026-07-13, the "Pepper Kiss" report).
 *
 * The concept/QA gates were tuned for the OLD failure (dense scenery + a
 * "Truth be say…" confession bridge). The writer ADAPTED around them and shipped
 * Mama-Titi-with-new-nouns: a food-seller romance, a literal object title
 * ("pepper on the lip" -> "Pepper Kiss"), a DIALOGUE bridge, calendar dialogue
 * ("Friday, Iyana, eight"), decorative Yoruba, and "gbam" impact filler. None of
 * that is what the old code looks for, so the song sailed through band B.
 *
 * This detects the owner's TWELVE forbidden catalogue patterns FROM THE LYRIC
 * ITSELF. When TWO OR MORE fire, it returns CATALOGUE_CONTAMINATION_DETECTED — a
 * rejection that BLOCKS the lyric. A rejection is a successful output. Pure,
 * zero-dependency, regex/wordlist heuristics; the >=2 threshold is the guard so a
 * single weak signal can never false-block a good record.
 */

// --- word fields (self-contained; no import to keep this leaf dependency-free) ---
const FOOD = new Set([
  'suya', 'pepper', 'soup', 'broth', 'jollof', 'amala', 'eba', 'garri', 'akara', 'boli',
  'corn', 'roast', 'meat', 'fish', 'kilishi', 'moimoi', 'dodo', 'plantain', 'zobo', 'kunu',
  'isiewu', 'nkwobi', 'ofada', 'egusi', 'efo', 'ewa', 'pap', 'shawarma', 'stew', 'sauce', 'barbecue',
]);
// Scenery OBJECTS that must not carry a song alone (title check). Food + place/transport props.
const SCENERY_OBJECTS = new Set([
  ...FOOD,
  'streetlight', 'generator', 'nepa', 'danfo', 'keke', 'okada', 'busstop', 'bus', 'conductor', 'garage',
  'market', 'junction', 'gutter', 'compound', 'gate', 'stall', 'kiosk', 'counter', 'blade',
  'gele', 'ankara', 'agbada', 'crate', 'bench', 'ladle', 'pot', 'steam', 'smoke',
]);
const VENDOR_LINE = /\b(turn(?:ing|s)?|wrap(?:ping|s)?|serv(?:e|es|ed|ing)|sell(?:ing|s)?|fry(?:ing)?|fried|roast(?:ing|s)?|grill(?:ing|s)?|dish(?:ing|es)?|hand(?:s|ing)?|pack(?:ing|s)?)\b/;
const VENDOR_NOUN = /\b(seller|vendor|stand|stall|kiosk|counter|customer|change|balance)\b/;
const ROMANCE = /\b(kiss|love|dance|baby|fine boy|fine girl|collar|lip|lips|honey|darling|sweet|hold me|hold my hand|my heart|romance|crush|my dear|near me)\b/;
const NAMES = new Set([
  'bimbo', 'titi', 'kemi', 'chidi', 'ada', 'ngozi', 'tunde', 'emeka', 'uche', 'sade', 'yemi', 'funke',
  'bola', 'sandra', 'amara', 'chioma', 'ifeoma', 'tobi', 'dele', 'segun', 'wale', 'tayo', 'seyi',
  'folake', 'ronke', 'bukola', 'ranti', 'shola', 'nkechi', 'obinna', 'ifeanyi', 'adaeze', 'zainab',
  'aisha', 'halima', 'fatima', 'blessing', 'precious', 'chinedu', 'ebuka', 'kunle', 'lekan', 'sikira',
]);
// Manufactured comedic impact sounds — any one is a strong tell. NOTE: legit
// percussive VOCABLES ("kpokpokpo", "nawo nawo", "soso") are the SOUL of Afro
// hooks (the app's own writer law celebrates them) — they must NOT be flagged.
// Only the out-of-place cartoon impacts the owner named belong here.
const IMPACT_STRONG = /\b(gbam|gbadum|gbadu)\b/i;
// Ambiguous ones only count as an ad-lib in a parenthetical, and need repetition.
const IMPACT_WEAK = /\b(bam|boom|pow|pah|pak)\b/i;
const DAYS = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const CLOCK = /\b(\d{1,2}\s*(?:am|pm|o'?clock)|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|noon|midnight)\b/i;
const APPOINTMENT = /\b(come back|show my face|keep your word|see you again|meet me|i go dey there|link up|pull up)\b/i;
const TRANSACTION = /\b(pay|money|price|charge|cash|order|owe|fee|balance|change)\b/i;
const YORUBA_DIACRITIC = /[àáèéìíòóùúẹọṣǹń]/i;
// Genuine Yoruba/Igbo phrases that would be DECORATION in a Pidgin/English song.
// NOTE: common Pidgin interjections ("omo", "jare", "abeg") are NOT here — they
// are everyday Pidgin, not decorative heritage-language (they false-blocked a
// real defiance anthem in the owner red-team).
const YORUBA_PHRASE = /\b(je ka jo|jɛ ka jo|o wa|mo gbo|se ni|ba mi|fun mi|mo feran|jowo|pele o|e ku)\b/i;

export interface ContaminationPattern {
  code: string;
  label: string;
  evidence: string;
}

export interface ContaminationResult {
  patterns: ContaminationPattern[];
  count: number;
  decision: 'CATALOGUE_CONTAMINATION_DETECTED' | null;
  resembles: string | null;
  titleSalvageable: boolean;
  titleNote: string;
  requiredEngine: string;
}

function lyricLines(body: string): string[] {
  return (body ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^\[[^\]]*\]\s*$/.test(l));
}

function sectionLines(body: string, rx: RegExp): string[] {
  const out: string[] = [];
  let inSec = false;
  for (const raw of (body ?? '').split(/\r?\n/)) {
    const h = /^\s*\[([^\]]+)\]\s*$/.exec(raw);
    if (h) { inSec = rx.test(h[1]!); continue; }
    if (inSec && raw.trim()) out.push(raw.trim());
  }
  return out;
}

const tokens = (s: string): string[] => (s ?? '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Detect the owner's 12 forbidden catalogue patterns in a finished lyric.
 * >=2 patterns => CATALOGUE_CONTAMINATION_DETECTED.
 */
export function detectCatalogueContamination(input: {
  title: string;
  body: string;
  languageMix?: Record<string, number> | null;
}): ContaminationResult {
  const body = input.body ?? '';
  const title = input.title ?? '';
  const lines = lyricLines(body);
  const bodyLow = body.toLowerCase();
  const titleTok = tokens(title);
  const p: ContaminationPattern[] = [];

  const hasFood = tokens(body).some((w) => FOOD.has(w));
  const romance = ROMANCE.test(bodyLow);

  // 1. Romantic attraction to a food seller.
  const vendorLine = lines.find((l) => {
    const t = tokens(l);
    return t.some((w) => FOOD.has(w)) && (VENDOR_LINE.test(l.toLowerCase()) || VENDOR_NOUN.test(l.toLowerCase()));
  });
  if (hasFood && romance && vendorLine) {
    p.push({ code: 'food_seller_romance', label: 'romantic attraction to a food seller', evidence: vendorLine });
  }

  // 1b. DISGUISED vendor-romance (owner red-team round 3, "Weigh My Morning"): the
  //     beloved is someone you BUY FROM / are SERVED BY, with the goods hidden in
  //     metaphor ("small suns", "green soldiers") so there is NO literal food word.
  //     The tell is the SERVICE + TRANSACTION + ANONYMITY, not the product.
  const SERVE_YOU = /\b(you|your hand|your palm)\b[^.]*\b(weigh|scale|count|fold|wrap|tie|arrange|pack|measure|serve|dish|fan|turn)\b|\b(weigh|scale|count|fold|wrap|tie|arrange|pack|measure|serve|dish|fan|turn)\b[^.]*\b(you|your hand|your palm|am for me)\b/i;
  const RETURN_BIZ = /\b(come back tomorrow|only business|my business|fill my hand|count am for me|your change|the note done finish|next customer|the queue|the line for)\b/i;
  const ANON_VENDOR = /\b((no|don'?t|never)\s+(even\s+)?know your name)\b/i;
  const servesYou = lines.some((l) => SERVE_YOU.test(l));
  if (servesYou && (RETURN_BIZ.test(bodyLow) || ANON_VENDOR.test(bodyLow)) && (romance || ANON_VENDOR.test(bodyLow))) {
    p.push({
      code: 'disguised_vendor_romance',
      label: 'a food/goods-seller romance with the product hidden in metaphor (service + transaction + anonymity)',
      evidence: lines.find((l) => SERVE_YOU.test(l)) ?? 'you are served, you transact, you never learn their name',
    });
  }

  // 2. A local object / food / transport prop as the CENTRAL idea (in the title).
  const titleObject = titleTok.find((w) => SCENERY_OBJECTS.has(w));
  if (titleObject) {
    p.push({ code: 'local_object_central', label: 'a local object is the central idea (in the title)', evidence: `title "${title}" is built on the object "${titleObject}"` });
  }

  // 3. A random Nigerian name dropped in to simulate authenticity.
  const nameHit = tokens(body).find((w) => NAMES.has(w)) || (/^\s*\(?\s*([A-Z][a-z]+)\s*:/m.exec(body)?.[1] ?? '').toLowerCase();
  if (nameHit && NAMES.has(nameHit)) {
    p.push({ code: 'decorative_name', label: 'a character name added to simulate authenticity', evidence: `named character "${nameHit}"` });
  }

  // 4. Flirtation created through buying / serving FOOD (owner pattern #4). A
  //    plain money/brag line ("money dey my hand") is normal Afro and must NOT
  //    trip this — it requires a FOOD/vendor context.
  if (TRANSACTION.test(bodyLow) && (hasFood || !!vendorLine) && (romance || /\bdance\b/.test(bodyLow))) {
    const line = lines.find((l) => TRANSACTION.test(l.toLowerCase()) && (ROMANCE.test(l.toLowerCase()) || /\bdance\b/i.test(l))) || 'a food/serving transaction used as flirtation';
    p.push({ code: 'flirt_through_transaction', label: 'flirtation built on buying/serving food', evidence: line });
  }

  // 5. The title is the LITERAL result of an event in the verse (not a metaphor).
  if (titleObject) {
    const literalLine = lines.find((l) => {
      const low = l.toLowerCase();
      return tokens(l).includes(titleObject) && /\b(wipe|lip|lips|hand|thumb|mouth|blade|plate|from my|on my|turn|red|pour|hold)\b/.test(low);
    });
    if (literalLine) {
      p.push({ code: 'literal_object_title', label: 'the title is the literal result of a physical event, not a metaphor', evidence: literalLine });
    }
  }

  // 6. Yoruba/Igbo inserted decoratively (not essential to meaning) in a mostly
  //    non-native song. Guard against flagging a GENUINELY Yoruba record: count
  //    DISTINCT diacritic-bearing words — a real Yoruba song has many, a
  //    decorative sprinkle (one repeated tag like "jẹ́ ká jó") has few. When
  //    languageMix is absent this is the only signal, so it must be robust.
  const yo = input.languageMix?.yo ?? 0;
  const ig = input.languageMix?.ig ?? 0;
  const nativeShare = yo + ig;
  const diacriticWords = new Set((bodyLow.match(/\b[a-zàáèéìíòóùúẹọṣǹń']*[àáèéìíòóùúẹọṣǹń][a-zàáèéìíòóùúẹọṣǹń']*\b/gi) ?? []));
  const yorubaHeavy = diacriticWords.size >= 5 || nativeShare >= 0.5;
  const hasYoruba = YORUBA_DIACRITIC.test(body) || YORUBA_PHRASE.test(bodyLow);
  if (hasYoruba && !yorubaHeavy) {
    // decorative when it is a small, repeated sprinkle rather than the song's language
    const phrase = (YORUBA_PHRASE.exec(bodyLow)?.[0]) || (body.split(/\r?\n/).find((l) => YORUBA_DIACRITIC.test(l))?.trim() ?? 'native-language phrase');
    p.push({ code: 'decorative_local_language', label: 'Yoruba/Igbo used as decoration, not essential meaning', evidence: phrase });
  }

  // 7. Fake hook-impact sounds ("gbam", "boom", "kpokpokpo"...).
  const parenAdlibs = (body.match(/\(([^)]*)\)/g) ?? []).join(' ').toLowerCase();
  const weakCount = (parenAdlibs.match(IMPACT_WEAK) ? (parenAdlibs.match(new RegExp(IMPACT_WEAK.source, 'gi'))?.length ?? 0) : 0);
  if (IMPACT_STRONG.test(bodyLow) || weakCount >= 2) {
    const ev = (IMPACT_STRONG.exec(bodyLow)?.[0]) || (IMPACT_WEAK.exec(parenAdlibs)?.[0]) || 'impact filler';
    p.push({ code: 'impact_sound_filler', label: 'manufactured impact sound as fake hook energy', evidence: `"${ev}"` });
  }

  // 8. Dialogue carrying schedules / addresses / appointments / prices.
  const apptLine = lines.find((l) => {
    const low = l.toLowerCase();
    return (DAYS.test(low) && (CLOCK.test(low) || APPOINTMENT.test(low))) || (TRANSACTION.test(low) && /\b(then|come|dance|money)\b/.test(low) && /["“]/.test(l));
  });
  if (apptLine || (DAYS.test(bodyLow) && CLOCK.test(bodyLow))) {
    p.push({ code: 'transactional_dialogue', label: 'dialogue carrying a schedule / appointment / price', evidence: apptLine ?? 'day + time appointment in the lyric' });
  }

  // 9. A screenplay: heavy QUOTED dialogue telling a chronological scene. Require
  //    actual quotation marks — a bare "I say / she say" is normal Pidgin
  //    declarative, not screenplay (it false-blocked a real anthem in the red-team).
  const quotedLines = lines.filter((l) => /["“”][^"“”]{2,}["“”]/.test(l));
  if (quotedLines.length >= 3) {
    p.push({ code: 'screenplay_scene', label: `${quotedLines.length} dialogue/narration lines — a screenplay, not a record`, evidence: quotedLines[0]! });
  }

  // 10. A bridge built from character dialogue.
  const bridge = sectionLines(body, /bridge/i);
  const dialogueBridge = bridge.find((l) => /["“]/.test(l) || /^\s*\(?\s*[A-Z][a-z]+\s*:/.test(l) || /\b(she|he)\s+(say|said|ask)\b/i.test(l));
  if (dialogueBridge) {
    p.push({ code: 'dialogue_bridge', label: 'the bridge is character dialogue', evidence: dialogueBridge });
  }

  // 11. An outro that CONFIRMS the relationship / resolves the scene (a reunion,
  //     an appointment kept, a "dance with me" payoff). NOTE: the title/hook line
  //     recurring in the outro is NORMAL for a hook record and is NOT this — only
  //     narrative RESOLUTION counts.
  const outro = sectionLines(body, /outro/i);
  const explained = outro.find((l) => {
    const low = l.toLowerCase();
    return APPOINTMENT.test(low) || (DAYS.test(low) && CLOCK.test(low)) || /\bdance with me\b/.test(low);
  });
  if (outro.length && explained) {
    p.push({ code: 'explained_outro', label: 'the outro confirms the relationship / explains the title', evidence: explained });
  }

  // 12. The same screenplay skeleton as previously-rejected songs.
  const structural = ['screenplay_scene', 'dialogue_bridge', 'explained_outro'].filter((c) => p.some((x) => x.code === c)).length;
  if (structural >= 2 || (p.some((x) => x.code === 'food_seller_romance') && p.some((x) => x.code === 'literal_object_title'))) {
    p.push({ code: 'rejected_skeleton', label: 'the same skeleton as previously-rejected songs, nouns swapped', evidence: 'scene-open -> transaction/flirtation -> dialogue -> appointment -> explained outro' });
  }

  // 13. SCENERY-DEPENDENT CONCEPT — the object-removal test on the FINISHED lyric.
  //     This catches the narration evasions that dodge every surface pattern above
  //     (a roadside/market/garage/street SCENE that IS the whole song, told in
  //     first person with no names, quotes or "gbam"). If a large share of the
  //     lines exist only to paint a commercial/street setting — and especially if
  //     the hook or title leans on that setting — the concept is scenery, not a
  //     feeling. Time/weather words (morning, night, road) are deliberately NOT
  //     scenery, and a single place reference in an emotional song stays under the
  //     density floor.
  const SCENERY = new Set([
    'roadside', 'streetlight', 'corner', 'junction', 'garage', 'market', 'stall', 'stand', 'kiosk', 'buka',
    'coalpot', 'coal', 'charcoal', 'embers', 'ember', 'lantern', 'lamp', 'stove', 'grill', 'skewer', 'tongs',
    'apron', 'tray', 'basket', 'crate', 'bench', 'ladle', 'generator', 'nepa', 'flame', 'smoke',
    'danfo', 'keke', 'okada', 'molue', 'conductor', 'traders', 'trader', 'oshodi', 'balogun', 'ojuelegba',
    // Concrete street-stall props (owner red-team 2026-07-13 — the "camera-
    // direction" evasions were built on these). Deliberately excludes metaphor-
    // prone words (fire, light, star, road, sun) to protect emotional records.
    'tin', 'drum', 'bulb', 'wire', 'umbrella', 'basin', 'kettle', 'awning', 'tarpaulin', 'bucket', 'cart',
    'wheel', 'thread', 'receipt', 'tarred', 'traffic', 'gutter', 'plank', 'tent', 'coalpot',
    // Cityscape-tour markers (owner red-team round 2 — the "place-tour vibe
    // ballad" evasion). Unambiguous geography/scene words, NOT metaphor-prone
    // ones (island/bridge/coast/road/moon/star are excluded on purpose).
    'lagoon', 'marina', 'skyline', 'mainland', 'oworonshoki', 'cms', 'harmattan', 'flyover', 'expressway', 'tollgate',
    ...SCENERY_OBJECTS,
  ]);
  const sceneryLineCount = lines.filter((l) => tokens(l).some((w) => SCENERY.has(w) || FOOD.has(w))).length;
  const sceneryDensity = lines.length ? sceneryLineCount / lines.length : 0;
  const hookLines = sectionLines(body, /hook|chorus|refrain/i);
  const hookScenery = hookLines.some((l) => tokens(l).some((w) => SCENERY.has(w) || FOOD.has(w))) || titleTok.some((w) => SCENERY.has(w) || FOOD.has(w));
  const sceneryDependent = sceneryDensity >= 0.4 || (hookScenery && sceneryDensity >= 0.28);
  if (sceneryDependent) {
    p.push({
      code: 'scenery_dependent',
      label: `the concept is a scene, not a feeling (~${Math.round(sceneryDensity * 100)}% of lines paint a setting)`,
      evidence: `scenery/food in ${sceneryLineCount}/${lines.length} lines${hookScenery ? ' + the hook or title leans on the setting' : ''}`,
    });
  }

  const count = p.length;
  // >=2 patterns, OR a strongly scenery-dependent concept ON ITS OWN (the
  // object-removal test: strip the props and the song is empty). A hook/title
  // built on the setting plus a scenery-dense body is enough to reject alone.
  const strongScenery = sceneryDensity >= 0.45 || (hookScenery && sceneryDensity >= 0.34);
  // A disguised vendor-romance is unambiguous on its own (service applied to
  // "you" + transaction/return + romance/anonymity) — reject even at count 1.
  const disguisedVendor = p.some((x) => x.code === 'disguised_vendor_romance');
  const decision = count >= 2 || strongScenery || disguisedVendor ? 'CATALOGUE_CONTAMINATION_DETECTED' : null;
  const resembles =
    p.some((x) => x.code === 'food_seller_romance' || x.code === 'literal_object_title')
      ? 'Sip Am Bam / Mama Titi (food-vendor romance template)'
      : structural >= 2
        ? 'the catalogue screenplay template'
        : p.some((x) => x.code === 'scenery_dependent')
          ? 'a scenery-dependent concept (fails the object-removal test — strip the props and the song is empty)'
          : count >= 2
            ? 'a previously-rejected catalogue pattern'
            : null;

  const titleSalvageable = !!titleObject; // an object title can live IF re-based as a metaphor
  const titleNote = titleObject
    ? `Keep "${title}" ONLY as a metaphor (an emotion the object stands for), never the literal event that produced it.`
    : `The title may be reusable once the concept is emotion-first.`;
  const requiredEngine = romance
    ? 'a human engine, e.g. dangerous/addictive attraction — the sweetness that keeps you returning even though you know it will hurt later. Emotion first, metaphor second, no vendor screenplay.'
    : 'a human engine (a feeling, desire, conflict, or victory) that survives with every prop, name, place and local word removed.';

  return { patterns: p, count, decision, resembles, titleSalvageable, titleNote, requiredEngine };
}
