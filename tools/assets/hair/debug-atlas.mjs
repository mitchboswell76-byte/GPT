// Debug: write the generated strand atlas (colour over grey + normal) to PNGs.
//   node tools/assets/hair/debug-atlas.mjs out-prefix
import sharp from 'sharp';
import { strandAtlas } from './atlas.mjs';
const A = await strandAtlas();
const pre = process.argv[2];
await sharp(A.colPng).flatten({ background: '#b8c0c4' }).toFile(pre + '_atlas.png');
await sharp(A.nrmPng).toFile(pre + '_atlas_n.png');
console.log('written', pre);
