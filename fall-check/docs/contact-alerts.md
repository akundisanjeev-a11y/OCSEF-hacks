# Full-stack assignment: local contact alerts

The starter PR #2 was verified merged into `origin/main` on November 13, 2026.
This work lives on `feature/contact-alerts`. No teammate-owned monitoring,
camera, or check-in files were changed. All contacts are sample teammates.

## Run it in PowerShell

```powershell
cd C:\Users\asnmu\Downloads\OCSEF-hacks
git status
git branch --show-current
cd fall-check
npm ci
npm run dev
```

`npm ci` installs the exact dependencies recorded in the app's lockfile.
Keep the dev terminal running. Open the exact address and port it prints,
then add `/alerts-demo` to that address. The root `/` is still the starter
until the frontend teammate integrates their page. If a connection is
refused, check the terminal is still running and use its printed port.

## Repeat the two-window check

1. Open `/alerts-demo` and choose Alex. Click **Open contact window**.
   Move the new tab to a second Chrome window if desired. Use the same Chrome
   profile, address, and port for both pages (don't mix localhost and 127.0.0.1).
2. In `/contact`, choose Alex. On the sender, click **Send sample Help requested**.
   Confirm one addressed test alert appears in the contact window.
3. Click **Acknowledge**. The sender should show that this alert was acknowledged.
4. Send **No response**. This is an immediate sample result, not a timer test.
   Refresh the contact window; the saved alert should return. Acknowledge it.
5. Choose Jordan in the sender and send another alert. Alex's contact view
   should not show it. Switch the contact view to Jordan to see it.
6. Leave an older alert pending, send another, then acknowledge the old one.
   The newer alert should still be pending.

Saved test alerts remain after refresh, including after restarting the app on
the same origin. Browser storage is the delivery record; BroadcastChannel and
storage events tell open pages to read it again. There is no real contact login
or isolation: these are role-playing windows on one consenting demo laptop.
No footage, audio, phone numbers, or network delivery are used.

## Integration contract for teammates

Proposed exports in `lib/alerts.ts` preserve the requested alert fields:
`id`, `contactName`, `createdAt`, `reason`, `trigger`, `acknowledgedAt`.
Review this interface together before integrating or changing it.

```tsx
// In the check-in owner’s code, capture once when an event starts:
const event = {
  id: crypto.randomUUID(),
  contactName: selectedContact,
  trigger: "simulation" as const, // or "camera" / "manual"
};

// On a winning Help or timeout resolution:
await createTestAlert({ ...event, reason: "help_requested" });
// Timeout instead uses reason: "no_response".
// “I'm OK” makes no call to createTestAlert.
```

The check-in owner must resolve cancellation, Help, and timeout once and clear
the timer. Reuse the captured ID and contact if more than one send attempt occurs;
the store returns the first alert for that ID without replacing its data.
This module does not implement the check-in state machine or cancellation.
Chrome Web Locks serialize writes across windows to avoid lost updates.
Storage failures reject the promise; the caller should display an error.

Frontend can render `ContactPicker` as a controlled component with `value` and
`onChange`, then use `useAlerts()` to find its event by ID and display
`acknowledgedAt`. The contact page acknowledges by both ID and addressed contact.
Refresh restores alerts; the sender sample's transient selection of which sent
alert to highlight is not persisted.

## Checks

From `fall-check` (Node 24 for the TypeScript-importing tests):

```powershell
node --test lib/alerts.test.mjs
npm run lint
npm run build
```

The automated tests exercise duplicate Help/timeout sends, competing creation
and acknowledgment, acknowledgment by ID, wrong-contact rejection, malformed
data, and storage failure. They use browser stand-ins; use the manual steps
above to check actual cross-window behavior. The 15-second timeout and I'm OK
cancellation need integrated testing after the check-in branch merges.

Verified during implementation: all three automated tests, ESLint, TypeScript,
and the production build passed. Both new routes returned HTTP 200 with their
expected headings on the existing localhost:3000 dev server. Browser automation
was unavailable, so actual two-window clicks and visual layout remain to be
checked using the steps above. Dependencies already existed; `npm ci` was not
rerun during implementation. Files were left uncommitted for your review.

## Save and review with Git

A branch is your separate line of work. A commit saves a named checkpoint
locally. Push copies those commits to GitHub. A pull request asks your team
to review and merge the branch into the shared `main` branch.

From the repo root, inspect before saving:

```powershell
git status
git diff
git add fall-check/lib/alerts.ts fall-check/lib/useAlerts.ts fall-check/lib/alerts.test.mjs fall-check/components/ContactPicker.tsx fall-check/app/contact/page.tsx fall-check/app/alerts-demo/page.tsx fall-check/docs/contact-alerts.md
git diff --cached
git commit -m "Add local test contact alerts and acknowledgment"
git push -u origin feature/contact-alerts
```

If Git's output viewer shows `(END)`, press `q`. On GitHub create a pull request
with base `main` and compare `feature/contact-alerts`. Ask a teammate to review
the interface and run the two-window check before merging. After it merges,
switch to `main`, run `git pull --ff-only origin main`, and try the combined app.
Do not create this feature branch again: it already exists.
