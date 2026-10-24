/* Trip globe: an orthographic globe drawn on canvas with d3-geo.
   Drag to spin, scroll or pinch to zoom, tap a leg to fly to it, or play the whole trip. */
(function () {
  "use strict";
  const ATLAS = "assets/vendor/countries-50m.json";
  const EARTH_KM = 6371;
  const INDIA_ID = "356";
  let atlasPromise = null;

  function loadAtlas() {
    if (!atlasPromise) {
      atlasPromise = fetch(ATLAS).then((r) => { if (!r.ok) throw new Error("map " + r.status); return r.json(); }).then((world) => ({
        land: topojson.feature(world, world.objects.land),
        borders: topojson.mesh(world, world.objects.countries, (a, b) => a !== b),
        india: topojson.feature(world, world.objects.countries).features.find((f) => String(f.id) === INDIA_ID),
      }));
      atlasPromise.catch(() => { atlasPromise = null; });
    }
    return atlasPromise;
  }

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function mount(opts) {
    const { canvas, places, legs, onLeg, onReady } = opts;
    const ctx = canvas.getContext("2d");
    const projection = d3.geoOrthographic().clipAngle(90).precision(0.4);
    const path = d3.geoPath(projection, ctx);
    const graticule = d3.geoGraticule10();
    let geo = null, W = 0, H = 0, base = 1, dpr = 1;
    let rot = [-20, -24, 0], scale = 1;
    let active = -1, marker = null, raf = 0, alive = true, playing = false, playToken = 0;

    const P = (id) => { const p = places[id]; return p ? [p.lon, p.lat] : null; };

    function size() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const w = Math.max(260, Math.floor(rect.width));
      const h = Math.min(w, Math.max(320, Math.floor(window.innerHeight * 0.68)));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const prevBase = base;
      W = w; H = h; base = Math.min(W, H) / 2 - 8;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      scale = prevBase > 1 ? scale * (base / prevBase) : base;
      draw();
    }

    function colors() {
      return {
        ocean: cssVar("--globe-ocean"), land: cssVar("--globe-land"), india: cssVar("--globe-india"),
        border: cssVar("--globe-border"), grat: cssVar("--globe-grat"), rim: cssVar("--line"),
        train: cssVar("--coach"), flight: cssVar("--maroon"), bus: cssVar("--muted"),
        ink: cssVar("--ink"), paper: cssVar("--paper"), go: cssVar("--go"),
      };
    }

    function visible(lonlat) {
      return d3.geoDistance(lonlat, [-rot[0], -rot[1]]) < Math.PI / 2 - 0.02;
    }

    function draw() {
      if (!alive) return;
      const c = colors();
      projection.translate([W / 2, H / 2]).scale(scale).rotate(rot);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = c.ocean; ctx.fill();
      ctx.beginPath(); path(graticule); ctx.strokeStyle = c.grat; ctx.lineWidth = 0.6; ctx.stroke();
      if (geo) {
        ctx.beginPath(); path(geo.land); ctx.fillStyle = c.land; ctx.fill();
        if (geo.india) { ctx.beginPath(); path(geo.india); ctx.fillStyle = c.india; ctx.fill(); }
        ctx.beginPath(); path(geo.borders); ctx.strokeStyle = c.border; ctx.lineWidth = 0.6; ctx.stroke();
      }
      ctx.beginPath(); path({ type: "Sphere" }); ctx.strokeStyle = c.rim; ctx.lineWidth = 1.2; ctx.stroke();

      const zoomed = scale / base;
      // legs, faded ones first so the active leg sits on top
      const order = legs.map((l, i) => i).sort((a, b) => (a === active) - (b === active));
      order.forEach((i) => {
        const l = legs[i], a = P(l.from), b = P(l.to);
        if (!a || !b) return;
        ctx.beginPath(); path({ type: "LineString", coordinates: [a, b] });
        const col = c[l.mode] || c.train;
        const on = i === active;
        ctx.globalAlpha = active < 0 || on ? 1 : 0.35;
        ctx.strokeStyle = col;
        ctx.lineWidth = (on ? 3.2 : 1.8) * Math.min(1.6, 0.8 + zoomed / 10);
        ctx.setLineDash(l.mode === "flight" ? [7, 6] : l.mode === "bus" ? [2, 5] : []);
        ctx.lineCap = "round";
        ctx.stroke();
      });
      ctx.setLineDash([]); ctx.globalAlpha = 1;

      // stops and labels; labels try four spots and skip any that would collide
      const stopIds = Array.from(new Set(legs.flatMap((l) => [l.from, l.to])));
      const big = new Set(["nyc", "dxb", "maa"]);
      const font = getComputedStyle(document.body).fontFamily;
      const activeIds = active >= 0 ? [legs[active].from, legs[active].to] : [];
      const pts = stopIds.map((id) => ({ id, ll: P(id) })).filter((p) => p.ll && visible(p.ll)).map((p) => ({ ...p, xy: projection(p.ll), on: activeIds.includes(p.id) }));
      pts.forEach((p) => {
        const [x, y] = p.xy;
        ctx.beginPath(); ctx.arc(x, y, p.on ? 5.5 : 3.8, 0, Math.PI * 2);
        ctx.fillStyle = p.on ? c.ink : c.paper; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = c.ink; ctx.stroke();
      });
      const placed = [];
      const hit = (r) => placed.some((q) => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
      const ranked = pts.filter((p) => p.on || big.has(p.id) || zoomed > 4.5).sort((a, b) => (b.on - a.on) || (big.has(b.id) - big.has(a.id)));
      ranked.forEach((p) => {
        const [x, y] = p.xy;
        const label = places[p.id].name;
        ctx.font = `${p.on ? 700 : 600} ${p.on ? 14 : 12.5}px ${font}`;
        const w = ctx.measureText(label).width, h = p.on ? 16 : 14;
        const spots = [[x + 9, y - h / 2, "left"], [x - 9 - w, y - h / 2, "left"], [x - w / 2, y - 10 - h, "left"], [x - w / 2, y + 9, "left"]];
        const spot = spots.find(([sx, sy]) => !hit({ x: sx - 2, y: sy - 1, w: w + 4, h: h + 2 }) && sx > 2 && sx + w < W - 2 && sy > 2 && sy + h < H - 2);
        if (!spot) return;
        const [sx, sy] = spot;
        placed.push({ x: sx - 2, y: sy - 1, w: w + 4, h: h + 2 });
        ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.lineWidth = 4; ctx.strokeStyle = c.paper; ctx.lineJoin = "round";
        ctx.strokeText(label, sx, sy + 1);
        ctx.fillStyle = c.ink; ctx.fillText(label, sx, sy + 1);
      });

      // moving marker
      if (marker && visible(marker.at)) {
        const [x, y] = projection(marker.at);
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fillStyle = c[marker.mode] || c.train; ctx.fill();
        ctx.lineWidth = 2.5; ctx.strokeStyle = c.paper; ctx.stroke();
      }
    }

    // ---- motion ----
    function tween(dur, step) {
      return new Promise((resolve) => {
        if (reduced() || dur <= 0) { step(1); draw(); return resolve(); }
        const t0 = performance.now();
        const tick = (now) => {
          if (!alive) return resolve();
          const t = Math.min(1, (now - t0) / dur);
          step(t); draw();
          if (t < 1) raf = requestAnimationFrame(tick); else resolve();
        };
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(tick);
      });
    }
    function flyTo(lon, lat, k, dur = 1100) {
      const r0 = rot.slice(), s0 = scale;
      let dl = (-lon - r0[0]) % 360; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
      const r1 = [r0[0] + dl, -lat, 0];
      const s1 = Math.max(base * 0.9, Math.min(base * 18, k));
      // pull back a little mid-flight when travelling far, like a camera
      const far = Math.abs(dl) > 25 || Math.abs(r1[1] - r0[1]) > 20;
      return tween(dur, (t) => {
        const e = d3.easeCubicInOut(t);
        rot = [r0[0] + (r1[0] - r0[0]) * e, r0[1] + (r1[1] - r0[1]) * e, 0];
        let s = s0 * Math.pow(s1 / s0, e);
        if (far) s *= 1 - 0.35 * Math.sin(Math.PI * e) * Math.min(1, Math.max(s0, s1) / (base * 3));
        scale = s;
      });
    }
    function legView(i) {
      const l = legs[i], a = P(l.from), b = P(l.to);
      const mid = d3.geoInterpolate(a, b)(0.5);
      const dist = Math.max(d3.geoDistance(a, b), 0.008);
      const k = Math.min(W, H) * 0.32 / Math.sin(Math.min(dist, 1.4) / 2) / 2;
      return { mid, k };
    }
    function runMarker(i) {
      const l = legs[i], a = P(l.from), b = P(l.to);
      const interp = d3.geoInterpolate(a, b);
      const km = d3.geoDistance(a, b) * EARTH_KM;
      const dur = Math.max(900, Math.min(2600, 700 + km * 0.25));
      return tween(dur, (t) => { marker = { at: interp(d3.easeSinInOut(t)), mode: l.mode }; }).then(() => { marker = null; draw(); });
    }
    async function focusLeg(i, animate = true) {
      active = i; onLeg && onLeg(i);
      const { mid, k } = legView(i);
      await flyTo(mid[0], mid[1], k, animate ? 1100 : 0);
      if (animate && alive) await runMarker(i);
    }
    async function play() {
      if (playing) { stop(); return; }
      playing = true; const token = ++playToken;
      opts.onPlay && opts.onPlay(true);
      for (let i = 0; i < legs.length; i++) {
        if (!alive || token !== playToken) break;
        await focusLeg(i, true);
        await new Promise((r) => setTimeout(r, reduced() ? 900 : 350));
      }
      if (token === playToken) { playing = false; opts.onPlay && opts.onPlay(false); }
    }
    function stop() { playToken++; playing = false; cancelAnimationFrame(raf); marker = null; draw(); opts.onPlay && opts.onPlay(false); }

    // ---- input: drag to spin, wheel and pinch to zoom ----
    const pointers = new Map();
    let pinch0 = 0, scale0 = 1;
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (playing) stop();
      if (pointers.size === 2) { const [p, q] = [...pointers.values()]; pinch0 = Math.hypot(p.x - q.x, p.y - q.y); scale0 = scale; }
    });
    canvas.addEventListener("pointermove", (e) => {
      const prev = pointers.get(e.pointerId); if (!prev) return;
      const cur = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, cur);
      if (pointers.size === 2) {
        const [p, q] = [...pointers.values()];
        const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (pinch0) { scale = Math.max(base * 0.9, Math.min(base * 18, scale0 * d / pinch0)); draw(); }
        return;
      }
      const k = 70 / scale;
      rot = [rot[0] + (cur.x - prev.x) * k, Math.max(-85, Math.min(85, rot[1] - (cur.y - prev.y) * k)), 0];
      draw();
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch0 = 0; };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      scale = Math.max(base * 0.9, Math.min(base * 18, scale * Math.exp(-e.deltaY * 0.0015)));
      draw();
    }, { passive: false });
    canvas.addEventListener("keydown", (e) => {
      const step = 8 * base / scale;
      if (e.key === "ArrowLeft") rot[0] += step; else if (e.key === "ArrowRight") rot[0] -= step;
      else if (e.key === "ArrowUp") rot[1] = Math.max(-85, rot[1] - step); else if (e.key === "ArrowDown") rot[1] = Math.min(85, rot[1] + step);
      else if (e.key === "+" || e.key === "=") scale = Math.min(base * 18, scale * 1.25);
      else if (e.key === "-") scale = Math.max(base * 0.9, scale / 1.25);
      else return;
      e.preventDefault(); draw();
    });

    const ro = new ResizeObserver(() => size());
    ro.observe(canvas.parentElement);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => draw();
    mq.addEventListener && mq.addEventListener("change", onScheme);

    size();
    loadAtlas().then((g) => {
      geo = g; draw(); onReady && onReady(true);
      // one opening move: from the whole route to India
      flyTo(78, 18, base * 3.2, 1800);
    }).catch(() => { onReady && onReady(false); });

    return {
      play, stop, focusLeg: (i) => { if (playing) stop(); return focusLeg(i, true); },
      world: () => { if (playing) stop(); active = -1; onLeg && onLeg(-1); return flyTo(10, 28, base * 0.95, 1200); },
      india: () => { if (playing) stop(); return flyTo(78, 18, base * 3.2, 1100); },
      zoom: (f) => { scale = Math.max(base * 0.9, Math.min(base * 18, scale * f)); draw(); },
      redraw: draw,
      destroy() { alive = false; playToken++; cancelAnimationFrame(raf); ro.disconnect(); mq.removeEventListener && mq.removeEventListener("change", onScheme); },
    };
  }

  const km = (places, l) => {
    const a = places[l.from], b = places[l.to];
    return a && b ? d3.geoDistance([a.lon, a.lat], [b.lon, b.lat]) * EARTH_KM : 0;
  };

  window.TripGlobe = { mount, km };
})();
