import { expandModel } from "@moco/kit";
import type { SceneSpec, Vocabulary, World } from "@moco/spec";
import type { Issue } from "../loop/feedback.ts";

export function compileScene(input: SceneSpec, vocabulary?: Vocabulary): { spec: SceneSpec; issues: Issue[] } {
  const spec = structuredClone(input);
  const issues: Issue[] = [];
  const stage = spec.stage;
  if (!stage) return { spec, issues };
  const expand = (target: typeof stage | typeof stage.players[number], path: string, channels: string[]) => {
    if (!target.sequence) return;
    const entry = vocabulary?.entries.find((entry) => entry.id === target.sequence);
    if (!entry) { issues.push({ path: `${path}.sequence`, problem: `unknown sequence ${target.sequence}`, allowed: vocabulary?.entries.map((entry) => entry.id) ?? [] }); return; }
    if (!channels.some((channel) => (entry as unknown as Record<string, unknown>)[channel])) { issues.push({ path, problem: "sequence has no compatible channels for this target" }); return; }
    for (const channel of channels) {
      const keys = (entry as unknown as Record<string, { atFrame: number }[] | undefined>)[channel];
      const record = target as unknown as Record<string, unknown>;
      if (keys && record[channel]) issues.push({ path: `${path}.${channel}`, problem: "both sequence and inline keys control this channel", fix: "Use one source per channel." });
      else if (keys) record[channel] = keys.map((key) => ({ ...key, atFrame: Math.round(key.atFrame * (spec.durationFrames - 1) / (entry.durationFrames - 1)) }));
    }
    delete target.sequence;
  };
  expand(stage, "stage", ["cameraKeys"]);
  stage.players.forEach((player, index) => expand(player, `stage.players[${index}]`, ["motionKeys", "poseKeys"]));
  return { spec, issues };
}

export function checkTimelines(spec: SceneSpec, world?: World): Issue[] {
  const issues: Issue[] = [];
  const check = (keys: { atFrame: number }[] | undefined, path: string) => {
    keys?.forEach((key, i) => {
      if (key.atFrame >= spec.durationFrames || (i > 0 && key.atFrame <= keys[i - 1]!.atFrame)) issues.push({ path: `${path}[${i}].atFrame`, problem: "keys must be strictly increasing and inside the shot" });
    });
  };
  check(spec.stage?.cameraKeys, "stage.cameraKeys");
  spec.stage?.cameraKeys?.forEach((key, index) => {
    if (key.eye.every((value, axis) => Math.abs(value - key.target[axis]!) < 0.001)) issues.push({ path: `stage.cameraKeys[${index}]`, problem: "camera eye and target coincide" });
  });
  spec.stage?.players.forEach((player, index) => {
    const path = `stage.players[${index}]`;
    check(player.motionKeys, `${path}.motionKeys`); check(player.poseKeys, `${path}.poseKeys`);
    if (player.motionKeys && player.to) issues.push({ path, problem: "motionKeys and to both control movement", fix: "Remove to when supplying motionKeys." });
    const model = world?.models.find((model) => model.id === player.model);
    if (!model) return;
    const joints = new Set(expandModel(model).parts.map((part) => part.id));
    player.poseKeys?.forEach((key, i) => Object.keys(key.turn).forEach((joint) => {
      if (!joints.has(joint)) issues.push({ path: `${path}.poseKeys[${i}].turn.${joint}`, problem: "joint does not exist on this model", allowed: [...joints] });
    }));
  });
  return issues;
}

export function sequencesFrom(spec: SceneSpec, episodeId: string): Vocabulary["entries"] {
  if (spec.fallback || !spec.stage) return [];
  const source = `${episodeId}/${spec.shotId}`;
  return [
    ...(spec.stage.cameraKeys ? [{ id: `${source}/camera`, source, durationFrames: spec.durationFrames, cameraKeys: spec.stage.cameraKeys }] : []),
    ...spec.stage.players.filter((player) => player.motionKeys || player.poseKeys).map((player) => ({ id: `${source}/${player.id}`, source, durationFrames: spec.durationFrames, motionKeys: player.motionKeys, poseKeys: player.poseKeys })),
  ];
}
