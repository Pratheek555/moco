import * as z from "zod";

export const THUMBNAIL_TEXT_MAX = 40;
export const THUMBNAIL_STYLES = [
  { id: "bold", name: "Bold hook", description: "Big outlined words for a dramatic moment.", sample: "ONE CHOICE" },
  { id: "minimal", name: "Minimal", description: "Quiet type. Let one strong subject lead.", sample: "Look closer" },
  { id: "cinematic", name: "Cinematic", description: "A film-poster feel for an emotional story.", sample: "The turning point" },
  { id: "editorial", name: "Editorial", description: "A crisp color block for a fact or question.", sample: "WHY IT MATTERS" },
] as const;
export const THUMBNAIL_ACCENTS = [
  { id: "yellow", name: "Sunshine", color: "#ffd54f" },
  { id: "white", name: "White", color: "#ffffff" },
  { id: "mint", name: "Mint", color: "#a7f3d0" },
  { id: "coral", name: "Coral", color: "#ff9a85" },
] as const;
export const ThumbnailDesign = z.object({
  style: z.enum(["bold", "minimal", "cinematic", "editorial"]).default("bold"),
  position: z.enum(["upper", "center", "lower"]).default("lower"),
  accent: z.enum(["yellow", "white", "mint", "coral"]).default("yellow"),
});
export type ThumbnailDesign = z.infer<typeof ThumbnailDesign>;
export const DEFAULT_THUMBNAIL_DESIGN: ThumbnailDesign = { style: "bold", position: "lower", accent: "yellow" };
export const ThumbnailHeadline = z.string().refine(text => [...text].length <= THUMBNAIL_TEXT_MAX, `Use at most ${THUMBNAIL_TEXT_MAX} characters`);
export const ThumbnailChoice = z.object({
  shotId: z.string().min(1),
  text: z.string().transform(text => text.trim()).pipe(ThumbnailHeadline),
  frame: z.number().int().nonnegative().optional(),
  design: ThumbnailDesign.optional(),
});
export type ThumbnailChoice = z.infer<typeof ThumbnailChoice>;

// Shared by the editor and Remotion, so a style preview uses the export's typography and spacing.
// All dimensions follow the actual composition, including landscape artist projects.
export function thumbnailPresentation(width: number, height: number, text: string, design: ThumbnailDesign = DEFAULT_THUMBNAIL_DESIGN) {
  const { style, position, accent } = design;
  const color = THUMBNAIL_ACCENTS.find(item => item.id === accent)!.color;
  const long = [...text.trim()].length > 24;
  const size = Math.min(width * (long ? 0.104 : 0.126), height * 0.11);
  const top = position === "upper" ? 0.22 : position === "center" ? 0.46 : 0.66;
  const gradient = position === "upper" ? "to bottom" : position === "center" ? "to right" : "to top";
  return {
    image: { filter: style === "cinematic" ? "saturate(0.8) contrast(1.08)" : "none" },
    shade: { background: `linear-gradient(${gradient}, rgba(0,0,0,${style === "cinematic" ? 0.82 : 0.65}) 0%, transparent 75%)` },
    headline: {
      position: "absolute" as const, top: height * top, left: width * 0.08, width: width * 0.84,
      transform: "translateY(-25%)", boxSizing: "border-box" as const,
      fontFamily: style === "cinematic" ? "Georgia, 'Noto Serif Devanagari', serif" : "'Arial Black', 'Noto Sans Devanagari', Arial, sans-serif",
      fontSize: size * (style === "minimal" ? 0.8 : style === "cinematic" ? 0.92 : 1),
      fontWeight: style === "cinematic" ? 700 : 900, lineHeight: 1.08,
      textAlign: style === "minimal" || style === "editorial" ? "left" as const : "center" as const,
      color: style === "editorial" ? "#111111" : style === "minimal" ? "#ffffff" : color,
      background: style === "editorial" ? color : "transparent",
      padding: style === "editorial" ? `${size * 0.16}px ${size * 0.2}px` : 0,
      borderLeft: style === "minimal" ? `${width * 0.009}px solid ${color}` : "none",
      paddingLeft: style === "minimal" ? width * 0.035 : style === "editorial" ? size * 0.2 : 0,
      WebkitTextStroke: style === "bold" ? `${width * 0.012}px #111111` : "0px transparent",
      paintOrder: "stroke fill", textShadow: style === "editorial" ? "none" : `0 ${width * 0.004}px ${width * 0.018}px #00000099`,
      textWrap: "balance" as const, overflowWrap: "anywhere" as const,
    },
  };
}
