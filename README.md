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

## The three screens

| Screen | URL | Who |
|---|---|---|
| Volunteer | `/count/{eventId}/{checkpointToken}` | Scanned from the QR card |
| Dashboard | `/dash/{eventId}` | Organizer |
| Admin | `/admin/{eventId}` | Whoever sets the event up |
| Printable cards | `/print/{eventId}` | Printed the day before |

Event ids and checkpoint tokens are random UUIDs, and Firestore will not list
events, so an event is undiscoverable without its link.

---

## Running the demo

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

`npm run verify:rules` exercises the deployed rules with two separate anonymous users
— 28 checks covering offline taps, undo ownership, hard-delete refusal, admin gating,
and privilege escalation. It creates a temporary event and prints the command to
delete it.

---

## Development

```bash
npm install
npm run dev            # local dev server
npm test               # unit tests for the counting engine
npm run build
npm run verify:rules   # check firestore.rules against the deployed project
node scripts/simulate-event.mjs 300   # three clients, one offline for 5 minutes

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

**The dashboard reads every tap for the event.** Fine for one day at this scale, and
it is what makes replay possible later, but it is not how you would build this for a
20,000-person event.

**A phone needs signal the first time it opens the app.** Anonymous sign-in and the
app shell have to be fetched once. After that the phone works offline. Have volunteers
scan their card while they still have service.

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

Phase 2 (by 10 October): forecast and alert banner, reset-zone action, confidence
indicator, site map with zone positions, suggested-actions table.

Phase 3 (after the event): post-event report, replay scrubber, miscounting detection.

The FLAG button and the dashboard flags panel are Phase 2 items that landed early —
they are working end to end, so flags raised at the demo are recorded and shown.
