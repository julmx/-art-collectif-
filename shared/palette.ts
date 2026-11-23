/** Temporary palette for local development; replaceable by the administrator before opening. */
export const PALETTE = [
  '#e63946',
  '#f06449',
  '#f28f3b',
  '#f2b134',
  '#e9c46a',
  '#b4c63b',
  '#70ad47',
  '#2a9d65',
  '#16a085',
  '#24a6a6',
  '#19a9c2',
  '#2786c4',
  '#4169c1',
  '#6155c4',
  '#8054bf',
  '#a14bb4',
  '#c0489b',
  '#dc4e81',
  '#a4274e',
  '#b3532c',
  '#9b741d',
  '#4c7c34',
  '#256d74',
  '#71468c',
] as const;

export function validPalette(colors: readonly string[]): boolean {
  return (
    colors.length === 24 &&
    new Set(colors.map((c) => c.toLowerCase())).size === 24 &&
    colors.every((c) => {
      if (!/^#[0-9a-f]{6}$/i.test(c)) return false;
      const rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
      return Math.max(...rgb) - Math.min(...rgb) >= 40;
    })
  );
}

export function parsePaletteRgb(palette: readonly string[]): Uint8Array {
  if (palette.length !== 24) {
    throw new Error('Palette invalide : 24 couleurs attendues');
  }
  const rgb = new Uint8Array(palette.length * 3);
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      throw new Error(`Couleur de palette invalide : ${color}`);
    }
    const offset = i * 3;
    rgb[offset] = parseInt(color.slice(1, 3), 16);
    rgb[offset + 1] = parseInt(color.slice(3, 5), 16);
    rgb[offset + 2] = parseInt(color.slice(5, 7), 16);
  }
  return rgb;
}
