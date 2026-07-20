import { prisma } from '@afrohit/db';
import { isFirstPartyWorkspace } from '@afrohit/shared';

export interface MusicRouteCapabilities {
  workspaceProvider: string | null;
  firstParty: boolean;
  sunoAllowed: boolean;
  elevenAllowed: boolean;
  flagship: boolean;
  advanced: boolean;
  standard: boolean;
  sunoAvailable: boolean;
  elevenAvailable: boolean;
  replicateAvailable: boolean;
  /** fal route connected — satisfies ace_step (dual-route) even without Replicate. */
  falAvailable: boolean;
  /** AfroOne sings: the genuine-singing path is armed (flag ON) AND at least one
   *  singing route (local score-singer / fal / replicate) is reachable. The UI
   *  must NEVER advertise singing unless this is true — capability-driven copy,
   *  not hardcoded promises (owner, 2026-07-19: "our engine is still not
   *  singing... that should have been corrected" — the copy follows the flag). */
  afrooneSinging: boolean;
}

export function musicRoutePolicy(workspaceId: string): {
  firstParty: boolean;
  sunoAllowed: boolean;
  elevenAllowed: boolean;
} {
  const firstParty = isFirstPartyWorkspace(workspaceId);
  return {
    firstParty,
    sunoAllowed: firstParty,
    elevenAllowed: firstParty || process.env.ELEVEN_MUSIC_CUSTOMER_ROUTE_APPROVED === '1',
  };
}

export async function musicRouteCapabilities(workspaceId: string): Promise<MusicRouteCapabilities> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { musicProvider: true, musicApiKey: true },
  });
  const hasWorkspaceKey = !!workspace.musicApiKey;
  const policy = musicRoutePolicy(workspaceId);
  const sunoAvailable = (workspace.musicProvider === 'suno' && hasWorkspaceKey) ||
    !!(process.env.SUNO_API_KEY || process.env.SUNOAPI_KEY);
  const elevenConnected = (workspace.musicProvider === 'eleven' && hasWorkspaceKey) ||
    !!(process.env.ELEVEN_API_KEY || process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY || process.env.XI_API_KEY);
  const replicateAvailable = (workspace.musicProvider === 'replicate' && hasWorkspaceKey) ||
    !!(process.env.REPLICATE_API_TOKEN || process.env.REPLICATE_TOKEN);
  const falAvailable = !!process.env.FAL_KEY;

  return {
    workspaceProvider: workspace.musicProvider,
    firstParty: policy.firstParty,
    sunoAllowed: policy.sunoAllowed,
    elevenAllowed: policy.elevenAllowed,
    sunoAvailable,
    elevenAvailable: policy.elevenAllowed && elevenConnected,
    replicateAvailable,
    falAvailable,
    flagship: policy.sunoAllowed && sunoAvailable,
    advanced: policy.elevenAllowed && elevenConnected,
    standard: replicateAvailable,
    afrooneSinging:
      process.env.AFROONE_SINGING_ENABLED === '1' &&
      (!!process.env.AFROONE_SINGING_LOCAL_URL?.trim() || falAvailable || replicateAvailable),
  };
}

export function validateMusicRoute(
  requested: string | undefined,
  capabilities: MusicRouteCapabilities,
  withVocals = true,
): { ok: true } | { ok: false; statusCode: 409 | 403; error: string; message: string } {
  const explicit = requested && requested !== 'auto' ? requested : undefined;
  const workspaceDefault = capabilities.workspaceProvider === 'replicate'
    ? 'minimax'
    : ['suno', 'eleven'].includes(capabilities.workspaceProvider ?? '')
      ? capabilities.workspaceProvider!
      : undefined;
  const envDefault = withVocals
    ? process.env.SONG_ENGINE?.toLowerCase()
    : (process.env.INSTRUMENTAL_ENGINE ?? process.env.MUSIC_PROVIDER)?.toLowerCase();
  const selectedRaw = explicit ?? workspaceDefault ?? envDefault;
  const selected = selectedRaw === 'replicate' ? 'minimax' : selectedRaw;

  if (!selected) {
    return capabilities.flagship || capabilities.advanced || capabilities.standard
      ? { ok: true }
      : {
          ok: false,
          statusCode: 409,
          error: 'music_engine_not_connected',
          message: 'No usable music engine is connected for this workspace. An owner must connect one in Settings.',
        };
  }
  if (!['suno', 'eleven', 'minimax', 'ace_step'].includes(selected)) {
    return {
      ok: false,
      statusCode: 409,
      error: 'music_engine_unsupported',
      message: 'The selected music engine is unsupported. Choose a connected route in Settings.',
    };
  }
  if (selected === 'suno' && !capabilities.firstParty) {
    return {
      ok: false,
      statusCode: 403,
      error: 'flagship_engine_first_party_only',
      message: 'The flagship route is available only for approved first-party release workspaces.',
    };
  }
  if (selected === 'eleven' && !capabilities.advanced) {
    return {
      ok: false,
      statusCode: capabilities.elevenAllowed ? 409 : 403,
      error: capabilities.elevenAllowed ? 'advanced_engine_not_connected' : 'advanced_engine_commercial_approval_required',
      message: capabilities.elevenAllowed
        ? 'The advanced engine is not connected for this workspace.'
        : 'This route requires current commercial terms and co-branding approval before customer use.',
    };
  }
  if (selected === 'suno' && !capabilities.flagship) {
    return { ok: false, statusCode: 409, error: 'flagship_engine_not_connected', message: 'The flagship engine is not connected for this workspace.' };
  }
  if (['minimax', 'ace_step'].includes(selected) && !capabilities.standard) {
    return { ok: false, statusCode: 409, error: 'standard_engine_not_connected', message: 'The standard music engine is not connected for this workspace.' };
  }
  return { ok: true };
}
