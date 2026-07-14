import assert from "node:assert/strict";
import { sendEmail as sendApiEmail } from "../../api/src/lib/email";
import { sendEmail as sendWorkerEmail } from "../src/lib/email";

async function main() {
  const originalKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;

  try {
    const input = {
      to: "artist@example.test",
      subject: "Delivery truth",
      html: "<p>test</p>",
    };
    const [apiResult, workerResult] = await Promise.all([
      sendApiEmail(input),
      sendWorkerEmail(input),
    ]);

    for (const result of [apiResult, workerResult]) {
      assert.equal(result.ok, false);
      if (result.ok) throw new Error("unreachable");
      assert.equal(result.skipped, true);
      assert.equal(result.error, "not_configured");
    }
    console.log(
      "email delivery: missing provider is a skipped failure, not success"
    );
  } finally {
    if (originalKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalKey;
  }
}

void main();
