import type { TemplateInfo } from "./index.ts";

export const ILLUSTRATED_EXPLAINER_ID = "illustrated-explainer";

// A launch format, not a fixed character pack or a subject-specific house style.
export const illustratedExplainer: TemplateInfo = {
  id: ILLUSTRATED_EXPLAINER_ID,
  name: "Illustrated explainer",
  tagline: "One clear idea, an original presenter and a diagram that explains it.",
  description: "Explain a topic in original illustrated scenes. Review the direction, narration and picture plan, then approve a sample before the full episode. Starts with one 30-second portrait video; shape, length and artwork direction are yours to change.",
  tags: ["Explainer", "2D", "Portrait"],
  story: ["A concrete question, a visible explanation and a satisfying answer", "Script and picture-plan approval before narration and artwork", "A sample shot before the full episode"],
  look: ["An original presenter with a consistent design and expressive poses", "Simple diagrams, sparse readable labels and purposeful cuts", "Custom Canvas artwork, configured narration and bundled fonts"],
  palette: { sky: ["#263e48", "#48767a"], ground: "#24353d", accents: ["#e6b866", "#77b6ab", "#e89580"] },
  world: "auto",
  defaults: { episodes: 1 },
  production: { mode: "artist", format: { width: 1080, height: 1920, fps: 60 }, targetSeconds: 30, localOnly: true },
  ideas: [
    { label: "How a queue works", idea: "Explain first in, first out using a queue at a tiny ticket booth. Show three numbered visitors arriving and leaving in order. Make the rule visible with a simple diagram, then return to the booth for the payoff." },
    { label: "A task finds its next step", idea: "Explain a simple checklist to someone trying to organize a small project. Show one task moving from To do to Doing to Done, with an original presenter helping us follow the change." },
    { label: "A map needs a key", idea: "Explain how a map key connects a symbol to a place. Use an invented park with a path, a bench and a pond; show one symbol-to-place connection at a time, then follow the map." },
  ],
  creativePrompt: `
FORMAT AND AUDIENCE
Make an original illustrated explainer about the user's topic. Serve the intended viewer in the brief; otherwise use a general audience with no specialist knowledge. Do not assume science, history, psychology, mythology or any other niche. Teach ONE clear idea. Use explicit production settings for format and target duration. The starting format is portrait, 30 seconds, but the user's settings and brief may change it.

STORY AND APPROVAL
Open with a concrete question or small problem, demonstrate the explanation visually, then resolve the opening with a useful answer. Do not force drama, a cliffhanger, a sales pitch or a next-episode teaser. Use original narration in the selected language, with natural pauses and enough breathing room. Do not invent facts or sources. Use supplied factual material; identify claims that need verification in the plan instead of pretending research tools are available.
Keep the existing plan and show-bible approvals. Provide shotPlan with one picture and estimated seconds per spoken line, summing to targetSeconds, so the user reviews narration AND pictures before voice or artwork. The picture describes the presenter pose and gaze, diagram change, exact short labels, framing and the reason for the cut. Keep each picture a short, viewer-readable description, roughly 30-60 words. Do not put actionChecks, word indices, code, file paths or internal acceptance metadata into the script's picture prose. Declare actionChecks only in the later measured-word shot list, after narration exists; do not ask the show bible to require them inside script.shotPlan. At the 30-second starting length aim for four to six distinct editorial shots; adapt the count for other durations. Later retime the approved pictures to measured words. A production unit may contain internal picture cuts, but every cut must advance the question, mechanism or answer. Do not generate a sample before the script and picture plan are approved. After approval, make and review the first shot before batching the rest; never approve gates yourself.

ORIGINAL ART AND REUSABLE DIRECTION
Invent one original illustrated presenter appropriate to this topic and the user's visual direction. It can be human, an animal or an invented figure; no fixed mascot, compulsory geometric body or kit character. Record the silhouette, proportions, face, colors, clothing and expressive poses in the show bible and shared/design.md. Implement the design in shared/characters.js and reuse it wherever the presenter returns. Custom drawing and custom rigs remain available. Keep shared approved designs immutable; use the existing versioned-design mechanism for later changes.
Choose a small coherent palette and a clear focal point for each shot. Establish the presenter in the opening, bring them back during the explanation and payoff, and allow diagram-only closeups when they clarify the idea. Change framing to teach, not to fill a cut quota. No compulsory backdrop or fixed kit. Preserve provided artwork and the user's chosen visual direction.

DIAGRAMS, LABELS AND ACTING
Include at least one simple diagram that demonstrates a relationship, sequence or cause and effect. Reveal or move its parts on the relevant measured narration words. Arrows and shapes must communicate the explanation rather than decorate the frame. Label only what the viewer needs, using exact short text in the selected language, strong contrast and bundled Montserrat. Draw labels in code on the diagram, board or sign; never bake text into an image. No continuous subtitles unless requested. Keep essential faces, diagram parts and labels inside a 10% frame inset and check readability at phone size. Fit and wrap text before it touches the surface boundary.
Give the presenter distinct questioning, pointing and reacting poses across the short example, with gaze following the actual target. Scale the acting to the story. Use preparation, gesture, follow-through and a readable settle; breathing or repeated bobbing alone is not acting. A pointer must visibly reach the diagram; feet should stay planted during a gesture. Custom poses are welcome when existing helpers are inadequate.
For every shot declare 1-3 observable actionChecks using whole-track word indices and shot-scoped ids. Include diagram reveals, pointing/gaze, and label visibility where relevant. Add presenter identity, diagram correctness, text legibility and purposeful editorial cuts to the show rubric/requirements so independent episode review sees them. Do not treat a helper invocation, cast declaration or successful render as evidence of the intended action.

AVAILABLE PRODUCTION
Use procedural Canvas 2D artwork, the configured narration backend and bundled fonts. This format selects local-only production: no generated-image model, remote voice service, downloads, music/SFX acquisition or automatic publishing. Never change the user's AI provider or silently substitute a requested service. Report an incompatible request clearly; the user can choose freeform custom illustration for a different production route. Source and diagrams remain editable in the ordinary saved artist workspace and SceneSpec artifacts. Do not claim a visual editor or asset-library UI exists.
Keep the normal preview, independent visual review/repair and final-export quality gate. Inspect both temporal action samples and the whole cut for continuity, text, diagrams and pacing. Flag unresolved defects honestly. Still samples do not verify audio playback or all intervening motion. Do not claim the output is finished until it has actually been rendered and reviewed.
`.trim(),
};
