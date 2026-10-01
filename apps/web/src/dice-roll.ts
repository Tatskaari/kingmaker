type Point = [number, number, number];
const dot = (a: Point, b: Point) => a.reduce((sum, value, i) => sum + value * b[i]!, 0);
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Point, b: Point): Point => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: Point): Point => v.map(n => n / Math.hypot(...v)) as Point;
const phi = (1 + Math.sqrt(5)) / 2;
const vertices: Point[] = [];
for (const a of [-1, 1]) for (const b of [-phi, phi]) vertices.push([0, a, b], [a, b, 0], [b, 0, a]);
const faces: number[][] = [];
for (let a = 0; a < 12; a++) for (let b = a + 1; b < 12; b++) for (let c = b + 1; c < 12; c++) {
  if ([sub(vertices[a]!, vertices[b]!), sub(vertices[b]!, vertices[c]!), sub(vertices[c]!, vertices[a]!)].every(edge => Math.abs(Math.hypot(...edge) - 2) < 0.001)) faces.push(dot(cross(sub(vertices[b]!, vertices[a]!), sub(vertices[c]!, vertices[a]!)), vertices[a]!) > 0 ? [a, b, c] : [a, c, b]);
}
// Orient a triangular face toward the viewer at rest, with its apex upright.
const [a, b, c] = faces[0]!.map(i => vertices[i]!) as [Point, Point, Point];
const normal = unit([a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]]);
const vertical = unit(sub(normal.map(n => n * dot(a, normal)) as Point, a));
const horizontal = cross(vertical, normal);
const resting = vertices.map(v => [dot(v, horizontal), dot(v, vertical), dot(v, normal)] as Point);

export function resolveDiceCheck(roll: number, dc: number, modifier: number) {
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) throw new RangeError("A d20 result must be an integer from 1 to 20.");
  if (!Number.isSafeInteger(dc) || !Number.isSafeInteger(modifier) || !Number.isSafeInteger(roll + modifier)) throw new RangeError("DC and modifier must be safe integers.");
  return { total: roll + modifier, success: roll + modifier >= dc };
}

/** Cosmetic presentation only: callers supply the resolved natural d20 result. */
export function showDiceRoll({ roll, dc, modifier, label = "Ability check", preview = false }: { roll: number; dc: number; modifier: number; label?: string; preview?: boolean }) {
  const result = resolveDiceCheck(roll, dc, modifier);
  if (document.querySelector(".dice-dialog")) return;
  const previousFocus = document.activeElement;
  const dialog = document.createElement("dialog");
  dialog.className = "dice-dialog";
  dialog.setAttribute("aria-labelledby", "dice-title");
  dialog.innerHTML = `<div class="dice-card"><div class="dice-eyebrow"></div><h2 id="dice-title"></h2>
    <div class="dice-target"></div><button class="dice-close" aria-label="Close dice roll">×</button><div class="dice-stage"><div class="dice-orbit"></div><button class="dice-trigger" aria-label="Roll the twenty-sided die"><canvas width="720" height="640" aria-hidden="true"></canvas></button></div>
    <div class="dice-result" role="status" aria-live="polite"><span class="dice-caption">Your fate awaits</span><strong>Roll the die</strong></div>
    <p class="dice-note"></p><button class="dice-continue">Roll the die</button></div>`;
  dialog.querySelector(".dice-eyebrow")!.textContent = preview ? "Dice preview · D20" : "The moment of truth · D20";
  dialog.querySelector("h2")!.textContent = label;
  const bonus = `${modifier >= 0 ? "+" : "−"}${Math.abs(modifier)}`;
  dialog.querySelector(".dice-target")!.textContent = `Difficulty ${dc}   ·   Modifier ${bonus}`;
  dialog.querySelector(".dice-note")!.textContent = preview ? "Test roll only · Your story is unchanged" : "Roll + modifier must meet the difficulty";
  document.body.append(dialog);
  const canvas = dialog.querySelector("canvas")!;
  const ctx = canvas.getContext("2d")!;
  const button = dialog.querySelector<HTMLButtonElement>(".dice-continue")!;
  const die = dialog.querySelector<HTMLButtonElement>(".dice-trigger")!;
  let frame = 0, settled = false, rolling = false;
  const close = () => dialog.close();
  dialog.querySelector(".dice-close")!.addEventListener("click", close);
  dialog.addEventListener("close", () => {
    cancelAnimationFrame(frame); dialog.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }, { once: true });
  dialog.addEventListener("keydown", event => event.stopPropagation());
  dialog.addEventListener("click", event => { if (event.target === dialog) close(); });

  function draw(progress: number) {
    const remaining = (1 - progress) ** 3;
    const x = remaining * Math.PI * 4, y = remaining * Math.PI * 6;
    const points = resting.map(([vx, vy, vz]) => {
      const ry = vy * Math.cos(x) - vz * Math.sin(x), rz = vy * Math.sin(x) + vz * Math.cos(x);
      return [vx * Math.cos(y) + rz * Math.sin(y), ry, rz * Math.cos(y) - vx * Math.sin(y)] as Point;
    });
    const lift = Math.sin(progress * Math.PI) * 35;
    const projected = points.map(([vx, vy, vz]) => [360 + vx * 108 * 6 / (6 - vz), 314 - lift + vy * 108 * 6 / (6 - vz)]);
    ctx.clearRect(0, 0, 720, 640);
    const glow = ctx.createRadialGradient(360, 320, 30, 360, 320, 280);
    glow.addColorStop(0, "#d6a85130"); glow.addColorStop(1, "#d6a85100");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 720, 640);
    ctx.fillStyle = "#0008"; ctx.beginPath(); ctx.ellipse(360, 536, 118 - lift, 15, 0, 0, Math.PI * 2); ctx.fill();
    faces.map((face, index) => ({ face, index, depth: face.reduce((sum, i) => sum + points[i]![2], 0) / 3 }))
      .sort((f, g) => f.depth - g.depth).forEach(({ face, index, depth }) => {
        const triangle = face.map(i => projected[i]!);
        ctx.beginPath(); triangle.forEach(([px, py], i) => i ? ctx.lineTo(px!, py!) : ctx.moveTo(px!, py!)); ctx.closePath();
        const fill = ctx.createLinearGradient(triangle[0]![0]!, triangle[0]![1]!, triangle[2]![0]!, triangle[2]![1]!);
        fill.addColorStop(0, `hsl(164 32% ${18 + depth * 7}%)`); fill.addColorStop(1, `hsl(174 42% ${10 + depth * 5}%)`);
        ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = "#e6bf758f"; ctx.lineWidth = 2; ctx.stroke();
        // Affine text mapping keeps numerals attached to each triangular face.
        const [p, q, r] = triangle as [number[], number[], number[]];
        ctx.save(); ctx.transform((q[0]! - p[0]!) / 160, (q[1]! - p[1]!) / 160,
          (r[0]! - (p[0]! + q[0]!) / 2) / 138, (r[1]! - (p[1]! + q[1]!) / 2) / 138, p[0]!, p[1]!);
        ctx.translate(80, 46); ctx.rotate(-Math.PI / 3);
        ctx.font = "500 44px Georgia"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#fff0c9"; ctx.fillText(String((index + (rolling ? roll : 20) - 1) % 20 + 1), 0, 0); ctx.restore();
      });
  }
  function reveal() {
    cancelAnimationFrame(frame); settled = true; draw(1); dialog.classList.add("is-settled");
    dialog.querySelector(".dice-caption")!.textContent = roll === 20 ? "A legendary roll" : roll === 1 ? "The fates are fickle" : "The die is cast";
    const { total, success } = result;
    dialog.dataset.outcome = success ? "success" : "failure";
    dialog.querySelector(".dice-result strong")!.textContent = success ? "Success" : "Failure";
    dialog.querySelector(".dice-caption")!.textContent += ` · Natural ${roll}`;
    dialog.querySelector(".dice-target")!.textContent = `${roll} ${bonus} = ${total}   ·   DC ${dc}`;
    button.textContent = "Continue";
  }
  function startRoll() {
    if (rolling) return;
    rolling = true; die.disabled = true; dialog.classList.add("is-rolling");
    dialog.querySelector(".dice-caption")!.textContent = "The fates are turning";
    dialog.querySelector(".dice-result strong")!.textContent = "Rolling…";
    button.textContent = "Skip animation"; button.focus();
    const started = performance.now();
    function animate(now: number) {
      const progress = Math.min(1, (now - started) / 1900); draw(progress);
      if (progress < 1) frame = requestAnimationFrame(animate); else reveal();
    }
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) reveal(); else frame = requestAnimationFrame(animate);
  }
  die.addEventListener("click", startRoll);
  button.addEventListener("click", () => settled ? close() : rolling ? reveal() : startRoll());
  draw(1); dialog.showModal(); die.focus();
}

export function installDicePreview() {
  document.addEventListener("keydown", event => {
    if (event.key.toLowerCase() !== "r" || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']")) return;
    if (document.querySelector("dialog[open]")) return;
    event.preventDefault();
    showDiceRoll({ roll: Math.floor(Math.random() * 20) + 1, dc: 15, modifier: 3, label: "A twist of fate", preview: true });
  });
}
