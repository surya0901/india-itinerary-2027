# India Itinerary 2027

Our family plan for India, Dec 31, 2026 to Feb 5, 2027: Chennai, Kerala, Salem, Trichy, Pongal at home, the Mysuru, Tirupati and Mantralayam temple loop, and Jaipur and Udaipur.

**Live site:** https://surya0901.github.io/india-itinerary-2027/

## What's on the site

- **Calendar** of every day, colour coded by trip. Tap a day for its timings.
- **Globe** of the whole route from New York to India and back. Drag it, zoom it, tap a leg to fly there, or play the whole trip.
- **Day by day** timings, with train and flight numbers.
- **Tickets** for every train, Vande Bharat, flight, darshan, stay and activity, with the price, the date booking opens (in India time and your own time), booking links, status and PNR.
- **To-do** list with who does what and by when. Unbooked tickets show up here on their own.
- **Budget** that adds everything up for the group. Prices switch between rupees and dollars at the live exchange rate: use the switch at the top, or tap any single price.
- **Trip planner chat**: ask questions or ask for changes in plain words, then apply them for everyone.
- **Good to know**: IRCTC rules, booking for 15 people, which class to pick, Tirumala darshan rules and links.
- Calendar files you can add to your phone: the whole trip, or reminders for when each booking opens.

## Trip planner chat

Tap **Ask the planner** (bottom right) or use the box under the countdown. Ask questions ("what do we need to book this week?") or ask for changes ("move Trichy to Jan 20 and 21", "we booked 22639, PNR 4521234567"). Google Gemini reads the whole plan and replies. Changes show up as a card. **Apply for everyone** saves them for everyone straight away, and **Undo** puts things back.

Anyone with the link can use it, with no keys or codes. The keys live in a small Cloudflare Worker (`worker/worker.js`), never in this public repository:

- `GET /plan` returns the latest plan from GitHub, so everyone sees changes within seconds.
- `POST /ask` forwards chat messages to Gemini.
- `POST /save` writes `data/trip.json` to this repository.

Safeguards: only the trip site can call the Worker, each visitor is rate limited, a save that would delete most of the plan is refused, and if two people save at once the planner re-applies its change on top of the newer version. GitHub keeps every version, so anything can be restored from the commit history.

Worker secrets (Cloudflare dashboard, the Worker's Settings, Variables and Secrets): `GEMINI_API_KEY` and `GITHUB_TOKEN` (fine-grained, this repository only, Contents read and write, expires Apr 23, 2027). The Worker's address is `meta.workerUrl` in `data/trip.json`.

## Editing

Anyone who opens the site can change anything: days, timings, tickets, prices, to-dos, names. Edits are saved on that device until you share them. Open **Share and save** to:

1. **Save for everyone.** Writes your version to this repository, and everyone sees it right away.
2. **Copy a link with your changes.** Whoever opens the link sees your version and can keep editing.
3. **Download or load a plan file.**

### Setting up "Save for everyone"

1. Add the person as a collaborator: repository **Settings → Collaborators → Add people**.
2. They create a fine-grained access key at https://github.com/settings/personal-access-tokens/new:
   - Repository access: **Only select repositories**, then pick `india-itinerary-2027`.
   - Permissions: **Contents → Read and write**.
3. They paste the key into **Share and save** on the site the first time. It stays in that browser only.

You can also edit `data/trip.json` directly on GitHub. GitHub Pages republishes within a minute or two.

## How it's built

Plain HTML, CSS and JavaScript with no build step, so GitHub Pages serves the repository as is.

```
index.html              page shell
assets/style.css        design
assets/app.js           views, editing, sharing, saving to GitHub, calendar files, currency
assets/globe.js         the globe (d3-geo orthographic projection on canvas)
assets/vendor/          d3 7.9.0, topojson-client 3.1.0, world-atlas 2.0.2 countries-50m
data/trip.json          the whole plan: days, tickets, to-dos, costs, places and route legs
```

Live exchange rate: [Frankfurter](https://frankfurter.dev/), with [ExchangeRate-API](https://www.exchangerate-api.com/) as a fallback. If both are unreachable the site uses the rate saved in the plan.

## Sources and caveats

Train times come from [RailMitra](https://www.railmitra.com/) and [ixigo](https://www.ixigo.com/trains). Fares marked "estimate" are approximate, so check [IRCTC](https://www.irctc.co.in/) before booking. TTD quota dates are from TTD's announcement for January 2027; book darshan only on [ttdevasthanams.ap.gov.in](https://ttdevasthanams.ap.gov.in/). Map data is from Natural Earth via [world-atlas](https://github.com/topojson/world-atlas).

This repository is public, so anyone with the link can see the plan.
