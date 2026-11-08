/** A frame is width*height packed 0xRRGGBB pixels. */
export type Frame = Uint32Array;

export class RenderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface TextElement {
  type: "text";
  text: string;
  color?: string;
  /** 1 = 5x7 font with Polish letters, >1 = integer upscale without diacritics */
  scale?: number;
  /** left edge of the text box; when omitted `align` decides */
  x?: number;
  /** top edge of the text box (rows -2..8 at scale 1); when omitted `valign` decides */
  y?: number;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  anim?: "none" | "scroll" | "blink";
  /** scroll speed 1..5 */
  speed?: number;
}

export interface RectElement {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  color?: string;
  /** default true */
  fill?: boolean;
}

export interface PixelElement {
  type: "pixel";
  x: number;
  y: number;
  color?: string;
}

export interface LineElement {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color?: string;
}

export interface BitmapElement {
  type: "bitmap";
  x?: number;
  y?: number;
  /** rows of '#' (on) and anything else (off) */
  rows: string[];
  color?: string;
  scale?: number;
}

export type Element = TextElement | RectElement | PixelElement | LineElement | BitmapElement;

export interface FrameSpec {
  /** milliseconds */
  duration?: number;
  elements: Element[];
}

export interface Spec {
  width?: number;
  height?: number;
  format?: "png" | "gif";
  background?: string;
  /** a single scene; text elements may animate (scroll / blink) */
  elements?: Element[];
  /** explicit frames (no element-level animation) */
  frames?: FrameSpec[];
  /** GIF loop count, 0 = forever (default) */
  loop?: number;
  /** PNG only: which frame to export (default 0) */
  frame?: number;
  /** GIF only: append random bytes so the file is never identical to the previous upload */
  nonce?: boolean;
}
