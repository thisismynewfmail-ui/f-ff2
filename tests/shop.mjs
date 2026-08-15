/**
 * The vendor, the tokens and the sentry, against the REAL game.
 *
 * Boots the actual town in headless Chromium and drives `game.update(dt)` at a
 * fixed timestep, so nothing here depends on rendering speed. What it asserts
 * is the set of promises the feature makes that are easy to break silently:
 *
 *   1. the coin table pays out at the stated rates, for the stated types —
 *      including an Exploder that took ITSELF out, which drops no ammunition
 *      by design and must still drop its silver
 *   2. tokens are banked on pickup, spent at the till, and survive a save /
 *      resume round trip and a checkpoint rollback
 *   3. the vendor stands in its pitch in Eastgate, shorter than the player,
 *      facing the road, and the horde IGNORES IT ENTIRELY — no zombie ever
 *      acquires it, and an Exploder going off at the pitch cannot hurt it
 *   4. the shop opens on [E], sells what it says it sells, refuses what it
 *      cannot be paid for, runs out of sentries after exactly two, and leaves
 *      on [E] or a click outside straight back into the game rather than to
 *      the pause menu — while Escape does nothing at all
 *   5. a sentry deploys facing where the player looked, covers a 180° arc to
 *      sixty feet, shoots at the pistol's rate for the pistol's damage,
 *      ignores what is behind it, and packs back into the satchel on [E]
 *
 * Usage: node tests/shop.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  try {
    const path = req.url.split('?')[0];
    if (path === '/api/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(req.method === 'POST' ? '{"ok":true}' : '{"exists":false}');
      return;
    }
    const data = await readFile(join(ROOT, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nope'); }
});
await new Promise((r) => server.listen(8143, r));

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:8143/index.html?test=1');
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#btn-start');
await page.waitForFunction(() => window.__game.state.state === 'playing');

/* ------------------------------------------------------------------ */
/* 1. the drop table                                                    */
/* ------------------------------------------------------------------ */
const drops = await page.evaluate(async () => {
  const { rollCoin, COIN_DROPS } = await import('/src/systems/TokenDrops.js');
  const { COINS } = await import('/src/systems/TokenSystem.js');
  // A deterministic sweep rather than a sampling run: walk the unit interval
  // and count, so the rate is measured exactly instead of approximately.
  const N = 10000;
  const rate = (name) => {
    let hits = 0;
    for (let i = 0; i < N; i++) if (rollCoin(name, () => (i + 0.5) / N)) hits++;
    return hits / N;
  };
  return {
    walker: rate('Walker'), sprinter: rate('Sprinter'), tank: rate('Tank'),
    spitter: rate('Spitter'), exploder: rate('Exploder'),
    unknown: rollCoin('Nothing', () => 0),
    coins: Object.fromEntries(Object.entries(COIN_DROPS).map(([k, d]) => [k, COINS[d.type].value])),
  };
});
check('the standard horde drops a 5-point copper on 15% of kills',
  Math.abs(drops.walker - 0.15) < 1e-9 && drops.sprinter === drops.walker && drops.tank === drops.walker
  && drops.coins.Walker === 5,
  `${(drops.walker * 100).toFixed(1)}% × ${drops.coins.Walker}`);
check('a Spitter drops a 10-point gold on 5%',
  Math.abs(drops.spitter - 0.05) < 1e-9 && drops.coins.Spitter === 10,
  `${(drops.spitter * 100).toFixed(1)}% × ${drops.coins.Spitter}`);
check('an Exploder drops a 20-point silver on 10%',
  Math.abs(drops.exploder - 0.10) < 1e-9 && drops.coins.Exploder === 20,
  `${(drops.exploder * 100).toFixed(1)}% × ${drops.coins.Exploder}`);
check('an archetype with no entry drops nothing at all', drops.unknown === null);

// ...and the coin really reaches the ground through the live death pipeline,
// including from an Exploder that set itself off (which drops NO ammunition).
const selfDetonate = await page.evaluate(() => {
  const g = window.__game;
  // Watch the loot events rather than the pickup list: the list is capped, so
  // in a well-stocked town a new drop can push an old one off the end and
  // leave the length unchanged.
  const spawned = [];
  const spy = ({ type }) => spawned.push(type);
  g.events.on('loot:spawn', spy);
  const pos = { x: g.player.position.x + 6, y: g.player.position.y, z: g.player.position.z + 6 };
  const roll = Math.random;
  Math.random = () => 0.01;                       // inside every drop chance
  g.events.emit('zombie:death', { type: { name: 'Exploder' }, pos, points: 3, loot: null });
  Math.random = roll;
  g.events.off?.('loot:spawn', spy);
  return { types: spawned };
});
check('a self-detonated Exploder still pays out its coin',
  selfDetonate.types.includes('coin_silver') && !selfDetonate.types.some((t) => t.startsWith('ammo_')),
  selfDetonate.types.join(', ') || 'nothing dropped');

/* ------------------------------------------------------------------ */
/* 2. the purse                                                         */
/* ------------------------------------------------------------------ */
const purse = await page.evaluate(() => {
  const g = window.__game;
  g.tokens.restore({ tokens: 0, earned: 0, spent: 0 });
  const out = {};
  // banked by collecting, through the ordinary pickup event
  g.events.emit('pickup', { type: 'coin_copper', amount: 1, label: 'Copper token' });
  g.events.emit('pickup', { type: 'coin_gold', amount: 1, label: 'Gold token' });
  g.events.emit('pickup', { type: 'coin_silver', amount: 1, label: 'Silver token' });
  out.banked = g.tokens.tokens;                    // 5 + 10 + 20
  out.spentOk = g.tokens.spend(20);
  out.afterSpend = g.tokens.tokens;
  out.spentTooMuch = g.tokens.spend(1000);         // refused, and no change
  out.afterRefusal = g.tokens.tokens;
  // the save carries it, and a resume brings it back
  const snap = g.captureSession();
  out.inSave = snap.tokens?.tokens;
  g.tokens.restore({ tokens: 0, earned: 0, spent: 0 });
  g.tokens.restore(snap.tokens);
  out.restored = g.tokens.tokens;
  // ...and a checkpoint rollback takes it with it
  g.checkpoint = { ...g.checkpoint, tokens: g.tokens.snapshot() };
  g.tokens.add(500);
  g.tokens.restore(g.checkpoint.tokens);
  out.rolledBack = g.tokens.tokens;
  return out;
});
check('coins bank at their stated values', purse.banked === 35, `${purse.banked} from 5 + 10 + 20`);
check('spending takes exactly the price', purse.spentOk && purse.afterSpend === 15, `${purse.afterSpend} left`);
check('an unaffordable price is refused and costs nothing',
  purse.spentTooMuch === false && purse.afterRefusal === 15, `${purse.afterRefusal} left`);
check('the purse is written into the save and comes back',
  purse.inSave === 15 && purse.restored === 15, `saved ${purse.inSave}, restored ${purse.restored}`);
check('and rolls back with a checkpoint', purse.rolledBack === 15, `${purse.rolledBack}`);

/* ------------------------------------------------------------------ */
/* 3. the vendor                                                        */
/* ------------------------------------------------------------------ */
const vendor = await page.evaluate(async () => {
  const THREE = await import('/lib/three.module.js');
  const { HEIGHT } = await import('/src/rendering/VendorModel.js');
  const g = window.__game;
  const k = g.shopkeeper;
  const box = new THREE.Box3().setFromObject(k.mesh);
  const post = g.world.tradingPost;
  const zone = g.world.zones.zoneAt(k.position.x, k.position.z);
  // Which way it faces, and whether you can get to it. The pitch is open at
  // the front and packed at the sides, so a probe walked in along the machine's
  // OWN facing must reach it, and probes walked in from either flank must not.
  const reach = (bearing, from) => {
    const p = new THREE.Vector3(
      k.position.x + Math.sin(bearing) * from, k.position.y, k.position.z + Math.cos(bearing) * from);
    const want = { x: p.x, z: p.z };
    // step toward the machine, resolving against the world the way a player does
    for (let t = 0; t < 40; t++) {
      p.x -= Math.sin(bearing) * 0.12;
      p.z -= Math.cos(bearing) * 0.12;
      g.world.collision.resolveCapsule(p, g.player.radius, g.player.height);
    }
    return Math.hypot(p.x - k.position.x, p.z - k.position.z);
  };
  const side = k.yaw + Math.PI / 2;

  /* BOTH ARMS ON THEIR OWN SIDE OF THE WAISTCOAT. Arm roll is written
   * body-relative and mirrored once, in VendorAnimator._apply. A pose that
   * mirrors it a SECOND time cancels on one arm and doubles on the other, and
   * the doubled one swings through the chest — invisible to every check here
   * and plain from the front. The chest is 0.34 across, so a hand inside
   * ±0.17 of the spine is inside the machine. */
  const a = k.anim;
  const handsX = () => {
    k.mesh.updateWorldMatrix(true, true);
    return k.rig.parts.arms.map((arm) => {
      const v = new THREE.Vector3();
      arm.hand.getWorldPosition(v);
      return +(k.rig.parts.torso.worldToLocal(v).x / k.mesh.scale.x).toFixed(3);
    });
  };
  const hold = (state, idleSet = null) => {
    a.state = state === 'idle' ? 'sleep' : 'idle';
    a.setState(state);
    if (idleSet) a.idleSet = idleSet;
    a.wake = 1;
    for (let i = 0; i < 60; i++) { a.stateT = 0.8; a.idleT = 1.8; a.update(1 / 60, {}); }
    const [L, R] = handsX();
    return { pose: idleSet || state, L, R, clear: L < -0.17 && R > 0.17 };
  };
  const armPoses = [
    ...['sleep', 'greet', 'deal', 'sale', 'refuse'].map((s) => hold(s)),
    ...['survey', 'polish', 'wind', 'drum', 'doze'].map((s) => hold('idle', s)),
  ];
  a.setState('idle');

  return {
    declared: HEIGHT,
    armPoses,
    measured: box.max.y - box.min.y,
    playerHeight: g.player.height,
    zone: zone.name,
    atCounter: Math.hypot(k.position.x - post.site.x, k.position.z - post.site.z) < 1.2,
    fromSpawn: Math.hypot(k.position.x - g.world.playerSpawn.x, k.position.z - g.world.playerSpawn.z),
    onFriendlyRoster: g.friendlies.includes(k),
    tagged: [...k.tags],
    hasPrompt: g.world.interactables.some((it) => String(it.prompt).includes('shopkeeper')),
    // It faces the road: Main St East runs along +Z from here, and an entity
    // faces (+sin yaw, +cos yaw), so facing the road means cos(yaw) ≈ +1.
    facesRoad: Math.cos(k.yaw) > 0.9,
    cosYaw: Math.cos(k.yaw),
    // ...and its own facing is the way in
    reachFront: reach(k.yaw, 4),
    reachLeft: reach(side, 4),
    reachRight: reach(side + Math.PI, 4),
    reachBack: reach(k.yaw + Math.PI, 4),
    interactRadius: g.world.interactables.find((it) => String(it.prompt).includes('shopkeeper'))?.radius,
  };
});
check('the vendor stands at the trading post counter, in Eastgate',
  vendor.atCounter && vendor.zone === 'Eastgate Residential', `${vendor.zone}`);
check('...and never puts a hand through its own waistcoat, in any state it has',
  vendor.armPoses.every((p) => p.clear),
  vendor.armPoses.filter((p) => !p.clear).map((p) => `${p.pose} ${p.L}/${p.R}`).join(', ')
  || `${vendor.armPoses.length} poses, hands out to ±0.17+`);
check('...a short walk from where the run starts', vendor.fromSpawn < 90, `${vendor.fromSpawn.toFixed(0)}m from spawn`);
// The hard constraint on the machine, and the only one: cabinet and figure
// together must come in UNDER the player, by enough that you are plainly
// looking at it rather than up at it. The declared HEIGHT has to match what
// the assembled model actually measures, or every camera and collider derived
// from it is quietly wrong.
check('the whole machine still stands shorter than the player',
  vendor.measured < vendor.playerHeight - 0.1 && Math.abs(vendor.measured - vendor.declared) < 0.05,
  `${vendor.measured.toFixed(2)}m vs player ${vendor.playerHeight}m (declared ${vendor.declared.toFixed(2)})`);
check('it is not on the roster the horde hunts from',
  !vendor.onFriendlyRoster && !vendor.tagged.includes('friendly'), vendor.tagged.join('/'));
check('and it offers a trade prompt', vendor.hasPrompt);
check('the pitch faces the road', vendor.facesRoad, `cos(yaw) ${vendor.cosYaw.toFixed(3)}`);
check('the open front lets you walk up to the machine',
  vendor.reachFront <= vendor.interactRadius,
  `stopped ${vendor.reachFront.toFixed(2)}m out, prompt reaches ${vendor.interactRadius}m`);
check('...and the stacked stock keeps you out of the sides and the back',
  vendor.reachLeft > 1.0 && vendor.reachRight > 1.0 && vendor.reachBack > 1.0,
  `left ${vendor.reachLeft.toFixed(2)}m, right ${vendor.reachRight.toFixed(2)}m, back ${vendor.reachBack.toFixed(2)}m`);

// The real test of "zombies ignore it": put a horde around it with no player
// to chase and check that not one of them ever acquires it, then set off an
// Exploder at the counter and check the vendor is untouched.
const ignored = await page.evaluate(() => {
  const g = window.__game;
  const k = g.shopkeeper;
  const alive = g.player.alive;
  g.player.alive = false;                          // no player: they hunt the roster
  const made = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const z = g.spawner.spawnOne('walker', g.player);
    if (!z) continue;
    z.placeAt(k.position.x + Math.cos(a) * 4, k.position.z + Math.sin(a) * 4);
    made.push(z);
  }
  const ctx = {
    player: g.player, camPos: g.renderer.camera.position, pathBudget: { n: 8 }, time: g.time,
    zombies: g.spawner.zombies, friendlies: g.friendlies, isDay: true, dayFactor: 1,
  };
  let acquired = 0;
  for (let t = 0; t < 180; t++) {
    for (const z of made) { z.update(1 / 30, ctx); if (z.victim === k) acquired++; }
  }
  // and a blast right at the counter
  const boomer = g.spawner.spawnOne('exploder', g.player);
  let hurt = false;
  if (boomer) {
    boomer.placeAt(k.position.x + 0.6, k.position.z + 0.6);
    k.takeDamage = () => { hurt = true; };         // it has none; prove nothing calls one
    boomer._explode(ctx, true);
  }
  for (const z of made) z.toRemove = true;
  if (boomer) boomer.toRemove = true;
  g.player.alive = alive;
  return { acquired, hurt, made: made.length };
});
check('no zombie ever acquires the vendor, even with no player to chase',
  ignored.made >= 3 && ignored.acquired === 0, `${ignored.made} hunters, ${ignored.acquired} acquisitions`);
check('and an Exploder at the counter cannot touch it', ignored.hurt === false);

/* ------------------------------------------------------------------ */
/* 4. the shop                                                          */
/* ------------------------------------------------------------------ */
const shop = await page.evaluate(async () => {
  const { SHOP_STOCK } = await import('/src/rendering/ShopUI.js');
  const g = window.__game;
  const out = { lines: SHOP_STOCK.map((s) => ({ id: s.id, price: s.price, stock: s.stock, locked: !!s.locked })) };
  g.tokens.restore({ tokens: 0, earned: 0, spent: 0 });
  g.sentries.reset();

  // opening through the same interact event the world's prompt fires
  g.events.emit('shop:open', {});
  out.opened = g.shop.open;
  // ...and the world is frozen while it is: a frame changes nothing
  const before = g.time;
  g.frame(1 / 60);
  out.frozen = g.time === before;

  const sentry = SHOP_STOCK.find((s) => s.id === 'sentry');
  out.sentryStock = sentry.stock;
  out.brokeRefused = g._buy(sentry) === false;     // nothing in the purse yet
  g.tokens.add(4000);
  // Buy the machine out, then keep clicking: the stock limit lives in the
  // TILL, not in the button, so going past it through the UI must not work
  // either.
  let bought = 0;
  for (let i = 0; i < sentry.stock; i++) if (g._buy(sentry)) bought++;
  out.boughtAll = bought === sentry.stock;
  g.shop._tryBuy('sentry'); g.shop._tryBuy('sentry');   // through the UI, past the stock
  out.stocked = g.shop.remaining(sentry);
  out.carrying = g.sentries.stored;

  // The adjutant: one only, five hundred, and she lands in the satchel folded.
  const adjutant = SHOP_STOCK.find((s) => s.id === 'companion');
  out.adjutantPrice = adjutant.price;
  out.adjutantStock = adjutant.stock;
  out.adjutantBought = g._buy(adjutant);
  out.adjutantSecond = g._buy(adjutant) === false;      // there is only ever one
  out.adjutantStored = g.companions.stored;

  const rifle = SHOP_STOCK.find((s) => s.id === 'ammo_rifle');
  const w = g.weapons.weapons.find((x) => x.config.id === 'rifle');
  const reserveBefore = w.reserve;
  const paidBefore = g.tokens.tokens;
  out.ammoBought = g._buy(rifle);
  out.ammoGained = w.reserve - reserveBefore;
  out.ammoCost = paidBefore - g.tokens.tokens;

  /* Every line on the shelf has to be drawn as the thing it sells. _drawIcon
   * is a chain of id tests ending in an ELSE that draws pistol rounds, so any
   * line nobody wrote art for silently ships as a tray of ammunition — which
   * is exactly what the adjutant was doing. Hash the pixels of each icon and
   * require them all distinct: a duplicate here means a fall-through. */
  const icons = {};
  for (const s of SHOP_STOCK) {
    const cv = document.createElement('canvas');
    cv.width = 52; cv.height = 52;
    g.shop._drawIcon(cv, s);
    const d = cv.getContext('2d').getImageData(0, 0, 52, 52).data;
    let h = 2166136261, ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 8) ink++;
      h ^= d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11;
      h = Math.imul(h, 16777619);
    }
    icons[s.id] = { hash: h >>> 0, ink };
  }
  out.icons = icons;

  const soon = SHOP_STOCK.find((s) => s.id === 'comingSoon');
  out.lockedRefused = g._buy(soon) === false;
  const spentBefore = g.tokens.tokens;
  g.shop._tryBuy('comingSoon');
  out.lockedFree = g.tokens.tokens === spentBefore;

  // ESCAPE IS INERT HERE. It neither leaves the counter nor reaches the pause
  // screen behind it: it is the key a player hits by reflex, and a counter
  // they walked up to and opened on purpose should not fall over when they do.
  const key = (code, init = {}) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, ...init }));
  key('Escape');
  out.escHolds = g.shop.open;
  out.state = g.state.state;
  out.pause = getComputedStyle(document.getElementById('screen-pause')).display;

  // The ways out are the three that carry user activation — a browser only
  // hands the pointer back to a page holding some, and Escape grants none, so
  // the button, the backdrop and the interact key are the exits that always
  // recapture the mouse on the spot.
  const open = () => { g.events.emit('shop:open', {}); return g.shop.open; };
  out.byInteract = (open(), key(g.input.codesFor("interact")[0]), !g.shop.open);
  out.byButton = (open(), g.shop.closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })), !g.shop.open);
  out.byBackdrop = (open(), g.shop.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), !g.shop.open);
  // clicking the case itself is not a way out
  open();
  g.shop.el.querySelector('.shop-case').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  out.caseHolds = g.shop.open;
  // an auto-repeat of the key that opened it must not close it again
  key(g.input.codesFor("interact")[0], { repeat: true });
  out.survivesRepeat = g.shop.open;
  // Tab belongs to the satchel, and the satchel declines to open here — so at
  // the counter it does nothing at all rather than doing both things at once
  key('Tab');
  out.tabHolds = g.shop.open && !g.inventory.open;
  // Leaving has to be CLEAN: no "click to take the mouse back" plate, and no
  // system cursor sitting in the middle of the street while the browser gets
  // round to the lock.
  open();
  key(g.input.codesFor("interact")[0]);
  await new Promise((r) => requestAnimationFrame(r));
  await new Promise((r) => requestAnimationFrame(r));
  out.exitPrompt = !!document.getElementById('lock-hint');
  out.exitCursorHidden = document.body.classList.contains('in-play');
  out.exitClosed = !g.shop.open && g.state.state === 'playing';
  g.shop.close();
  return out;
});
const stockOf = (id) => shop.lines.find((l) => l.id === id);
check('the counter lists the sentry at 100 with six in stock',
  stockOf('sentry').price === 100 && stockOf('sentry').stock === 6,
  `${stockOf('sentry').price} tokens, ${stockOf('sentry').stock} on the shelf`);
check('...the Mk II at 300, two only',
  stockOf('sentryTwo').price === 300 && stockOf('sentryTwo').stock === 2,
  `${stockOf('sentryTwo')?.price} tokens, ${stockOf('sentryTwo')?.stock} on the shelf`);
check('...and the adjutant at 500, one only',
  stockOf('companion').price === 500 && stockOf('companion').stock === 1,
  `${stockOf('companion')?.price} tokens, ${stockOf('companion')?.stock} on the shelf`);
check('every ammunition type is listed separately at 10',
  ['ammo_pistol', 'ammo_shotgun', 'ammo_rifle', 'ammo_sniper'].every((id) => stockOf(id)?.price === 10),
  shop.lines.filter((l) => l.id.startsWith('ammo_')).map((l) => `${l.id}:${l.price}`).join(' '));
check('and the bottom line is an unbuyable placeholder',
  stockOf('comingSoon').locked && shop.lockedRefused && shop.lockedFree);
const iconIds = Object.keys(shop.icons);
const iconHashes = new Set(iconIds.map((id) => shop.icons[id].hash));
check('every line on the shelf is drawn as the thing it sells',
  iconHashes.size === iconIds.length
  && shop.icons.companion.hash !== shop.icons.ammo_pistol.hash
  && shop.icons.companion.ink > 300,
  iconHashes.size === iconIds.length
    ? `${iconIds.length} distinct icons, the adjutant in ${shop.icons.companion.ink} px of ink`
    : `only ${iconHashes.size} distinct icons across ${iconIds.length} lines`);
check('[E] opens the counter and freezes the street', shop.opened && shop.frozen);
check('an empty purse buys nothing', shop.brokeRefused);
check('the whole shelf of sentries can be bought, and no more than that',
  shop.boughtAll && shop.stocked === 0 && shop.carrying === shop.sentryStock,
  `${shop.carrying} carried, ${shop.stocked} left of ${shop.sentryStock}`);
check('and the adjutant is sold once, at five hundred',
  shop.adjutantBought && shop.adjutantSecond && shop.adjutantStored === 1,
  `bought ${shop.adjutantBought}, refused a second ${shop.adjutantSecond},`
  + ` stored ${shop.adjutantStored}`);
check('ammunition costs 10 and reaches the gun',
  shop.ammoBought && shop.ammoCost === 10 && shop.ammoGained === 30,
  `${shop.ammoGained} rounds for ${shop.ammoCost}`);
check('Escape does nothing at the counter, and never reaches the pause menu',
  shop.escHolds && shop.state === 'playing' && shop.pause === 'none',
  `still open ${shop.escHolds}, state ${shop.state}, pause ${shop.pause}`);
check('the button, the backdrop and [E] all leave too',
  shop.byInteract && shop.byButton && shop.byBackdrop,
  `interact ${shop.byInteract}, button ${shop.byButton}, backdrop ${shop.byBackdrop}`);
check('and nothing else does — the case holds, a key repeat holds, Tab holds',
  shop.caseHolds && shop.survivesRepeat && shop.tabHolds,
  `case ${shop.caseHolds}, repeat ${shop.survivesRepeat}, tab ${shop.tabHolds}`);
check('leaving on [E] shows no prompt and no cursor',
  shop.exitClosed && !shop.exitPrompt && shop.exitCursorHidden,
  `closed ${shop.exitClosed}, prompt ${shop.exitPrompt}, cursor hidden ${shop.exitCursorHidden}`);

/* ONE RULE FOR EVERY OVERLAY: Escape is swallowed and does nothing, and the
 * way out is the key that opened it or a click on the ground outside it. The
 * pause screen is the exception in both directions — Escape is what PUTS IT
 * UP, and only its buttons take it down — and that is checked here too, since
 * an overlay that let Escape through would reach it. */
const esc = await page.evaluate(async () => {
  const g = window.__game;
  const key = (code) => document.dispatchEvent(
    new KeyboardEvent('keydown', { code, key: code, bubbles: true }));
  const outside = (id, type = 'mousedown') => document.getElementById(id)
    .dispatchEvent(new MouseEvent(type, { bubbles: true }));
  const out = {};

  g.inventory.close(); g.companions.reset();
  // the satchel
  g.inventory.toggle();
  key('Escape'); out.satchelHolds = g.inventory.open;
  outside('inventory'); out.satchelClickOut = !g.inventory.open;

  // the order dial
  g.events.emit('pickup', { type: 'companion', amount: 1 });
  const c = g.companions.deploy();
  g.radial.openOn(c);
  key('Escape'); out.dialHolds = g.radial.open;
  outside('radial', 'click'); out.dialClickOut = !g.radial.open;
  g.companions.reset();

  // and the pause screen, which Escape owns from the other side
  out.pausedOnEsc = (key('Escape'), g.state.state);
  out.stillPausedOnEsc = (key('Escape'), g.state.state);
  g.startPlaying();
  out.resumedByButton = g.state.state;
  return out;
});
check('Escape is inert in the satchel and on the order dial as well',
  esc.satchelHolds && esc.dialHolds, `satchel ${esc.satchelHolds}, dial ${esc.dialHolds}`);
check('...and a click outside closes both of them',
  esc.satchelClickOut && esc.dialClickOut,
  `satchel ${esc.satchelClickOut}, dial ${esc.dialClickOut}`);
check('Escape puts the pause screen UP and never takes it down',
  esc.pausedOnEsc === 'paused' && esc.stillPausedOnEsc === 'paused'
  && esc.resumedByButton === 'playing',
  `${esc.pausedOnEsc} → ${esc.stillPausedOnEsc} → ${esc.resumedByButton} on RESUME`);

/* ------------------------------------------------------------------ */
/* 5. the sentry                                                        */
/* ------------------------------------------------------------------ */
const sentry = await page.evaluate(async () => {
  const { SENTRY_RANGE, SENTRY_ARC, SENTRY_DAMAGE, SENTRY_INTERVAL } = await import('/src/entities/Sentry.js');
  const { WEAPON_CONFIGS } = await import('/src/weapons/WeaponConfigs.js');
  const pistol = WEAPON_CONFIGS.find((c) => c.id === 'pistol');
  const g = window.__game;
  const out = { range: SENTRY_RANGE, arc: SENTRY_ARC, damage: SENTRY_DAMAGE, interval: SENTRY_INTERVAL,
    pistolDamage: pistol.damage, pistolInterval: pistol.fireInterval };

  g.sentries.reset();
  g.events.emit('pickup', { type: 'sentry', amount: 1, label: 'Portable Sentry' });
  out.stored = g.sentries.stored;
  // stand on the open Green, facing a known direction, and take it in hand
  g.player.position.set(158, g.world.groundHeightFor(158, 42, 1e9), 42);
  g.player.yaw = 0;                     // the player faces -Z at yaw 0
  out.tookToHand = g.sentries.takeToHand();
  g.sentries.update(1 / 60, { zombies: [] }, null);
  out.previewShown = g.sentries.preview.visible;
  out.spotAhead = g.sentries.spot.z < g.player.position.z;   // in front, i.e. -Z

  const s = g.sentries.place();
  out.placed = !!s;
  out.deployed = g.sentries.deployed.length;
  out.storedAfter = g.sentries.stored;
  // it points where the player looked: forward is -Z, and an entity's yaw
  // faces (+sin, +cos), so a sentry aimed forward has cos(yaw) ≈ -1
  out.facesForward = Math.cos(s.yaw) < -0.99;
  out.coversAhead = s.covers(s.position.x, s.position.z - 4);
  out.coversBehind = s.covers(s.position.x, s.position.z + 4);
  out.coversFar = s.covers(s.position.x, s.position.z - (SENTRY_RANGE + 1));
  out.coversSide = s.covers(s.position.x + 3, s.position.z);

  // one zombie in the arc, one behind it
  const inArc = g.spawner.spawnOne('walker', g.player);
  const behind = g.spawner.spawnOne('walker', g.player);
  inArc.placeAt(s.position.x, s.position.z - 3);
  behind.placeAt(s.position.x, s.position.z + 3);
  const hpIn = inArc.hp, hpBehind = behind.hp;
  const ctx = { zombies: [inArc, behind] };
  for (let t = 0; t < 240; t++) s.update(1 / 60, ctx);   // 4 s, past the deploy
  out.hitInArc = hpIn - inArc.hp;
  out.hitBehind = hpBehind - behind.hp;
  out.shots = s.shotsFired;
  out.zombieTargetedSentry = [inArc, behind].some((z) => z.victim === s);

  // and [E] packs it away again
  g.events.emit('sentry:retrieve', { sentry: s });
  out.retrieved = g.sentries.deployed.length === 0 && g.sentries.stored === 1;

  // the satchel shows what the system actually owns, at every step — and
  // still does after a checkpoint rollback wipes the field
  const slot = () => g.inventory.items.get('Portable Sentry')?.count ?? 0;
  out.slotStored = slot();
  g.sentries.takeToHand();
  out.slotInHand = slot();                  // in your hands is not in the bag
  g.sentries.place();
  out.slotPlaced = slot();
  g.sentries.restore({ stored: 2, deployed: [] });
  out.slotRolledBack = slot();
  g.sentries.reset();
  out.slotAfterReset = slot();

  inArc.toRemove = true; behind.toRemove = true;
  return out;
});
check('the sentry reaches about sixty feet over a 180° arc',
  Math.abs(sentry.range - 18.288) < 0.01 && Math.abs(sentry.arc - Math.PI) < 1e-9,
  `${sentry.range.toFixed(2)}m, ${(sentry.arc * 180 / Math.PI).toFixed(0)}°`);
check('it shoots for the pistol\'s damage at the pistol\'s rate',
  sentry.damage === sentry.pistolDamage && sentry.interval === sentry.pistolInterval,
  `${sentry.damage} dmg every ${sentry.interval}s`);
check('taking it in hand shows the placement preview ahead of the player',
  sentry.tookToHand && sentry.previewShown && sentry.spotAhead);
check('placing it leaves it facing the way the player looked',
  sentry.placed && sentry.facesForward && sentry.coversAhead && sentry.coversSide,
  `cos(yaw) test ${sentry.facesForward}`);
check('its arc excludes what is behind it and what is out of range',
  !sentry.coversBehind && !sentry.coversFar);
check('it engages a target in its arc and never one behind it',
  sentry.hitInArc > 0 && sentry.hitBehind === 0,
  `${sentry.shots} shots, ${sentry.hitInArc} damage in arc, ${sentry.hitBehind} behind`);
check('and the horde never targets the sentry itself', sentry.zombieTargetedSentry === false);
check('[E] packs it back into the satchel', sentry.retrieved);
check('and the satchel always shows what you actually own',
  sentry.slotStored === 1 && sentry.slotInHand === 0 && sentry.slotPlaced === 0
  && sentry.slotRolledBack === 2 && sentry.slotAfterReset === 0,
  `stowed ${sentry.slotStored}, in hand ${sentry.slotInHand}, placed ${sentry.slotPlaced}, `
  + `rolled back ${sentry.slotRolledBack}, reset ${sentry.slotAfterReset}`);

/* ------------------------------------------------------------------ */
/* 5b. the Sentry Mk II                                                 */
/* ------------------------------------------------------------------ */
/* The second deployable, and everything about it that is a PROMISE rather
 * than a preference: twice the reach, 240° instead of 180°, two rounds a
 * pull, its own satchel slot, its own ghost and wedge, and the horde still
 * not knowing either machine is there. */
const mk2 = await page.evaluate(async () => {
  const { TWO_RANGE, TWO_ARC, TWO_INTERVAL, TWO_DAMAGE, TWO_BARRELS, SentryTwo } =
    await import('/src/entities/SentryTwo.js');
  const { SENTRY_RANGE, SENTRY_ARC, SENTRY_INTERVAL, SENTRY_DAMAGE } = await import('/src/entities/Sentry.js');
  const g = window.__game;
  const out = {
    rangeRatio: TWO_RANGE / SENTRY_RANGE,
    arcDeg: Math.round(TWO_ARC * 180 / Math.PI),
    faster: TWO_INTERVAL < SENTRY_INTERVAL,
    sameBullet: TWO_DAMAGE === SENTRY_DAMAGE,
    barrels: TWO_BARRELS,
  };
  g.sentries.reset();
  g.tokens.restore({ tokens: 2000, earned: 2000, spent: 0 });

  // ONE SLOT EACH. Buying a Mk II must never top up the Mk I's tally.
  g.events.emit('pickup', { type: 'sentry', amount: 1 });
  g.events.emit('pickup', { type: 'sentryTwo', amount: 1 });
  const slot = (k) => g.inventory.items.get(k)?.count ?? 0;
  out.slots = { mk1: slot('Portable Sentry'), mk2: slot('Sentry Mk II') };

  // TAKEN TO HAND, it shows ITS OWN ghost and ITS OWN wedge.
  g.sentries.takeToHand('sentryTwo');
  out.holding = g.sentries.holding;
  out.mk2SlotEmptied = slot('Sentry Mk II') === 0 && slot('Portable Sentry') === 1;
  g.sentries.update(1 / 60, { zombies: [] }, null, true);
  const view = g.sentries.previews.sentryTwo;
  const pos = view.fanGeo.attributes.position;
  let far = 0, wide = 0;
  for (let i = 0; i < pos.count; i++) {
    far = Math.max(far, Math.hypot(pos.getX(i), pos.getZ(i)));
    wide = Math.max(wide, Math.abs(Math.atan2(pos.getX(i), pos.getZ(i))));
  }
  out.wedgeRadius = far;
  out.wedgeHalfArcDeg = Math.round(wide * 180 / Math.PI);
  out.onlyOnePreview = view.group.visible && !g.sentries.previews.sentry.group.visible;

  // PLACED with a click, exactly like the Mk I.
  const placed = g.sentries.place();
  out.placedKind = placed?.kind;
  out.handEmpty = g.sentries.holding === null;
  for (let i = 0; i < 130; i++) placed.update(1 / 60, { zombies: [], player: g.player });
  out.stoodUp = placed.state !== 'deploy';

  // WHAT IT COVERS: a target at 30 m is past the Mk I's reach entirely, and
  // one 100° off the centre line is outside the Mk I's arc.
  const at = (dist, deg) => {
    const a = placed.yaw + deg * Math.PI / 180;
    return [placed.position.x + Math.sin(a) * dist, placed.position.z + Math.cos(a) * dist];
  };
  const mk1 = { covers: (x, z) => {
    const dx = x - placed.position.x, dz = z - placed.position.z;
    if (dx * dx + dz * dz > SENTRY_RANGE * SENTRY_RANGE) return false;
    let rel = Math.atan2(dx, dz) - placed.yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    return Math.abs(rel) <= SENTRY_ARC / 2;
  } };
  out.reachesFar = placed.covers(...at(30, 0)) && !mk1.covers(...at(30, 0));
  out.reachesWide = placed.covers(...at(10, 100)) && !mk1.covers(...at(10, 100));
  out.stillHasABack = !placed.covers(...at(10, 160));
  out.notPastItsOwnRange = !placed.covers(...at(TWO_RANGE + 2, 0));

  // TWO BULLETS A PULL. Counted through the real takeDamage pipeline.
  const realLos = g.world.hasLineOfSight;
  g.world.hasLineOfSight = () => true;
  let hits = 0, dmg = 0;
  const dummy = {
    state: 'walk', height: 1.8, position: { x: 0, y: placed.position.y, z: 0 },
    takeDamage(d) { hits++; dmg += d; },
  };
  const [dx, dz] = at(24, 0);                    // well past the Mk I's reach
  dummy.position.x = dx; dummy.position.z = dz;
  placed.headYaw = 0; placed.converge = 1; placed.cooldown = 0;
  const beforePulls = placed.shotsFired;
  for (let i = 0; i < 60; i++) placed.update(1 / 60, { zombies: [dummy], player: g.player });
  out.pulls = placed.shotsFired - beforePulls;
  out.hitsPerPull = out.pulls ? hits / out.pulls : 0;
  out.damagePerPull = out.pulls ? dmg / out.pulls : 0;
  out.rounds = placed.roundsFired;

  // IT CHANGES ITS OWN DRUM, and cannot fire while it does.
  placed.drum = 1;
  const pullsAtEmpty = placed.shotsFired;
  for (let i = 0; i < 30; i++) placed.update(1 / 60, { zombies: [dummy], player: g.player });
  out.wentToReload = placed.state === 'reload';
  const pullsInReload = placed.shotsFired - pullsAtEmpty;
  for (let i = 0; i < 130; i++) placed.update(1 / 60, { zombies: [dummy], player: g.player });
  out.reloadHeldFire = pullsInReload <= 1;       // the pull that emptied it, at most
  out.drumRefilled = placed.drum > 1;
  g.world.hasLineOfSight = realLos;

  // THE HORDE DOES NOT KNOW IT IS THERE — the same rule as the Mk I.
  out.offRoster = !g.friendlies.includes(placed);
  out.tags = [...placed.tags];

  // [E] PUTS IT BACK IN ITS OWN SLOT, not the Mk I's.
  g.events.emit('sentry:retrieve', { sentry: placed });
  out.packedAway = { mk2: slot('Sentry Mk II'), mk1: slot('Portable Sentry'),
    gone: g.sentries.deployed.length === 0 };

  // ...and a death brings both kinds home, stowed. One of each goes out —
  // the Mk I bought at the top, the Mk II the [E] above just packed away.
  g.sentries.takeToHand('sentry');
  g.sentries.place();
  g.sentries.takeToHand('sentryTwo');
  g.sentries.place();
  const recovered = g.sentries.recallAll();
  out.recall = { recovered, mk1: slot('Portable Sentry'), mk2: slot('Sentry Mk II'),
    standing: g.sentries.deployed.length };

  // and the save carries the pair, kinds and all
  g.sentries.takeToHand('sentryTwo');
  g.sentries.place();
  const snap = g.sentries.snapshot();
  out.snapKinds = snap.deployed.map((d) => d.kind).join(',');
  out.snapCounts = `${snap.counts.sentry}/${snap.counts.sentryTwo}`;
  g.sentries.reset();
  g.sentries.restore(snap);
  out.restoredKinds = g.sentries.deployed.map((s) => s.kind).join(',');
  g.sentries.reset();
  return out;
});
check('the Mk II reaches exactly twice as far, over 240° instead of 180°',
  mk2.rangeRatio === 2 && mk2.arcDeg === 240,
  `${mk2.rangeRatio}× range, ${mk2.arcDeg}°`);
check('...and the wedge you aim with is drawn from those same numbers',
  Math.abs(mk2.wedgeRadius - 36.576) < 0.01 && mk2.wedgeHalfArcDeg === 120 && mk2.onlyOnePreview,
  `${mk2.wedgeRadius.toFixed(2)} m, ±${mk2.wedgeHalfArcDeg}°, one preview ${mk2.onlyOnePreview}`);
check('it has its own satchel slot, and taking one empties only that slot',
  mk2.slots.mk1 === 1 && mk2.slots.mk2 === 1 && mk2.holding === 'sentryTwo' && mk2.mk2SlotEmptied,
  `mk1 ${mk2.slots.mk1}, mk2 ${mk2.slots.mk2}, held ${mk2.holding}`);
check('clicking puts a Mk II on the ground, and it stands itself up',
  mk2.placedKind === 'sentryTwo' && mk2.handEmpty && mk2.stoodUp);
check('it covers what the Mk I cannot — 30 m out, and 100° off the centre line',
  mk2.reachesFar && mk2.reachesWide && mk2.stillHasABack && mk2.notPastItsOwnRange,
  `far ${mk2.reachesFar}, wide ${mk2.reachesWide}, still has a back ${mk2.stillHasABack}`);
check('one pull is TWO bullets, at a faster rate than the Mk I, for the same damage each',
  mk2.hitsPerPull === 2 && mk2.damagePerPull === 24 && mk2.faster && mk2.sameBullet
  && mk2.rounds === mk2.pulls * 2,
  `${mk2.pulls} pulls → ${mk2.rounds} rounds, ${mk2.hitsPerPull}/pull for ${mk2.damagePerPull}`);
check('it changes its own drum, and holds fire while it does',
  mk2.wentToReload && mk2.reloadHeldFire && mk2.drumRefilled,
  `reloaded ${mk2.wentToReload}, held fire ${mk2.reloadHeldFire}, refilled ${mk2.drumRefilled}`);
check('and the horde has no idea it is there either',
  mk2.offRoster && !mk2.tags.includes('friendly'), mk2.tags.join('/'));
check('[E] packs it into ITS OWN slot, not the Mk I\'s',
  mk2.packedAway.mk2 === 1 && mk2.packedAway.mk1 === 1 && mk2.packedAway.gone,
  `mk2 ${mk2.packedAway.mk2}, mk1 ${mk2.packedAway.mk1}`);
check('dying brings both kinds home, stowed and sorted',
  mk2.recall.recovered === 2 && mk2.recall.mk1 === 1 && mk2.recall.mk2 === 1
  && mk2.recall.standing === 0,
  `${mk2.recall.recovered} recovered → mk1 ${mk2.recall.mk1}, mk2 ${mk2.recall.mk2}`);
check('...and the save carries which machine is which',
  mk2.snapKinds === 'sentryTwo' && mk2.restoredKinds === 'sentryTwo' && mk2.snapCounts === '1/0',
  `saved ${mk2.snapKinds} (counts ${mk2.snapCounts}), restored ${mk2.restoredKinds}`);

/* ------------------------------------------------------------------ */
/* 6. the sentry's new tricks                                          */
/* ------------------------------------------------------------------ */
// Three things the machine gained: it can be spawned from the console as an
// ORDINARY sentry (not a special one), its arc can be trimmed in hand, and it
// has an inner life when nothing is happening.
const tricks = await page.evaluate(async () => {
  const g = window.__game;
  const { SENTRY_ARC } = await import('/src/entities/Sentry.js');
  const out = {};
  g.sentries.reset();

  // spawn: a foot in front, deployed, and inside its own interact radius
  const before = g.world.interactables.length;
  const s = g.sentries.spawnAhead(g.player);
  out.spawnedDeployed = g.sentries.deployed.length === 1 && s.state === 'deploy';
  out.spawnDist = Math.hypot(s.position.x - g.player.position.x, s.position.z - g.player.position.z);
  out.spawnClose = out.spawnDist < 0.6;                       // ~a foot
  out.spawnPrompt = g.world.interactables.length === before + 1;
  // it is the ordinary machine: [E] packs it into the satchel like a bought one
  g.events.emit('sentry:retrieve', { sentry: s });
  out.packable = g.sentries.deployed.length === 0 && g.sentries.stored === 1;

  // [R] trims the arc 25 degrees a press, and only the ARC — not the spot
  g.sentries.takeToHand();
  const spot0 = g.sentries._resolveSpot();
  g.sentries.rotate(1);
  const spot1 = g.sentries._resolveSpot();
  out.stepDeg = Math.round((spot1.yaw - spot0.yaw) * 180 / Math.PI);
  out.spotHeld = Math.hypot(spot1.x - spot0.x, spot1.z - spot0.z) < 1e-6;
  // ...and it is the arc that actually lands on the machine. place() commits
  // the spot the last frame resolved, so resolve one first — which is what
  // update() does every frame while the thing is in your hands.
  for (let i = 0; i < 3; i++) g.sentries.rotate(1);
  g.sentries.spot = g.sentries._resolveSpot();
  const placed = g.sentries.place();
  out.placedYaw = placed ? Math.round(((placed.yaw - spot0.yaw) * 180 / Math.PI + 720) % 360) : -1;
  out.arc = SENTRY_ARC;

  // the idle life: left alone with nothing to shoot it starts doing things
  const t = g.sentries.deployed[0];
  const ctx = { zombies: [], player: { alive: false, position: { x: 1e6, y: 0, z: 1e6 } } };
  const seen = new Set();
  for (let i = 0; i < 60 * 130; i++) {
    t.update(1 / 60, ctx);
    if (t.routine) seen.add(t.routine);
  }
  out.routines = [...seen];
  // and the player standing in front of it gets noticed
  t.quiet = 20; t.saluteReady = 0; t.routine = null; t.sawPlayer = 0;
  const px = t.position.x + Math.sin(t.yaw) * 3, pz = t.position.z + Math.cos(t.yaw) * 3;
  const near = { zombies: [], player: { alive: true, position: { x: px, y: t.position.y, z: pz } } };
  let saluted = false;
  for (let i = 0; i < 60 * 6 && !saluted; i++) {
    t.update(1 / 60, near);
    if (t.routine === 'salute') saluted = true;
  }
  out.salutes = saluted;
  g.sentries.reset();
  return out;
});
check('spawn puts an ORDINARY sentry a foot in front of you',
  tricks.spawnedDeployed && tricks.spawnClose && tricks.spawnPrompt && tricks.packable,
  `${tricks.spawnDist.toFixed(2)}m out, prompt ${tricks.spawnPrompt}, packs up ${tricks.packable}`);
check('[R] swings the arc 25° a press and leaves the spot alone',
  tricks.stepDeg === 25 && tricks.spotHeld && tricks.placedYaw === 100,
  `${tricks.stepDeg}° a press, spot held ${tricks.spotHeld}, placed at ${tricks.placedYaw}°`);
check('and left alone it finds things to do with itself',
  tricks.routines.length >= 2 && tricks.routines.includes('doze'),
  tricks.routines.join(' ') || 'none');
check('...including noticing you standing in front of it',
  tricks.salutes, `saluted ${tricks.salutes}`);

/* ------------------------------------------------------------------ */
/* 7. the adjutant                                                     */
/* ------------------------------------------------------------------ */
const adjutant = await page.evaluate(async () => {
  const { ANDROID_HEIGHT } = await import('/src/rendering/AndroidModel.js');
  const { ORDERS } = await import('/src/rendering/RadialMenu.js');
  const g = window.__game;
  const out = { declared: ANDROID_HEIGHT, playerHeight: g.player.height };
  g.companions.reset();
  g.events.emit('pickup', { type: 'companion', amount: 1, label: 'Adjutant Unit' });
  out.stored = g.companions.stored;

  const THREE = await import('/lib/three.module.js');
  const c = g.companions.deploy();
  out.deployed = !!c && g.companions.stored === 0;

  // Let her finish standing up before measuring: she arrives folded into a
  // ball and unfolds over a couple of seconds, so a height taken mid-unfold
  // is the height of the ball.
  const ctx = { zombies: [], player: g.player, camPos: g.renderer.camera.position };
  for (let i = 0; i < 260; i++) c.update(1 / 60, ctx);
  out.stoodUp = c.state !== 'unfold';
  c.mesh.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(c.mesh);
  out.measured = box.max.y - box.min.y;
  out.shorter = out.measured < g.player.height - 0.15;

  // she carries no gun anywhere in her rig — the rule, checked
  let guns = 0;
  c.mesh.traverse((o) => { if (/barrel|muzzle|magazine|gun/i.test(o.name)) guns++; });
  out.gunParts = guns;

  // ORDERS: every wedge on the dial is a command she answers to
  out.wedges = ORDERS.length;
  out.everyOrderTakes = ORDERS.filter((o) => o.cmd !== 'pickup')
    .every((o) => c.order(o.cmd) === true);
  c.order('stay'); c.order('ranged');
  out.describes = c.describe();
  out.postAtStay = Math.hypot(c.post.x - c.position.x, c.post.z - c.position.z) < 0.01;

  // she walks: told to follow a player who has moved, she covers ground
  c.order('follow'); c.order('passive');
  const start = { x: c.position.x, z: c.position.z };
  const far = { alive: true, height: 1.75, yaw: 0, position: { x: c.position.x + 12, y: c.position.y, z: c.position.z } };
  const walkCtx = { zombies: [], player: far, camPos: g.renderer.camera.position };
  const gaits = new Set();
  for (let i = 0; i < 60 * 6; i++) { c.update(1 / 60, walkCtx); gaits.add(c.state); }
  out.walked = Math.hypot(c.position.x - start.x, c.position.z - start.z);
  out.gaits = [...gaits];

  // ...and her hardware comes out only when she is allowed to fight
  const z = { state: 'idle', height: 1.8, position: { x: c.position.x + 1.2, y: c.position.y, z: c.position.z },
    takeDamage() { this.hit = (this.hit || 0) + 1; } };
  c.order('melee');
  const fightCtx = { zombies: [z], player: far, camPos: g.renderer.camera.position };
  for (let i = 0; i < 90; i++) c.update(1 / 60, fightCtx);
  out.bladesOut = c.anim.bladeOut > 0.5;
  out.hitIt = (z.hit || 0) > 0;
  c.order('ranged');
  z.position.x = c.position.x + 8;
  for (let i = 0; i < 150; i++) c.update(1 / 60, fightCtx);
  out.podsOut = c.anim.podOut > 0.5;
  c.order('passive');
  for (let i = 0; i < 200; i++) c.update(1 / 60, fightCtx);
  out.standsDown = c.anim.bladeOut < 0.05 && c.anim.podOut < 0.05 && c.target === null;

  /* REACH. Her arc is the reason to take her rather than another sentry, so
   * three things about its range are pinned here. Sight lines are forced open
   * for the duration — this is a range test, not a level-geometry test — and
   * the shots are counted off the arc EVENT, because the range governs whether
   * she fires at all, not what the bolt then does. */
  const realLos = g.world.hasLineOfSight.bind(g.world);
  g.world.hasLineOfSight = () => true;
  let arcs = 0;
  const offArc = g.events.on('companion:arc', () => { arcs++; });
  const shootFrom = (dist, cmds, frames = 300) => {
    for (const cmd of cmds) c.order(cmd);
    z.position.x = c.position.x + dist; z.position.z = c.position.z;
    z.hit = 0; arcs = 0;
    const held = { x: c.position.x, z: c.position.z };
    c.anim.bladeOut = 0;
    for (let i = 0; i < frames; i++) c.update(1 / 60, fightCtx);
    return { arcs, hit: z.hit || 0, moved: Math.hypot(c.position.x - held.x, c.position.z - held.z),
      blades: c.anim.bladeOut };
  };
  // 1. 18 m — comfortably past the 13 m she used to have — pinned by STAY, so
  //    a hit cannot be her having quietly walked into her old range.
  out.long = shootFrom(18, ['stay', 'ranged']);
  // 2. On ATTACK at 8 m she still picks the arc. The melee preference used to
  //    be a FRACTION of the arc range, so every extension of her reach turned
  //    her into a melee unit that charged from further out.
  out.mid = shootFrom(8, ['attack']);
  // 3. On GUARD she shoots what she can see from her post rather than only
  //    what she would chase: 15 m is well past the 9 m chase leash.
  c.post = { x: c.position.x, z: c.position.z };
  out.guard = shootFrom(15, ['guard', 'ranged']);
  offArc();
  g.world.hasLineOfSight = realLos;
  c.order('follow'); c.order('passive');

  /* BOTH ARMS THE SAME WAY ROUND. Her poses are written body-relative — a
   * positive roll is away from the torso on either side — and mirrored ONCE,
   * in CompanionAnimator._apply. Say it in the pose as well and the mirror is
   * applied twice: one arm braces out and the other swings through her ribs,
   * which is invisible to every check above and glaring from two metres away.
   * So: hold a pose, and require the two hands to land as mirror images with
   * neither of them inside the body. */
  const handsX = () => {
    c.mesh.updateWorldMatrix(true, true);
    const chest = c.rig.parts.chest;
    return c.rig.parts.arms.map((a) => {
      const v = new THREE.Vector3();
      a.hand.getWorldPosition(v);
      return +chest.worldToLocal(v).x.toFixed(3);
    });
  };
  const hold = (state, t = null, frames = 90) => {
    c.anim.setState('idle'); c.anim.setState(state);
    for (let i = 0; i < frames; i++) {
      if (t !== null) c.anim.stateT = t;                 // pin one instant of a cycle
      c.anim.update(1 / 60, { speed: state === 'walk' ? 2 : 0 });
    }
    return handsX();
  };
  out.symmetry = ['alert', 'ranged', 'sit', 'walk'].map((s) => {
    const [l, r] = hold(s);
    return { s, l, r, ok: Math.abs(l + r) < 0.03 && l < -0.15 && r > 0.15 };
  });
  // The melee combo alternates which arm swings, so its two beats are not
  // symmetric in themselves — they are mirrors of EACH OTHER, and were not.
  const beatA = hold('melee', 0.4);
  const beatB = hold('melee', 1.3);
  out.combo = { beatA, beatB,
    ok: Math.abs(beatA[0] + beatB[1]) < 0.03 && Math.abs(beatA[1] + beatB[0]) < 0.03 };

  /* THE DIAL ITSELF. Eight wells cut into the plate, the two orders she is
   * holding lit, an order taken off it landing on her and relighting — and the
   * flash it lands with put out behind it, because a class left on a wedge is
   * still lit the next time she is asked for orders. */
  c.order('follow'); c.order('attack');
  g.radial.openOn(c);
  const litNow = () => [...document.querySelectorAll('#radial .rad-wedge.on')]
    .map((w) => w.dataset.cmd).sort().join('+');
  out.dial = { wells: document.querySelectorAll('#radial .rad-wedge').length, lit: litNow() };
  document.querySelector('#radial .rad-wedge[data-cmd="stay"]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  out.dial.took = c.posture === 'stay';
  out.dial.hub = document.querySelector('#radial .rad-hub-state').textContent;
  out.dial.relit = litNow();
  g.radial.close();
  out.dial.clean = !g.radial.open && document.querySelectorAll('#radial .ping').length === 0;
  c.order('follow');

  // the horde must not know she is there
  out.onFriendlyRoster = g.friendlies.includes(c);
  out.tagged = [...c.tags];

  // pack up, and she is back in the satchel
  out.packed = g.companions.command('pickup') === false
    && g.companions.unit === null && g.companions.stored === 1;
  g.companions.reset();
  return out;
});
check('the adjutant stands shorter than the player',
  adjutant.shorter && Math.abs(adjutant.measured - adjutant.declared) < 0.06,
  `${adjutant.measured.toFixed(2)}m vs player ${adjutant.playerHeight}m (declared ${adjutant.declared})`);
check('she unfolds out of the satchel and stands up',
  adjutant.stored === 1 && adjutant.deployed && adjutant.stoodUp, `state after unfolding: ${adjutant.stoodUp}`);
check('every order on the dial is one she answers to',
  adjutant.wedges === 8 && adjutant.everyOrderTakes && adjutant.describes === 'HOLDING · ARC',
  `${adjutant.wedges} orders, "${adjutant.describes}"`);
check('STAY pins her post to where she is standing', adjutant.postAtStay);
check('told to follow, she walks — and runs when she is behind',
  adjutant.walked > 6 && adjutant.gaits.includes('walk') && adjutant.gaits.includes('run'),
  `${adjutant.walked.toFixed(1)}m covered, gaits ${adjutant.gaits.join('/')}`);
check('her weapons are built in, and come out only when they are allowed',
  adjutant.gunParts === 0 && adjutant.bladesOut && adjutant.hitIt && adjutant.podsOut && adjutant.standsDown,
  `gun parts ${adjutant.gunParts}, blades ${adjutant.bladesOut}, hit ${adjutant.hitIt},`
  + ` pods ${adjutant.podsOut}, stood down ${adjutant.standsDown}`);
check('the dial cuts eight wells, lights the two she holds, and takes an order',
  adjutant.dial.wells === 8 && adjutant.dial.lit === 'attack+follow'
  && adjutant.dial.took && adjutant.dial.relit === 'attack+stay'
  && adjutant.dial.hub === 'HOLDING · FREE' && adjutant.dial.clean,
  `${adjutant.dial.wells} wells, lit ${adjutant.dial.lit} → ${adjutant.dial.relit},`
  + ` hub "${adjutant.dial.hub}", left clean ${adjutant.dial.clean}`);
check('both arms are posed as mirrors, with neither hand inside her',
  adjutant.symmetry.every((p) => p.ok),
  adjutant.symmetry.map((p) => `${p.s} ${p.l}/${p.r}`).join(', '));
check('...and the blade combo reads the same on the backhand as the forehand',
  adjutant.combo.ok,
  `beats ${adjutant.combo.beatA.join('/')} then ${adjutant.combo.beatB.join('/')}`);
check('her arc reaches well past the sentry\'s, and she fires without closing',
  adjutant.long.arcs > 0 && adjutant.long.hit > 0 && adjutant.long.moved < 0.6,
  `${adjutant.long.arcs} bolts at 18 m, ${adjutant.long.hit} hits, moved ${adjutant.long.moved.toFixed(2)}m`);
check('...and the longer reach did not turn her into a melee unit',
  adjutant.mid.arcs > 0 && adjutant.mid.blades < 0.5,
  `at 8 m on ATTACK: ${adjutant.mid.arcs} bolts, blades ${adjutant.mid.blades.toFixed(2)}`);
check('...and a guard shoots what she can see, not just what she would chase',
  adjutant.guard.arcs > 0 && adjutant.guard.moved < 1.2,
  `${adjutant.guard.arcs} bolts at 15 m from post, moved ${adjutant.guard.moved.toFixed(2)}m`);
check('and the horde has no idea she exists',
  !adjutant.onFriendlyRoster && !adjutant.tagged.includes('friendly'), adjutant.tagged.join('/'));
check('PACK UP folds her back into the satchel', adjutant.packed);

/* ------------------------------------------------------------------ */
/* 8. dying hands the kit back                                          */
/* ------------------------------------------------------------------ */
/* A death rolls the run back a wave. It does not confiscate hardware the
 * player paid tokens for, and it must not leave that hardware where they
 * died — the respawn point is somewhere else entirely. So: everything they
 * own comes back STOWED, and everything already in the satchel stays. */
const death = await page.evaluate(async () => {
  const { DROPPABLE } = await import('/src/systems/Inventory.js');
  const g = window.__game;
  // Everything the satchel lets you put OUT is something a death has to fetch
  // back. If a fifth droppable ever lands here, Game.respawn needs to know
  // about it, and this is where that gets noticed.
  const out = { droppable: [...DROPPABLE].sort().join(',') };
  g.sentries.reset(); g.companions.reset();
  const s = g.world.playerSpawn;
  g.player.teleport(s.x, g.world.groundHeightFor(s.x, s.z, 1e9), s.z);
  const cube = g.world.companionCube;

  // A cube nobody has found is not the player's yet, and a death must not
  // reach into the maintenance room and hand it over.
  out.unfoundStays = cube.recall() === false && !cube.taken;

  // three sentries: one stowed, one in the hands, one bolted to the pavement
  for (let i = 0; i < 3; i++) g.events.emit('pickup', { type: 'sentry', amount: 1 });
  g.sentries.takeToHand(); g.sentries.place();
  g.sentries.takeToHand();
  // the adjutant, standing in the street
  g.events.emit('pickup', { type: 'companion', amount: 1 });
  g.companions.deploy();
  // the cube, found and then set back down out in the world — through the
  // satchel, the way a player does it, so the drop wiring is under test too
  cube._take();
  [...g.inventory.gridEl.querySelectorAll('.inv-slot.droppable')]
    .find((el) => el.dataset.label === 'Companion Cube')
    ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  // and a key, which was in the satchel the whole time and must still be
  g.events.emit('pickup', { type: 'key', amount: 1, label: 'Brass Key' });

  const slot = (k) => g.inventory.items.get(k)?.count ?? 0;
  const state = () => ({
    stowed: slot('Portable Sentry'), placed: g.sentries.deployed.length,
    holding: g.sentries.holding, adjutant: slot('Adjutant Unit'),
    standing: !!g.companions.unit, cube: slot('Companion Cube'),
    cubeDown: !cube.taken, key: slot('Brass Key'),
  });
  out.before = state();

  g.events.emit('player:died');
  out.died = g.state.state === 'dead';
  g.respawn();
  out.after = state();
  out.playing = g.state.state === 'playing';

  g.sentries.reset(); g.companions.reset();
  return out;
});
check('before dying: one sentry stowed, one held, one placed, and the rest out in the world',
  death.before.stowed === 1 && death.before.holding && death.before.placed === 1
  && death.before.standing && death.before.cubeDown && death.before.cube === 0
  && death.before.key === 1,
  `stowed ${death.before.stowed}, held ${death.before.holding}, placed ${death.before.placed},`
  + ` adjutant standing ${death.before.standing}, cube down ${death.before.cubeDown}`);
check('dying hands every piece of it back, stowed',
  death.died && death.playing && death.after.stowed === 3 && death.after.placed === 0
  && !death.after.holding && death.after.adjutant === 1 && !death.after.standing
  && death.after.cube === 1 && !death.after.cubeDown,
  `sentries ${death.after.stowed} stowed / ${death.after.placed} placed / held ${death.after.holding},`
  + ` adjutant ${death.after.adjutant} stowed (standing ${death.after.standing}), cube ${death.after.cube}`);
check('...and what was already in the satchel is untouched',
  death.after.key === 1, `key ${death.after.key}`);
check('...while a cube nobody has found stays where it is hidden', death.unfoundStays);
check('...and that kit is everything the satchel can put out in the first place',
  death.droppable === 'companion,companionCube,sentry,sentryTwo', death.droppable);

check('no console errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(failures === 0 ? '\nall shop/token/sentry checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
