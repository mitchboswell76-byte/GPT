// Bone maps for quadruped rigs. Names are as three.js exposes them (dots and
// colons stripped). +X in model space is the animal's left; models face +Z.
// To support a new quadruped model, add an entry here and reference it from
// src/data/assets.js.
//
// Leg chains: `upper` (shoulder / hip), `lower` (elbow / stifle), `hock`
// (hind only: hock -> paw), `end` (front: carpus -> paw; hind: paw joint),
// `toe` (the digits; its origin is the pivot the paw rolls over), `tip`
// (optional digit tip), `scap` (optional shoulder blade, rotated with the leg).
// `endIsChild: false` means the paw bones are separate IK controls (as on the
// Labrador) and are placed explicitly.
//
// `pelvis` carries the hind legs and tail; `spine` bones lie between it and
// the `chest`, which carries the front legs and neck. Gait, posture and
// secondary-motion tunings are per rig in `tune` (see QuadrupedRig.js).

export const RIGS = {
  puppy: {
    pelvis: 'DogROOTSHJnt',
    spine: ['Dog_Spine_01SHJnt', 'Dog_Spine_02SHJnt', 'Dog_Spine_03SHJnt', 'Dog_Spine_04SHJnt'],
    chest: 'Dog_Spine_TopSHJnt',
    neck: ['Dog_Neck_01SHJnt', 'Dog_Neck_02SHJnt'],
    head: 'Dog_Neck_TopSHJnt',
    jaw: 'Dog_Head_JawSHJnt',
    tail: ['Dog_Tail_01_02SHJnt', 'Dog_Tail_01_03SHJnt', 'Dog_Tail_01_04SHJnt', 'Dog_Tail_01_05SHJnt'],
    ears: {
      L: ['Dog_l_Ear_01_01SHJnt', 'Wolf_l_Ear_01_02SHJnt', 'Wolf_l_Ear_01_03SHJnt'],
      R: ['Dog_r_Ear_01_01SHJnt', 'Dog_r_Ear_01_02SHJnt', 'Dog_r_Ear_01_03SHJnt'],
    },
    endIsChild: true,
    legs: {
      FL: { scap: 'Dog_l_Clavicle_01_01SHJnt', upper: 'Dog_l_FrontLeg_HipSHJnt', lower: 'Dog_l_FrontLeg_KneeSHJnt', end: 'Dog_l_FrontLeg_AnkleSHJnt', toe: 'Dog_l_FrontLeg_BallSHJnt', tip: 'Dog_l_FrontLeg_ToeSHJnt', front: true, side: 1 },
      FR: { scap: 'Dog_r_Clavicle_01_01SHJnt', upper: 'Dog_r_FrontLeg_HipSHJnt', lower: 'Dog_r_FrontLeg_KneeSHJnt', end: 'Dog_r_FrontLeg_AnkleSHJnt', toe: 'Wolf_r_FrontLeg_BallSHJnt', tip: 'Wolf_r_FrontLeg_ToeSHJnt', front: true, side: -1 },
      HL: { upper: 'Dog_l_HindLeg_HipSHJnt', lower: 'Dog_l_HindLeg_Knee1SHJnt', hock: 'Wolf_l_HindLeg_Knee2SHJnt', end: 'Wolf_l_HindLeg_AnkleSHJnt', toe: 'Wolf_l_HindLeg_BallSHJnt', tip: 'Wolf_l_HindLeg_ToeSHJnt', front: false, side: 1 },
      HR: { upper: 'Dog_r_HindLeg_HipSHJnt', lower: 'Dog_r_HindLeg_Knee1SHJnt', hock: 'Dog_r_HindLeg_Knee2SHJnt', end: 'Dog_r_HindLeg_AnkleSHJnt', toe: 'Dog_r_HindLeg_BallSHJnt', tip: 'Wolf_r_HindLeg_ToeSHJnt', front: false, side: -1 },
    },
    morphs: { breath: 'breath', blink: 'blink' },
    // Idle clip weight while standing still / moving or posing.
    clipWeight: { still: 1, moving: 0 },
    tune: {
      bound: 0.75,        // puppies gallop with a bound-like footfall (hinds nearly together)
      earMass: 0.6,       // short, light ears
      jawOpen: 1,         // jaw opens with positive rotation about the head's left axis
      sitHip: 0.62, lieHip: 0.66, lieChest: 0.62, sleepHip: 0.72,
      sitPawFwd: 0.12, liePawFwd: 0.95, lieHindOut: 0.15,
      scapula: 0.35,      // shoulder-blade rotation per radian of leg swing
    },
  },
  labrador: {
    pelvis: 'Back_38',
    spine: ['Torso_23', 'Torso2_22', 'Torso3_15'],
    chest: 'Torso3_15',
    neck: ['Neck1_14', 'Neck2_13'],
    head: 'Neck3_12',
    jaw: 'Neck3002_10',
    tail: ['Tail1_37', 'Tail2_36', 'Tail3_35', 'Tail4_34', 'Tail5_33', 'Tail6_32'],
    ears: { L: ['Ear1L_5', 'Ear2L_4', 'Ear3L_3', 'Ear4L_2'], R: ['Ear1R_9', 'Ear2R_8', 'Ear3R_7', 'Ear4R_6'] },
    endIsChild: false,
    legs: {
      FL: { upper: 'FrontUpperLegL_17', lower: 'FrontLowerLegL_16', end: 'IKFrontLegL_47', toe: 'FFL_46', front: true, side: 1 },
      FR: { upper: 'FrontUpperLegR_20', lower: 'FrontLowerLegR_19', end: 'IKFrontLegR_51', toe: 'FFR_50', front: true, side: -1 },
      HL: { upper: 'BackLegL_26', lower: 'BackUpperLegL_25', hock: 'BackLowerLegL_24', end: 'IKBackLegL_45', toe: 'FFBL_44', front: false, side: 1 },
      HR: { upper: 'BackLegR_30', lower: 'BackUpperLegR_29', hock: 'BackLowerLegR_28', end: 'IKBackLegR_49', toe: 'FFBR_48', front: false, side: -1 },
    },
    morphs: {},
    clipWeight: { still: 0.85, moving: 0 },
    tune: {
      bound: 0.1,         // adult: rotary gallop
      earMass: 1.6,       // long, heavy ears
      jawOpen: 1,
      // The thigh bones carry most of the hindquarter weights, so lying uses a
      // wider hind splay and a deeper drop.
      sitHip: 0.6, lieHip: 0.7, lieChest: 0.64, sleepHip: 0.74,
      sitPawFwd: 0.1, liePawFwd: 0.85, lieHindOut: 0.3,
      scapula: 0,
    },
  },
};
