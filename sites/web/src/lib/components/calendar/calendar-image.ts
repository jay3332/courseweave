// A week calendar drawn on a canvas, for "Save as image". Drawn directly rather than captured from the page, so it
// doesn't depend on the page's scroll, width or theme and needs no library. Light colors, the palette of
// routes/layout.css.
import { colorIndex } from "$lib/core/colors";
import type { CalendarDisplay } from "$lib/core/state/store";
import { DAY_SHORT, formatTimeRange } from "$lib/core/time";
import type { Day } from "$lib/core/types";
import { hourRange, layoutDay, shownDays, type CalendarBlock } from "$lib/core/week-grid";

const PALETTE = [
  "#d63a52",
  "#c98a00",
  "#1e8f50",
  "#00818a",
  "#2350a0",
  "#2683c6",
  "#7a4fb0",
  "#6a8424",
  "#b45a22",
  "#546679",
];
const PAPER = "#ffffff";
const INK = "#4a5662";
const STRONG = "#1e1e1e";
const MUTED = "#7a8fa3";
const LINE = "#d9e1e7";
const DANGER = "#c4314b";
const FONT = 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export interface CalendarImageOptions {
  title: string;
  /** Second line, such as "Fall 2026 &middot; 48 units" (plain text). */
  subtitle?: string;
  display: CalendarDisplay;
  days?: Day[];
  /** Device pixels per CSS pixel; 2 makes a sharp image. */
  scale?: number;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` mixed into `b`, `amount` of the way (0 to 1). */
function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const c = (x: number, y: number) => Math.round(x * amount + y * (1 - amount));
  return `rgb(${c(ar, br)}, ${c(ag, bg)}, ${c(ab, bb)})`;
}

/** `text` cut with an ellipsis to fit `width`. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}\u2026`).width > width) cut = cut.slice(0, -1);
  return `${cut}\u2026`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

interface Layout {
  days: Day[];
  from: number;
  to: number;
  pad: number;
  headerH: number;
  gridLeft: number;
  gridTop: number;
  colW: number;
  rowH: number;
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  options: CalendarImageOptions,
): void {
  const { days, from, to, pad, headerH, gridLeft, gridTop, colW, rowH } = layout;
  const width = gridLeft + colW * days.length + pad;
  ctx.fillStyle = STRONG;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText(fit(ctx, options.title, width - pad * 2), pad, pad);
  if (options.subtitle !== undefined) {
    ctx.fillStyle = MUTED;
    ctx.font = `400 14px ${FONT}`;
    ctx.fillText(fit(ctx, options.subtitle, width - pad * 2), pad, pad + 32);
  }

  ctx.font = `600 13px ${FONT}`;
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  days.forEach((d, i) => {
    ctx.fillText(DAY_SHORT[d], gridLeft + colW * i + colW / 2, pad + headerH + 8);
  });

  ctx.textAlign = "right";
  ctx.font = `400 11px ${FONT}`;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  for (let h = from; h <= to; h++) {
    const y = gridTop + (h - from) * rowH;
    ctx.beginPath();
    ctx.moveTo(gridLeft, y + 0.5);
    ctx.lineTo(gridLeft + colW * days.length, y + 0.5);
    ctx.stroke();
    if (h < to) {
      const hour = h % 12 === 0 ? 12 : h % 12;
      ctx.fillStyle = MUTED;
      ctx.fillText(`${hour} ${h < 12 ? "AM" : "PM"}`, gridLeft - 8, y + (h === from ? 3 : -6));
    }
  }
  for (let i = 0; i <= days.length; i++) {
    const x = gridLeft + colW * i + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, gridTop);
    ctx.lineTo(x, gridTop + (to - from) * rowH);
    ctx.stroke();
  }
  ctx.textAlign = "left";
}

function drawBlock(
  ctx: CanvasRenderingContext2D,
  block: CalendarBlock,
  box: { x: number; y: number; w: number; h: number },
  display: CalendarDisplay,
): void {
  const { x, y, w, h } = box;
  const color = PALETTE[colorIndex(block.color)] ?? "#546679";
  ctx.save();
  roundRect(ctx, x, y, w, h, 5);
  ctx.fillStyle = mix(color, PAPER, 0.18);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 3, h);
  const left = x + 8;
  const room = w - 12;
  let line = y + 5;
  ctx.fillStyle = mix(color, STRONG, 0.64);
  ctx.font = `700 13px ${FONT}`;
  const head =
    display.section && block.section !== undefined
      ? `${block.label} ${block.section}`
      : block.label;
  ctx.fillText(fit(ctx, head, room), left, line);
  line += 17;
  if (display.title && block.title !== undefined && line + 13 <= y + h) {
    ctx.font = `500 11px ${FONT}`;
    ctx.fillText(fit(ctx, block.title, room), left, line);
    line += 14;
  }
  ctx.font = `400 11px ${FONT}`;
  if (display.time && line + 13 <= y + h) {
    ctx.fillText(fit(ctx, formatTimeRange(block.start, block.end), room), left, line);
    line += 14;
  }
  const where = block.location ?? block.detail;
  if (display.location && where !== undefined && line + 13 <= y + h)
    ctx.fillText(fit(ctx, where, room), left, line);
  ctx.restore();
  if (block.conflict === true) {
    roundRect(ctx, x, y, w, h, 5);
    ctx.strokeStyle = DANGER;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function layoutFor(solid: CalendarBlock[], options: CalendarImageOptions): Layout {
  const days = shownDays(solid, options.days);
  const { from, to } = hourRange(solid, 8, 18);
  const pad = 32;
  const headerH = options.subtitle === undefined ? 56 : 76;
  return {
    days,
    from,
    to,
    pad,
    headerH,
    gridLeft: pad + 56,
    gridTop: pad + headerH + 32,
    colW: days.length > 5 ? 150 : 190,
    rowH: 56,
  };
}

/** Draws the solid blocks of a schedule as a week calendar. */
export function drawCalendar(
  blocks: readonly CalendarBlock[],
  options: CalendarImageOptions,
): HTMLCanvasElement {
  const solid = blocks.filter((b) => (b.variant ?? "solid") === "solid");
  const layout = layoutFor(solid, options);
  const { days, from, to, colW, rowH, gridLeft, gridTop, pad } = layout;
  const scale = options.scale ?? 2;
  const width = gridLeft + colW * days.length + pad;
  const height = gridTop + (to - from) * rowH + pad;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return canvas;
  ctx.scale(scale, scale);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";
  drawFrame(ctx, layout, options);

  const yOf = (minutes: number) => gridTop + ((minutes - from * 60) / 60) * rowH;
  days.forEach((d, i) => {
    for (const { block, lane, lanes } of layoutDay(solid.filter((b) => b.day === d))) {
      const y = yOf(block.start) + 1;
      const box = {
        x: gridLeft + colW * i + (colW / lanes) * lane + 2,
        y,
        w: colW / lanes - 4,
        h: Math.max(yOf(block.end) - y - 1, 14),
      };
      drawBlock(ctx, block, box, options.display);
    }
  });
  return canvas;
}

/** The calendar as a PNG file. */
export function calendarPng(
  blocks: readonly CalendarBlock[],
  options: CalendarImageOptions,
): Promise<Blob> {
  const canvas = drawCalendar(blocks, options);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("The browser couldn't make the image."));
      else resolve(blob);
    }, "image/png");
  });
}
