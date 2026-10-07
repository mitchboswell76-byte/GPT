// Interaction poses for the keeper (kneel / crouch, offering hand, stroking)
// and idle life. Stub: filled in after locomotion.
export class KeeperPoses {
  constructor(motion) {
    this.m = motion;
    this.active = false;
    this.shift = 0;
    this.pelvisDy = 0;
    this.pelvisOffset = null;
    this.headTilt = 0;
  }
  bodyYaw(yaw) { return yaw; }
  updateLegs() {}
  updateUpper() {}
  idleLook() { return null; }
}
