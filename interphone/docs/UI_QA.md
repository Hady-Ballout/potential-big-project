# Interphone UI release checks

The interface uses a warm light palette, shared controls, and centralized English copy. Visitor entry stays mobile-first; the resident home expands to two columns on desktop. No database migration or firmware update is required.

## Automated verification

Verified in this workspace: production build, 14 unit tests, and all 27 browser scenarios (including a focused rerun of the corrected authentication fixture). Automated axe scans found no violations in the tested login, visitor-selection, and incoming-visit screens at all four widths. Screenshots were visually inspected on mobile and desktop. Production dependency audit: zero reported vulnerabilities.

From `interphone/web`:

```sh
npm ci
npm test
npm run build
npm run test:ui
```

On Windows PowerShell with script execution disabled, use `npm.cmd` in place of `npm`. Browser tests use an installed Google Chrome by default. Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Microsoft Edge instead. They launch their own Vite server on `127.0.0.1:5174`; this port must be free.

**The browser suite uses a simulated backend, not the virtual controller or physical hardware.** Test configuration supplies fake backend credentials, intercepts all requests to that backend, and closes its realtime websocket locally. No test unlock is sent to a real entrance.

Coverage includes apartment selection, keyboard navigation, duplicate submissions, visitor outcomes, preserved form state, loading/errors, offline controls, stale-data recovery, accurate unlock language, expired/unavailable notification links, password visibility, and notification setup/permission guidance. Screenshots and axe accessibility scans cover login, visitor selection, and incoming visits at 360, 390, 768, and 1440 CSS pixels. A 720px viewport checks the reflow equivalent of a 1440px desktop at 200% zoom; it is not a native browser zoom or physical-phone test.

Screenshots and retained failure traces are written to `web/test-results/` and excluded from Git. SVG identity assets are source controlled. Run `npm run icons` after changing `public/icon.svg` to regenerate the two PNG Home Screen icons.

## Behavior to preserve

- Approval means an unlock request was queued. The UI must never infer physical opening, lock position, or relocking from a successful HTTP response or the existing firmware acknowledgement.
- Remote unlocking requires a fresh successful controller query and a recent heartbeat. A failed query preserves previous data, marks it stale, and disables actions until recovery. The visitor may still ring when the controller is offline.
- `/app/visit/:visitId` retains its target through sign-in and reads that visit within the resident's selected apartment and existing RLS. An ended or unavailable visit cannot silently switch to a different active visitor.
- SDK retries are disabled for dashboard reads because the UI owns polling and retry feedback. Requests have a 12-second timeout; the last successful state is retained across refresh errors.
- Notification support, browser permission, and backend configuration are separate conditions. A local browser subscription is only considered enabled when it also belongs to the signed-in resident in the backend.
- The existing single-apartment assumption remains. Membership selection is deterministic by apartment ID; multi-apartment switching is not included.

## Physical demo rehearsal — requires the prototype and two phones

These checks remain manual; automated browser success does not verify them.

1. Serve the app over HTTPS, confirm the real backend and controller are configured, and sign into the resident account on one phone.
2. Scan the entrance QR on the visitor phone, choose the apartment, and send a short message. Confirm the other phone displays the same request.
3. Tap Unlock entrance once. Confirm the UI says **Unlock request sent** / **Entry approved**, then separately observe the relay and lock. Record any latency or failed actuation.
4. Repeat with Decline and with no resident response. Verify the visitor receives the appropriate outcome.
5. Disconnect the controller and wait for its heartbeat to become stale. Unlock must be disabled; visitor ringing should still work. Restore the controller and verify recovery.
6. Interrupt the resident phone's connection. Confirm that existing visitor information remains visible with a stale/reconnecting notice, then recovers without a reload.
7. Enable real push notifications, background the resident app, ring again, and open the notification. Also open an old notification after its visit ends.
8. On iPhone/iPad, add the app to the Home Screen and open the installed app before testing notifications. Check the icon, browser permissions, safe areas, and software keyboard. Repeat the entry flow in Android Chrome.

## Human usability and accessibility acceptance

- Ask three first-time testers to ring an apartment and respond as a resident without coaching. Record completion, hesitation, wrong actions, and whether they understand approval versus verified physical opening.
- Test keyboard focus order, visible focus, and 200% browser zoom in the real browser. Check long building names and apartment labels on a narrow phone.
- Listen with VoiceOver or TalkBack: fields must have clear labels; selection must be announced; waiting/outcome transitions and newly arriving visitors must be understandable without seeing the screen. Automatic axe scans do not replace this check.
- Check notification available/enabled states with a real subscription. Automated checks cover blocked, unsupported, and unconfigured states without asking a browser for a real push subscription.

## Existing tooling note

The dependency audit reports advisories in the pre-existing Vitest 2 development-tool chain. Production dependency auditing is separate; this UI change does not introduce a Vitest UI server or perform a major test-runner migration.
