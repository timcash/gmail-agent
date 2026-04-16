# gmail-agent

`gmail-agent` is a Windows-first Gmail control plane built on top of [`googleworkspace/cli`](https://github.com/googleworkspace/cli) and a local `codex` worker. It does three main jobs:

- wraps Gmail auth and day-to-day `gws` usage so setup is less painful
- runs an evented `codex` daemon that turns self-addressed email into a queue-backed operator interface
- triages normal inbox mail into mailbox labels without waking the worker

The daemon is intentionally split into a fast `monitor` role and a slower `worker` role. The monitor owns queueing, labels, reporting, security posture, and inbox triage. The worker owns repo work inside a pinned workspace and is forced through a monitor-reviewed TDD loop before a task can finish.

For the detailed OAuth runbook and direct console links, use [AUTH.md](AUTH.md).

## 1. System Workflow

The repo works as a small email-native operating loop:

1. Gmail watch listens for new inbox mail and a short reconcile loop backfills anything watch might miss.
2. Every incoming message is ingested into the local task and thread ledger in `./.daemon/codex-state.json`.
3. If the message is normal inbox mail instead of a `codex/...` command, the monitor classifies it into a triage label such as `mail/needs-reply` or `mail/newsletter`.
4. If the message is a direct command like `codex/ps` or `codex/help`, the monitor replies immediately without invoking any LLM.
5. If the message is a real work request, the monitor sends a queue acknowledgement, applies Gmail status labels, and enforces the single-flight rule so only one worker task runs at a time.
6. The worker runs inside the pinned workspace for that Gmail thread and follows `plan -> red -> green -> refactor -> docs`.
7. After each worker checkpoint, the monitor verifies the evidence, looks for cheating or weak test proof, and only then allows the next stage.
8. The docs stage is not complete until the worker updates `README.md` and reruns the relevant tests after the doc change.
9. The monitor sends the final operator reply, updates the task state, and keeps the Gmail thread read and labeled.

Current safety posture:

- self-only mode is enabled by default, so the daemon only processes threads where every participant is your mailbox
- inbox triage is label-only for now, so categorized mail stays in Inbox until we explicitly add archive rules
- the monitor is read-only and the worker is the only role allowed to write inside the pinned workspace
- old `codex-314` subject prefixes and labels still have compatibility fallbacks during the rename transition

Mailbox status labels:

- `codex/queued`
- `codex/working`
- `codex/review`
- `codex/done`
- `codex/error`
- `codex/blocked`

Inbox triage labels:

- `mail/needs-reply`
- `mail/waiting`
- `mail/receipt`
- `mail/newsletter`
- `mail/alert`
- `mail/personal`

## 2. Workflow CLI

This is the main shell workflow, written in the same compact style as the `linker` README:

```powershell
npm install
Copy-Item .env.example .env

npm run auth:guide -- --open
npm run auth:start
npm run auth:verify
npm run auth:doctor
npm run auth:reset
npm run auth:reset:daemon

npm run gmail:profile
npm run gmail:inbox
npm run gmail:search -- "label:inbox newer_than:7d"
npm run gmail:read -- MESSAGE_ID
npm run gmail:send -- --to someone@example.com --subject "Hello" --body "Hi there"
npm run gmail:send -- --to someone@example.com --subject "Report" --body "See attached" -a .\report.pdf

npm run codex:once
npm run codex:daemon
npm run codex:demo
npm run codex:e2e
npm run codex:install-startup
npm run codex:remove-startup

npm run gws -- gmail +triage --max 5 --query "label:inbox newer_than:3d"
npm run gws -- gmail +read --help
npm run gws -- gmail +send --help

npm test
```

Focused working loop for the daemon:

```powershell
npm run auth:verify
npm run codex:daemon
npm run gmail:send -- --to your-mailbox@example.com --subject "codex/help" --body ""
npm run gmail:send -- --to your-mailbox@example.com --subject "codex/linker review the repo and give me a report" --body ""
npm test
```

## 3. Email CLI

The monitor treats the subject line, or the first non-empty body line, like a small mailbox CLI.

Direct commands that stay on the monitor path:

```text
codex/help
codex/ping
codex/ps
codex/health
codex/queue
codex/tasks 10
codex/errors 10
codex/report
codex/task latest
codex/thread
codex/sessions
codex/monitor
codex/worker
codex/workspace
codex/workspace linker
codex/workspace clear
codex/labels
codex/watch
codex/config
codex/logs 10
codex/reset
```

Work-request patterns that wake the worker:

```text
codex review the repo and summarize the main risks
codex/linker fix the failing tests and update the README
codex/workspace linker
codex/workspace linker then continue the queued task
```

Useful operator notes:

- `codex/linker <request>` is the fastest workspace shorthand and resolves to `~/linker`
- `codex/workspace linker` is the clearer long-form syntax for a thread you plan to keep using
- `codex/thread`, `codex/task latest`, `codex/ps`, `codex/config`, and `codex/logs 10` are the best inspection commands when debugging the daemon over email
- a body command works too, so you can reply in-thread with `codex/thread` as the first non-empty line

## 4. Domain Language

The repo uses a small control-plane vocabulary so the code, the email replies, and the docs describe the same system in the same way.

- `Mailbox CLI`: the subject and body command surface exposed through Gmail using `codex/...`
- `Control plane`: the monitor, queue, labels, watch loop, reconcile loop, and singleton guard working together
- `Monitor`: the fast control role that classifies mail, applies labels, queues work, validates worker progress, and answers direct commands
- `Worker`: the Codex-backed role that handles non-command repo work inside a pinned workspace
- `Direct command`: a `codex/...` command that the monitor can answer immediately without any LLM work
- `Work request`: a `codex` email that becomes a worker task instead of a direct monitor reply
- `Task`: one queued unit of work created from a user message
- `Task ledger`: the persisted task state stored in `./.daemon/codex-state.json`
- `Thread ledger`: the per-thread state that stores subject, labels, sessions, workspace pin, and task ids
- `Queue ack`: the immediate monitor reply that proves the daemon is awake and tells you whether the request is queued or in work
- `Single-flight worker`: the system rule that only one worker task can run at a time system-wide
- `Self-only mode`: the policy that only mailbox threads containing only your own address are allowed onto the command path
- `Workspace`: the folder under your home directory where the worker runs for a given Gmail thread
- `Workspace pin`: the thread-level binding from a Gmail thread to a local workspace folder
- `Worker session`: the Codex session reused for follow-up emails in the same Gmail thread
- `Monitor session`: the Codex session reused by the monitor review pass
- `Watch loop`: the live Gmail event stream for low-latency ingestion
- `Reconcile loop`: the fallback mailbox scan that repairs missed watch events and startup drift
- `Command query`: the reconcile query that backfills `codex` command messages
- `Triage query`: the reconcile query that backfills normal inbox mail that has not been categorized yet
- `Status label`: a Gmail state label like `codex/queued` or `codex/done`
- `Triage label`: a Gmail mailbox organization label like `mail/needs-reply` or `mail/newsletter`
- `Inbox triage`: the monitor-only path that classifies normal inbox mail without waking the worker
- `Operator report`: a structured monitor reply meant for debugging or system inspection
- `Runtime dir`: `./.daemon/`, which stores state, pid files, and logs
- `Singleton guard`: the global mutex plus pid file behavior that prevents more than one daemon from running
- `Faulted task`: a task that ended in `blocked` or `error` and needs operator attention

## 5. Dependencies

System dependencies:

- `Node.js 18+`
- Windows PowerShell and Task Scheduler for the startup helpers
- a local `codex` CLI installation available to the worker runtime

Google and mailbox dependencies:

- a Gmail account
- a Google Cloud project
- Gmail API enabled
- Pub/Sub API enabled for Gmail watch
- a Desktop OAuth client in Google Auth Platform
- your mailbox listed as a test user while the app is in testing mode

NPM dependencies:

- `@googleworkspace/cli`: the upstream Gmail and auth engine this repo wraps
- `dotenv`: local environment loading for `.env`

Project files you are expected to have locally:

- `.env`
- `.gws/`
- `secrets/client_secret.json` or the equivalent client id and secret in `.env`

Optional but useful:

- `gcloud` for quicker API enablement and project setup
- a workspace folder like `~/linker` if you want to use workspace-pinned worker threads

## 6. Code Index

Core runtime:

- `src/gmail-agent.js`: auth wrapper, `gws` pass-through, scope checking, Windows setup helpers, and user-facing npm command entrypoints
- `src/codex-gmail.js`: Gmail JSON helpers for listing messages, reading messages, modifying thread labels, marking threads read, and sending replies
- `src/codex-system.js`: the monitor-side state machine, command parsing, queueing, reporting, triage classification, and ledger persistence model
- `src/codex-daemon.js`: daemon entrypoint, Gmail watch session, reconcile loop, singleton guard, monitor and worker runners, and workspace execution

Live harnesses:

- `src/codex-demo.js`: self-email demo flow for proving the daemon can reply end to end
- `src/codex-e2e.js`: live mailbox harness that exercises monitor commands, queueing, labels, and worker sessions together

Windows helpers:

- `scripts/start-codex-daemon.ps1`: launches the daemon in the expected detached/startup shape
- `scripts/install-codex-startup.ps1`: installs the logon startup task
- `scripts/remove-codex-startup.ps1`: removes the startup task
- `scripts/hold-codex-mutex.ps1`: owns the Windows global mutex used for the system-wide singleton guard

Tests:

- `test/codex-system.test.js`: monitor behavior, queue rules, direct commands, workspace routing, triage classification, and system-state reporting
- `test/codex-daemon.test.js`: worker and monitor TDD workflow behavior plus daemon helper coverage

Documentation:

- `README.md`: operator overview, workflow, CLI, domain language, dependencies, and code map
- `AUTH.md`: detailed Google auth and consent-screen runbook

Compatibility layer:

- the running code now uses `codex` names, but the system still keeps compatibility for old `codex-314` subject prefixes, labels, and state migrations during the rename transition

## 7. Auth and Setup

Fast path:

```powershell
npm install
Copy-Item .env.example .env
npm run auth:guide -- --open
npm run auth:start
npm run auth:verify
```

Daemon auth requires a broader second-stage consent than simple Gmail send and read. The extra scopes are:

- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.labels`
- `https://www.googleapis.com/auth/pubsub`

If those scopes change after you already logged in, refresh the local grant with:

```powershell
npm run auth:reset:daemon
```

Use [AUTH.md](AUTH.md) for the exact browser pages, console links, and recovery flow.

## 8. Notes and References

- credentials and cached auth stay under `./.gws/`
- `secrets/` and `.env` are gitignored
- startup is Windows-first because the daemon depends on your user-scoped Gmail and Codex credentials
- normal mailbox triage is label-only right now; archive rules are intentionally not automatic yet
- the upstream dynamic CLI is still available through `npm run gws -- ...`

Upstream reference:

- [googleworkspace/cli](https://github.com/googleworkspace/cli)
- [timcash/linker README](https://github.com/timcash/linker)
