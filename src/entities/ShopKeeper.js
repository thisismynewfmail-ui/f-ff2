import { Entity } from './Entity.js';
import { buildVendorModel, VendorAnimator, BASE_H } from '../rendering/VendorModel.js';

/**
 * The SHOPKEEPER — the coin-operated vendor standing in its kiosk out on the
 * Eastgate knoll (see world/TradingPost.js for the building it lives in, and
 * rendering/VendorModel.js for the machine itself).
 *
 * It is a fixture, not a combatant. Three things follow from that and all
 * three are deliberate:
 *
 *  1. THE HORDE DOES NOT SEE IT. Zombies acquire the player first and
 *     otherwise the nearest thing on the shared `friendlies` roster
 *     (Zombie._acquireVictim). The shopkeeper is never put on that roster, so
 *     there is nothing for a zombie to sense, hunt, chase or swing at — and
 *     since an Exploder's blast is dealt to the player, the horde and that
 *     same roster, a bomb going off at the counter cannot hurt it either. It
 *     is not "very tough": it is invisible to the whole hostile stack.
 *  2. IT DOES NOT MOVE. It is bolted to its machine. It turns to watch you,
 *     and that is all — so it needs no navigation, no steering and no capsule.
 *  3. IT IS ALWAYS THERE. No spawn roll, no despawn, no wave gating. The one
 *     fixed point in a run that is otherwise nothing but weather.
 *
 * Behaviour is the animator's state machine (VendorAnimator): it dozes when
 * nobody is about, wakes and greets when you come up the path, holds a
 * presenting pose while the shop is open, and plays a one-shot when a sale
 * goes through or the till refuses you. Its head tracks the player the whole
 * time it is awake, which is what makes a machine feel like it noticed you.
 */
const WAKE_RANGE = 14;      // it stirs when somebody is this close
const GREET_RANGE = 5.0;    // ...and straightens up at this
const GREET_TIME = 1.4;     // how long the greeting plays before it settles
const REACH = 2.6;          // how far from the counter [E] still works

export class ShopKeeper extends Entity {
  constructor(events, world, texLib, { x, z, yaw = 0, lift = 0 } = {}) {
    super();
    this.events = events;
    this.world = world;
    this.addTag('vendor');
    // Explicitly NOT tagged 'friendly': that tag is what puts an NPC on the
    // roster zombies hunt from. See the class note above.

    // `lift` is the surface it stands ON — the kiosk's plank deck, so the
    // cabinet's feet sit on the boards instead of a hand's width inside them.
    const y = world.groundHeightFor(x, z, 1e9) + lift;
    this.position.set(x, y, z);
    this.yaw = yaw;
    this.height = BASE_H;   // what a hit test would use: the counter, not the hat

    this.rig = buildVendorModel(texLib);
    this.mesh = this.rig.group;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = yaw;
    this.anim = new VendorAnimator(this.rig);

    this.shopOpen = false;
    this._greetT = -1;
    this._metPlayer = false;

    // The cabinet is solid — you lean on the counter, you do not walk through
    // it. 'furniture' rather than 'prop' so the placement audit reads it as
    // something deliberately inside a structure.
    this._colliderId = world.collision.addBoxCentered(
      x, y + BASE_H / 2, z, 0.46, BASE_H / 2, 0.36, 'furniture');

    this.interactable = world.addInteractable({
      x, z, y, radius: REACH,
      prompt: 'Trade with the shopkeeper [E]',
      enabled: () => !this.shopOpen,
      onInteract: () => this.events.emit('shop:open', { vendor: this }),
    });

    this.events.on('shop:opened', () => { this.shopOpen = true; this.anim.setState('deal'); });
    this.events.on('shop:closed', () => { this.shopOpen = false; this._greetT = -1; });
    this.events.on('shop:bought', () => this.anim.poke('sale'));
    this.events.on('tokens:refused', () => { if (this.shopOpen) this.anim.poke('refuse'); });
  }

  /** Where the player's eye should meet: over the counter, at the head. */
  eyePoint() {
    return { x: this.position.x, y: this.position.y + this.rig.height - 0.12, z: this.position.z };
  }

  /**
   * Pick a behaviour from what the player is doing, and hand the animator the
   * direction to look in. The look is computed in the MACHINE's frame (its own
   * yaw subtracted), because the animator clamps how far the head can turn on
   * its bearing and that limit only means anything relative to the body.
   */
  update(dt, ctx) {
    const player = ctx?.player;
    let look = null;
    let dist = Infinity;

    if (player && player.alive) {
      const dx = player.position.x - this.position.x;
      const dz = player.position.z - this.position.z;
      dist = Math.hypot(dx, dz);
      if (dist < WAKE_RANGE) {
        let rel = Math.atan2(dx, dz) - this.yaw;
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        const eye = this.eyePoint();
        const dy = player.position.y + (player.eyeHeight ?? 1.6) - eye.y;
        look = { yaw: rel, pitch: -Math.atan2(dy, Math.max(0.6, dist)) };
      }
    }

    if (this.shopOpen) {
      this.anim.setState(this.anim.state === 'sale' || this.anim.state === 'refuse' ? this.anim.state : 'deal');
    } else if (dist < GREET_RANGE) {
      // Greet once per approach: walking away and coming back gets another.
      if (this._greetT < 0) {
        this._greetT = 0;
        this.anim.setState('greet');
        this.events.emit('vendor:greet', { pos: this.eyePoint(), first: !this._metPlayer });
        if (!this._metPlayer) {
          this._metPlayer = true;
          this.events.emit('subtitle', {
            text: 'The machine grinds awake behind the counter. "TOKENS, friend. Only tokens."',
          });
        }
      }
      this._greetT += dt;
      if (this._greetT > GREET_TIME) this.anim.setState('idle');
    } else {
      if (dist > GREET_RANGE * 1.6) this._greetT = -1;   // hysteresis: no flicker on the line
      this.anim.setState(dist < WAKE_RANGE ? 'idle' : 'sleep');
    }

    this.anim.update(dt, look);
  }

  dispose() {
    this.world.removeInteractable(this.interactable);
    this.world.collision.remove(this._colliderId);
  }
}
