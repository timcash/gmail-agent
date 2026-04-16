# AUTH

This repo has two auth levels:

1. Base Gmail auth
   Used for mailbox read and send.
2. Daemon auth
   Used for the evented `codex` monitor/worker daemon, Gmail label updates, and Pub/Sub-backed watch mode.

The base flow is enough for `gmail:profile`, `gmail:inbox`, `gmail:search`, `gmail:read`, and `gmail:send`.

The daemon flow is required for:

- `npm run codex:daemon`
- `npm run codex:demo`
- `npm run codex:e2e`
- Gmail thread label updates
- Gmail watch via Pub/Sub

## Current Template Values

Replace these placeholders with your own values when working through the setup:

- Project ID: `<your-project-id>`
- Gmail account: `<your-test-user@gmail.com>`
- Local Cloud SDK path on Windows:

```powershell
$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd
```

## Quick Links

Open these with your project id substituted in the `project=` query string:

- [Google Auth Platform / OAuth consent](https://console.cloud.google.com/apis/credentials/consent)
- [Credentials](https://console.cloud.google.com/apis/credentials)
- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
- [Pub/Sub API](https://console.cloud.google.com/apis/library/pubsub.googleapis.com)

If you only need base Gmail read/send auth, the repo flow is:

```powershell
npm run auth:reset
```

If you need daemon auth, use:

```powershell
npm run auth:reset:daemon
```

That clears the saved token, opens the Google consent flow, requests the full daemon scope set, and then verifies the new token when login completes.

## What Can Be Automated

These parts can be automated locally:

- set the active Google Cloud project
- enable the Gmail API
- enable the Pub/Sub API
- clear the saved repo token
- start a fresh OAuth login
- verify the resulting token and mailbox access

These parts still usually need the Google Cloud web UI:

- `Audience` test-user setup
- `Data Access` scope selection
- browser consent for the refreshed token

## Required Scopes

Base Gmail auth:

- `https://www.googleapis.com/auth/gmail.readonly`
- `https://www.googleapis.com/auth/gmail.send`

Daemon auth:

- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.labels`
- `https://www.googleapis.com/auth/pubsub`

The daemon needs all five scopes total.

## gcloud Commands

The local `gcloud` install is usable even when it is not on PATH.

Set the project:

```powershell
& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" config set project <your-project-id>
```

Enable required APIs:

```powershell
& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" services enable gmail.googleapis.com pubsub.googleapis.com
```

Check the active account:

```powershell
& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" auth list --filter=status:ACTIVE --format='value(account)'
```

## Google Cloud Checklist

Open the Google Auth Platform consent page for your project and verify:

1. Under `Audience`, your mailbox is listed as a test user.
2. Under `Data Access`, these scopes are present:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.labels`
   - `https://www.googleapis.com/auth/pubsub`

Also make sure these APIs are enabled in your project:

- Gmail API
- Pub/Sub API

## Re-Consent Flow

After the Cloud settings are correct, refresh the saved token for the daemon:

```powershell
npm run auth:reset:daemon
```

Then verify the repo sees the daemon scopes:

```powershell
npm run --silent auth:doctor
npm run auth:verify
```

The important `auth:doctor` fields should look like this:

```json
{
  "hasRequiredGmailScopes": true,
  "missingRequiredGmailScopes": [],
  "hasRequiredDaemonScopes": true,
  "missingDaemonScopes": []
}
```

## After Auth Is Fixed

Run the live daemon demo:

```powershell
npm run codex:demo
```

Run the full live Gmail end-to-end harness:

```powershell
npm run codex:e2e
```

Run the daemon itself:

```powershell
npm run codex:daemon
```

Install startup:

```powershell
npm run codex:install-startup
```

## Diagnostic Snapshot Template

When auth is correct, a healthy `auth:doctor` snapshot should look like:

```json
{
  "hasStoredCredentials": true,
  "hasRequiredGmailScopes": true,
  "missingRequiredGmailScopes": [],
  "hasRequiredDaemonScopes": true,
  "missingDaemonScopes": []
}
```

If this regresses in the future, the next step is usually:

```powershell
npm run auth:reset:daemon
```
