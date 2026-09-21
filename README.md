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
| Checklist | `/admin/{eventId}/checklist` | The organizer, the morning of |
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
| Checklist | https://crowdcontroldiwali.web.app/admin/0bcdb987fe9045a3b11710bfa45d4eef/checklist |

This event is marked `demo: true`, so its dashboard carries the SIMULATED badge and
the simulator will run on it.

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

## Running the simulation

On a day with no crowd outside, the demo event can generate one. The **Demo
simulator** on the admin page writes 2 hours 40 minutes of festival instantly as
backdated taps, then plays the last 20 minutes out live over about three minutes, so
the dashboard visibly moves while people are watching it.

Simulated taps are not marked and cannot be. The rules pin every tap's `deviceId` to
whoever wrote it and allow no other fields, so a generated tap is byte-for-byte an
ordinary one - which is the point: occupancy, forecasting, scoring, health and alerts
all behave exactly as they will on the night. What marks the data as generated is the
`demo: true` flag on the event, which puts an unmissable **SIMULATED** badge on the
dashboard. The simulator refuses to run on an event without it.

### At the meeting

The one thing that needs planning is the forecast-accuracy tile. A forecast may only
be written with a target in the future and scored only after that target has passed -
that is enforced by the rules, and it is why the number can be trusted - so scored
forecasts cannot be generated. They have to be earned in real time.

**Start 30 minutes before you present.** For a 4:30 p.m. meeting:

| | |
|---|---|
| **4:00** | Open `/admin/{eventId}`, scroll to **Demo simulator**, leave crowd size at **Full size**, press **Simulate**. The history lands in about 30 seconds; the live tail then runs for 3 minutes. |
| **4:03** | Open the dashboard on the presenting device and **unlock it** with the lock in the header. Nothing records forecasts until a dashboard is unlocked. Leave it open and awake. |
| **4:05** | Stage Seating has crossed 85% and the red alert banner is up. Everything except the forecast tile is now worth showing. |
| **4:22** | The first forecasts have been scored; the tile still reads "— · 3 of 5 scored". |
| **4:30** | Five or more forecasts are scored and the tile reads something like **±4% · 7 scored**. Present. |

The tile needs **roughly 25 minutes** from the first unlocked dashboard: a forecast
looks 15 minutes ahead, is scored 2 minutes after that, and five of them are recorded
two minutes apart. There is no way to shorten it that does not also make the number a
lie. If you are running late, open the dashboard first and set the event up second.

A light trickle of taps keeps running after the three-minute tail so the zones keep
moving and the forecasts have something real to be scored against. Press **Stop**
when you are done.

### What the generated evening contains

- A slow start while it is still light, a hard surge at the entrance around the
  40-minute mark, the food court filling through the middle to about half full, and
  everyone converging on the stage for the programme at the end.
- **Stage Seating crosses 85% during the live tail**, which is what raises the red
  alert banner, the chime, and the suggested action if one is set.
- **Path to Food Court goes silent for six minutes mid-event** - visible afterwards
  in the throughput chart and the operations log.
- **Vendor Row Walkway dies seven minutes before the handover and never comes back**,
  so checkpoint health shows it red, and both Vendor Row and Main Lawn carry the
  silent-feeder warning for the whole demo. This is the one to point at.
- Two flags waiting to be acknowledged: a long line at the gate, and a request for
  staff at the stage entrance.

It is the same festival every time - the generator is seeded - so the demo tells one
story and you can rehearse it.

### What it costs

Every tap is one Firestore write, and a full-size evening is **about 6,100 taps**.
Clearing it is another write per tap, and every dashboard load reads the whole log.
The free Spark plan allows roughly 20,000 writes and 50,000 reads per day, which is
one simulate-and-clear cycle with very little room. **Be on the Blaze plan before you
rehearse**, and set a budget alert; at these volumes the bill is cents.

**Crowd size** offers half and quarter as cheaper rehearsals. Capacities do not shrink
with the crowd, so at those sizes no zone gets near its limit and the alert banner
never appears - useful for checking the plumbing, not for the demo itself. (To
rehearse the whole story cheaply, quarter the crowd *and* quarter the zone capacities;
every percentage then comes out exactly as it does at full size. That is what
`scripts/demo-check.mjs` does.)

**Clear simulation** marks every tap this browser wrote to the event as undone -
nothing is ever hard-deleted. That is also the only thing the rules let a browser
undo, so **run Simulate and Clear from the same browser**. Clearing stops a running
simulation first.

---

## Setting up a new event

Open **Morning-of checklist** from the top of the admin page for the list of things
to verify before the gates open. The ticks are saved in that browser.

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

The dashboard answers three questions, in this order, and is laid out in that order:
**how many people are here**, **what is about to be a problem**, and **whether the
numbers can still be trusted**. It is built for a phone held in one hand, because
that is where it will actually be read.

**Summary strip.** Four tiles, always on screen.

- *Attendance so far* - everyone who has come in through a gate since the first tap.
  This is the number the organizer reports upward, so it gets the largest type.
- *On site now* - the sum of every zone's current occupancy.
- *Watch* - the single zone closest to being a problem, as "Stage Seating · 71% ·
  full in ~9 min". "All zones steady" when nothing is trending up.
- *Forecast accuracy* - how far the forecast has been off, as a share of capacity,
  so it is in the same units as the percentage on every card. It reads "—" until
  five forecasts have been scored, because before that the average says more about
  luck than about the forecast.

**Alert banner.** One line, only when a zone is over 85% or is projected to reach
capacity within 15 minutes: the zone, what is happening, and the suggested action if
one has been written down for it. Tap it to dismiss for ten minutes - an alert that
cannot be silenced gets ignored, and an ignored alert is worse than none. A zone that
starts alerting *after* you dismiss brings the banner straight back.

**Zone cards, fullest first.** Occupancy, percentage, the rate in people per minute,
time to capacity while it is rising, and the last 60 minutes as a sparkline with the
next 15 projected as a dashed continuation of the same line. The projection is a
straight line at whatever rate the zone has moved over the last 10 minutes - nothing
cleverer than that.

The sparkline scales to its own data rather than to capacity, so the shape of the
hour stays visible even in a zone that is nowhere near full. The capacity line
appears once capacity is close enough to matter.

Each card also carries two honesty markers, described under *Confidence* below, and
a **Reset** button when the dashboard is unlocked.

**Checkpoint health**, directly under the cards, because a quiet checkpoint is the
reason a number above it is wrong. The two are meant to be read together.

**Flags**, then the **arrivals and attendance chart** - one chart, with arrivals per
five minutes as bars and cumulative attendance as a line on a second axis. Collapsed
on a phone, open on a desktop.

**More** holds everything that does not compete for attention during an event:
per-checkpoint throughput, the 15-minute flow table, forecast accuracy in detail, and
the operations log. Nothing in there is mounted until the drawer is opened.

Organizer actions are behind the lock in the header rather than a box in the page. On
the night nobody is unlocking anything - they are reading numbers - and an input
field at the top of a dashboard is a thing to scroll past a hundred times.

### Confidence, and other ways the dashboard admits it is wrong

Occupancy is a running difference of two large counts, so every missed or double tap
stays in the number for the rest of the night. Nothing in the data can say how wrong
we are - if the error could be measured it would be corrected. So the dashboard shows
the two things it *can* know.

**Confidence, per zone.** Time since the number was last known to be right, which is
the start of the event or that zone's last reset:

| | |
|---|---|
| **high** | under 30 minutes since calibration |
| **medium** | 30 to 90 minutes |
| **low** | over 90 minutes |

This is a proxy for accumulated drift and nothing more - the label and its tooltip
both say so. Resetting a zone puts it back to **high**, and only that zone.

**Silent feeders.** If any checkpoint that changes a zone's count has recorded
nothing for five minutes, that zone's card says so by name and by clock time:
"⚠ Vendor Row Walkway stopped reporting at 6:42 PM". A dead phone belongs on the zone
whose number it is quietly corrupting, not only in the health list further down. A
checkpoint that has never reported at all is counted from the start of the event, so
a post nobody ever staffed is caught too.

**Resetting a zone** is one tap from its card, behind the lock. The dialog is
pre-filled with 0, because the reason to reset is almost always that an area has
visibly emptied and the count has not, and it takes an optional note that goes
straight into the operations log - so the report can say why the number jumped.
The taps are never deleted; a reset is a new baseline the count continues from.

**Forecast accuracy.** Every two minutes each zone's 15-minute forecast is written
down. Once that moment arrives and the taps have settled, the actual occupancy is
recorded next to it. **Read the error before you trust the forecast.** A
straight-line projection does badly at turning points - when a performance starts,
everyone moves at once and the forecast will be wrong in a way it cannot anticipate.
The number on screen is what makes that visible instead of hidden.

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
node scripts/verify-simulator.mjs                        # the three writes only the
                                                         # simulator makes, against
                                                         # the deployed rules
node scripts/demo-check.mjs                              # the whole demo path in a
                                                         # real browser: simulate,
                                                         # read the dashboard, clear.
                                                         # Needs `npx vite preview`

firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only hosting
```

`firebase deploy` needs `firebase login` first, with access to the
`crowdcontroldiwali` project.

## Planning features

A second layer on the dashboard and report, built for one question: how many food
trucks and staff did this event need, with attendance a parks department can
defend? The evening is data collection; the report is the product. Every number
lists the assumption it rests on.

**All of it is behind one switch, off by default.** With it off, the dashboard and
report are exactly what they were at `demo-ready` (checked text-for-text by
`scripts/planning-check.mjs`).

### Turning it on and off

- **For the event:** admin page → *Planning features* → tick the box. Untick to hide it
  again. Every open dashboard and report updates within a second or two.
- **For one visit, without touching the switch:** add `?planning=1` to a dashboard or
  report link (`/dash/<id>?planning=1`, `/report/<id>?planning=1`). `?planning=0` hides
  it even when the switch is on.

The organizer inputs (food-court zone, trucks, order share, target wait, miss rate,
staffing ratio) and the service-timer QR card appear under the switch once it is on.

### The models, for a parks manager

**Service times.** A volunteer times customers at each truck for about half an hour
before the rush, on the `/service/...` screen: START when someone reaches the window,
DONE when they leave with food. A truck's speed is only used once it has at least 8
timed customers; until then the report says "not enough samples".

**Food-truck lines (Erlang C).** The number of people walking into the food court every
5 minutes, times the share you say will order, is compared with how fast the trucks
serve; from that, standard queueing maths (the M/M/c model) gives the expected wait.
It assumes customers always find the shortest line, so it is the *best case*, and when
the trucks cannot keep up at all it says "line growing" instead of inventing a number.
*Assumptions:* random arrivals and service times; one shared line; each 5-minute block
treated as settled (a real line lags a surge); the order share is yours, and until you
enter it the report shows 50%, 75% and 100% side by side. The what-if table shows one
fewer truck through two more, and highlights the fewest that keeps every wait under your
target (10 minutes unless you change it).

**Attendance band (±).** Volunteers miss people; if each person is missed independently
with a small chance (3% unless you change it), the count is uncertain by roughly the
square root of the number of taps times that chance, and a zone reset brings its
uncertainty back to nearly zero. The ± is one standard deviation. *Assumptions:* misses
are independent; double taps and silent phones are not included; misses make counts run
low, so treat the band as a floor, not a ceiling. (In code: a one-dimensional Kalman
filter on the variance only, `src/lib/planning/band.ts`.)

**Staffing by 15 minutes.** The most people on site in each 15-minute block, divided by
*your* people-per-staff ratio, rounded up. The app never suggests a ratio; with none
entered the table stays empty. *Assumption:* on-site is the gate count (in minus out).

**Consistency checks.** Flags, with the place and time, where the counts contradict
themselves: a zone below zero; inner areas holding more people than the gates say are on
site (beyond the ± band); a checkpoint where cumulative OUT has been more than 10% above
cumulative IN for 15 minutes. They are prompts for a person to look, and never change a
count.

**Second forecaster (Holt, damped trend).** Smooths each zone's recent count and its
trend, and lets the trend fade over the 15 minutes ahead instead of running it on in a
straight line. It is recorded and scored exactly like the straight-line forecast, and
both errors are shown on the dashboard; the straight line stays primary because it did
better (see below).

**Replay.** A slider on the report rebuilds the dashboard's numbers at any minute of the
evening from the tap log.

### Holt versus straight line

Scored offline over three simulated evenings (every 2 minutes, every zone, 15 minutes
ahead - the dashboard's own schedule; `src/lib/planning/backtest.test.ts`), with Holt's
parameters fixed beforehand (α 0.5, β 0.2, φ 0.9) rather than tuned to the simulator:

| Simulated evening (seed) | Forecasts | Straight line MAE | Holt MAE |
|---|---|---|---|
| 20261017 | 312 | 45.9 people | 61.2 people |
| 1 | 312 | 46.1 people | 62.0 people |
| 2 | 312 | 46.4 people | 61.7 people |

Holt lost all three, so it is not the primary forecast. On the night both are scored
live, and the dashboard shows the two errors side by side.

### New data

New collections, each with its own rules and nothing else changed:
`trucks` (organizer), `serviceTimes` (anyone with the event id, written as their own
device, soft-delete only, 1 s to 30 min), `forecastsHolt` (same rules as `forecasts`).
Organizer inputs live in a `planning` map on the event document. The volunteer screen
and the tap rules are byte-for-byte what they were at `demo-ready`.

The service-timer screen is a lazily loaded page, so unlike the counting screen it is
not in the offline precache: the volunteer opens the link once with signal (which the
first sign-in needs anyway), after which it and every sample work offline.

The demo simulator also adds three trucks, twelve timed customers each (60-180 s), the
food-court zone and a 60% order share to the demo event, so the Planning section has
something to show. It leaves the staffing ratio blank - type one in on the admin page.

Checks: `npm test` (Erlang C against published tables, the band's accumulation and
reset, queue, staffing, consistency, Holt), `node scripts/verify-planning-rules.mjs`,
and `BASE=... COMPARE_BASE=<demo-ready url> node scripts/planning-check.mjs` in a
browser.

---

## Known limitations

Read this section before relying on the numbers.

**Net-count drift.** Occupancy is a running difference of two large numbers, so small
errors accumulate and never self-correct. If a volunteer misses ten people entering
over an hour, the zone reads ten low for the rest of the night. Expect the count to be
directionally right and roughly accurate, not exact. Treat trend and relative fullness
as more trustworthy than the absolute number. Each card carries a confidence label
saying how long it has been since that zone was last calibrated; reset a zone when it
visibly empties and the label goes back to high.

**A silent checkpoint silently corrupts the count.** If a volunteer wanders off, stops
tapping or their phone dies, the zone behind them stops filling and looks calmer than
it is. Checkpoint health is on the dashboard and any zone fed by a checkpoint quiet
for five minutes says so on its own card - but neither of those makes the missing
people reappear. The count behind a checkpoint that was dead for twenty minutes is
wrong by however many people walked past it, and the only fix is a reset.

**The admin secret is weak.** It is a shared password with no rate limiting, because
there is no server to rate-limit at. Someone who guesses it can edit zones and
checkpoints. It cannot be read out of the database, and it cannot be escalated to via
the rules, but it can be brute-forced given enough time. Acceptable for a pilot; do
not use this scheme for anything that matters.

**Any volunteer can tap for any checkpoint.** The rules check that a tap is
well-formed and that the device owns it, but they do not verify that the volunteer
holds that checkpoint's token — that would cost an extra document read on every tap.
Someone with an event link could deliberately submit garbage counts.

**Firestore free tier.** Running the demo simulator costs about 6,100 writes a time;
see *What it costs* above. The Spark (free) plan allows roughly 20,000 writes and 50,000
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

**Replay scrubber.** Built, on the report, behind the Planning features switch.

**Miscounting detection.** With planning on, the consistency checks catch counts that
contradict themselves (a zone below zero, more out than in). Otherwise nothing flags a
checkpoint whose counts look wrong -
one volunteer tapping at half the rate of the gate beside them, say. Confidence and
the silent-feeder warning cover *staleness* and *silence*; neither catches a
checkpoint that is reporting steadily and wrongly. Spotting that, and resetting the
zone, is still the organizer's job. After 17 October.
