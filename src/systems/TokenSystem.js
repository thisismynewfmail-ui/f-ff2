/**
 * Tokens — the only currency in the town, and the only thing the vendor takes.
 *
 * Tokens are not score. Score is a record of what you did; tokens are a
 * resource you spend, so they are counted separately, they survive a session
 * (Game.captureSession writes the balance into the save), and they roll back
 * with a checkpoint exactly the way ammunition does — dying should cost you
 * the shopping you had not done yet, not hand you a windfall.
 *
 * Everything moves through events, so nothing here reaches into another
 * system:
 *   'pickup' (a coin type)  -> the coin's value is banked
 *   'tokens:changed'        -> emitted on every balance move, for the HUD
 *   'tokens:refused'        -> a purchase that could not be paid for
 *
 * The coin table is the single definition of what each coin is worth; the
 * pickups, the drop rolls and the shop all read their values from here.
 */
export const COINS = {
  coin_copper: { value: 5, label: 'Copper coin', tex: 'coinCopper', size: 0.34 },
  coin_gold: { value: 10, label: 'Gold coin', tex: 'coinGold', size: 0.42 },
  coin_silver: { value: 20, label: 'Silver coin', tex: 'coinSilver', size: 0.40 },
};

/** Is this pickup type one of the coins? */
export function isCoin(type) {
  return Object.prototype.hasOwnProperty.call(COINS, type);
}

export class TokenSystem {
  constructor(events) {
    this.events = events;
    this.tokens = 0;
    this.earned = 0;   // lifetime take, for the record on the pause screen
    this.spent = 0;

    events.on('pickup', ({ type }) => {
      const coin = COINS[type];
      if (coin) this.add(coin.value);
    });
  }

  add(n) {
    const amount = Math.max(0, Math.round(n));
    if (!amount) return this.tokens;
    this.tokens += amount;
    this.earned += amount;
    this.events.emit('tokens:changed', { tokens: this.tokens, delta: amount });
    return this.tokens;
  }

  /** Can this be afforded right now? */
  canAfford(cost) { return this.tokens >= Math.max(0, Math.round(cost)); }

  /**
   * Take `cost` coins. Returns true if the purchase went through; a refusal
   * is announced rather than silently ignored so the till can say why.
   */
  spend(cost) {
    const price = Math.max(0, Math.round(cost));
    if (this.tokens < price) {
      this.events.emit('tokens:refused', { tokens: this.tokens, needed: price });
      return false;
    }
    this.tokens -= price;
    this.spent += price;
    this.events.emit('tokens:changed', { tokens: this.tokens, delta: -price });
    return true;
  }

  /** Freeze the purse for a checkpoint (see Game._wire / respawn). */
  snapshot() {
    return { tokens: this.tokens, earned: this.earned, spent: this.spent };
  }

  /** Restore a purse captured by snapshot(), or loaded from a save. */
  restore(snap) {
    if (!snap) return;
    this.tokens = Math.max(0, snap.tokens | 0);
    this.earned = Math.max(0, snap.earned | 0);
    this.spent = Math.max(0, snap.spent | 0);
    this.events.emit('tokens:changed', { tokens: this.tokens, delta: 0 });
  }
}
