import { appendFileSync } from "node:fs";
import { defineTool } from "eve/tools";
import { z } from "zod";

// Sleeps so the server can be killed while a tool is running. Logs start and end to SIDE_LOG.
export default defineTool({
  description: "Wait for a number of seconds.",
  inputSchema: z.object({ seconds: z.number() }),
  execute: async ({ seconds }) => {
    const log = (m: string) => process.env.SIDE_LOG && appendFileSync(process.env.SIDE_LOG, `${new Date().toISOString()} ${m}\n`);
    log(`slow-start ${seconds}s`);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    log("slow-end");
    return { waited: seconds };
  },
});
