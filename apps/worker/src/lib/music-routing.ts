export interface MusicCredentials {
  replicate?: string;
  eleven?: string;
  suno?: string;
}

export function resolveMusicCredentials(
  workspaceProvider: string | null | undefined,
  workspaceApiKey: string | undefined,
  env: Record<string, string | undefined> = process.env
): MusicCredentials {
  return {
    replicate: (workspaceProvider === 'replicate' ? workspaceApiKey : undefined)
      || env.REPLICATE_API_TOKEN
      || env.REPLICATE_TOKEN,
    eleven: (workspaceProvider === 'eleven' ? workspaceApiKey : undefined)
      || env.ELEVEN_API_KEY
      || env.ELEVENLABS_API_KEY
      || env.ELEVEN_LABS_API_KEY
      || env.XI_API_KEY,
    suno: (workspaceProvider === 'suno' ? workspaceApiKey : undefined)
      || env.SUNO_API_KEY
      || env.SUNOAPI_KEY,
  };
}

export function workspaceProviderEngine(provider: string | null | undefined): string | undefined {
  if (provider === 'replicate') return 'minimax';
  if (provider === 'eleven') return 'eleven';
  if (provider === 'suno') return 'suno';
  return undefined;
}

export function credentialForEngine(engine: string, credentials: MusicCredentials): string | undefined {
  if (engine === 'suno') return credentials.suno;
  if (engine === 'eleven') return credentials.eleven;
  if (['minimax', 'minimax_ref', 'ace_step', 'replicate'].includes(engine)) return credentials.replicate;
  return undefined;
}

export function elevenMusicRouteApproved(
  firstParty: boolean,
  env: Record<string, string | undefined> = process.env
): boolean {
  return firstParty || env.ELEVEN_MUSIC_CUSTOMER_ROUTE_APPROVED === '1';
}
