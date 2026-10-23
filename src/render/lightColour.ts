/**
 * The colour of light at a colour temperature (kelvin), as an sRGB hex. A well-known curve fit
 * of black-body colour (Tanner Helland's), accurate enough for showing warm or cool lighting.
 */
export function kelvinToHex(kelvin: number): string {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const clamp = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A light's colour as it looks in a room photographed or seen in daylight-balanced terms:
 * its black-body colour relative to a 5,000 K white, so 2,700 K stays clearly warm, 4,000 K is
 * slightly warm and 6,500 K slightly cool (as eyes and cameras adapt), never deeply orange.
 */
export function lightHex(kelvin: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const light = rgb(kelvinToHex(kelvin));
  const white = rgb(kelvinToHex(5000));
  const ratio = light.map((v, i) => v / white[i]);
  const max = Math.max(...ratio);
  return `#${ratio.map((r) => Math.round((r / max) * 255).toString(16).padStart(2, '0')).join('')}`;
}
