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
 *      on Escape straight back into the game rather than to the pause menu
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
  return {
    declared: HEIGHT,
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
  out.brokeRefused = g._buy(sentry) === false;     // nothing in the purse yet
  g.tokens.add(1000);
  out.first = g._buy(sentry);
  out.second = g._buy(sentry);
  g.shop._tryBuy('sentry'); g.shop._tryBuy('sentry');   // through the UI, past the stock
  out.stocked = g.shop.remaining(sentry);
  out.carrying = g.sentries.stored;

  const rifle = SHOP_STOCK.find((s) => s.id === 'ammo_rifle');
  const w = g.weapons.weapons.find((x) => x.config.id === 'rifle');
  const reserveBefore = w.reserve;
  const paidBefore = g.tokens.tokens;
  out.ammoBought = g._buy(rifle);
  out.ammoGained = w.reserve - reserveBefore;
  out.ammoCost = paidBefore - g.tokens.tokens;

  const soon = SHOP_STOCK.find((s) => s.id === 'comingSoon');
  out.lockedRefused = g._buy(soon) === false;
  const spentBefore = g.tokens.tokens;
  g.shop._tryBuy('comingSoon');
  out.lockedFree = g.tokens.tokens === spentBefore;

  // Escape leaves the counter and goes back to the game, never to the pause
  const key = (code, init = {}) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true, ...init }));
  key('Escape');
  out.closed = !g.shop.open;
  out.state = g.state.state;
  out.pause = getComputedStyle(document.getElementById('screen-pause')).display;

  // ...and so does every other way out. There are four on purpose: a browser
  // only hands the pointer back to a page holding user activation, and Escape
  // grants none — so the button, the backdrop and the interact key are the
  // exits that always recapture the mouse on the spot.
  const open = () => { g.events.emit('shop:open', {}); return g.shop.open; };
  out.byInteract = (open(), key(g.input.bindings.interact), !g.shop.open);
  out.byButton = (open(), g.shop.closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })), !g.shop.open);
  out.byBackdrop = (open(), g.shop.el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), !g.shop.open);
  // clicking the case itself is not a way out
  open();
  g.shop.el.querySelector('.shop-case').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  out.caseHolds = g.shop.open;
  // an auto-repeat of the key that opened it must not close it again
  key(g.input.bindings.interact, { repeat: true });
  out.survivesRepeat = g.shop.open;
  // Tab belongs to the satchel, and the satchel declines to open here — so at
  // the counter it does nothing at all rather than doing both things at once
  key('Tab');
  out.tabHolds = g.shop.open && !g.inventory.open;
  g.shop.close();
  return out;
});
const stockOf = (id) => shop.lines.find((l) => l.id === id);
check('the counter lists the sentry at 100 with two in stock',
  stockOf('sentry').price === 100 && stockOf('sentry').stock === 2);
check('every ammunition type is listed separately at 10',
  ['ammo_pistol', 'ammo_shotgun', 'ammo_rifle', 'ammo_sniper'].every((id) => stockOf(id)?.price === 10),
  shop.lines.filter((l) => l.id.startsWith('ammo_')).map((l) => `${l.id}:${l.price}`).join(' '));
check('and the bottom line is an unbuyable placeholder',
  stockOf('comingSoon').locked && shop.lockedRefused && shop.lockedFree);
check('[E] opens the counter and freezes the street', shop.opened && shop.frozen);
check('an empty purse buys nothing', shop.brokeRefused);
check('exactly two sentries can be bought, and they land in the satchel',
  shop.first && shop.second && shop.stocked === 0 && shop.carrying === 2,
  `${shop.carrying} carried, ${shop.stocked} left`);
check('ammunition costs 10 and reaches the gun',
  shop.ammoBought && shop.ammoCost === 10 && shop.ammoGained === 30,
  `${shop.ammoGained} rounds for ${shop.ammoCost}`);
check('Escape leaves the counter for the street, not the pause menu',
  shop.closed && shop.state === 'playing' && shop.pause === 'none',
  `state ${shop.state}, pause ${shop.pause}`);
check('the button, the backdrop and [E] all leave too',
  shop.byInteract && shop.byButton && shop.byBackdrop,
  `interact ${shop.byInteract}, button ${shop.byButton}, backdrop ${shop.byBackdrop}`);
check('and nothing else does — the case holds, a key repeat holds, Tab holds',
  shop.caseHolds && shop.survivesRepeat && shop.tabHolds,
  `case ${shop.caseHolds}, repeat ${shop.survivesRepeat}, tab ${shop.tabHolds}`);

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

check('no console errors across the run', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(failures === 0 ? '\nall shop/token/sentry checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
