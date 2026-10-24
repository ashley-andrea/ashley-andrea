// Ashley's cozy pixel room. Everything is drawn on a 240x134 canvas so every
// pixel (scene, text, bubbles, leaves) shares the same grid.
(() => {
  const W = 240, H = 134;
  const INK = "#2b2624";
  const CREAM = "#f7ead1";
  const SHADOW = "rgba(60, 25, 10, 0.35)";
  const LINE = 10; // 9 glyph rows + 1 gap
  const TYPE_MS = 45;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // bubble: x/w of the box, and either `bottom` (tail points down) or `side`
  const OBJECTS = {
    1: { name: "laptop", anchor: [121, 59], box: { x: 26, w: 190, bottom: 54 },
         text: "AI grad turned Computer Engineering master's student at Polimi, powered mostly by coffee and stubbornness." },
    2: { name: "coffee", anchor: [50, 89], box: { x: 4, w: 150, bottom: 84 },
         text: "I'm half engineer, half designer: I'll train your model and argue about the perfect button corner radius." },
    3: { name: "plant", anchor: [209, 64], box: { x: 54, w: 150, side: "right" },
         text: "Co-founder of a medtech startup, where I build things that will (hopefully) make life a little kinder for people with epilepsy." },
    4: { name: "candle", anchor: [29, 75], box: { x: 3, w: 160, bottom: 70 }, chick: true,
         text: "I can't help giving my apps cute little characters. See exhibit A over there >" },
    5: { name: "book", anchor: [184, 105], box: { x: 24, w: 172, bottom: 100 },
         text: "The most interesting vulnerability might be human nature! I'm exploring social engineering and the psychology behind cyberattacks." },
    6: { name: "pumpkin", anchor: [202, 86], box: { x: 80, w: 156, bottom: 81 },
         text: "Off-screen, I usually climb rocks, romanticize fall, or cry my heart out to nostalgic music :D" },
  };

  const CHICK = { w: 26, h: 32, frames: 7, ms: 250 };

  const stage = document.getElementById("stage");
  const canvas = document.getElementById("room");
  const ctx = canvas.getContext("2d");
  const live = document.getElementById("live");

  const load = (src) => new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = fail;
    im.src = src;
  });
  const pixels = (im) => {
    const c = document.createElement("canvas");
    c.width = im.width; c.height = im.height;
    const x = c.getContext("2d");
    x.drawImage(im, 0, 0);
    return x.getImageData(0, 0, im.width, im.height).data;
  };

  Promise.all([
    load("room/scene.png"), load("room/hitmap.png"), load("room/chick.png"),
    fetch("room/font.json").then((r) => r.json()),
    fetch("room/title.json").then((r) => r.json()),
    fetch("room/anim.json").then((r) => r.json()),
  ]).then(start);

  function start([scene, hitmap, chick, font, title, anim]) {
    const hit = pixels(hitmap);
    const sceneData = pixels(scene);
    const idAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : hit[(y * W + x) * 4]);

    // per object: its pixels, bbox, and the cream outline of its lifted copy
    for (const [id, o] of Object.entries(OBJECTS)) {
      o.id = +id;
      o.px = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (idAt(x, y) === o.id) o.px.push([x, y]);
      const xs = o.px.map((p) => p[0]), ys = o.px.map((p) => p[1]);
      o.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs) + 1, Math.max(...ys) + 1];
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

    // glass mask for the leaves
    const glass = document.createElement("canvas");
    glass.width = W; glass.height = H;
    const gctx = glass.getContext("2d");
    const gimg = gctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) gimg.data[i * 4 + 3] = hit[i * 4 + 1];
    gctx.putImageData(gimg, 0, 0);
    const leafLayer = document.createElement("canvas");
    leafLayer.width = W; leafLayer.height = H;
    const lctx = leafLayer.getContext("2d");

    // ---- text ----
    const glyph = (c) => font[c] || font["?"];
    const textWidth = (s) => [...s].reduce((w, c) => w + glyph(c)[0].length + 1, 0) - 1;
    function drawText(c2, s, x, y, color) {
      c2.fillStyle = color;
      for (const ch of s) {
        const g = glyph(ch);
        for (let j = 0; j < g.length; j++)
          for (let i = 0; i < g[j].length; i++) if (g[j][i] === "#") c2.fillRect(x + i, y + j, 1, 1);
        x += g[0].length + 1;
      }
    }
    function wrap(s, width) {
      const lines = [];
      let line = "";
      for (const word of s.split(" ")) {
        const next = line ? line + " " + word : word;
        if (textWidth(next) > width && line) { lines.push(line); line = word; } else line = next;
      }
      lines.push(line);
      return lines;
    }

    // ---- bubble layout ----
    const PAD = 4;
    for (const o of Object.values(OBJECTS)) {
      const b = o.box;
      const room = o.chick ? CHICK.w + 4 : 0; // the chick stands right of the text
      o.lines = wrap(o.text, b.w - 2 * PAD - 2 - room);
      const h = Math.max(2 * PAD + 2 + o.lines.length * LINE - 2, o.chick ? CHICK.h + 2 * PAD + 2 : 0);
      const y = b.side ? Math.round(o.anchor[1] - h / 2) : b.bottom - h;
      o.rect = { x: b.x, y: Math.max(2, y), w: b.w, h };
    }

    // ---- state ----
    let hovered = 0, open = null, openedAt = 0, hinted = false;
    const sparkle = { id: 0, at: 0 };

    const typed = (now) => (open ? (reduceMotion ? open.text.length : Math.floor((now - openedAt) / TYPE_MS)) : 0);
    const doneTyping = (now) => open && typed(now) >= open.text.length;

    function openObject(o) {
      hinted = true;
      if (open === o) return close();
      open = o;
      openedAt = performance.now();
      live.textContent = o.text;
      // on narrow screens the room pans: bring the bubble into view
      const wrapEl = stage.parentElement, unit = stage.clientWidth / W;
      if (wrapEl.scrollWidth > wrapEl.clientWidth) {
        const mid = (Math.min(o.rect.x, o.bbox[0]) + Math.max(o.rect.x + o.rect.w, o.bbox[2])) / 2;
        wrapEl.scrollTo({ left: 16 + mid * unit - wrapEl.clientWidth / 2, behavior: "smooth" });
      }
    }
    function close() {
      open = null;
      live.textContent = "";
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
      const [ax, ay] = o.anchor;
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
        const part = line.slice(0, left);
        drawText(ctx, part, x + PAD + 1, y + PAD + 1 + n * LINE, INK);
        left -= line.length + 1;
      });

      // the chick hops in once the whole sentence is out
      if (o.chick && doneTyping(now)) {
        const doneAt = openedAt + o.text.length * TYPE_MS;
        const t = reduceMotion ? 1e9 : now - doneAt;
        const hop = t < 80 ? 2 : t < 160 ? 1 : 0;
        const f = Math.floor(t / CHICK.ms) % CHICK.frames;
        const cx = x + w - PAD - 1 - CHICK.w, cy = y + h - PAD - 1 - CHICK.h;
        ctx.drawImage(chick, f * CHICK.w, 0, CHICK.w, CHICK.h - hop, cx, cy + hop, CHICK.w, CHICK.h - hop);
      }
    }

    // ---- falling leaves and coffee steam: same formulas as tools/build.py, 10 ticks/s ----
    const { leafShapes, leafSpin, leafVein, sill, steam } = anim;
    function drawLeaves(tick) {
      lctx.globalCompositeOperation = "source-over";
      lctx.clearRect(0, 0, W, H);
      for (const l of anim.leaves) {
        const k = (tick + l.offset) % l.period;
        const tau = k / anim.tps;
        const y = l.y + l.vy * tau;
        if (y > sill + 0.5) continue; // behind the window sill now
        const x = l.x + l.drift * tau + l.amp * Math.sin(l.freq * tau + l.phase);
        const px = Math.floor(x + 0.5) - 1, py = Math.floor(y + 0.5) - 1;
        const shape = leafShapes[Math.floor(k / leafSpin) % leafShapes.length];
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
      ctx.fillStyle = INK;
      for (const [x, y] of title.pixels) ctx.fillRect(x, y - lift, 1, 1);
      if (Math.floor(now / 530) % 2 === 0) ctx.fillRect(title.cursor[0], title.cursor[1] - lift, 4, 1);
    }

    function drawSparkle(now) {
      if (open || reduceMotion) return;
      if (now - sparkle.at > 2600) {
        const ids = Object.keys(OBJECTS).map(Number).filter((id) => id !== sparkle.id);
        sparkle.id = ids[Math.floor(Math.random() * ids.length)];
        sparkle.at = now;
        const [x0, y0, x1] = OBJECTS[sparkle.id].bbox;
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
      const s = "psst! click around the desk";
      const w = textWidth(s) + 8, x = Math.floor((W - w) / 2), y = 3;
      ctx.fillStyle = INK;
      ctx.fillRect(x + 1, y, w - 2, 15); ctx.fillRect(x, y + 1, w, 13);
      ctx.fillStyle = CREAM;
      ctx.fillRect(x + 1, y + 1, w - 2, 13);
      drawText(ctx, s, x + 4, y + 3, INK);
    }

    function frame(now) {
      const tick = reduceMotion ? 0 : Math.floor((now / 1000) * anim.tps);
      ctx.drawImage(scene, 0, 0);
      if (!reduceMotion) drawLeaves(tick);
      drawSteam(tick);
      const lifted = hovered && (!open || open.id !== hovered) ? OBJECTS[hovered] : open;
      if (lifted) drawLifted(lifted);
      drawTitle(now, lifted && lifted.id === 1 ? 1 : 0);
      drawSparkle(now);
      if (open) drawBubble(open, now);
      drawHint();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // ---- input ----
    const toGrid = (e) => {
      const r = canvas.getBoundingClientRect();
      return [Math.floor(((e.clientX - r.left) / r.width) * W), Math.floor(((e.clientY - r.top) / r.height) * H)];
    };
    const inBubble = (x, y) => open && x >= open.rect.x && x < open.rect.x + open.rect.w && y >= open.rect.y && y < open.rect.y + open.rect.h;
    canvas.addEventListener("pointermove", (e) => {
      const [x, y] = toGrid(e);
      hovered = inBubble(x, y) ? 0 : idAt(x, y);
      canvas.style.cursor = hovered || inBubble(x, y) ? "pointer" : "default";
    });
    canvas.addEventListener("pointerleave", () => { hovered = 0; });
    canvas.addEventListener("click", (e) => {
      const [x, y] = toGrid(e);
      const now = performance.now();
      if (inBubble(x, y)) {
        if (doneTyping(now)) close(); else openedAt = -1e9;
        return;
      }
      const id = idAt(x, y);
      if (id) openObject(OBJECTS[id]); else close();
    });
    addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

    // invisible buttons over each object, for keyboards and screen readers
    for (const o of Object.values(OBJECTS)) {
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

    // ---- sizing: whole device pixels per grid pixel, never blurry ----
    function fit() {
      const dpr = devicePixelRatio || 1;
      const availW = innerWidth - 32, availH = innerHeight - 72;
      let k = Math.floor(Math.min(availW / W, availH / H) * dpr);
      k = Math.max(k, Math.ceil(2 * dpr), 1); // never smaller than 2 css px: scroll instead
      const unit = k / dpr;
      stage.style.width = `${W * unit}px`;
      stage.style.height = `${H * unit}px`;
      const wrapEl = stage.parentElement;
      wrapEl.scrollLeft = (wrapEl.scrollWidth - wrapEl.clientWidth) / 2;
    }
    addEventListener("resize", fit);
    matchMedia(`(resolution: ${devicePixelRatio}dppx)`).addEventListener?.("change", fit);
    fit();
  }
})();
