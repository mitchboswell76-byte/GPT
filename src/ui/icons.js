// Small line illustrations for the construction catalogue.
const S = (body) => `<svg viewBox="0 0 120 50" fill="none" stroke="#3b3a31" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  fence: S('<path d="M14 44V10M60 44V10M106 44V10"/><path d="M14 18h92M14 30h92"/><path d="M14 40h92" stroke-dasharray="3 4" stroke="#7d7a6c"/><path d="M8 46h104" stroke="#9c947c"/>'),
  gate: S('<path d="M12 46V8M108 46V8"/><path d="M18 12h84M18 22h84M18 32h84M18 42h84M18 12v30M102 12v30M18 42L102 12"/><path d="M14 16h6M14 38h6" stroke="#7d6a4a"/>'),
  kennel: S('<path d="M26 44V24l34-16 34 16v20z"/><path d="M20 27L60 7l40 20"/><path d="M50 44V32a10 10 0 0 1 20 0v12"/><path d="M18 46h84" stroke="#9c947c"/><path d="M53 41c4-2 10-2 14 0" stroke="#c09a52"/>'),
  food_bowl: S('<path d="M30 36h60l-4 8H34z" stroke="#7d6a4a"/><path d="M36 36c0-8 10-12 24-12s24 4 24 12"/><path d="M46 26c3-3 6-2 8-1M58 24c3-2 6-1 9 1" stroke="#8a5a2c"/>'),
  water_trough: S('<path d="M18 22h84l-6 20H24z"/><path d="M24 28h72" stroke="#4f7186"/><path d="M28 44v3M92 44v3"/>'),
  ball: S('<circle cx="60" cy="27" r="15" stroke="#a5482c"/><path d="M47 20c8 6 18 6 26 0" stroke="#a5482c"/><path d="M36 46h48" stroke="#9c947c"/>'),
  tug_post: S('<path d="M52 46V6"/><circle cx="56" cy="12" r="3"/><path d="M58 13c8 6 12 14 12 24" stroke="#b59a6a" stroke-width="3"/><circle cx="70" cy="39" r="3.5" stroke="#b59a6a"/><path d="M40 46h40" stroke="#9c947c"/>'),
  hollow_log: S('<path d="M26 18h66M26 42h66"/><ellipse cx="26" cy="30" rx="8" ry="12"/><ellipse cx="26" cy="30" rx="4" ry="7"/><path d="M92 18c5 0 8 6 8 12s-3 12-8 12"/><path d="M44 22l6 2M66 38l6-2" stroke="#7d6a4a"/>'),
};
