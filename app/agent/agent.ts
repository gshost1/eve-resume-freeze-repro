import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

// Offline scripted model. A user message "plan:a,b,c" runs those steps in order, one tool call per
// step, counting finished steps from the tool results after that message, so it continues correctly
// after a replay:  effect-<label> -> effect({label});  slow-<seconds> -> slow({seconds}).
export default defineAgent({
  model: mockModel({
    modelId: "repro-mock",
    provider: "eve-mock",
    respond: ({ lastUserMessage, messages }) => {
      const plan = (lastUserMessage ?? "").match(/plan:([\w,-]+)/)?.[1];
      if (!plan) return "ok";
      const steps = plan.split(",");
      const start = messages.map((m) => m.role === "user" && m.text.includes(`plan:${plan}`)).lastIndexOf(true);
      const done = messages.slice(start + 1).filter((m) => m.role === "tool").length;
      if (done >= steps.length) return `done: ${plan}`;
      const step = steps[done];
      if (step.startsWith("slow-")) return { toolCalls: [{ name: "slow", input: { seconds: Number(step.slice(5)) } }] };
      return { toolCalls: [{ name: "effect", input: { label: step.replace(/^effect-/, "") } }] };
    },
  }),
});
