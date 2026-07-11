/** SANDBOX-ONLY compile shim: prisma engines can't download here, so real
 *  @afrohit/db types are unavailable. This any-shim lets tsc verify EVERYTHING
 *  ELSE (imports, signatures, syntax) — the error class that broke two deploys.
 *  Railway/CI never use this: only tsconfig.shim.json includes it. */
declare module '@afrohit/db' {
  export const prisma: any;
  export const Prisma: any;
  export const JobStatus: any;
  export type JobStatus = any;
  export const VoiceProfileStatus: any;
  export type VoiceProfileStatus = any;
  // Autonomy flag helpers (packages/db/src/index.ts) — real exports, mirrored here.
  export type AutonomyJob = any;
  export const isAutonomyEnabled: any;
  export const setAutonomyEnabled: any;
  export const allAutonomyFlags: any;
}
