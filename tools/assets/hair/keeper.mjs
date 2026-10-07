// Shared access to the keeper source model's Body primitive and texture.
import sharp from 'sharp';

export async function loadBody(doc) {
  const root = doc.getRoot();
  const bodyNode = root.listNodes().find(n => n.getName() === 'Body');
  const skin = bodyNode.getSkin();
  const headJoint = skin.listJoints().findIndex(j => j.getName() === 'mixamorig:Head');
  const prim = bodyNode.getMesh().listPrimitives()[0];
  const body = {
    pos: prim.getAttribute('POSITION').getArray(),
    idx: prim.getIndices().getArray(),
    uv: prim.getAttribute('TEXCOORD_0').getArray(),
    jnt: prim.getAttribute('JOINTS_0').getArray(),
    wgt: prim.getAttribute('WEIGHTS_0').getArray(),
  };
  const img = prim.getMaterial().getBaseColorTexture().getImage();
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  const tex = { data, width: info.width, height: info.height, channels: info.channels };
  return { bodyNode, skin, headJoint, body, tex };
}
