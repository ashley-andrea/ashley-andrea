// Ashley's cozy pixel room. Everything is drawn on a 240x134 canvas so every
// pixel (scene, text, bubbles, leaves) shares the same grid.
(() => {
  const W = 240, H = 134;
  const INK = "#2b2624";
  const CREAM = "#f7ead1";
  const SHADOW = "rgba(60, 25, 10, 0.35)";
  const LINE = 10; // 9 glyph rows + 1 gap
  const TYPE_MS = 28;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // bubble: x/w of the box, and either `bottom` (tail points down) or `side`
  const OBJECTS = {
    1: { name: "laptop", anchor: [121, 59], box: { x: 41, w: 160, bottom: 54 },
         text: "AI grad turned Computer Engineering master's student at Polimi, powered mostly by coffee and stubbornness." },
    2: { name: "coffee", anchor: [50, 89], box: { x: 4, w: 150, bottom: 84 },
         text: "I'm half engineer, half designer: I'll train your model and argue about the perfect button corner radius." },
    3: { name: "plant", anchor: [209, 64], box: { x: 54, w: 150, side: "right" },
         text: "Co-founder of a medtech startup, where I build things that will (hopefully) make life a little kinder for people with epilepsy." },
    4: { name: "candle", anchor: [29, 75], box: { x: 3, w: 112, bottom: 70 }, chick: true,
         text: "I can't help giving my apps cute little characters. See exhibit A over there >" },
    5: { name: "book", anchor: [190, 104], box: { x: 76, w: 160, bottom: 99 },
         text: "The most interesting vulnerability might be human nature! I'm exploring social engineering and the psychology behind cyberattacks." },
    6: { name: "pumpkin", anchor: [202, 86], box: { x: 80, w: 156, bottom: 81 },
         text: "Off-screen, I usually climb rocks, romanticize fall, or cry my heart out to nostalgic music :D" },
  };

  // leaves tumble through these frames; "#" = leaf colour, "+" = dark vein
  const LEAF_COLORS = ["#f6c14b", "#f29a38", "#d8452a", "#fbe08a"];
  const LEAF_VEIN = "#6e2814";
  const LEAF_SHAPES = [[".##", "#+#", "+.."], ["##.", "#+#", "..+"], ["##", "++"], [".#.", "#+#", ".+."]];
  const CHICK = { x: 120, y: 28, w: 26, h: 32, frames: 7, ms: 250, lid: 60 };

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
  ]).then(start);

  function start([scene, hitmap, chick, font, title]) {
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
      o.lines = wrap(o.text, b.w - 2 * PAD - 2);
      const h = 2 * PAD + 2 + o.lines.length * LINE - 2;
      const y = b.side ? Math.round(o.anchor[1] - h / 2) : b.bottom - h;
      o.rect = { x: b.x, y: Math.max(2, y), w: b.w, h };
    }

    // ---- state ----
    let hovered = 0, open = null, openedAt = 0, chickAt = 0, hinted = false;
    const leaves = [];
    let nextLeaf = 0;
    const sparkle = { id: 0, at: 0 };

    const typed = (now) => (open ? (reduceMotion ? open.text.length : Math.floor((now - openedAt) / TYPE_MS)) : 0);
    const doneTyping = (now) => open && typed(now) >= open.text.length;

    function openObject(o) {
      hinted = true;
      if (open === o) return close();
      open = o;
      openedAt = performance.now();
      chickAt = openedAt;
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

      // blinking "more" arrow once the text is out
      if (doneTyping(now) && Math.floor(now / 450) % 2 === 0) {
        ctx.fillStyle = INK;
        ctx.fillRect(x + w - 8, y + h - 5, 3, 1);
        ctx.fillRect(x + w - 7, y + h - 4, 1, 1);
      }
    }

    function drawLeaves(now, dt) {
      if (reduceMotion) return;
      if (now > nextLeaf && leaves.length < 9) {
        const left = Math.random() < 0.15;
        leaves.push({
          x: left ? 44 + Math.random() * 12 : 74 + Math.random() * 104,
          y: -3,
          vy: 5 + Math.random() * 4,
          drift: (Math.random() - 0.3) * 4,
          amp: 2 + Math.random() * 3,
          freq: 0.8 + Math.random() * 0.8,
          phase: Math.random() * 6,
          color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)],
          spin: 280 + Math.random() * 300,
          born: now,
        });
        nextLeaf = now + 900 + Math.random() * 1600;
      }
      lctx.globalCompositeOperation = "source-over";
      lctx.clearRect(0, 0, W, H);
      for (let i = leaves.length - 1; i >= 0; i--) {
        const l = leaves[i];
        const t = (now - l.born) / 1000;
        l.y += l.vy * dt;
        if (l.y > 95) { leaves.splice(i, 1); continue; }
        const x = Math.round(l.x + l.drift * t + l.amp * Math.sin(t * l.freq + l.phase));
        const shape = LEAF_SHAPES[Math.floor((now - l.born) / l.spin) % LEAF_SHAPES.length];
        shape.forEach((row, j) => [...row].forEach((c, k) => {
          if (c === ".") return;
          lctx.fillStyle = c === "#" ? l.color : LEAF_VEIN;
          lctx.fillRect(x + k, Math.round(l.y) + j, 1, 1);
        }));
      }
      lctx.globalCompositeOperation = "destination-in";
      lctx.drawImage(glass, 0, 0);
      ctx.drawImage(leafLayer, 0, 0);
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

    function drawChick(now) {
      const t = now - chickAt;
      const rise = reduceMotion ? 0 : Math.max(0, CHICK.h - Math.floor(t / 10));
      const frame = Math.floor(t / CHICK.ms) % CHICK.frames;
      const visible = CHICK.lid - (CHICK.y + rise); // only above the laptop lid
      if (visible <= 0) return;
      ctx.drawImage(chick, frame * CHICK.w, 0, CHICK.w, visible, CHICK.x, CHICK.y + rise, CHICK.w, visible);
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

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      ctx.drawImage(scene, 0, 0);
      drawLeaves(now, dt);
      const lifted = hovered && (!open || open.id !== hovered) ? OBJECTS[hovered] : open;
      if (lifted) drawLifted(lifted);
      drawTitle(now, lifted && lifted.id === 1 ? 1 : 0);
      drawSparkle(now);
      if (open && open.chick) drawChick(now);
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
