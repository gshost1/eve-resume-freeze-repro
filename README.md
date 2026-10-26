# eve: a step interrupted by a crash stays frozen for ~14 minutes after restart

Minimal reproduction for a `vercel/eve` bug report. Kill the eve server while a tool is running and
start it again (`eve dev --resume`, or `eve start`, which always recovers local runs). The run is
re-enqueued, but nothing happens until 860 s after the interrupted step first started: the inline
ownership lease of the dead process. A message sent meanwhile is accepted and waits.

eve 0.83.3 (npm), ai 7.x, Node 24+. Offline: a scripted `mockModel` from `eve/evals`, no provider or API key.

## Run

```bash
cd app && npm install && cd ..
node repro.mjs                                  # eve dev --resume, ~15 min
cd app && npx eve build && cd ..
MODE=start node repro.mjs                       # eve start, ~15 min
WORKFLOW_INLINE_OWNERSHIP_LEASE_SECONDS=60 node repro.mjs   # same stall, 60 s: the lease sets the delay
```

The agent runs `effect a`, a 25 s `slow` tool, then `effect b`. The driver waits until `slow` has
started, `SIGKILL`s the server's process group, waits for the port to free, restarts, sends a second
message (`plan:effect-c`) and reports how long the session stays idle. Side effects are logged to
`side.txt`.

Recorded outputs: [`dev.out`](dev.out) and [`start.out`](start.out).

## What to look for

- `session resumed ... 860 s after the interrupted tool started`, with nothing in between.
- `message sent during the wait: accepted`, followed by silence.
- After the lease the work continues and nothing is lost. The follow-up message steers the resumed
  turn, so it may replace the rest of the plan (eve's documented steering behaviour).

## Files

- `app/agent/agent.ts`: the scripted mock model.
- `app/agent/tools/effect.ts`, `app/agent/tools/slow.ts`: a visible side effect and a sleep.
- `app/agent/channels/eve.ts`: turns route auth off so the driver can call `eve start` on
  127.0.0.1. Repro only.
- `repro.mjs`: the driver.

Fix: https://github.com/gshost1/eve/tree/fix/resume-stale-step-ownership
