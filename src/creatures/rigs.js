// Bone maps for quadruped rigs. Names are as three.js exposes them (dots and
// colons stripped). +X in model space is the animal's left; models face +Z.
// To support a new quadruped model, add an entry here and reference it from
// src/data/assets.js. `end` is the wrist (front) or paw joint (hind); `hock`
// is the third hind segment. `endIsChild: false` means the paw bones are
// separate IK controls (as on the Labrador) and are placed explicitly.

export const RIGS = {
  puppy: {
    root: 'DogROOTSHJnt',
    spine: ['Dog_Spine_01SHJnt', 'Dog_Spine_02SHJnt', 'Dog_Spine_03SHJnt', 'Dog_Spine_04SHJnt', 'Dog_Spine_TopSHJnt'],
    neck: ['Dog_Neck_01SHJnt', 'Dog_Neck_02SHJnt'],
    head: 'Dog_Neck_TopSHJnt',
    jaw: 'Dog_Head_JawSHJnt',
    tail: ['Dog_Tail_01_02SHJnt', 'Dog_Tail_01_03SHJnt', 'Dog_Tail_01_04SHJnt', 'Dog_Tail_01_05SHJnt'],
    ears: { L: ['Dog_l_Ear_01_01SHJnt'], R: ['Dog_r_Ear_01_01SHJnt'] },
    endIsChild: true,
    legs: {
      FL: { upper: 'Dog_l_FrontLeg_HipSHJnt', lower: 'Dog_l_FrontLeg_KneeSHJnt', end: 'Dog_l_FrontLeg_AnkleSHJnt', toe: 'Dog_l_FrontLeg_BallSHJnt', front: true, side: 1 },
      FR: { upper: 'Dog_r_FrontLeg_HipSHJnt', lower: 'Dog_r_FrontLeg_KneeSHJnt', end: 'Dog_r_FrontLeg_AnkleSHJnt', toe: 'Wolf_r_FrontLeg_BallSHJnt', front: true, side: -1 },
      HL: { upper: 'Dog_l_HindLeg_HipSHJnt', lower: 'Dog_l_HindLeg_Knee1SHJnt', hock: 'Wolf_l_HindLeg_Knee2SHJnt', end: 'Wolf_l_HindLeg_AnkleSHJnt', toe: 'Wolf_l_HindLeg_BallSHJnt', front: false, side: 1 },
      HR: { upper: 'Dog_r_HindLeg_HipSHJnt', lower: 'Dog_r_HindLeg_Knee1SHJnt', hock: 'Dog_r_HindLeg_Knee2SHJnt', end: 'Dog_r_HindLeg_AnkleSHJnt', toe: 'Dog_r_HindLeg_BallSHJnt', front: false, side: -1 },
    },
    morphs: { breath: 'breath', blink: 'blink' },
    // How strongly the idle clip shows through while posing / moving.
    clipWeight: { still: 1, moving: 0.3 },
  },
  labrador: {
    root: 'Body_43',
    spine: ['Back_38', 'Torso_23', 'Torso2_22', 'Torso3_15'],
    neck: ['Neck1_14', 'Neck2_13'],
    head: 'Neck3_12',
    jaw: null,
    tail: ['Tail1_37', 'Tail2_36', 'Tail3_35', 'Tail4_34', 'Tail5_33'],
    ears: { L: ['Ear1L_5'], R: ['Ear1R_9'] },
    endIsChild: false,
    legs: {
      FL: { upper: 'FrontUpperLegL_17', lower: 'FrontLowerLegL_16', end: 'IKFrontLegL_47', toe: 'FFL_46', front: true, side: 1 },
      FR: { upper: 'FrontUpperLegR_20', lower: 'FrontLowerLegR_19', end: 'IKFrontLegR_51', toe: 'FFR_50', front: true, side: -1 },
      HL: { upper: 'BackLegL_26', lower: 'BackUpperLegL_25', hock: 'BackLowerLegL_24', end: 'IKBackLegL_45', toe: 'FFBL_44', front: false, side: 1 },
      HR: { upper: 'BackLegR_30', lower: 'BackUpperLegR_29', hock: 'BackLowerLegR_28', end: 'IKBackLegR_49', toe: 'FFBR_48', front: false, side: -1 },
    },
    morphs: {},
    clipWeight: { still: 0.85, moving: 0.25 },
    // The thigh bones carry most of the hindquarter weights, so lying uses a
    // wider hind splay, a deeper drop and a slight nose-up tilt.
    poseTweaks: { lieHindFwd: 0.3, lieHindOut: 0.42, lieDrop: 0.66, lieRearPitch: 0.12 },
  },
};
