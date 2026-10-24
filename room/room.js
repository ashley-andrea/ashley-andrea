// Ashley's cozy pixel room. The scene, leaves, steam and bubbles live on a 240x134
// grid; the canvas is drawn at whole device pixels per grid pixel so nothing blurs.
// Contours, the leaf window, bubble boxes and the text size come from room/config.json
// (edit them with tools/editor.py). The page boots it; the editor reuses PixelRoom.
(() => {
  const W = 240, H = 134;
  const INK = "#2b2624";
  const CREAM = "#f7ead1";
  const SHADOW = "rgba(60, 25, 10, 0.35)";
  const LINE = 10; // 9 glyph rows + 1 gap, in text pixels
  const PAD = 4;
  const TYPE_MS = 45;
  const HINT = "psst! click around the desk";
  const CHICK = { w: 26, h: 32, frames: 7, ms: 250 };
  const SCREEN = [92, 62, 151, 101]; // laptop screen interior, x0 y0 x1 y1 (exclusive)
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const OBJECTS = {
    1: { name: "laptop", text: "AI grad turned Computer Engineering master's student at Polimi, powered mostly by coffee and stubbornness :P" },
    2: { name: "coffee", text: "I'm half engineer, half designer: I'll train your model and argue about the perfect button corner radius hehe" },
    3: { name: "plant", text: "Co-founder of a medtech startup, where I build things that will (hopefully) make life a little kinder for people with epilepsy" },
    4: { name: "candle", chick: true, text: "I can't help giving my apps cute little characters. See exhibit A over here ->" },
    5: { name: "book", text: "The most interesting vulnerability might be human nature! I'm exploring social engineering and the psychology behind cyberattacks B)" },
    6: { name: "pumpkin", text: "Off-screen, I usually climb rocks, romanticize fall, or cry my heart out to nostalgic music :D" },
  };

  const loadImage = (src) => new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = fail;
    im.src = src;
  });
  const json = (src) => fetch(src, { cache: "no-store" }).then((r) => r.json());

  function load(base = "") {
    return Promise.all([
      loadImage(base + "room/scene.png"), loadImage(base + "room/chick.png"),
      json(base + "room/font.json"), json(base + "room/anim.json"), json(base + "room/config.json"),
    ]).then(([scene, chick, font, anim, config]) => ({ scene, chick, font, anim, config }));
  }

  function create({ stage, canvas, assets, interactive = true, fitTo }) {
    const { scene, chick, font, anim } = assets;
    let config = assets.config;
    const ctx = canvas.getContext("2d");
    const live = document.getElementById("live");
    const objects = Object.fromEntries(Object.entries(OBJECTS).map(([id, o]) => [id, { ...o, id: +id }]));

    const sceneData = (() => {
      const c = document.createElement("canvas");
      c.width = W; c.height = H;
      const x = c.getContext("2d");
      x.drawImage(scene, 0, 0);
      return x.getImageData(0, 0, W, H).data;
    })();

    // ---- masks: which object owns each pixel, and where the glass shows the leaves ----
    const ids = new Uint8Array(W * H);
    const glassGrid = new Uint8Array(W * H);
    const glass = document.createElement("canvas");
    glass.width = W; glass.height = H;
    const leafLayer = document.createElement("canvas");
    leafLayer.width = W; leafLayer.height = H;
    const lctx = leafLayer.getContext("2d");
    const idAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : ids[y * W + x]);

    function readMasks() {
      ids.fill(0);
      glassGrid.fill(0);
      for (const [key, runs] of Object.entries(config.masks)) {
        const grid = key === "glass" ? glassGrid : ids;
        const v = key === "glass" ? 1 : +key;
        for (const [y, x0, x1] of runs) for (let x = x0; x <= x1; x++) grid[y * W + x] = v;
      }
      rebuildMasks();
    }

    // per object: its pixels, bbox, and the cream outline of its lifted copy
    function rebuildMasks() {
      for (const o of Object.values(objects)) {
        o.px = [];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ids[y * W + x] === o.id) o.px.push([x, y]);
        const xs = o.px.map((p) => p[0]), ys = o.px.map((p) => p[1]);
        o.bbox = o.px.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1] : [0, 0, 0, 0];
        const inside = (x, y) => idAt(x, y) === o.id || idAt(x, y + 1) === o.id;
        o.outline = [];
        for (let y = -1; y <= H; y++) for (let x = -1; x <= W; x++) {
          if (inside(x, y)) continue;
          if (inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1)) o.outline.push([x, y]);
        }
        o.colors = o.px.map(([x, y]) => {
          const i = (y * W + x) * 4;
          return `rgb(${sceneData[i]},${sceneData[i + 1]},${sceneData[i + 2]})`;
        });
      }
      const g = glass.getContext("2d");
      const img = g.createImageData(W, H);
      for (let i = 0; i < W * H; i++) img.data[i * 4 + 3] = glassGrid[i] ? 255 : 0;
      g.putImageData(img, 0, 0);
    }

    // ---- text: drawn in device pixels so any text size stays crisp ----
    let k = 1;      // device pixels per grid pixel
    let tp = 1;     // device pixels per text pixel
    const p = () => tp / k; // text pixel in grid units
    const glyph = (c) => font[c] || font["?"];
    const textWidth = (s) => [...s].reduce((w, c) => w + glyph(c)[0].length + 1, 0) - 1;
    function drawText(s, x, y, color) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = color;
      let ox = Math.round(x * k);
      const oy = Math.round(y * k);
      for (const ch of s) {
        const g = glyph(ch);
        for (let j = 0; j < g.length; j++)
          for (let i = 0; i < g[j].length; i++) if (g[j][i] === "#") ctx.fillRect(ox + i * tp, oy + j * tp, tp, tp);
        ox += (g[0].length + 1) * tp;
      }
      ctx.restore();
    }
    function wrap(s, width) {
      const lines = [];
      let line = "";
      for (const word of s.split(" ")) {
        const next = line ? line + " " + word : word;
        if (textWidth(next) * p() > width && line) { lines.push(line); line = word; } else line = next;
      }
      lines.push(line);
      return lines;
    }

    // ---- layout: bubbles and the laptop title depend on the text size ----
    let title = null;
    function layout() {
      tp = Math.max(1, Math.round(config.textScale * k));
      for (const o of Object.values(objects)) {
        const b = (o.box = config.bubbles[o.id]);
        // the chick stands right of the text, drawn with text-sized pixels
        const room = o.chick ? Math.ceil(CHICK.w * p()) + 4 : 0;
        o.lines = wrap(o.text, b.w - 2 * PAD - 2 - room);
        const textH = 2 * PAD + 2 + Math.ceil((o.lines.length * LINE - 2) * p());
        const h = Math.max(textH, o.chick ? Math.ceil(CHICK.h * p()) + 2 * PAD + 2 : 0);
        o.rect = { x: b.x, y: Math.max(1, b.bottom - h), w: b.w, h };
      }
      // mirrors title_layout() in tools/build.py
      const q = p(), snap = (v) => Math.floor(v / q + 1e-9) * q;
      const [x0, y0, x1, y1] = SCREEN;
      const top = snap(y0 + (y1 - y0 - 19 * q) / 2 - 3 * q);
      const cx = (x0 + x1) / 2;
      title = ["Hi, it's", "Ashley!"].map((s, n) => ({
        s, x: snap(cx - ((textWidth(s) + (n ? 6 : 0)) * q) / 2), y: top + n * 11 * q,
      }));
      title.cursor = [title[1].x + (textWidth("Ashley!") + 2) * q, title[1].y + 7 * q];
    }

    // ---- state ----
    let hovered = 0, open = null, openedAt = 0, hinted = !interactive;
    const sparkle = { id: 0, at: 0 };
    const typed = (now) => (open ? (reduceMotion ? open.text.length : Math.floor((now - openedAt) / TYPE_MS)) : 0);
    const doneTyping = (now) => open && typed(now) >= open.text.length;

    function openObject(o, { instant = false } = {}) {
      hinted = true;
      open = o;
      openedAt = instant ? -1e9 : performance.now();
      if (live) live.textContent = o.text;
      // on narrow screens the room pans: bring the bubble into view
      const wrapEl = stage.parentElement, unit = stage.clientWidth / W;
      if (interactive && wrapEl.scrollWidth > wrapEl.clientWidth) {
        const mid = (Math.min(o.rect.x, o.bbox[0]) + Math.max(o.rect.x + o.rect.w, o.bbox[2])) / 2;
        wrapEl.scrollTo({ left: 16 + mid * unit - wrapEl.clientWidth / 2, behavior: "smooth" });
      }
    }
    function close() {
      open = null;
      if (live) live.textContent = "";
    }

    // ---- drawing ----
    function drawBubble(o, now) {
      const { x, y, w, h } = o.rect;
      // shadow, then the rounded box (corners cut by one pixel)
      ctx.fillStyle = SHADOW;
      ctx.fillRect(x + 2, y + h, w - 2, 1);
      ctx.fillRect(x + w, y + 2, 1, h - 2);
      ctx.fillStyle = INK;
      ctx.fillRect(x + 1, y, w - 2, h);
      ctx.fillRect(x, y + 1, w, h - 2);
      ctx.fillStyle = CREAM;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

      // tail
      const [ax, ay] = o.box.anchor;
      if (o.box.side === "right") {
        const ty = Math.min(Math.max(ay, y + 4), y + h - 5);
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = INK;
          ctx.fillRect(x + w - 1 + i, ty - 3 + i, 1, 7 - 2 * i);
          ctx.fillStyle = CREAM;
          if (7 - 2 * i - 2 > 0) ctx.fillRect(x + w - 1 + i, ty - 2 + i, 1, 7 - 2 * i - 2);
        }
      } else {
        const tx = Math.min(Math.max(ax, x + 6), x + w - 7);
        const rows = Math.min(4, ay - (y + h));
        for (let j = 0; j < rows; j++) {
          ctx.fillStyle = INK;
          ctx.fillRect(tx - 3 + j, y + h - 1 + j, 7 - 2 * j, 1);
          ctx.fillStyle = CREAM;
          if (7 - 2 * j - 2 > 0) ctx.fillRect(tx - 2 + j, y + h - 1 + j, 7 - 2 * j - 2, 1);
        }
      }

      // typewriter text
      let left = typed(now);
      o.lines.forEach((line, n) => {
        if (left <= 0) return;
        drawText(line.slice(0, left), x + PAD + 1, y + PAD + 1 + n * LINE * p(), INK);
        left -= line.length + 1;
      });

      // the chick hops in once the whole sentence is out
      if (o.chick && doneTyping(now)) {
        const doneAt = openedAt + o.text.length * TYPE_MS;
        const t = reduceMotion ? 1e9 : now - doneAt;
        const hop = t < 80 ? 2 : t < 160 ? 1 : 0; // in chick pixels
        const f = Math.floor(t / CHICK.ms) % CHICK.frames;
        const cx = Math.round((x + w - PAD - 1) * k) - CHICK.w * tp;
        const cy = Math.round((y + h - PAD - 1) * k) - CHICK.h * tp;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(chick, f * CHICK.w, 0, CHICK.w, CHICK.h - hop, cx, cy + hop * tp, CHICK.w * tp, (CHICK.h - hop) * tp);
        ctx.restore();
      }
    }

    // ---- falling leaves and coffee steam: same formulas as tools/build.py, 10 ticks/s ----
    const { leafShapes, leafSpin, leafVein, sill, steam } = anim;
    function drawLeaves(tick) {
      lctx.globalCompositeOperation = "source-over";
      lctx.clearRect(0, 0, W, H);
      for (const l of anim.leaves) {
        const kk = (tick + l.offset) % l.period;
        const tau = kk / anim.tps;
        const y = l.y + l.vy * tau;
        if (y > sill + 0.5) continue; // behind the window sill now
        const x = l.x + l.drift * tau + l.amp * Math.sin(l.freq * tau + l.phase);
        const px = Math.floor(x + 0.5) - 1, py = Math.floor(y + 0.5) - 1;
        const shape = leafShapes[Math.floor(kk / leafSpin) % leafShapes.length];
        shape.forEach((row, j) => [...row].forEach((c, i) => {
          if (c === ".") return;
          lctx.fillStyle = c === "#" ? l.color : leafVein;
          lctx.fillRect(px + i, py + j, 1, 1);
        }));
      }
      lctx.globalCompositeOperation = "destination-in";
      lctx.drawImage(glass, 0, 0);
      ctx.drawImage(leafLayer, 0, 0);
    }

    const steamFill = steam.alphas.map((a) => {
      const n = parseInt(steam.color.slice(1), 16);
      return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
    });
    function drawSteam(tick) {
      const s = (2 * Math.PI * (tick % steam.ticks)) / steam.ticks;
      const cells = new Map();
      for (const [wx, ph] of steam.wisps) {
        for (let y = steam.top; y <= steam.bottom; y++) {
          const h = (steam.bottom - y) / (steam.bottom - steam.top); // 0 at the cup, 1 at the top
          let env = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(0.33 * y + 2 * s + ph * 1.7));
          env *= 1 - 0.75 * h ** 1.5;
          if (env < 0.2) continue;
          const cx = wx + 5 * h + (0.6 + 2.4 * h) * Math.sin(0.19 * y + s + ph);
          const half = 0.6 + 1.6 * env;
          for (let x = Math.floor(cx - half + 0.5); x <= Math.floor(cx + half + 0.5); x++) {
            const a = env * (1 - (0.45 * Math.abs(x - cx)) / half);
            const level = a > 0.62 ? 0 : a > 0.4 ? 1 : a > 0.18 ? 2 : 3;
            const key = y * W + x;
            if (level < 3 && level < (cells.get(key) ?? 3)) cells.set(key, level);
          }
        }
      }
      for (const [key, level] of cells) {
        ctx.fillStyle = steamFill[level];
        ctx.fillRect(key % W, Math.floor(key / W), 1, 1);
      }
    }

    function drawLifted(o) {
      o.px.forEach(([x, y], i) => { ctx.fillStyle = o.colors[i]; ctx.fillRect(x, y - 1, 1, 1); });
      ctx.fillStyle = CREAM;
      for (const [x, y] of o.outline) ctx.fillRect(x, y - 1, 1, 1);
    }

    function drawTitle(now, lift) {
      for (const t of title) drawText(t.s, t.x, t.y - lift, INK);
      if (Math.floor(now / 530) % 2 === 0) {
        ctx.fillStyle = INK;
        ctx.fillRect(title.cursor[0], title.cursor[1] - lift, 4 * p(), p());
      }
    }

    function drawSparkle(now) {
      if (open || reduceMotion || !interactive) return;
      if (now - sparkle.at > 2600) {
        const choices = Object.keys(objects).map(Number).filter((id) => id !== sparkle.id);
        sparkle.id = choices[Math.floor(Math.random() * choices.length)];
        sparkle.at = now;
        const [x0, y0, x1] = objects[sparkle.id].bbox;
        sparkle.x = x0 + Math.floor((x1 - x0) * (0.6 + Math.random() * 0.3));
        sparkle.y = y0 + 1;
      }
      const t = now - sparkle.at;
      if (t > 900 || sparkle.id === hovered) return;
      ctx.fillStyle = CREAM;
      ctx.fillRect(sparkle.x, sparkle.y, 1, 1);
      if (t > 200 && t < 700) {
        ctx.fillRect(sparkle.x - 1, sparkle.y, 3, 1);
        ctx.fillRect(sparkle.x, sparkle.y - 1, 1, 3);
      }
      if (t > 350 && t < 550) {
        ctx.fillRect(sparkle.x - 2, sparkle.y, 1, 1);
        ctx.fillRect(sparkle.x + 2, sparkle.y, 1, 1);
        ctx.fillRect(sparkle.x, sparkle.y - 2, 1, 1);
        ctx.fillRect(sparkle.x, sparkle.y + 2, 1, 1);
      }
    }

    function drawHint() {
      if (hinted) return;
      const q = p();
      const w = Math.ceil(textWidth(HINT) * q) + 8, h = Math.ceil(9 * q) + 6;
      const x = Math.floor((W - w) / 2), y = 3;
      ctx.fillStyle = INK;
      ctx.fillRect(x + 1, y, w - 2, h); ctx.fillRect(x, y + 1, w, h - 2);
      ctx.fillStyle = CREAM;
      ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
      drawText(HINT, x + 4, y + 3, INK);
    }

    const api = {
      W, H, objects, ids, glassGrid, overlay: null, showLeaves: true,
      get config() { return config; },
      get hovered() { return hovered; },
      set hovered(id) { hovered = id; },
      get open() { return open; },
      idAt, openObject, close, rebuildMasks, readMasks, layout: () => layout(),
      setConfig(c) { config = c; readMasks(); layout(); },
      toGrid(e) {
        const r = canvas.getBoundingClientRect();
        return [Math.floor(((e.clientX - r.left) / r.width) * W), Math.floor(((e.clientY - r.top) / r.height) * H)];
      },
      fit,
    };

    function frame(now) {
      const tick = reduceMotion ? 0 : Math.floor((now / 1000) * anim.tps);
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scene, 0, 0);
      if (!reduceMotion && api.showLeaves) drawLeaves(tick);
      drawSteam(tick);
      const lifted = hovered && (!open || open.id !== hovered) ? objects[hovered] : open;
      if (lifted) drawLifted(lifted);
      drawTitle(now, lifted && lifted.id === 1 ? 1 : 0);
      drawSparkle(now);
      if (open) drawBubble(open, now);
      drawHint();
      if (api.overlay) {
        ctx.setTransform(k, 0, 0, k, 0, 0);
        api.overlay(ctx, k);
      }
      requestAnimationFrame(frame);
    }

    // ---- sizing: whole device pixels per grid pixel, never blurry ----
    function fit() {
      const dpr = devicePixelRatio || 1;
      const [availW, availH] = fitTo ? fitTo() : [innerWidth - 32, innerHeight - 72];
      k = Math.floor(Math.min(availW / W, availH / H) * dpr);
      k = Math.max(k, Math.ceil(2 * dpr), 1); // never smaller than 2 css px: scroll instead
      canvas.width = W * k;
      canvas.height = H * k;
      stage.style.width = `${(W * k) / dpr}px`;
      stage.style.height = `${(H * k) / dpr}px`;
      layout();
      const wrapEl = stage.parentElement;
      if (interactive) wrapEl.scrollLeft = (wrapEl.scrollWidth - wrapEl.clientWidth) / 2;
    }

    readMasks();
    fit();
    addEventListener("resize", fit);
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener?.("change", fit);
    requestAnimationFrame(frame);

    if (interactive) {
      const inBubble = (x, y) => open && x >= open.rect.x && x < open.rect.x + open.rect.w && y >= open.rect.y && y < open.rect.y + open.rect.h;
      canvas.addEventListener("pointermove", (e) => {
        const [x, y] = api.toGrid(e);
        hovered = inBubble(x, y) ? 0 : idAt(x, y);
        canvas.style.cursor = hovered || inBubble(x, y) ? "pointer" : "default";
      });
      canvas.addEventListener("pointerleave", () => { hovered = 0; });
      canvas.addEventListener("click", (e) => {
        const [x, y] = api.toGrid(e);
        const now = performance.now();
        if (inBubble(x, y)) {
          if (doneTyping(now)) close(); else openedAt = -1e9;
          return;
        }
        const id = idAt(x, y);
        if (id && open !== objects[id]) openObject(objects[id]); else close();
      });
      addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

      // invisible buttons over each object, for keyboards and screen readers
      for (const o of Object.values(objects)) {
        const b = document.createElement("button");
        const [x0, y0, x1, y1] = o.bbox;
        b.className = "hotspot";
        b.setAttribute("aria-label", `The ${o.name}`);
        Object.assign(b.style, {
          left: `${(x0 / W) * 100}%`, top: `${(y0 / H) * 100}%`,
          width: `${((x1 - x0) / W) * 100}%`, height: `${((y1 - y0) / H) * 100}%`,
        });
        b.addEventListener("focus", () => { hovered = o.id; });
        b.addEventListener("blur", () => { hovered = 0; });
        b.addEventListener("click", (e) => {
          if (e.detail === 0) openObject(o); // keyboard only; mouse clicks go to the canvas
        });
        stage.appendChild(b);
      }
    }
    return api;
  }

  window.PixelRoom = { W, H, load, create };

  if (document.currentScript?.hasAttribute("data-autostart")) {
    load().then((assets) => create({
      stage: document.getElementById("stage"), canvas: document.getElementById("room"), assets,
    }));
  }
})();
