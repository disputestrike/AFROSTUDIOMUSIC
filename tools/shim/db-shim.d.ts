/** SANDBOX-ONLY compile shim: prisma engines can't download here, so real
 *  @afrohit/db types are unavailable. This any-shim lets tsc verify EVERYTHING
 *  ELSE (imports, signatures, syntax) — the error class that broke two deploys.
 *  Railway/CI never use this: only tsconfig.shim.json includes it. */
declare module '@afrohit/db' {
  interface PrismaShimClient {
    [key: string]: any;
    $transaction<T>(fn: (tx: PrismaShimClient) => Promise<T>): Promise<T>;
    $transaction<T extends readonly unknown[]>(queries: T): Promise<T>;
  }
  export const prisma: PrismaShimClient;
  export const Prisma: any;
  export namespace Prisma {
    type InputJsonValue = any;
    type TransactionClient = PrismaShimClient;
  }
  export const JobStatus: any;
  export type JobStatus = any;
  export const VoiceProfileStatus: any;
  export type VoiceProfileStatus = any;
  // Autonomy flag helpers (packages/db/src/index.ts) — real exports, mirrored here.
  export type AutonomyJob = any;
  export const isAutonomyEnabled: any;
  export const setAutonomyEnabled: any;
  export const allAutonomyFlags: any;
  export const assertSecretConfiguration: () => void;
  export const isSealedSecret: (value: string | null | undefined) => boolean;
  export const sealSecret: (plaintext: string) => string;
  export const openSecret: (stored: string | null | undefined) => string | undefined;
  export const secretHint: (stored: string | null | undefined) => string | null;
  export const migratePlaintextWorkspaceSecrets: () => Promise<number>;
  export const releaseEvidenceHash: (value: unknown) => string;
  export const normalizeSplitSheet: (value: unknown) => Array<{ name: string; role: string; share: number }>;
  export const loadReleaseCertification: (
    db: PrismaShimClient,
    options: { workspaceId: string; songId: string; projectId?: string; hitTarget?: number },
  ) => Promise<any>;
  export const RELEASE_REVIEW_LANGUAGES: readonly string[];
}
