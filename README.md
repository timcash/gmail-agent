# gmail-agent

A tiny local Gmail agent built on top of [`googleworkspace/cli`](https://github.com/googleworkspace/cli).

This project keeps the official `gws` CLI doing the real Gmail work, then wraps it in a few small commands so auth and day-to-day use are easier on Windows.

## LLM quick check

If another LLM needs to verify that the project is working and fetch the top unread email using CLI commands only, use this sequence:

```powershell
npm install
npm run auth:verify
npm run gmail:profile
npm run --silent gws -- gmail +triage --max 1 --format json
```

The `+triage` command returns the top unread message at `messages[0]`. In PowerShell, extract that message ID and read it like this:

```powershell
$top = npm run --silent gws -- gmail +triage --max 1 --format json | ConvertFrom-Json
$id = $top.messages[0].id
npm run --silent gws -- gmail +read --id $id --headers
```

If you want the full message body as JSON instead of text output:

```powershell
npm run --silent gws -- gmail +read --id $id --headers --format json
```

If `npm run auth:verify` fails, the next commands to try are:

```powershell
npm run auth:guide
npm run auth:login
```

## What you get

- Local project config in `./.gws/`
- Guided auth helper that opens the right Google Cloud pages
- Verification that checks the saved token, Gmail scope, and live mailbox access
- Reset flow for the common case where you add scopes after already logging in
- Quick commands for profile, inbox summary, search, and reading a message
- A direct pass-through command when you want full `gws` power

## Prerequisites

- Node.js 18+
- A Google account
- A Google Cloud project with the Gmail API enabled

If you already have `gcloud` installed, you can use the faster automated setup path. Otherwise, the project also supports the manual OAuth flow.

## 1. Install dependencies

```powershell
cd gmail-agent
npm install
Copy-Item .env.example .env
```

If `gcloud` is installed and you are already logged in, you can often finish setup with:

```powershell
npm run gws -- auth setup --login
```

If you want the project to inspect your current state and tell you what is missing, use:

```powershell
npm run auth:guide
```

## 2. Create Google OAuth credentials

Open the Google Cloud Console and do this once:

1. Create or pick a Google Cloud project.
2. Enable the Gmail API.
3. Open **Google Auth Platform** and choose **External**.
4. Keep it in **Testing** mode for personal use.
5. Under **Audience**, add your Gmail address under **Test users**.
6. Under **Data Access**, add the Gmail read-only scope:
   `https://www.googleapis.com/auth/gmail.readonly`
7. Open **Credentials** and create an **OAuth client ID**.
8. Choose **Desktop app**.
9. Download the client JSON.

Helpful console links:

- [Google Cloud Console](https://console.cloud.google.com/)
- [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent)
- [Credentials](https://console.cloud.google.com/apis/credentials)
- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)

## 3. Make auth simple

Use either option below.

### Option A: easiest

Put the downloaded OAuth JSON at:

```text
.\secrets\client_secret.json
```

The `.env.example` is already set up for that location.

### Option B: no JSON file in the project

Open the downloaded JSON and copy the `client_id` and `client_secret` into `.env`:

```dotenv
GOOGLE_WORKSPACE_CLI_CLIENT_ID=...
GOOGLE_WORKSPACE_CLI_CLIENT_SECRET=...
GOOGLE_WORKSPACE_PROJECT_ID=your-project-id
```

## 4. Check the setup

```powershell
npm run auth:doctor
```

If you want the project to guide you through setup, use:

```powershell
npm run auth:guide -- --open
```

That opens the key Google Cloud pages and the local `secrets` folder, and it prints the exact checklist this project expects.

If it looks right, start login:

```powershell
npm run auth:login
```

That opens the Google OAuth flow through the upstream `gws auth login --readonly -s gmail` command, then it immediately verifies that Gmail access really works.

If you want one command that opens the right pages, waits for the OAuth JSON, and then starts login automatically, use:

```powershell
npm run auth:start
```

If Google shows **"Google hasn't verified this app"**, click through. That is expected for a personal testing-mode app.

If Google says **Access blocked**, your Gmail address probably is not listed as a **Test user** yet.

If login succeeds but Gmail commands still fail with **insufficientPermissions**, the token is missing the Gmail scope. Add the Gmail read-only scope under **Google Auth Platform** -> **Data Access**, then refresh the saved token:

```powershell
npm run auth:reset
```

To verify everything end to end at any time:

```powershell
npm run auth:verify
```

## 5. Access your Gmail

Show your Gmail profile:

```powershell
npm run gmail:profile
```

Show an unread inbox summary:

```powershell
npm run gmail:inbox
```

Search your Gmail:

```powershell
npm run gmail:search -- "from:someone@example.com newer_than:7d"
```

Read one message:

```powershell
npm run gmail:read -- MESSAGE_ID
```

Use raw `gws` directly through this project:

```powershell
npm run gws -- gmail +triage --max 5 --query "label:inbox newer_than:3d"
```

## 6. A quick real-world flow

```powershell
npm run auth:guide
npm run gws -- auth setup --login
npm run auth:verify
npm run gmail:profile
npm run gmail:inbox
npm run gmail:search -- "label:inbox newer_than:3d"
```

## Notes

- Credentials and cached auth stay under `./.gws/`.
- `secrets/` and `.env` are ignored by git.
- If you change test users or OAuth scopes after logging in, run `npm run auth:reset` so Google issues a fresh token.
- The upstream CLI is dynamic, so you can explore more with:

```powershell
npm run gws -- gmail --help
npm run gws -- gmail +read --help
```

## Upstream reference

This project is intentionally based on the current `googleworkspace/cli` repo and follows its manual OAuth guidance:

- [googleworkspace/cli](https://github.com/googleworkspace/cli)
