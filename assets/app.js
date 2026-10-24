/* India Itinerary 2027
   Plain JavaScript, no build step, so GitHub Pages can serve it as is.
   The shared plan lives in data/trip.json. Edits are kept on this device until someone
   shares them with a link, downloads the file, or saves them to GitHub for everyone. */
(function () {
  "use strict";

  // ---------- small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = (p) => p + Math.random().toString(36).slice(2, 8);
  const DAY = 86400000;

  const parseDay = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const dayDiff = (a, b) => Math.round((parseDay(isoDay(b)) - parseDay(isoDay(a))) / DAY);
  const fmt = (d, o) => d.toLocaleDateString("en-IN", o);
  const fmtDay = (iso) => fmt(parseDay(iso), { weekday: "short", day: "numeric", month: "short" });
  const fmtLongDay = (iso) => fmt(parseDay(iso), { weekday: "long", day: "numeric", month: "long" });
  const inr = (n) => "₹" + Math.round(n || 0).toLocaleString("en-IN");
  const usd = (n) => "$" + Math.round(n || 0).toLocaleString("en-US");
  const IST = "Asia/Kolkata";
  const fmtIST = (d) => d.toLocaleString("en-IN", { timeZone: IST, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const fmtLocal = (d) => d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const localIsIST = () => Intl.DateTimeFormat().resolvedOptions().timeZone === IST || new Date().getTimezoneOffset() === -330;

  const store = {
    key: (k) => "iti27:" + location.pathname + ":" + k,
    get(k) { try { const v = localStorage.getItem(this.key(k)); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(this.key(k)); } catch (e) {} },
  };

  // ---------- state ----------
  let pub = null;        // version published in data/trip.json
  let data = null;       // what you are looking at and editing
  let view = "calendar";
  const ui = { tripFilter: "all", kindFilter: "all", ownerFilter: "all", showDone: false, currency: store.get("currency") === "USD" ? "USD" : "INR" };
  let liveRate = store.get("rate"); // { value, date, source, fetched }
  let globe = null;

  // ---------- money: rupees or dollars, live rate ----------
  const rate = () => (data && data.meta.rateMode === "fixed" ? Number(data.meta.usdRate) : (liveRate && liveRate.value) || Number(data && data.meta.usdRate) || 95);
  function fmtMoney(n, cur) {
    if (cur === "USD") { const v = (Number(n) || 0) / rate(); return "$" + v.toLocaleString("en-US", { maximumFractionDigits: v < 20 ? 2 : 0, minimumFractionDigits: v < 20 && v % 1 ? 2 : 0 }); }
    return inr(n);
  }
  // a price you can tap to flip between ₹ and $
  const money = (n) => `<button type="button" class="money" data-inr="${Math.round(Number(n) || 0)}" data-cur="${ui.currency}" title="Tap to switch between rupees and dollars">${fmtMoney(n, ui.currency)}</button>`;
  function refreshMoney() {
    $$(".money").forEach((b) => { b.textContent = fmtMoney(b.dataset.inr, b.dataset.cur); });
    $$(".cur-toggle button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.setCur === ui.currency)));
    const r = $("#rate-line");
    if (r) r.innerHTML = rateLine();
    const f = $("#rate-foot");
    if (f) f.innerHTML = rateLine() + ". Tap any price to switch it between rupees and dollars.";
  }
  function setCurrency(cur) {
    ui.currency = cur; store.set("currency", cur);
    $$(".money").forEach((b) => { b.dataset.cur = cur; });
    refreshMoney();
  }
  function rateLine() {
    if (data && data.meta.rateMode === "fixed") return `Fixed rate: $1 = ₹${Number(data.meta.usdRate).toFixed(2)}`;
    if (liveRate && liveRate.value) return `Live rate: $1 = ₹${liveRate.value.toFixed(2)}, ${esc(liveRate.date || "")} (${esc(liveRate.source)})`;
    return `Rate: $1 = ₹${rate().toFixed(2)} (live rate unavailable right now)`;
  }
  async function fetchRate() {
    if (liveRate && Date.now() - (liveRate.fetched || 0) < 3 * 3600 * 1000) return;
    const sources = [
      ["Frankfurter", "https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR", (j) => ({ value: j.rates && j.rates.INR, date: j.date })],
      ["ExchangeRate-API", "https://open.er-api.com/v6/latest/USD", (j) => ({ value: j.rates && j.rates.INR, date: (j.time_last_update_utc || "").slice(5, 16) })],
    ];
    for (const [source, url, pick] of sources) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) continue;
        const v = pick(await r.json());
        if (v.value > 10) { liveRate = { value: Number(v.value), date: v.date, source, fetched: Date.now() }; store.set("rate", liveRate); refreshMoney(); return; }
      } catch (e) { /* try the next source */ }
    }
  }

  const tripById = (id) => (data.trips.find((t) => t.id === id) || { name: id, color: "#67737A" });
  const peopleFor = (t) => Number(t.people) || Number(data.meta.defaultPeople) || 1;
  const costOf = (t) => (t.costType === "total" ? Number(t.cost) || 0 : (Number(t.cost) || 0) * peopleFor(t));
  const dirty = () => pub && JSON.stringify(data) !== JSON.stringify(pub);

  // ---------- booking windows ----------
  // Indian Railways opens bookings 60 days before the date the train starts its run, at 8 AM IST.
  function opensAt(t) {
    if (t.opensAt === "now") return null;
    if (t.opensAt) return new Date(t.opensAt);
    if (t.kind === "train") {
      const o = parseDay(t.originDate || t.date);
      const d = addDays(o, -60);
      return new Date(`${isoDay(d)}T08:00:00+05:30`);
    }
    return null;
  }
  function bookingState(t, now = new Date()) {
    if (t.status === "booked") return { key: "booked", label: "Booked", cls: "is-booked" };
    const at = opensAt(t);
    if (t.status === "waitlist") return { key: "waitlist", label: "Waitlisted, keep checking", cls: "is-open", at };
    if (!at) return { key: "anytime", label: "Book any time", cls: "", at: null };
    const days = Math.ceil((at - now) / DAY);
    if (at <= now) return { key: "open", label: "Open now, book it", cls: "is-open", at };
    if (days <= 7) return { key: "soon", label: days <= 1 ? "Opens tomorrow" : `Opens in ${days} days`, cls: "is-soon", at };
    return { key: "later", label: `Opens in ${days} days`, cls: "", at };
  }
  function whenLines(at) {
    if (!at) return "";
    const india = fmtIST(at) + " in India";
    return localIsIST() ? `<span>${esc(india)}</span>` : `<span>${esc(fmtLocal(at))} your time</span><span>${esc(india)}</span>`;
  }

  // ---------- load ----------
  async function load() {
    try {
      const res = await fetch("data/trip.json?t=" + Date.now(), { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      pub = await res.json();
    } catch (e) {
      $("#main").innerHTML = `<p class="loading">The plan file didn't load (${esc(e.message)}). If you opened this file directly from your computer, run it through a local web server or open the GitHub Pages link instead.</p>`;
      return;
    }
    data = clone(pub);
    let note = "";

    const linkPlan = await readPlanFromHash();
    const draft = store.get("draft");
    const draftBase = store.get("draftBase");
    if (linkPlan) {
      data = linkPlan;
      store.set("draft", data); store.set("draftBase", pub.meta.updated);
      note = "link";
      history.replaceState(null, "", location.pathname + location.search);
    } else if (draft) {
      data = draft;
      if (draftBase && draftBase !== pub.meta.updated) note = "stale";
    }
    const v = (location.hash || "").replace("#", "");
    if (["calendar", "globe", "days", "tickets", "todo", "budget", "info"].includes(v)) view = v;
    else view = store.get("view") || "calendar";
    render();
    if (note === "link") showBanner("You opened a shared link, so you're seeing someone's edited version. It's now saved on this device too.", [
      ["Go back to the shared plan", () => { discard(); }],
    ]);
    if (note === "stale") showBanner("Someone saved a newer version of the plan since you started editing. Your edits are still here on this device.", [
      ["Load the newer version", () => { discard(); toast("Loaded the newer version"); }],
      ["Keep my version", () => { store.set("draftBase", pub.meta.updated); hideBanner(); }],
    ]);
  }

  function commit(mutate, msg) {
    mutate(data);
    if (dirty()) { store.set("draft", data); store.set("draftBase", pub.meta.updated); }
    else { store.del("draft"); store.del("draftBase"); }
    render();
    if (msg) toast(msg);
  }
  function discard() {
    data = clone(pub); store.del("draft"); store.del("draftBase"); hideBanner(); render();
  }

  // ---------- render shell ----------
  function render() {
    document.title = data.meta.title || "India Itinerary 2027";
    $("#trip-title").textContent = data.meta.title || "India Itinerary 2027";
    $("#trip-sub").textContent = `${fmt(parseDay(data.meta.start), { day: "numeric", month: "long", year: "numeric" })} to ${fmt(parseDay(data.meta.end), { day: "numeric", month: "long", year: "numeric" })}, ${data.meta.defaultPeople} of us`;
    const st = $("#save-state");
    st.hidden = !dirty();
    st.textContent = "Edits only on this device";
    const up = pub.meta.updated ? new Date(pub.meta.updated) : null;
    $("#updated-line").textContent = up ? `Shared plan last saved ${up.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}${pub.meta.updatedBy ? " by " + pub.meta.updatedBy : ""}.` : "";
    renderHero();
    $$(".tabs [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === view)));
    const main = $("#main");
    const views = { calendar: viewCalendar, globe: viewGlobe, days: viewDays, tickets: viewTickets, todo: viewTodo, budget: viewBudget, info: viewInfo };
    if (globe) { globe.destroy(); globe = null; }
    main.innerHTML = views[view]();
    bindView();
    refreshMoney();
    if (view === "globe") mountGlobe();
  }

  function renderHero() {
    const now = new Date();
    const start = parseDay(data.meta.start), end = parseDay(data.meta.end);
    let line;
    const toGo = dayDiff(now, start);
    if (toGo > 1) line = `<strong>${toGo} days</strong> until we land in Chennai.`;
    else if (toGo === 1) line = `We land in Chennai <strong>tomorrow</strong>.`;
    else if (now <= addDays(end, 1)) {
      const today = data.days.find((d) => d.date === isoDay(now));
      line = today ? `Today, ${esc(fmtLongDay(today.date))}: <strong>${esc(today.place)}</strong>. ${esc(today.summary || "")}` : `We're in India.`;
    } else line = `Trip done. Hope it was a good one.`;

    const open = data.tickets.filter((t) => bookingState(t, now).key === "open" && t.status !== "booked");
    const upcoming = data.tickets
      .map((t) => ({ t, s: bookingState(t, now) }))
      .filter((x) => x.s.key === "soon" || x.s.key === "later")
      .sort((a, b) => a.s.at - b.s.at);
    const lateTodos = data.todos.filter((x) => !x.done && x.due && parseDay(x.due) < parseDay(isoDay(now)));
    let rows = "";
    if (open.length) {
      const names = open.slice(0, 3).map((t) => esc(t.number ? `${t.number} ${shortRoute(t)}` : t.name)).join(", ");
      rows += `<span class="k">Book now</span><span class="v"><b>${open.length} ${open.length === 1 ? "booking is" : "bookings are"} open and not booked:</b> ${names}${open.length > 3 ? " and more" : ""}. <button class="btn-link" data-go="tickets" type="button">See tickets</button></span>`;
    }
    if (upcoming[0]) {
      const { t, s } = upcoming[0];
      const when = localIsIST() ? fmtIST(s.at) : `${fmtLocal(s.at)} your time (${fmtIST(s.at)} in India)`;
      rows += `<span class="k">Next to open</span><span class="v"><b>${esc(t.number ? t.number + " " : "")}${esc(shortRoute(t) || t.name)}</b> for ${esc(fmtDay(t.date))}. Opens ${esc(when)}.</span>`;
    }
    if (lateTodos.length) rows += `<span class="k">Overdue</span><span class="v">${lateTodos.length} to-do ${lateTodos.length === 1 ? "item" : "items"}. <button class="btn-link" data-go="todo" type="button">Open the list</button></span>`;
    $("#hero").innerHTML = `<p class="hero-line">${line}</p>${rows ? `<div class="hero-next${open.length ? " is-urgent" : ""}">${rows}</div>` : ""}`;
  }
  const shortRoute = (t) => (t.from && t.to ? `${t.from.replace(/\s*\(.*\)/, "")} to ${t.to.replace(/\s*\(.*\)/, "")}` : "");

  // ---------- calendar ----------
  function viewCalendar() {
    const start = parseDay(data.meta.start), end = parseDay(data.meta.end);
    const gridStart = addDays(start, -start.getDay());
    const gridEnd = addDays(end, 6 - end.getDay());
    const byDate = Object.fromEntries(data.days.map((d) => [d.date, d]));
    const todayIso = isoDay(new Date());
    const dows = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let cells = dows.map((d) => `<div class="cal-dow">${d}</div>`).join("");
    let agenda = "";
    for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
      const iso = isoDay(d), day = byDate[iso];
      const first = d.getDate() === 1 || +d === +gridStart;
      const label = `${d.getDate()}${first ? ` <small>${fmt(d, { month: "short" })}</small>` : ""}`;
      if (!day) { cells += `<div class="cal-cell is-off" aria-hidden="true"><span class="cal-date">${label}</span></div>`; continue; }
      const trip = tripById(day.trip);
      const tix = data.tickets.filter((t) => t.date === iso && (t.kind === "train" || t.kind === "flight"));
      const tixHtml = tix.map((t) => `<span class="tix-dot${t.status === "booked" ? " is-booked" : ""}" title="${esc(t.status === "booked" ? "Booked" : "Not booked yet")}">${esc(t.number)}</span>`).join("");
      const today = iso === todayIso ? " is-today" : "";
      cells += `<button class="cal-cell${today}" style="--trip:${esc(trip.color)}" data-day="${iso}" type="button" aria-label="${esc(fmtLongDay(iso) + ", " + day.place)}">
        <span class="cal-date">${label}</span>
        <span class="cal-place">${esc(day.place)}</span>
        ${day.summary ? `<span class="cal-sum">${esc(day.summary)}</span>` : ""}
        ${tixHtml ? `<span class="cal-tix">${tixHtml}</span>` : ""}
      </button>`;
      if (d.getDay() === 0 || iso === data.meta.start) agenda += `<p class="agenda-week">Week of ${esc(fmt(d, { day: "numeric", month: "long" }))}</p>`;
      agenda += `<button class="agenda-row${today}" style="--trip:${esc(trip.color)}" data-day="${iso}" type="button">
        <span class="agenda-d">${d.getDate()}<small>${esc(fmt(d, { weekday: "short", month: "short" }))}</small></span>
        <span class="agenda-b"><span class="cal-place">${esc(day.place)}</span>${day.summary ? `<span class="cal-sum">${esc(day.summary)}</span>` : ""}${tixHtml ? `<span class="cal-tix">${tixHtml}</span>` : ""}</span>
      </button>`;
    }
    const legend = data.trips.map((t) => `<span><i class="swatch" style="background:${esc(t.color)}"></i>${esc(t.name)}</span>`).join("");
    return `<section class="view" aria-labelledby="h-cal">
      <div class="view-head">
        <div><h2 id="h-cal">Calendar</h2><p>Tap a day to see its timings or change it. Train numbers in red still need booking; green ones are booked.</p></div>
        <div class="toolbar"><button class="btn" data-action="ics-trip" type="button">Add trip to my calendar</button></div>
      </div>
      <div class="cal-wrap">
        <div class="legend">${legend}</div>
        <div class="cal">${cells}</div>
        <div class="agenda">${agenda}</div>
      </div>
    </section>`;
  }

  // ---------- globe ----------
  const haversine = (a, b) => {
    const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  };
  const MODE = { train: "Train", flight: "Flight", bus: "Bus" };
  function viewGlobe() {
    const places = data.places || {}, legs = data.legs || [];
    const kms = legs.map((l) => (places[l.from] && places[l.to] ? haversine(places[l.from], places[l.to]) : 0));
    const sum = (m) => Math.round(legs.reduce((a, l, i) => a + (l.mode === m ? kms[i] : 0), 0));
    const list = legs.map((l, i) => `<li><button class="leg" type="button" data-leg="${i}" style="--mode:var(--${l.mode === "flight" ? "maroon" : l.mode === "bus" ? "muted" : "coach"})">
        <span class="leg-date">${esc(fmtDay(l.date))}</span>
        <span class="leg-route">${esc((places[l.from] || {}).name || l.from)} → ${esc((places[l.to] || {}).name || l.to)}</span>
        <span class="leg-meta">${esc(MODE[l.mode] || l.mode)} ${esc(l.ref || "")}, about ${Math.round(kms[i]).toLocaleString("en-IN")} km</span>
      </button></li>`).join("");
    return `<section class="view" aria-labelledby="h-globe">
      <div class="view-head">
        <div><h2 id="h-globe">Globe</h2><p>Every leg from New York to India and back. Drag to spin, scroll or pinch to zoom, tap a leg to fly there.</p></div>
      </div>
      <div class="globe-stats">
        <div><b>${(sum("train") + sum("flight") + sum("bus")).toLocaleString("en-IN")} km</b><span>in total</span></div>
        <div><b>${sum("train").toLocaleString("en-IN")} km</b><span>by train, ${legs.filter((l) => l.mode === "train").length} trains</span></div>
        <div><b>${sum("flight").toLocaleString("en-IN")} km</b><span>in the air</span></div>
        <div><b>${new Set(legs.flatMap((l) => [l.from, l.to])).size}</b><span>places</span></div>
      </div>
      <div class="globe-layout">
        <div class="globe-stage">
          <canvas id="globe-canvas" tabindex="0" aria-label="Globe showing the trip route. Use arrow keys to spin and plus or minus to zoom."></canvas>
          <p class="globe-caption" id="globe-caption" aria-live="polite">Loading the map…</p>
          <div class="globe-controls">
            <button class="btn btn-primary" type="button" data-g="play" id="g-play">Play the whole trip</button>
            <button class="btn" type="button" data-g="world">Whole world</button>
            <button class="btn" type="button" data-g="india">India</button>
            <button class="btn" type="button" data-g="out" aria-label="Zoom out">−</button>
            <button class="btn" type="button" data-g="in" aria-label="Zoom in">+</button>
          </div>
          <div class="legend"><span><i class="mode-key" style="--mode:var(--coach)"></i>Train</span><span><i class="mode-key is-dash" style="--mode:var(--maroon)"></i>Flight</span><span><i class="mode-key is-dot" style="--mode:var(--muted)"></i>Bus</span></div>
        </div>
        <ol class="leg-list" id="leg-list">${list}</ol>
      </div>
    </section>`;
  }
  let libsPromise = null;
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.async = true; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.appendChild(s); });
  function loadGlobeLibs() {
    if (!libsPromise) {
      libsPromise = (window.d3 ? Promise.resolve() : loadScript("assets/vendor/d3.min.js"))
        .then(() => (window.topojson ? null : loadScript("assets/vendor/topojson-client.min.js")))
        .then(() => (window.TripGlobe ? null : loadScript("assets/globe.js")));
      libsPromise.catch(() => { libsPromise = null; });
    }
    return libsPromise;
  }
  async function mountGlobe() {
    const caption = $("#globe-caption");
    try { await loadGlobeLibs(); } catch (e) { if (caption) caption.textContent = "The globe couldn't load. Check your connection and open this tab again."; return; }
    const canvas = $("#globe-canvas");
    if (!canvas || view !== "globe") return;
    const places = data.places || {}, legs = data.legs || [];
    const legBtns = $$("#leg-list .leg");
    const setCaption = (i) => {
      legBtns.forEach((b, j) => b.setAttribute("aria-current", String(i === j)));
      if (i < 0) { caption.textContent = "New York to India and back, 21 legs."; return; }
      const l = legs[i];
      caption.innerHTML = `<b>${esc(fmtLongDay(l.date))}</b>: ${esc(places[l.from].name)} → ${esc(places[l.to].name)}, ${esc((MODE[l.mode] || l.mode).toLowerCase())} ${esc(l.ref || "")}. <span>${esc(l.label || "")}</span>`;
      const btn = legBtns[i]; if (btn) btn.scrollIntoView({ block: "nearest" });
    };
    globe = TripGlobe.mount({
      canvas, places, legs,
      onLeg: setCaption,
      onPlay: (on) => { const b = $("#g-play"); if (b) b.textContent = on ? "Stop" : "Play the whole trip"; },
      onReady: (ok) => { caption.textContent = ok ? "Press Play to fly the whole trip, or tap a leg." : "The world map didn't load, so only the route is shown."; },
    });
    $(".globe-controls").onclick = (e) => {
      const b = e.target.closest("[data-g]"); if (!b || !globe) return;
      ({ play: () => globe.play(), world: () => globe.world(), india: () => globe.india(), in: () => globe.zoom(1.4), out: () => globe.zoom(1 / 1.4) })[b.dataset.g]();
    };
    $("#leg-list").onclick = (e) => { const b = e.target.closest("[data-leg]"); if (b && globe) globe.focusLeg(Number(b.dataset.leg)); };
  }

  // ---------- day by day ----------
  function viewDays() {
    const chips = [`<button class="chip" data-trip="all" aria-pressed="${ui.tripFilter === "all"}" type="button">All days</button>`]
      .concat(data.trips.map((t) => `<button class="chip" data-trip="${esc(t.id)}" aria-pressed="${ui.tripFilter === t.id}" type="button"><i class="swatch" style="background:${esc(t.color)}"></i>${esc(t.name)}</button>`)).join("");
    const days = data.days.slice().sort((a, b) => a.date.localeCompare(b.date)).filter((d) => ui.tripFilter === "all" || d.trip === ui.tripFilter);
    // group consecutive days of the same trip
    const groups = [];
    days.forEach((d) => { const g = groups[groups.length - 1]; if (g && g.trip === d.trip && dayDiff(parseDay(g.days[g.days.length - 1].date), parseDay(d.date)) === 1) g.days.push(d); else groups.push({ trip: d.trip, days: [d] }); });
    const todayIso = isoDay(new Date());
    const html = groups.map((g) => {
      const trip = tripById(g.trip);
      const range = g.days.length > 1 ? `${fmtDay(g.days[0].date)} to ${fmtDay(g.days[g.days.length - 1].date)}` : fmtDay(g.days[0].date);
      return `<section class="trip-block">
        <h2 class="trip-title"><i class="swatch" style="background:${esc(trip.color)}"></i>${esc(trip.name)} <small>${esc(range)}</small></h2>
        <div class="day-grid">${g.days.map((d) => dayCard(d, trip, d.date === todayIso)).join("")}</div>
      </section>`;
    }).join("");
    return `<section class="view" aria-labelledby="h-days">
      <div class="view-head">
        <div><h2 id="h-days">Day by day</h2><p>Every day with its times. Bold lines are things to book.</p></div>
        <div class="toolbar"><button class="btn" data-action="add-day" type="button">Add a day</button><button class="btn" data-action="print" type="button">Print</button></div>
      </div>
      <div class="chips" role="group" aria-label="Show trip">${chips}</div>
      ${html || `<p class="hint">No days for this trip yet.</p>`}
    </section>`;
  }
  function dayCard(d, trip, isToday) {
    const steps = (d.steps || []).map((s) => {
      const tk = s.ref ? data.tickets.find((t) => t.number === s.ref && t.date === dateForStep(d, s)) || data.tickets.find((t) => t.number === s.ref) : null;
      const ref = s.ref ? (tk ? `<a class="ref" href="#tickets" data-ticket="${esc(tk.id)}">${esc(s.ref)}</a>` : `<span class="ref">${esc(s.ref)}</span>`) : "";
      return `<li class="step${s.booking ? " is-booking" : ""}"><span class="step-t">${esc(s.time || "")}</span><span class="step-x">${ref}${esc(s.text)}${s.alt ? `<span class="step-alt">${esc(s.alt)}</span>` : ""}</span></li>`;
    }).join("");
    return `<article class="day-card${isToday ? " is-today" : ""}" id="day-${d.date}" style="--trip:${esc(trip.color)}">
      <div class="day-head"><h3>${esc(d.place)}</h3><span class="when">${esc(fmtDay(d.date))}</span></div>
      ${steps ? `<ol class="steps">${steps}</ol>` : `<p class="day-empty">${esc(d.summary || "Nothing planned yet.")}</p>`}
      ${d.note ? `<p class="day-note">${esc(d.note)}</p>` : ""}
      <div class="day-foot"><button class="btn btn-small" data-edit-day="${d.date}" type="button">Edit day</button></div>
    </article>`;
  }
  // a step after midnight on an overnight leg belongs to the ticket dated the next day
  const dateForStep = (d, s) => { const tk = data.tickets.find((t) => t.number === s.ref && t.date === d.date); return tk ? d.date : isoDay(addDays(parseDay(d.date), 1)); };

  // ---------- tickets ----------
  function viewTickets() {
    const kinds = [["all", "Everything"], ["train", "Trains"], ["flight", "Flights"], ["darshan", "Darshan"], ["stay", "Stays"], ["activity", "Activities"]];
    const chips = kinds.map(([k, l]) => `<button class="chip" data-kind="${k}" aria-pressed="${ui.kindFilter === k}" type="button">${l}</button>`).join("");
    const now = new Date();
    const order = { open: 0, waitlist: 0, soon: 1, later: 2, anytime: 3, booked: 4 };
    const list = data.tickets
      .filter((t) => ui.kindFilter === "all" || t.kind === ui.kindFilter)
      .map((t) => ({ t, s: bookingState(t, now) }))
      .sort((a, b) => (order[a.s.key] - order[b.s.key]) || ((a.s.at || 0) - (b.s.at || 0)) || a.t.date.localeCompare(b.t.date));
    const all = data.tickets.map((t) => ({ t, s: bookingState(t, now) }));
    const booked = all.filter((x) => x.s.key === "booked").length;
    const openN = all.filter((x) => x.s.key === "open" || x.s.key === "waitlist").length;
    const later = all.filter((x) => x.s.key === "soon" || x.s.key === "later").length;
    const anytime = all.filter((x) => x.s.key === "anytime").length;
    const total = data.tickets.reduce((a, t) => a + costOf(t), 0);
    return `<section class="view" aria-labelledby="h-tix">
      <div class="view-head">
        <div><h2 id="h-tix">Tickets and bookings</h2><p>Sorted by what to book first. Train bookings open 60 days ahead at 8 AM India time. Prices marked estimate need checking on IRCTC.</p></div>
        <div class="toolbar">
          <button class="btn" data-action="ics-bookings" type="button">Add booking reminders to my calendar</button>
          <button class="btn" data-action="add-ticket" type="button">Add a ticket</button>
        </div>
      </div>
      <div class="tix-summary">
        <div><b>${openN}</b><span>open now, not booked</span></div>
        <div><b>${later}</b><span>open later</span></div>
        <div><b>${anytime}</b><span>book any time</span></div>
        <div><b>${booked}</b><span>booked</span></div>
        <div><b>${money(total)}</b><span>all bookings for ${data.meta.defaultPeople}</span></div>
      </div>
      <div class="chips" role="group" aria-label="Show">${chips}</div>
      <div class="tix-list">${list.map(({ t, s }) => stub(t, s)).join("") || `<p class="hint">Nothing here yet.</p>`}</div>
    </section>`;
  }
  const KIND = { train: "Train", flight: "Flight", darshan: "Temple darshan", stay: "Stay", activity: "Activity" };
  function stub(t, s) {
    const trip = tripById(t.trip);
    const per = t.costType === "total" ? `${money(t.cost)} total` : `${money(t.cost)} × ${peopleFor(t)} = <b>${money(costOf(t))}</b>`;
    const est = t.costConfirmed ? "" : `<span class="est" title="${esc(t.costNote || "Estimate")}">estimate</span>`;
    const route = t.from && t.to
      ? `<div class="stub-route"><div class="end"><div class="t">${esc(t.dep || "")}</div><div class="p">${esc(t.from)}</div></div><span class="line" aria-hidden="true"></span><div class="end"><div class="t">${esc(t.arr || "")}</div><div class="p">${esc(t.to)}</div></div></div>`
      : `<div class="stub-facts"><span>Where</span> <b>${esc(t.from || "")}</b>${t.dep ? ` <span>Time</span> <b>${esc(t.dep)}</b>` : ""}</div>`;
    const links = (t.links || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("");
    return `<article class="stub ${s.cls}" id="ticket-${esc(t.id)}">
      <div class="stub-main">
        <div class="stub-top">
          ${t.number ? `<span class="stub-num">${esc(t.number)}</span>` : ""}
          <span class="stub-name">${esc(t.name)}</span>
          <span class="stub-kind">${esc(KIND[t.kind] || "")}, ${esc(fmtLongDay(t.date))}, ${esc(trip.name)}</span>
        </div>
        ${route}
        <div class="stub-facts">
          <span>Class <b>${esc(t.class || "")}</b></span>
          <span>Price ${per}${est}</span>
          ${t.alt ? `<span>${esc(t.alt)}</span>` : ""}
        </div>
        ${t.note ? `<p class="stub-note">${esc(t.note)}</p>` : ""}
        ${t.costNote && !t.costConfirmed ? `<p class="stub-note">Price: ${esc(t.costNote)}</p>` : ""}
        ${links ? `<div class="stub-links">${links}</div>` : ""}
      </div>
      <div class="stub-side">
        <div class="stub-state">${esc(s.label)}</div>
        ${s.at ? `<div class="stub-when">${s.key === "open" ? "Opened " : ""}${whenLines(s.at)}</div>` : ""}
        <label>Status
          <select data-status="${esc(t.id)}">
            <option value="todo"${t.status === "todo" ? " selected" : ""}>Not booked</option>
            <option value="waitlist"${t.status === "waitlist" ? " selected" : ""}>Waitlisted</option>
            <option value="booked"${t.status === "booked" ? " selected" : ""}>Booked</option>
          </select>
        </label>
        <label>PNR or booking ref
          <input data-pnr="${esc(t.id)}" value="${esc(t.pnr || "")}" inputmode="text" autocomplete="off" placeholder="Add after booking">
        </label>
        <button class="btn btn-small" data-edit-ticket="${esc(t.id)}" type="button">Edit</button>
      </div>
    </article>`;
  }

  // ---------- to-do ----------
  function viewTodo() {
    const owners = ["all"].concat(data.people);
    const chips = owners.map((o) => `<button class="chip" data-owner="${esc(o)}" aria-pressed="${ui.ownerFilter === o}" type="button">${o === "all" ? "Everyone's list" : esc(o)}</button>`).join("");
    const today = parseDay(isoDay(new Date()));
    const mine = (x) => ui.ownerFilter === "all" || x.owner === ui.ownerFilter || x.owner === "Everyone";
    const todos = data.todos.filter(mine).slice().sort((a, b) => (a.due || "9").localeCompare(b.due || "9"));
    const open = todos.filter((x) => !x.done);
    const done = todos.filter((x) => x.done);
    const late = open.filter((x) => x.due && parseDay(x.due) < today);
    const week = open.filter((x) => x.due && parseDay(x.due) >= today && parseDay(x.due) <= addDays(today, 7));
    const laterL = open.filter((x) => !late.includes(x) && !week.includes(x));
    const now = new Date();
    const auto = data.tickets.map((t) => ({ t, s: bookingState(t, now) })).filter((x) => x.s.key !== "booked")
      .sort((a, b) => (a.s.at || 0) - (b.s.at || 0));
    const autoRows = auto.map(({ t, s }) => {
      const when = s.at ? (s.key === "open" ? `Opened ${fmtIST(s.at)} IST` : `Opens ${fmtIST(s.at)} IST`) : "Book any time";
      return `<div class="todo is-auto"><input type="checkbox" data-ticket-done="${esc(t.id)}" aria-label="Mark ${esc(t.name)} as booked"><div class="todo-text"><span>Book ${esc(t.number ? t.number + ", " : "")}${esc(shortRoute(t) || t.name)} for ${esc(fmtDay(t.date))}</span><div class="todo-meta"><span class="${s.key === "open" ? "late" : ""}">${esc(when)}</span></div></div><a class="btn btn-small" href="#tickets" data-ticket="${esc(t.id)}">Ticket</a></div>`;
    }).join("");
    const group = (title, items, sub) => items.length ? `<div class="todo-group"><h3>${title}${sub ? ` <small>${sub}</small>` : ""}</h3>${items.map(todoRow).join("")}</div>` : "";
    const ownerOpts = data.people.map((p) => `<option>${esc(p)}</option>`).join("");
    return `<section class="view" aria-labelledby="h-todo">
      <div class="view-head">
        <div><h2 id="h-todo">To-do</h2><p>Who does what, and by when. Tickets that aren't booked show up here on their own.</p></div>
        <div class="toolbar"><button class="btn" data-action="people" type="button">Edit names</button></div>
      </div>
      <form class="todo-add" id="todo-add">
        <label class="field grow"><span>New to-do</span><input id="todo-text" required placeholder="For example: buy power banks for the trains"></label>
        <label class="field"><span>Who</span><select id="todo-owner">${ownerOpts}</select></label>
        <label class="field"><span>By</span><input id="todo-due" type="date"></label>
        <button class="btn btn-primary" type="submit">Add</button>
      </form>
      <div class="chips" role="group" aria-label="Whose list">${chips}</div>
      ${group("Overdue", late, `${late.length}`)}
      ${group("This week", week, `${week.length}`)}
      ${group("Coming up", laterL, `${laterL.length}`)}
      ${autoRows ? `<div class="todo-group"><h3>Tickets to book <small>${auto.length}</small></h3>${autoRows}</div>` : ""}
      ${done.length ? `<div class="todo-group"><h3>Done <small>${done.length}</small></h3>${ui.showDone ? done.map(todoRow).join("") : `<button class="btn btn-small" data-action="show-done" type="button">Show done items</button>`}</div>` : ""}
    </section>`;
  }
  function todoRow(x) {
    const today = parseDay(isoDay(new Date()));
    const late = !x.done && x.due && parseDay(x.due) < today;
    return `<div class="todo${x.done ? " is-done" : ""}">
      <input type="checkbox" data-todo="${esc(x.id)}" ${x.done ? "checked" : ""} aria-label="Done: ${esc(x.text)}">
      <div class="todo-text"><span>${esc(x.text)}</span>
        <div class="todo-meta"><span>${esc(x.owner || "Anyone")}</span>${x.due ? `<span class="${late ? "late" : ""}">${late ? "Was due " : "By "}${esc(fmtDay(x.due))}</span>` : ""}${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">Open link</a>` : ""}</div>
      </div>
      <button class="btn btn-small" data-edit-todo="${esc(x.id)}" type="button">Edit</button>
    </div>`;
  }

  // ---------- budget ----------
  function viewBudget() {
    const rate = Number(data.meta.usdRate) || 88;
    const n = Number(data.meta.defaultPeople) || 1;
    let rows = "", grand = 0, confirmed = 0;
    data.trips.forEach((trip) => {
      const tix = data.tickets.filter((t) => t.trip === trip.id);
      const ex = data.extras.filter((x) => x.trip === trip.id);
      if (!tix.length && !ex.length) return;
      let sub = 0, lines = "";
      tix.forEach((t) => {
        const c = costOf(t); sub += c; if (t.costConfirmed) confirmed += c;
        lines += `<tr><td>${esc(t.number ? t.number + " " : "")}${esc(t.name)}${t.costConfirmed ? "" : ` <span class="est">estimate</span>`}</td><td>${esc(fmtDay(t.date))}</td><td class="num">${t.costType === "total" ? "total" : money(t.cost) + " × " + peopleFor(t)}</td><td class="num">${money(c)}</td></tr>`;
      });
      ex.forEach((x) => {
        const c = x.costType === "total" ? Number(x.cost) || 0 : (Number(x.cost) || 0) * n; sub += c;
        lines += `<tr><td><button class="btn-link" data-edit-extra="${esc(x.id)}" type="button">${esc(x.label)}</button> <span class="est">estimate</span></td><td></td><td class="num">${x.costType === "total" ? "total" : money(x.cost) + " × " + n}</td><td class="num">${money(c)}</td></tr>`;
      });
      grand += sub;
      rows += `<tr class="trip-row"><td colspan="3"><i class="swatch" style="background:${esc(trip.color)};display:inline-block;margin-right:8px"></i>${esc(trip.name)}</td><td class="num">${money(sub)}</td></tr>${lines}`;
    });
    const fixed = data.meta.rateMode === "fixed";
    return `<section class="view" aria-labelledby="h-budget">
      <div class="view-head">
        <div><h2 id="h-budget">Budget</h2><p>Ticket prices come from the Tickets tab. Change the number of people or a price and everything updates. International flights and Aarav Villa aren't included.</p></div>
        <div class="toolbar"><button class="btn" data-action="add-extra" type="button">Add a cost</button></div>
      </div>
      <div class="budget-controls">
        <label class="field"><span>People</span><input id="b-people" type="number" min="1" max="60" value="${n}" style="width:110px"></label>
        <label class="field"><span>Exchange rate</span><select id="b-mode"><option value="live"${fixed ? "" : " selected"}>Live rate</option><option value="fixed"${fixed ? " selected" : ""}>My own rate</option></select></label>
        ${fixed ? `<label class="field"><span>Rupees per dollar</span><input id="b-rate" type="number" min="1" step="0.01" value="${rate}" style="width:140px"></label>` : ""}
      </div>
      <p class="hint" id="rate-line">${rateLine()}</p>
      <div class="budget-big">
        <div>${money(grand)} <span>in total</span></div>
        <div>${money(grand / n)} <span>per person</span></div>
      </div>
      <p class="hint">${money(confirmed)} of this is confirmed prices. The rest are estimates until you book. Tap any price to flip it between rupees and dollars.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>What</th><th>When</th><th class="num">Price</th><th class="num">Cost</th></tr></thead>
        <tbody>${rows}<tr class="total-row"><td colspan="3">Total</td><td class="num">${money(grand)}</td></tr></tbody>
      </table></div>
    </section>`;
  }

  // ---------- good to know ----------
  function viewInfo() {
    return `<section class="view" aria-labelledby="h-info">
      <div class="view-head"><div><h2 id="h-info">Good to know</h2><p>Booking rules and links for trains, Vande Bharat and temples.</p></div></div>
      <div class="info-grid">
        <div class="info"><h3>When train bookings open</h3><ul>
          <li>60 days before the train starts its run, not counting the travel day, at 8:00 AM India time.</li>
          <li>For a train that started its run a day or more before you board, the window follows its start date, so it opens earlier. The Tickets tab already does this math.</li>
          <li>From the US, 8:00 AM India time is 9:30 PM the night before in New York (after Nov 1).</li>
          <li>Tatkal opens one day before travel: 10 AM for AC classes, 11 AM for sleeper. It costs more and allows only 4 people per booking.</li>
        </ul></div>
        <div class="info"><h3>Booking for 15 people</h3><ul>
          <li>One booking (PNR) holds up to 6 people, so 15 people needs 3 bookings per train.</li>
          <li>Use 3 IRCTC accounts and have all 3 people logged in before 8 AM on opening day. Save every traveller in each account's master list first.</li>
          <li>Link Aadhaar to each IRCTC account. Tatkal needs it, and Aadhaar-linked accounts get priority on opening day.</li>
          <li>Waitlisted tickets can't board sleeper or AC coaches any more. If a booking stays waitlisted, change plans before the chart is prepared.</li>
        </ul></div>
        <div class="info"><h3>Which class to pick</h3><ul>
          <li><b>3A</b> (AC 3-tier) for overnight trains: bedding included, comfortable for elders.</li>
          <li><b>SL</b> (sleeper) for short day trains: about a third of the 3A price, no AC.</li>
          <li><b>CC</b> (AC chair car) on Vande Bharat and Intercity trains. <b>EC</b> is the bigger executive seat.</li>
          <li>Vande Bharat fares can include meals. You can switch meals off when booking.</li>
        </ul></div>
        <div class="info"><h3>Tirumala darshan</h3><ul>
          <li>Book only on the official TTD site: <a href="https://ttdevasthanams.ap.gov.in/" target="_blank" rel="noopener">ttdevasthanams.ap.gov.in</a>.</li>
          <li>January 2027 ₹300 tickets opened Oct 24, 2026 at 10 AM IST. Rooms opened the same day at 3 PM.</li>
          <li>Elders 65+ and differently abled devotees have a separate quota.</li>
          <li>Carry the same photo ID used to book. Traditional dress is required.</li>
        </ul></div>
        <div class="info"><h3>Useful links</h3><ul>
          <li><a href="https://www.irctc.co.in/" target="_blank" rel="noopener">IRCTC</a> to book trains</li>
          <li><a href="https://www.railmitra.com/" target="_blank" rel="noopener">RailMitra</a> and <a href="https://www.ixigo.com/trains" target="_blank" rel="noopener">ixigo</a> for timetables, fares and seat availability</li>
          <li><a href="https://www.goindigo.in/" target="_blank" rel="noopener">IndiGo</a> and <a href="https://www.akasaair.com/" target="_blank" rel="noopener">Akasa Air</a> for Rajasthan flights</li>
          <li><a href="https://srsmatha.org/" target="_blank" rel="noopener">Sri Raghavendra Swamy Mutt</a> for Mantralayam rooms</li>
        </ul></div>
        <div class="info"><h3>How editing works</h3><ul>
          <li>Anyone can change anything here. Your changes stay on your device until you share them.</li>
          <li><b>Share and save</b> lets you send a link with your changes, save a file, or save to GitHub so everyone sees them.</li>
          <li>Saving to GitHub needs a one-time access key. Surya can set that up for family who edit often.</li>
        </ul></div>
      </div>
    </section>`;
  }

  // ---------- event wiring ----------
  function bindView() {
    const main = $("#main");
    main.onclick = (e) => {
      const el = e.target.closest("[data-day],[data-edit-day],[data-trip],[data-kind],[data-owner],[data-edit-ticket],[data-edit-todo],[data-edit-extra],[data-action],[data-ticket]");
      if (!el) return;
      if (el.dataset.ticket) { e.preventDefault(); goTicket(el.dataset.ticket); return; }
      if (el.dataset.day) return openDay(el.dataset.day);
      if (el.dataset.editDay) return editDay(el.dataset.editDay);
      if (el.dataset.trip) { ui.tripFilter = el.dataset.trip; return render(); }
      if (el.dataset.kind) { ui.kindFilter = el.dataset.kind; return render(); }
      if (el.dataset.owner) { ui.ownerFilter = el.dataset.owner; return render(); }
      if (el.dataset.editTicket) return editTicket(el.dataset.editTicket);
      if (el.dataset.editTodo) return editTodo(el.dataset.editTodo);
      if (el.dataset.editExtra) return editExtra(el.dataset.editExtra);
      const a = el.dataset.action;
      if (a === "add-day") return editDay(null);
      if (a === "add-ticket") return editTicket(null);
      if (a === "add-extra") return editExtra(null);
      if (a === "people") return editPeople();
      if (a === "print") return window.print();
      if (a === "show-done") { ui.showDone = true; return render(); }
      if (a === "ics-trip") return downloadICS("trip");
      if (a === "ics-bookings") return downloadICS("bookings");
    };
    main.onchange = (e) => {
      const t = e.target;
      if (t.dataset.status) commit((d) => { d.tickets.find((x) => x.id === t.dataset.status).status = t.value; }, t.value === "booked" ? "Marked as booked" : "Status updated");
      else if (t.dataset.pnr !== undefined && t.dataset.pnr) commit((d) => { const k = d.tickets.find((x) => x.id === t.dataset.pnr); k.pnr = t.value.trim(); if (k.pnr && k.status === "todo") k.status = "booked"; }, "Saved the PNR");
      else if (t.dataset.todo) commit((d) => { d.todos.find((x) => x.id === t.dataset.todo).done = t.checked; }, t.checked ? "Done" : "Marked not done");
      else if (t.dataset.ticketDone) commit((d) => { d.tickets.find((x) => x.id === t.dataset.ticketDone).status = "booked"; }, "Marked as booked");
      else if (t.id === "b-people") commit((d) => { d.meta.defaultPeople = Math.max(1, Number(t.value) || 1); });
      else if (t.id === "b-rate") commit((d) => { d.meta.usdRate = Math.max(1, Number(t.value) || 95); });
      else if (t.id === "b-mode") commit((d) => { d.meta.rateMode = t.value; if (t.value === "fixed") d.meta.usdRate = Math.round(rate() * 100) / 100; });
    };
    const f = $("#todo-add");
    if (f) f.onsubmit = (e) => {
      e.preventDefault();
      const text = $("#todo-text").value.trim();
      if (!text) { $("#todo-text").focus(); return; }
      commit((d) => d.todos.push({ id: uid("d"), text, owner: $("#todo-owner").value, due: $("#todo-due").value || "", done: false }), "Added to the list");
    };
  }
  function goTicket(id) {
    ui.kindFilter = "all"; view = "tickets"; store.set("view", view); render();
    const el = document.getElementById("ticket-" + id);
    if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("is-flash"); }
  }

  // ---------- dialogs ----------
  const dlg = $("#dialog"), form = $("#dialog-form");
  function openDialog(title, sub, body, actions) {
    form.innerHTML = `<div class="dlg-head"><div><h2 id="dialog-title">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div><button class="x" value="cancel" aria-label="Close" type="submit" formnovalidate>×</button></div>
      <div class="dlg-body">${body}</div>
      <div class="dlg-foot">${actions}</div>`;
    if (!dlg.open) dlg.showModal();
    const first = form.querySelector(".dlg-body input, .dlg-body select, .dlg-body textarea, .dlg-body button");
    if (first) first.focus();
  }
  const closeDialog = () => dlg.open && dlg.close();
  const field = (label, name, value, type = "text", extra = "") => `<label class="field"><span>${esc(label)}</span><input name="${name}" type="${type}" value="${esc(value == null ? "" : value)}" ${extra}></label>`;
  const area = (label, name, value, hint = "") => `<label class="field"><span>${esc(label)}</span><textarea name="${name}">${esc(value || "")}</textarea>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</label>`;
  const select = (label, name, value, opts) => `<label class="field"><span>${esc(label)}</span><select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const tripOpts = () => data.trips.map((t) => [t.id, t.name]);
  const fv = (name) => { const el = form.elements[name]; return el ? (el.type === "checkbox" ? el.checked : el.value.trim()) : ""; };

  function openDay(iso) {
    const d = data.days.find((x) => x.date === iso);
    if (!d) return;
    const trip = tripById(d.trip);
    const tix = data.tickets.filter((t) => t.date === iso);
    const steps = (d.steps || []).map((s) => `<li class="step${s.booking ? " is-booking" : ""}"><span class="step-t">${esc(s.time)}</span><span class="step-x">${s.ref ? `<span class="ref">${esc(s.ref)}</span>` : ""}${esc(s.text)}${s.alt ? `<span class="step-alt">${esc(s.alt)}</span>` : ""}</span></li>`).join("");
    const tixList = tix.length ? `<div class="share-block"><h3>Bookings this day</h3>${tix.map((t) => { const s = bookingState(t); return `<p><button class="btn-link" type="button" data-goticket="${esc(t.id)}">${esc(t.number ? t.number + " " : "")}${esc(t.name)}</button>: ${esc(s.label)}</p>`; }).join("")}</div>` : "";
    openDialog(d.place, `${fmtLongDay(iso)}, ${trip.name}`,
      `${steps ? `<ol class="steps" style="padding:0">${steps}</ol>` : `<p>${esc(d.summary || "Nothing planned yet.")}</p>`}${d.note ? `<p class="hint">${esc(d.note)}</p>` : ""}${tixList}`,
      `<button class="btn" type="button" data-dlg="see-days">Open in day by day</button><div class="right"><button class="btn btn-primary" type="button" data-dlg="edit">Edit this day</button></div>`);
    form.onclick = (e) => {
      const b = e.target.closest("[data-dlg],[data-goticket]");
      if (!b) return;
      if (b.dataset.goticket) { closeDialog(); goTicket(b.dataset.goticket); }
      else if (b.dataset.dlg === "edit") editDay(iso);
      else if (b.dataset.dlg === "see-days") { closeDialog(); ui.tripFilter = "all"; view = "days"; store.set("view", view); render(); const c = document.getElementById("day-" + iso); if (c) { c.scrollIntoView({ block: "start" }); c.classList.add("is-flash"); } }
    };
  }

  function stepRow(s = {}) {
    return `<div class="step-edit"><input aria-label="Time" placeholder="Time" data-s="time" value="${esc(s.time || "")}"><input aria-label="What happens" placeholder="What happens" data-s="text" value="${esc(s.text || "")}"><input class="ref-in" aria-label="Train or flight number" placeholder="Train no." data-s="ref" value="${esc(s.ref || "")}"><button class="btn btn-small btn-danger" type="button" data-rm-step aria-label="Remove this line">Remove</button><input type="hidden" data-s="alt" value="${esc(s.alt || "")}"><input type="hidden" data-s="booking" value="${s.booking ? "1" : ""}"></div>`;
  }
  function editDay(iso) {
    const d = iso ? data.days.find((x) => x.date === iso) : { date: "", trip: "home", place: "", summary: "", steps: [], note: "" };
    openDialog(iso ? "Edit day" : "Add a day", iso ? fmtLongDay(iso) : "Pick a date inside the trip",
      `<div class="field-row">${field("Date", "date", d.date, "date", `min="${data.meta.start}" max="${data.meta.end}" required`)}${select("Part of", "trip", d.trip, tripOpts())}</div>
       ${field("Where", "place", d.place, "text", 'required placeholder="For example: Salem → Trichy"')}
       ${field("Short summary for the calendar", "summary", d.summary)}
       <div class="field"><span>Timings</span><div id="steps-edit" style="display:grid;gap:6px">${(d.steps || []).map(stepRow).join("")}</div><button class="btn btn-small" type="button" data-add-step style="justify-self:start;margin-top:6px">Add a line</button><span class="hint">Put a train or flight number in the last box and it links to that ticket.</span></div>
       ${area("Note", "note", d.note)}`,
      `${iso ? `<button class="btn btn-danger" type="button" data-dlg="delete">Clear this day</button>` : ""}<div class="right"><button class="btn" type="submit" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" type="button" data-dlg="save">Save day</button></div>`);
    form.onclick = (e) => {
      if (e.target.closest("[data-add-step]")) { $("#steps-edit").insertAdjacentHTML("beforeend", stepRow()); $("#steps-edit").lastElementChild.querySelector("input").focus(); return; }
      if (e.target.closest("[data-rm-step]")) { e.target.closest(".step-edit").remove(); return; }
      const b = e.target.closest("[data-dlg]"); if (!b) return;
      if (b.dataset.dlg === "delete") {
        commit((x) => { const k = x.days.find((y) => y.date === iso); k.place = tripById(k.trip).name; k.summary = ""; k.steps = []; k.note = ""; }, "Day cleared");
        return closeDialog();
      }
      const date = fv("date"), place = fv("place");
      if (!date || !place) { toast(!date ? "Pick a date first" : "Add where you'll be"); return; }
      const steps = $$("#steps-edit .step-edit").map((row) => {
        const g = (k) => row.querySelector(`[data-s="${k}"]`).value.trim();
        const s = { time: g("time"), text: g("text") };
        if (g("ref")) s.ref = g("ref"); if (g("alt")) s.alt = g("alt"); if (g("booking") || g("ref")) s.booking = !!(g("booking") || g("ref"));
        return s;
      }).filter((s) => s.text);
      commit((x) => {
        if (iso && iso !== date) x.days = x.days.filter((y) => y.date !== iso);
        let k = x.days.find((y) => y.date === date);
        if (!k) { k = { date }; x.days.push(k); }
        Object.assign(k, { trip: fv("trip"), place, summary: fv("summary"), steps, note: fv("note") });
        x.days.sort((a, b2) => a.date.localeCompare(b2.date));
        if (date < x.meta.start) x.meta.start = date; if (date > x.meta.end) x.meta.end = date;
      }, "Day saved");
      closeDialog();
    };
  }

  function editTicket(id) {
    const t = id ? data.tickets.find((x) => x.id === id) : { id: "", kind: "train", trip: "home", date: data.meta.start, number: "", name: "", from: "", to: "", dep: "", arr: "", class: "3A", cost: 0, costType: "perPerson", costConfirmed: false, costNote: "", status: "todo", pnr: "", note: "", links: [] };
    const opensMode = t.opensAt === "now" ? "now" : t.opensAt ? "date" : "auto";
    const linksTxt = (t.links || []).map((l) => `${l.label} | ${l.url}`).join("\n");
    openDialog(id ? "Edit ticket" : "Add a ticket", id ? `${t.number || ""} ${t.name}`.trim() : "Train, flight, stay, darshan or activity",
      `<div class="field-row">${select("Type", "kind", t.kind, [["train", "Train"], ["flight", "Flight"], ["darshan", "Darshan"], ["stay", "Stay"], ["activity", "Activity"]])}${select("Part of", "trip", t.trip, tripOpts())}${field("Date", "date", t.date, "date", "required")}</div>
       <div class="field-row">${field("Train or flight number", "number", t.number)}${field("Name", "name", t.name, "text", "required")}</div>
       <div class="field-row">${field("From", "from", t.from)}${field("Leaves", "dep", t.dep, "text", 'placeholder="20:55"')}</div>
       <div class="field-row">${field("To", "to", t.to)}${field("Arrives", "arr", t.arr, "text", 'placeholder="10:40 +1"')}</div>
       <div class="field-row">${field("Class or room", "class", t.class)}${field("Price (₹)", "cost", t.cost, "number", 'min="0" step="1"')}${select("Price is", "costType", t.costType, [["perPerson", "Per person"], ["total", "Total"]])}${field("People (blank = everyone)", "people", t.people || "", "number", 'min="1"')}</div>
       <label class="check"><input type="checkbox" name="costConfirmed" ${t.costConfirmed ? "checked" : ""}> Price is confirmed (not an estimate)</label>
       ${field("Where the price came from", "costNote", t.costNote)}
       <div class="field-row">${select("Booking opens", "opensMode", opensMode, [["auto", "Train rule: 60 days before"], ["now", "Already open"], ["date", "On a set date"]])}${field("Train starts its run on (if earlier)", "originDate", t.originDate || "", "date")}${field("Set date and time (India)", "opensAt", opensMode === "date" ? toISTInput(t.opensAt) : "", "datetime-local")}</div>
       <div class="field-row">${select("Status", "status", t.status, [["todo", "Not booked"], ["waitlist", "Waitlisted"], ["booked", "Booked"]])}${field("PNR or booking ref", "pnr", t.pnr)}</div>
       ${field("Other options", "alt", t.alt || "")}
       ${area("Note", "note", t.note)}
       ${area("Links", "links", linksTxt, "One per line: label | https://link")}`,
      `${id ? `<button class="btn btn-danger" type="button" data-dlg="delete">Delete ticket</button>` : ""}<div class="right"><button class="btn" type="submit" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" type="button" data-dlg="save">Save ticket</button></div>`);
    form.onclick = (e) => {
      const b = e.target.closest("[data-dlg]"); if (!b) return;
      if (b.dataset.dlg === "delete") { if (!confirmInline(b, "Click again to delete")) return; commit((x) => { x.tickets = x.tickets.filter((y) => y.id !== id); }, "Ticket deleted"); return closeDialog(); }
      if (!fv("name") || !fv("date")) { toast("Add a name and a date"); return; }
      const mode = fv("opensMode");
      const next = {
        id: id || uid("t"), kind: fv("kind"), trip: fv("trip"), date: fv("date"), number: fv("number"), name: fv("name"),
        from: fv("from"), to: fv("to"), dep: fv("dep"), arr: fv("arr"), class: fv("class"),
        cost: Number(fv("cost")) || 0, costType: fv("costType"), costConfirmed: fv("costConfirmed"), costNote: fv("costNote"),
        status: fv("status"), pnr: fv("pnr"), note: fv("note"), alt: fv("alt"),
        links: fv("links").split("\n").map((l) => l.split("|").map((p) => p.trim())).filter((p) => p[1] && /^https?:\/\//.test(p[1])).map(([label, url]) => ({ label: label || "Link", url })),
      };
      if (fv("people")) next.people = Number(fv("people"));
      if (fv("originDate")) next.originDate = fv("originDate");
      if (mode === "now") next.opensAt = "now";
      if (mode === "date" && fv("opensAt")) next.opensAt = fv("opensAt") + ":00+05:30";
      if (!next.alt) delete next.alt;
      commit((x) => { const i = x.tickets.findIndex((y) => y.id === next.id); if (i >= 0) x.tickets[i] = next; else x.tickets.push(next); }, "Ticket saved");
      closeDialog();
    };
  }
  const toISTInput = (iso) => { if (!iso || iso === "now") return ""; const d = new Date(iso); const p = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d); const g = (t) => p.find((x) => x.type === t).value; return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`; };
  function confirmInline(btn, msg) { if (btn.dataset.armed) return true; btn.dataset.armed = "1"; btn.textContent = msg; setTimeout(() => { delete btn.dataset.armed; }, 4000); return false; }

  function editTodo(id) {
    const x = data.todos.find((t) => t.id === id);
    openDialog("Edit to-do", "", `${field("What", "text", x.text, "text", "required")}<div class="field-row">${select("Who", "owner", x.owner, data.people.map((p) => [p, p]))}${field("By", "due", x.due, "date")}</div>${field("Link (optional)", "link", x.link || "", "url")}<label class="check"><input type="checkbox" name="done" ${x.done ? "checked" : ""}> Done</label>`,
      `<button class="btn btn-danger" type="button" data-dlg="delete">Delete</button><div class="right"><button class="btn" type="submit" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" type="button" data-dlg="save">Save</button></div>`);
    form.onclick = (e) => {
      const b = e.target.closest("[data-dlg]"); if (!b) return;
      if (b.dataset.dlg === "delete") { if (!confirmInline(b, "Click again to delete")) return; commit((d) => { d.todos = d.todos.filter((t) => t.id !== id); }, "Deleted"); return closeDialog(); }
      if (!fv("text")) { toast("Write what needs doing"); return; }
      commit((d) => { Object.assign(d.todos.find((t) => t.id === id), { text: fv("text"), owner: fv("owner"), due: fv("due"), link: fv("link"), done: fv("done") }); }, "Saved");
      closeDialog();
    };
  }

  function editExtra(id) {
    const x = id ? data.extras.find((t) => t.id === id) : { id: "", trip: "home", label: "", cost: 0, costType: "perPerson" };
    openDialog(id ? "Edit cost" : "Add a cost", "Food, local transport, gifts, anything without a ticket",
      `${field("What", "label", x.label, "text", "required")}<div class="field-row">${select("Part of", "trip", x.trip, tripOpts())}${field("Amount (₹)", "cost", x.cost, "number", 'min="0"')}${select("Amount is", "costType", x.costType, [["perPerson", "Per person"], ["total", "Total"]])}</div>`,
      `${id ? `<button class="btn btn-danger" type="button" data-dlg="delete">Delete</button>` : ""}<div class="right"><button class="btn" type="submit" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" type="button" data-dlg="save">Save</button></div>`);
    form.onclick = (e) => {
      const b = e.target.closest("[data-dlg]"); if (!b) return;
      if (b.dataset.dlg === "delete") { commit((d) => { d.extras = d.extras.filter((t) => t.id !== id); }, "Deleted"); return closeDialog(); }
      if (!fv("label")) { toast("Name the cost"); return; }
      const next = { id: id || uid("x"), trip: fv("trip"), label: fv("label"), cost: Number(fv("cost")) || 0, costType: fv("costType") };
      commit((d) => { const i = d.extras.findIndex((t) => t.id === next.id); if (i >= 0) d.extras[i] = next; else d.extras.push(next); }, "Saved");
      closeDialog();
    };
  }

  function editPeople() {
    openDialog("Names for the to-do list", "One per line. Keep \"Everyone\" for jobs the whole family shares.", area("Names", "people", data.people.join("\n")),
      `<div class="right"><button class="btn" type="submit" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" type="button" data-dlg="save">Save names</button></div>`);
    form.onclick = (e) => {
      if (!e.target.closest("[data-dlg]")) return;
      const list = fv("people").split("\n").map((s) => s.trim()).filter(Boolean);
      if (!list.length) { toast("Add at least one name"); return; }
      commit((d) => { d.people = Array.from(new Set(list)); }, "Names saved");
      closeDialog();
    };
  }

  // ---------- share and save ----------
  function openShare() {
    const repo = repoInfo();
    const name = store.get("name") || "";
    const hasToken = !!store.get("token");
    openDialog("Share and save", dirty() ? "You have edits that only you can see right now." : "Everyone is looking at the same plan.",
      `<div class="share-block"><h3>Save for everyone</h3>
        <p>Writes your version to GitHub. The site updates for everyone in about a minute.</p>
        <div class="field-row">${field("Your name", "who", name, "text", 'placeholder="Shows who saved it"')}${field("GitHub repository", "repo", repo, "text", 'placeholder="owner/repo"')}</div>
        ${hasToken ? `<p class="hint">An access key is saved on this device. <button class="btn-link" type="button" data-dlg="forget">Remove it</button></p>` : `${field("GitHub access key", "token", "", "password", 'autocomplete="off" placeholder="github_pat_..."')}<p class="hint">One-time setup. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Create a fine-grained key</a> for this repository only, with Contents set to Read and write. It stays on this device.</p>`}
        <div class="toolbar"><button class="btn btn-primary" type="button" data-dlg="github">Save for everyone</button></div>
      </div>
      <div class="share-block"><h3>Send a link with your changes</h3>
        <p>Anyone who opens the link sees your version and can keep editing it. Nothing changes for others until someone saves for everyone.</p>
        <div class="toolbar"><button class="btn" type="button" data-dlg="link">Copy link</button></div>
      </div>
      <div class="share-block"><h3>Keep a copy</h3>
        <p>Download the whole plan as a file, or load one someone sent you.</p>
        <div class="toolbar"><button class="btn" type="button" data-dlg="download">Download plan file</button><label class="btn" for="file-in">Load a plan file</label><input id="file-in" type="file" accept="application/json,.json" hidden></div>
      </div>
      ${dirty() ? `<div class="share-block"><h3>Undo my edits</h3><p>Go back to the version everyone sees. This can't be undone.</p><div class="toolbar"><button class="btn btn-danger" type="button" data-dlg="discard">Discard my edits</button></div></div>` : ""}`,
      `<div class="right"><button class="btn" type="submit" value="cancel" formnovalidate>Done</button></div>`);
    form.onclick = async (e) => {
      const b = e.target.closest("[data-dlg]"); if (!b) return;
      const act = b.dataset.dlg;
      if (act === "forget") { store.del("token"); openShare(); toast("Access key removed from this device"); }
      if (act === "link") copyLink();
      if (act === "download") { download("india-itinerary-2027.json", JSON.stringify(data, null, 1), "application/json"); toast("Plan file downloaded"); }
      if (act === "discard") { if (!confirmInline(b, "Click again to discard")) return; discard(); closeDialog(); toast("Back to the shared plan"); }
      if (act === "github") saveToGitHub(b);
    };
    $("#file-in").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { const j = JSON.parse(await f.text()); if (!j.days || !j.tickets) throw new Error("not a plan file"); commit((d) => { Object.keys(d).forEach((k) => delete d[k]); Object.assign(d, j); }, "Plan file loaded"); closeDialog(); }
      catch (err) { toast("That file isn't a plan file from this site"); }
    };
  }
  function repoInfo() {
    const saved = store.get("repo");
    if (saved) return saved;
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    const seg = location.pathname.split("/").filter(Boolean)[0];
    if (m && seg) return `${m[1]}/${seg}`;
    return data.meta.repo || "";
  }
  const b64utf8 = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); };
  const unb64utf8 = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
  async function saveToGitHub(btn, force) {
    const who = fv("who"), repo = fv("repo");
    const token = store.get("token") || fv("token");
    if (!who) { toast("Add your name first"); return; }
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { toast("Repository should look like owner/repo"); return; }
    if (!token) { toast("Paste a GitHub access key first"); return; }
    store.set("name", who); store.set("repo", repo);
    const api = `https://api.github.com/repos/${repo}/contents/data/trip.json`;
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const cur = await fetch(api + "?ref=main&t=" + Date.now(), { headers, cache: "no-store" });
      if (cur.status === 401 || cur.status === 403) throw new Error("GitHub didn't accept the access key. Check it has Contents: Read and write for " + repo + ".");
      if (!cur.ok) throw new Error("Couldn't reach " + repo + " (GitHub said " + cur.status + "). Check the repository name.");
      const curJson = await cur.json();
      const remote = JSON.parse(unb64utf8(curJson.content));
      if (!force && remote.meta && pub.meta && remote.meta.updated !== pub.meta.updated) {
        btn.disabled = false; btn.textContent = "Save over their version";
        toast(`${remote.meta.updatedBy || "Someone"} saved a newer version. Press again to replace it, or discard your edits to load theirs.`);
        btn.onclick = () => saveToGitHub(btn, true);
        return;
      }
      const next = clone(data);
      next.meta.updated = new Date().toISOString();
      next.meta.updatedBy = who;
      const body = { message: `Update trip plan (${who})`, content: b64utf8(JSON.stringify(next, null, 1) + "\n"), sha: curJson.sha, branch: "main" };
      const put = await fetch(api, { method: "PUT", headers, body: JSON.stringify(body) });
      if (!put.ok) throw new Error("GitHub didn't save it (" + put.status + "). Try again in a minute.");
      store.set("token", token);
      data = next; pub = clone(next); store.del("draft"); store.del("draftBase");
      closeDialog(); render(); hideBanner();
      toast("Saved for everyone. The site updates in about a minute.");
    } catch (err) {
      btn.disabled = false; btn.textContent = "Save for everyone";
      toast(err.message || "Couldn't save to GitHub");
    }
  }

  async function copyLink() {
    const enc = await encodePlan(data);
    const url = location.origin + location.pathname + "#plan=" + enc;
    try { await navigator.clipboard.writeText(url); toast("Link copied. Paste it in WhatsApp or email."); }
    catch (e) { openDialog("Copy this link", "Your browser blocked automatic copying.", `<label class="field"><span>Link</span><textarea readonly>${esc(url)}</textarea></label>`, `<div class="right"><button class="btn" type="submit" value="cancel">Done</button></div>`); form.querySelector("textarea").select(); }
  }
  const b64url = (bytes) => { let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  async function encodePlan(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === "undefined") return "j" + b64url(raw);
    const buf = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
    return "z" + b64url(new Uint8Array(buf));
  }
  async function readPlanFromHash() {
    const m = location.hash.match(/^#plan=([zj])([\w-]+)$/);
    if (!m) return null;
    try {
      let bytes = unb64url(m[2]);
      if (m[1] === "z") bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      const obj = JSON.parse(new TextDecoder().decode(bytes));
      return obj.days && obj.tickets ? obj : null;
    } catch (e) { toast("That shared link looks cut off. Ask for it again."); return null; }
  }

  // ---------- calendar files (.ics) ----------
  function downloadICS(which) {
    const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//India Itinerary 2027//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    const e = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
    const utc = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const stamp = utc(new Date());
    if (which === "trip") {
      data.days.forEach((d) => {
        const desc = (d.steps || []).map((s) => `${s.time ? s.time + "  " : ""}${s.ref ? s.ref + " " : ""}${s.text}`).join("\n") + (d.note ? "\n\n" + d.note : "");
        L.push("BEGIN:VEVENT", `UID:day-${d.date}@india-itinerary-2027`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${d.date.replace(/-/g, "")}`, `DTEND;VALUE=DATE:${isoDay(addDays(parseDay(d.date), 1)).replace(/-/g, "")}`, `SUMMARY:${e(d.place + (d.summary ? ": " + d.summary : ""))}`, `DESCRIPTION:${e(desc)}`, "TRANSP:TRANSPARENT", "END:VEVENT");
      });
    } else {
      data.tickets.forEach((t) => {
        const at = opensAt(t); if (!at || t.status === "booked" || at < new Date()) return;
        const end = new Date(+at + 30 * 60000);
        const url = (t.links && t.links[0] && t.links[0].url) || "https://www.irctc.co.in/";
        L.push("BEGIN:VEVENT", `UID:book-${t.id}@india-itinerary-2027`, `DTSTAMP:${stamp}`, `DTSTART:${utc(at)}`, `DTEND:${utc(end)}`,
          `SUMMARY:${e(`Book ${t.number ? t.number + " " : ""}${shortRoute(t) || t.name} (${fmtDay(t.date)})`)}`,
          `DESCRIPTION:${e(`Booking opens now for ${fmtLongDay(t.date)}. Class ${t.class}. ${peopleFor(t)} people, ${Math.ceil(peopleFor(t) / 6)} bookings of up to 6.\n${url}`)}`,
          "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Booking opens in 15 minutes", "TRIGGER:-PT15M", "END:VALARM", "END:VEVENT");
      });
    }
    L.push("END:VCALENDAR");
    const folded = L.map((line) => { let out = "", s = line; while (s.length > 74) { out += s.slice(0, 74) + "\r\n "; s = s.slice(74); } return out + s; }).join("\r\n");
    download(which === "trip" ? "india-trip-days.ics" : "india-trip-booking-reminders.ics", folded, "text/calendar");
    toast(which === "trip" ? "Calendar file downloaded. Open it to add the trip." : "Reminders downloaded. Open the file to add them.");
  }
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- banner and toast ----------
  function showBanner(text, actions) {
    const b = $("#banner");
    b.innerHTML = `<div class="wrap"><p>${esc(text)}</p>${actions.map(([l], i) => `<button class="btn btn-small" type="button" data-b="${i}">${esc(l)}</button>`).join("")}</div>`;
    b.hidden = false;
    b.onclick = (e) => { const x = e.target.closest("[data-b]"); if (x) actions[+x.dataset.b][1](); };
  }
  const hideBanner = () => { $("#banner").hidden = true; };
  let toastTimer;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3600); }

  // ---------- global wiring ----------
  $$(".tabs [role=tab]").forEach((b) => b.addEventListener("click", () => {
    view = b.dataset.view; store.set("view", view);
    history.replaceState(null, "", "#" + view);
    render();
    const top = $("#hero").offsetTop + $("#hero").offsetHeight;
    if (window.scrollY > top) window.scrollTo(0, top);
  }));
  $(".tabs-row").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const tabs = $$(".tabs [role=tab]"); const i = tabs.findIndex((t) => t.dataset.view === view);
    const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; n.click(); n.focus();
  });
  $("#hero").addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) { view = b.dataset.go; store.set("view", view); render(); } });
  $("#open-share").addEventListener("click", openShare);
  // tap one price to flip just that price; the switch in the header flips them all
  document.addEventListener("click", (e) => {
    const m = e.target.closest(".money");
    if (m) { e.stopPropagation(); m.dataset.cur = m.dataset.cur === "USD" ? "INR" : "USD"; m.textContent = fmtMoney(m.dataset.inr, m.dataset.cur); return; }
    const c = e.target.closest("[data-set-cur]");
    if (c) setCurrency(c.dataset.setCur);
  }, true);
  fetchRate();
  dlg.addEventListener("close", () => { form.onclick = null; });
  window.addEventListener("hashchange", async () => { if (location.hash.startsWith("#plan=")) { const p = await readPlanFromHash(); if (p) { data = p; store.set("draft", data); store.set("draftBase", pub.meta.updated); history.replaceState(null, "", location.pathname); render(); toast("Loaded the shared version"); } } });
  setInterval(() => { if (!dlg.open && data) renderHero(); }, 60000);

  load();
})();
