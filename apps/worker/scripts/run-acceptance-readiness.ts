import { prisma } from "@afrohit/db";
import {
  acceptanceExitCode,
  loadAcceptanceReadiness,
} from "../src/lib/acceptance-readiness";

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : null;
}

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log(
      "Usage: pnpm --filter @afrohit/worker acceptance:readiness -- --workspace <id> [--strict] [--pretty]"
    );
    return;
  }
  const strict = process.argv.includes("--strict");
  const workspaceId = option("--workspace") ?? process.env.ACCEPTANCE_WORKSPACE_ID;
  const report = await loadAcceptanceReadiness({ workspaceId });
  console.log(JSON.stringify(report, null, process.argv.includes("--pretty") ? 2 : 0));
  process.exitCode = acceptanceExitCode(report, strict);
}

main()
  .catch(error => {
    console.error(
      JSON.stringify({
        version: "acceptance-readiness-v1",
        ready: false,
        error: (error as Error)?.message ?? "acceptance readiness failed",
      })
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
