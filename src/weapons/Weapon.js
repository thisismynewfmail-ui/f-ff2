/**
 * Runtime state for one weapon: magazine, reserve, cooldowns, reload
 * progress and recoil bloom. Firing decisions live here; hit resolution
 * lives in WeaponManager.
 */
export class Weapon {
  constructor(config) {
    this.config = config;
    this.mag = config.melee ? Infinity : config.magSize;
    this.reserve = config.melee ? Infinity : config.reserveStart;
    this.cooldown = 0;
    this.reloading = false;
    this.reloadLeft = 0;
    this.reloadDuration = config.reloadTime ?? 1; // length of the current reload
    this.tactical = false;                        // quick-tap (mag not empty) variant
    this.bloom = 0;
  }

  get isMelee() { return this.config.melee; }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.reloading) {
      this.reloadLeft -= dt;
      if (this.reloadLeft <= 0) this.finishReload();
    }
    this.bloom = Math.max(0, this.bloom - dt * 3);
  }

  canFire() {
    return this.cooldown <= 0 && !this.reloading && (this.isMelee || this.mag > 0);
  }

  /**
   * Consume a shot; returns effective spread in degrees. `opts` lets the
   * alt-fire paths override the cooldown, ammo drawn per trigger pull, and
   * base spread (e.g. shotgun both-barrels draws 2 shells).
   */
  fire(scoped = false, opts = {}) {
    this.cooldown = opts.interval ?? this.config.fireInterval;
    if (!this.isMelee) this.mag -= (opts.ammo ?? 1);
    const base = opts.spread !== undefined ? opts.spread
      : scoped && this.config.spreadScoped !== undefined ? this.config.spreadScoped
      : (this.config.spread ?? 0);
    const spread = base + this.bloom;
    this.bloom = Math.min(this.config.bloomMax ?? this.bloom + 10, this.bloom + (this.config.bloomPerShot ?? 0));
    return spread;
  }

  canReload() {
    return !this.isMelee && !this.reloading && this.mag < this.config.magSize && this.reserve > 0;
  }

  startReload() {
    if (!this.canReload()) return false;
    this.reloading = true;
    // Quick-tap reload: weapons that retain a chambered round (config sets
    // tacticalReload < 1) reload faster when the magazine isn't empty and the
    // rig skips its slide-release phase.
    this.tactical = this.mag > 0 && !!this.config.tacticalReload;
    this.reloadDuration = this.config.reloadTime * (this.tactical ? this.config.tacticalReload : 1);
    this.reloadLeft = this.reloadDuration;
    return true;
  }

  finishReload() {
    this.reloading = false;
    const need = this.config.magSize - this.mag;
    const take = Math.min(need, this.reserve);
    this.mag += take;
    if (this.reserve !== Infinity) this.reserve -= take;
  }

  cancelReload() {
    this.reloading = false;
    this.reloadLeft = 0;
  }

  addReserve(amount) {
    if (this.reserve === Infinity) return;
    this.reserve = Math.min(999, this.reserve + amount);
  }
}
