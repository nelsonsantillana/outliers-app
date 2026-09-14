# Outlier Auxiliary Report — Stage 1

A read-only WFM dashboard connected to Assembled. Team leads can filter by team, queue assignment, agent, auxiliary, and an exact date/time range.

The report displays:

- scheduled time for the selected auxiliary;
- number of distinct times the auxiliary was actually used;
- accumulated actual time;
- scheduled-versus-actual comparison; and
- the individual actual sessions returned by Assembled.

## Keep the API key private

The browser never calls Assembled directly. The server reads the key from the private `ASSEMBLED_API_KEY` environment variable and sends only the calculated report to the page.

Never put an API key in `app/page.tsx`, commit it to GitHub, or send it in a screenshot.

## Run the app in VS Code

### 1. Install Node.js

Install Node.js 22 or newer from [nodejs.org](https://nodejs.org/), then restart VS Code.

### 2. Open the project

In VS Code, choose **File → Open Folder** and select this repository folder.

### 3. Open the terminal

Choose **Terminal → New Terminal** from the top menu.

### 4. Install the project

Run these commands one at a time:

```bash
corepack enable
pnpm install
```

### 5. Create the private key file

In the Explorer panel, duplicate `.dev.vars.example` and rename the copy to exactly:

```text
.dev.vars
```

Open `.dev.vars` and replace the example value with the Assembled key you created:

```text
ASSEMBLED_API_KEY=sk_live_your_real_key_here
```

Save the file. `.dev.vars` is ignored by Git, so it will not be uploaded to GitHub.

### 6. Start the app

Run:

```bash
pnpm dev
```

Open the local address shown in the terminal, normally `http://localhost:5173`.

## How the calculation works

- **Scheduled time:** effective scheduled activities for the selected Assembled activity type, clipped to the selected time range.
- **Times used:** distinct matching actual-state intervals after overlapping or immediately adjacent records are merged.
- **Time accumulated:** total duration of those merged actual sessions, clipped to the selected time range.
- **Team and queue:** these filters narrow the selectable people using their current Assembled assignments. Actual state records do not contain a per-session queue.

Assembled state names are matched against the selected activity type's name and value. If the names differ, the app displays the actual state labels it found. An optional alias can then be added through `ASSEMBLED_AUX_STATE_ALIASES` without changing browser code.

## Security notes

- The integration is read-only.
- The API key is used only by server routes.
- The key is never included in API responses.
- Reports are limited to 62 days, matching Assembled's activities API limit.
- The deployed app must also receive `ASSEMBLED_API_KEY` as a private hosting environment variable.
