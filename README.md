# CrowdFlow

Volunteers at an outdoor festival count people moving between areas by tapping a
phone. Organizers see how full each area is, live.

Built for the **Morrisville Diwali Festival**, Saturday 17 October 2026, 5–8 p.m.,
Morrisville Community Park.

**Live:** https://crowdcontroldiwali.web.app

---

## What it does

A volunteer stands at a gate or a path with a QR card taped to their post. They scan
it once and get two enormous buttons: **IN** and **OUT**. Every tap is one person
crossing that point in one direction.

Taps are stored on the phone first and synced when there is signal. A volunteer with
no service for twenty minutes loses nothing.

The organizer opens a dashboard on a phone or tablet and sees each area's current
occupancy, how fast it is filling, and — importantly — whether any checkpoint has
gone quiet, because a silent checkpoint means the numbers are wrong.

There are no accounts. Nothing about any attendee is ever recorded: no GPS, no
camera, no names, no device fingerprinting. Only counts and timestamps.

## The screens

| Screen | URL | Who |
|---|---|---|
| Volunteer | `/count/{eventId}/{checkpointToken}` | Scanned from the QR card |
| Dashboard | `/dash/{eventId}` | Organizer |
| Vendor | `/vendor/{eventId}/{zoneId}` | One area, read-only, for a food vendor |
| Report | `/report/{eventId}` | After the event; print-friendly |
| Admin | `/admin/{eventId}` | Whoever sets the event up |
| Printable cards | `/print/{eventId}` | Printed the day before |

Event ids and checkpoint tokens are random UUIDs, and Firestore will not list
events, so an event is undiscoverable without its link.

---

## Running the demo

A demo event is already seeded and ready:

| | |
|---|---|
| Dashboard | https://crowdcontroldiwali.web.app/dash/0bcdb987fe9045a3b11710bfa45d4eef |
| QR cards to print | https://crowdcontroldiwali.web.app/print/0bcdb987fe9045a3b11710bfa45d4eef |
| Admin | https://crowdcontroldiwali.web.app/admin/0bcdb987fe9045a3b11710bfa45d4eef |
| Admin secret | `9TNW-KVT9-TGVD` |

Volunteer links, if you would rather not print anything for the demo:

- Gate A — Main Entrance: https://crowdcontroldiwali.web.app/count/0bcdb987fe9045a3b11710bfa45d4eef/c22f84a10d9f4f6cbbde7205572b8914
- Path to Food Court: https://crowdcontroldiwali.web.app/count/0bcdb987fe9045a3b11710bfa45d4eef/bba0270d92b34d9c91a172181b18b66f
- Stage Entrance: https://crowdcontroldiwali.web.app/count/0bcdb987fe9045a3b11710bfa45d4eef/92eebec77b534d3aa1eedae7840653c6
- Vendor Row Walkway: https://crowdcontroldiwali.web.app/count/0bcdb987fe9045a3b11710bfa45d4eef/cdbcff7b1ef6445ba1ab3b7da7565f58

To make a fresh one at any time:

1. Open https://crowdcontroldiwali.web.app/admin
2. Click **Create demo event**. This creates four zones (Main Lawn, Food Court, Stage
   Seating, Vendor Row) and four checkpoints matching a plausible park layout.
3. **Write down the admin secret** it shows you. It is not recoverable.
4. Click **Print QR cards**, or open the "Volunteer links" section to get tappable
   URLs without printing anything.
5. Open the dashboard link on a second device.
6. Hand someone a phone with a volunteer link open and let them tap. The dashboard
   updates within a second.

To show the offline behaviour: put the volunteer's phone in airplane mode, keep
tapping, watch the indicator go amber and count up, then turn signal back on. The
taps appear on the dashboard within a couple of seconds.

## Setting up a new event

1. Go to `/admin` and fill in name, date and venue. **Write down the admin secret.**
2. Add **zones** — the areas you want a headcount for — with a rough comfortable
   maximum for each. The capacity only drives the colour bands and the forecast; a
   rough number is fine.
3. Add **checkpoints** — the places a volunteer will stand. Each has a *from* and a
   *to*; either can be **Outside**, which means off the event site.
   - A main gate is `Outside → Main Lawn`.
   - A path between areas is `Main Lawn → Food Court`.
   - **IN** counts someone moving from → to. **OUT** counts the reverse. The printed
     card spells this out in words so the volunteer never has to think about it.
4. Print the QR cards. One page per checkpoint plus one for the dashboard. Tape each
   card to its post.
5. Give volunteers the [briefing sheet](BRIEFING.md).

To reuse the setup next year, open the admin page and press **Duplicate**. Zones and
checkpoints are copied to a new event with fresh tokens, so last year's cards stop
working.

---

## How it works

**Taps are an append-only log. A running count is never the source of truth.**

```
events/{eventId}
  ├── zones/{zoneId}              name, capacity, order
  ├── checkpoints/{checkpointId}  name, fromZoneId, toZoneId, token, order
  ├── taps/{tapId}                checkpointId, direction, clientTs, serverTs,
  │                               deviceId, undone
  ├── flags/{flagId}              checkpointId, type, clientTs, acknowledged
  ├── resets/{resetId}            zoneId, newCount, ts, note
  └── private/admin               secret, adminUids   (no client can read this)
```

Occupancy of a zone at time *T* is its most recent reset before *T*, plus every
non-undone tap since. Nothing is ever hard-deleted; UNDO sets `undone: true`.

Deriving instead of storing is what makes reset, replay and drift correction possible
at all — and it is why a batch of taps that arrives twenty minutes late lands on
exactly the same number as if it had arrived live. `computeOccupancy` is
order-independent; there are unit tests for precisely that.

**Offline** is Firestore's `persistentLocalCache`, not a hand-rolled sync layer. Tap
writes are deliberately never awaited: offline, the write promise does not settle
until the connection returns, but Firestore has already applied the tap locally, so
awaiting would freeze the button for as long as the volunteer has no signal.

The service worker precaches only what the volunteer screen needs: Firebase, React
and the volunteer page itself. The organizer pages and their charts are separate
chunks, cached the first time each one is opened, so a volunteer's phone never
downloads them. The flip side: open the dashboard, report and vendor pages once with
signal on each device that will use them.

### Reading the dashboard

The dashboard is analytics-first. Top to bottom:

**Zone cards.** Current occupancy, the last 60 minutes as a sparkline, and the next
15 minutes projected as a dashed continuation of the same line. The projection is a
straight line drawn at whatever rate the zone has moved over the last 10 minutes -
nothing cleverer than that. Peak and an estimated dwell time sit under the chart.

The sparkline scales to its own data rather than to capacity, so the shape of the
hour stays visible even in a zone that is nowhere near full. The capacity line
appears once capacity is close enough to matter; until then the percentage above the
chart tells you where you stand.

**Forecast accuracy.** Every two minutes, each zone's 15-minute forecast is written
down. Once that moment arrives and the taps have settled, the actual occupancy is
recorded next to it. The mean absolute error is how many people the forecast is
typically off by; the bias says whether it runs high or low. **Read the error before
you trust the forecast.** A straight-line projection does badly at turning points -
when a performance starts, everyone moves at once and the forecast will be wrong in
a way it cannot anticipate. The number on screen is what makes that visible instead
of hidden.

**People on site / arrivals.** Both come from checkpoints that touch OUTSIDE, which
is the only boundary with the rest of the world and so the only place total
attendance can be measured.

**Throughput and flow.** People per minute across each checkpoint, and a 15-minute
in/out/net table. A checkpoint that has gone quiet is drawn in red on the throughput
chart, because an empty bar there means missing data, not a quiet gate.

**Operations log.** Alerts, flags, resets and scored forecasts on one timeline.
Alerts are derived from the tap log rather than stored when they fire, so the history
survives a reload and can be reconstructed for any past moment.

### Site map and suggested actions

Both optional, both set up on the admin page.

Upload a picture of the park, then tap a zone and tap the map to place it. The
dashboard draws each zone as a circle sized by occupancy, with the number printed
inside. The image is shrunk and stored in Firestore, so there is no Cloud Storage
bucket to configure or clean up.

Suggested actions are a small rules table - "when Food Court is over 85%, show: open
the second queue lane". The text appears on the dashboard alert, so whoever is
holding the tablet at 7 p.m. does not have to decide what to do on the spot.

### Security model

Anyone signed in anonymously can create a well-formed tap or flag under an event they
hold the id for. Taps can only be updated to set `undone: true`, only by the device
that wrote them (`deviceId` is the anonymous auth uid, so this is enforced rather than
claimed). Zones, checkpoints, resets and the event document are readable by anyone
with the event id but writable only by an admin.

The admin secret is stored in `events/{id}/private/admin`, which **no client can
read**. To become an admin on a device you send the secret as `claimSecret`; the rules
compare it to the stored one and record your uid. After that you are recognised by
uid.

`npm run verify:rules` exercises the deployed rules with two separate anonymous users,
covering offline taps, undo ownership, hard-delete refusal, admin gating, forecast
scoring and privilege escalation. It creates a temporary event and prints the command to
delete it.

---

## Development

```bash
npm install
npm run dev            # local dev server
npm test               # unit tests for the counting engine
npm run build
npm run verify:rules   # checks firestore.rules against the deployed project
node scripts/simulate-event.mjs 300   # three clients, one offline for 5 minutes
node scripts/seed-history.mjs         # an event with 90 minutes of realistic taps

# End-to-end in a real browser. Needs a local Chrome; puppeteer-core is
# deliberately not a project dependency, so install it without saving it.
npm i --no-save puppeteer-core
node scripts/smoke-test.mjs                              # Phase 1 flow
node scripts/phone-check.mjs <eventId> <secret> [zoneId] # charts on a 390px screen;
                                                         # zoneId adds the vendor page.
                                                         # BASE=http://localhost:4173
                                                         # checks a local `vite preview`
node scripts/forecast-loop-check.mjs <eventId> <secret>  # holds the dashboard open
                                                         # ~20 min and checks that
                                                         # forecasts got scored

firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only hosting
```

`firebase deploy` needs `firebase login` first, with access to the
`crowdcontroldiwali` project.

---

## Known limitations

Read this section before relying on the numbers.

**Net-count drift.** Occupancy is a running difference of two large numbers, so small
errors accumulate and never self-correct. If a volunteer misses ten people entering
over an hour, the zone reads ten low for the rest of the night. Expect the count to be
directionally right and roughly accurate, not exact. The organizer can reset a zone
when it visibly empties. Treat trend and relative fullness as more trustworthy than
the absolute number.

**A silent checkpoint silently corrupts the count.** If a volunteer wanders off, stops
tapping or their phone dies, the zone behind them stops filling and looks calmer than
it is. This is why checkpoint health is on the dashboard; watch it.

**The admin secret is weak.** It is a shared password with no rate limiting, because
there is no server to rate-limit at. Someone who guesses it can edit zones and
checkpoints. It cannot be read out of the database, and it cannot be escalated to via
the rules, but it can be brute-forced given enough time. Acceptable for a pilot; do
not use this scheme for anything that matters.

**Any volunteer can tap for any checkpoint.** The rules check that a tap is
well-formed and that the device owns it, but they do not verify that the volunteer
holds that checkpoint's token — that would cost an extra document read on every tap.
Someone with an event link could deliberately submit garbage counts.

**Firestore free tier.** The Spark (free) plan allows roughly 20,000 writes and 50,000
reads per day. One tap is one write. A 5,000-person festival where each person crosses
three checkpoints in and back out is around 30,000 taps, which exceeds the free write
quota, and each dashboard reads the whole tap log on first load. **Switch the project
to the Blaze plan before the event and set a budget alert.** Past the free quota the
cost is a few cents per event at current pricing — confirm the current rates when you
switch.

**The forecast is a straight line.** It takes the last 10 minutes of movement and
extends it. It has no idea that the fireworks start at 7:30. It will be confidently
wrong at exactly the moments that matter most, which is why the error is measured and
shown rather than hidden - check the mean absolute error before acting on a
projection.

**Dwell time is Little's Law, not a measurement.** Occupancy divided by arrival rate
assumes a zone in steady state. While a zone is filling or emptying quickly the
number is not meaningful. It is labelled as an estimate everywhere it appears.

**Forecast logging costs writes.** Four zones, one forecast every two minutes, plus a
second write to score each one: roughly 700 writes across a three-hour event, on top
of the taps. It only runs on a dashboard that has been unlocked with the admin
secret.

**Every vendor link reads the whole tap log.** A vendor page computes its zone from
the same data the dashboard uses. Handing the link to ten vendors means ten more full
reads of the tap log. Keep vendor links to people who actually need them, and see the
free-tier note above.

**Site maps must be simple.** The image is shrunk to fit a Firestore document, and a
very detailed photograph will be rejected with a message asking for a simpler one. A
flat park diagram is the right input.

**Alerts are detected once a minute.** A zone that crosses 85% and drops back within
the same minute may not produce a log entry. Peak occupancy is tracked exactly and
is not affected.

**The dashboard reads every tap for the event.** Fine for one day at this scale, and
it is what makes replay possible later, but it is not how you would build this for a
20,000-person event.

**A phone needs signal the first time it opens the app.** Anonymous sign-in has to
reach Firebase once. After that the phone works offline. Have
volunteers scan their card while they still have service.

**Clock skew.** `clientTs` comes from the volunteer's phone. A phone with a badly wrong
clock will place its taps at the wrong time on the timeline, and taps more than 24
hours out are rejected outright.

**Undo is 60 seconds and one tap deep**, per device and per checkpoint. It is for
double-taps, not for fixing a bad five minutes.

**Button geometry.** The spec asked for IN and OUT to each be at least 45% of screen
height. With a header and a footer bar that is geometrically impossible on a phone —
45 + 45 + chrome exceeds 100%. Each button fills all remaining space, which works out
at roughly 43–46% depending on the device. They are still the overwhelming majority of
the screen.

---

## What is not built yet

Everything else from the Phase 2 and Phase 3 plans is built and described above: the
alert banner, reset-zone action, flags, site map, suggested actions, forecast log,
vendor page and post-event report. Still missing:

**Confidence indicator.** Nothing on the dashboard says how far to trust a zone's
number. Checkpoint health on the throughput chart is the closest thing.

**Replay scrubber.** The time-series engine can rebuild the event at any past moment,
but there is no control for dragging back through the evening.

**Miscounting detection.** Nothing flags a checkpoint whose counts look wrong.
Spotting drift and resetting the zone is up to the organizer.

**Vendor links in the app.** The vendor page works, but nothing in the app lists its
link. Build it by hand as `/vendor/{eventId}/{zoneId}`, where the zone id is the
zone's document id under `events/{eventId}/zones`.
