# gmail-agent

A tiny local Gmail agent built on top of [`googleworkspace/cli`](https://github.com/googleworkspace/cli).

This project keeps the official `gws` CLI doing the real Gmail work, then wraps it in a few small commands so auth and day-to-day use are easier on Windows.

## What you get

- Local project config in `./.gws/`
- Guided auth helper that opens the right Google Cloud pages
- Simple login command with read-only Gmail scopes
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

## 2. Create Google OAuth credentials

Open the Google Cloud Console and do this once:

1. Create or pick a Google Cloud project.
2. Enable the Gmail API.
3. Open **OAuth consent screen** and choose **External**.
4. Keep it in **Testing** mode for personal use.
5. Add your Gmail address under **Test users**.
6. Open **Credentials** and create an **OAuth client ID**.
7. Choose **Desktop app**.
8. Download the client JSON.

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
npm run auth:setup -- --open
```

That opens the key Google Cloud pages and the local `secrets` folder.

If it looks right, start login:

```powershell
npm run auth:login
```

That opens the Google OAuth flow through the upstream `gws auth login --readonly -s gmail` command.

If you want one command that opens the right pages, waits for the OAuth JSON, and then starts login automatically, use:

```powershell
npm run auth:start
```

If Google shows **"Google hasn't verified this app"**, click through. That is expected for a personal testing-mode app.

If Google says **Access blocked**, your Gmail address probably is not listed as a **Test user** yet.

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
npm run auth:doctor
npm run gws -- auth setup --login
npm run gmail:profile
npm run gmail:inbox
npm run gmail:search -- "label:inbox newer_than:3d"
```

## Notes

- Credentials and cached auth stay under `./.gws/`.
- `secrets/` and `.env` are ignored by git.
- The upstream CLI is dynamic, so you can explore more with:

```powershell
npm run gws -- gmail --help
npm run gws -- gmail +read --help
```

## Upstream reference

This project is intentionally based on the current `googleworkspace/cli` repo and follows its manual OAuth guidance:

- [googleworkspace/cli](https://github.com/googleworkspace/cli)
