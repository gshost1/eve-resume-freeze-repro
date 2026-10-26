import { appendFileSync } from "node:fs";
import { defineTool } from "eve/tools";
import { z } from "zod";

// A visible side effect: one line in SIDE_LOG per execution.
export default defineTool({
  description: "Perform a side effect identified by a label.",
  inputSchema: z.object({ label: z.string() }),
  execute: async ({ label }) => {
    if (process.env.SIDE_LOG) appendFileSync(process.env.SIDE_LOG, `${new Date().toISOString()} effect ${label}\n`);
    return { done: label };
  },
});
