import * as THREE from '../../lib/three.module.js';

/**
 * The portable sentry's machinery: a folding tripod, a yaw ring, and a gun
 * head with a perforated shroud, a box magazine, a sensor dish and a status
 * lamp. Its behaviour lives in entities/Sentry.js; this is only the object.
 *
 * It is built here rather than beside the entity because THREE users of it
 * want one: the deployed turret, the translucent ghost the placement preview
 * puts on the ground, and the copy held in the player's hands (WeaponView).
 *
 * Built facing +Z with its foot at the origin, so the entity can place it the
 * way it places any other object and `mesh.rotation.y = yaw` points it exactly
 * where the player was looking. Every moving part is a real pivot: the legs
 * hinge, the head yaws on the ring, the barrel slides on its recoil spring.
 */
/**
 * How big the finished machine is, applied to the assembled group.
 *
 * The parts below are laid out at a natural 1:1 and then scaled as a whole,
 * so the proportions are authored once and the SIZE is one number. It was
 * built knee-high at first and read as a toy dropped in the grass; at this
 * scale it stands about waist height, which is what a crew-served weapon on a
 * tripod actually looks like next to a person.
 */
export const SENTRY_SCALE = 1.35;

export function buildSentryModel(texLib = null) {
  const plate = texLib
    ? new THREE.MeshLambertMaterial({ map: texLib.get('sentryPlate') })
    : new THREE.MeshLambertMaterial({ color: 0x4a5236 });
  const steel = new THREE.MeshLambertMaterial({ color: 0x35383c });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1e2023 });
  const brass = texLib
    ? new THREE.MeshLambertMaterial({ map: texLib.get('vendorBrass') })
    : new THREE.MeshLambertMaterial({ color: 0xa8842c });
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffcc66, emissive: 0x704a10 });

  const g = new THREE.Group();
  const parts = { legs: [], lampMat };
  const box = (w, h, d, m) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cyl = (rt, rb, h, m, seg = 10) => new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);

  // --- three folding legs on hinges at the hub
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI;     // one leg to the rear
    const hinge = new THREE.Group();
    hinge.position.set(Math.sin(a) * 0.05, 0.20, Math.cos(a) * 0.05);
    hinge.rotation.y = a;
    const leg = box(0.045, 0.30, 0.045, steel);
    leg.position.set(0, -0.15, 0);
    hinge.add(leg);
    const foot = cyl(0.05, 0.06, 0.03, dark, 8);
    foot.position.set(0, -0.30, 0);
    hinge.add(foot);
    g.add(hinge);
    parts.legs.push({ group: hinge, rest: 0.52 });  // how far out it swings
  }
  const hub = box(0.14, 0.06, 0.14, steel);
  hub.position.set(0, 0.20, 0);
  g.add(hub);

  // --- the body: an armoured drum on the tripod, carrying the yaw ring
  const body = new THREE.Group();
  body.position.y = 0.26;
  g.add(body);
  parts.body = body;
  const drum = cyl(0.13, 0.15, 0.14, plate, 12);
  drum.position.y = 0.07;
  body.add(drum);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.018, 6, 16), brass);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.15;
  body.add(ring);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 12, Math.PI), steel);
  handle.position.set(0, 0.06, -0.15);
  handle.rotation.set(Math.PI / 2, 0, 0);
  body.add(handle);

  // --- the head: everything above the ring turns
  const head = new THREE.Group();
  head.position.y = 0.17;
  body.add(head);
  parts.head = head;
  const receiver = box(0.16, 0.13, 0.24, plate);
  receiver.position.set(0, 0.06, 0.02);
  head.add(receiver);
  const cheek = box(0.17, 0.05, 0.10, brass);
  cheek.position.set(0, 0.12, -0.04);
  head.add(cheek);
  // the barrel and its perforated shroud, on the recoil spring
  const barrel = new THREE.Group();
  barrel.position.set(0, 0.07, 0.16);
  head.add(barrel);
  parts.barrel = barrel;
  parts.barrelZ = 0.16;
  const shroud = cyl(0.035, 0.035, 0.16, steel, 10);
  shroud.rotation.x = Math.PI / 2;
  barrel.add(shroud);
  for (let i = 0; i < 3; i++) {                    // cooling slots down the shroud
    const slot = box(0.008, 0.05, 0.012, dark);
    slot.position.set(0.03, 0, -0.04 + i * 0.04);
    barrel.add(slot);
    const slot2 = slot.clone();
    slot2.position.x = -0.03;
    barrel.add(slot2);
  }
  const bore = cyl(0.016, 0.016, 0.21, dark, 8);
  bore.rotation.x = Math.PI / 2;
  bore.position.z = 0.04;
  barrel.add(bore);
  const brake = cyl(0.03, 0.026, 0.04, brass, 8);
  brake.rotation.x = Math.PI / 2;
  brake.position.z = 0.135;
  barrel.add(brake);
  // the magazine hanging under the receiver, and the ejection port beside it
  const mag = box(0.06, 0.14, 0.05, steel);
  mag.position.set(0, -0.04, 0.02);
  mag.rotation.x = -0.16;
  head.add(mag);
  const port = box(0.012, 0.035, 0.05, dark);
  port.position.set(0.082, 0.08, 0.02);
  head.add(port);
  // the sensor dish on its little mast, and the status lamp beside it
  const mast = box(0.02, 0.08, 0.02, steel);
  mast.position.set(-0.07, 0.15, -0.04);
  head.add(mast);
  const dish = new THREE.Group();
  dish.position.set(-0.07, 0.20, -0.04);
  head.add(dish);
  parts.dish = dish;
  const cup = cyl(0.045, 0.012, 0.03, brass, 10);
  cup.rotation.x = 0.5;
  dish.add(cup);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.018, 7, 6), lampMat);
  lamp.position.set(0.07, 0.15, -0.03);
  head.add(lamp);

  // the muzzle flash, hidden until it fires
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  flash.position.set(0, 0, 0.2);
  flash.visible = false;
  barrel.add(flash);
  parts.flash = flash;

  g.scale.setScalar(SENTRY_SCALE);
  return { group: g, parts };
}
