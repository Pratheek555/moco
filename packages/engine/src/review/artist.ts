// Artist quality is evidence about saved frames, not a successful draw or an author's self-assessment.
import { access, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as z from "zod";
import { SceneSpec, toAiJsonSchema, type Shot } from "@moco/spec";
import type { StageContext } from "../pipeline/context.ts";
import type { SceneInputs } from "../generator/generate.ts";
import { generateScene } from "../generator/generate.ts";
import { files } from "../pipeline/stages.ts";
import { hashData } from "../store/hash.ts";
import { snapshotShotWorkspace, publishShotStills } from "../artist/workspace.ts";
import { lookupTemplate, templateImages } from "../templates/registry.ts";
import { loadPrompt } from "../generator/prompts.ts";
import { EngineError } from "../errors.ts";

const progress = (ctx:StageContext,ep:string,message:string) => ctx.bus.emit(ctx.seriesId,"ai.activity",{key:`${ep}/scenes`,episodeId:ep,phase:"working",message});

// A verdict describes a particular cut, including continuity, not just one drawing.
export function reviewContext(ctx:StageContext,shots:Shot[],shared:Shared) {
  return hashData({version:1,shots,shared,idea:ctx.series.idea,production:ctx.series.production,template:ctx.series.template,templateBrief:lookupTemplate(ctx.series.template)?.creativePrompt,references:templateImages(ctx.series.template).map(file=>({file,hash:hashData(readFileSync(file).toString("base64"))})),renderer:ctx.render.versions(),backend:ctx.ai.backendId});
}

const Check = z.object({id:z.string(),description:z.string(),status:z.enum(["pass","fail","unknown"]),severity:z.enum(["critical","major","minor"]),evidence:z.string(),fix:z.string()});
export const ArtistVerdict = z.object({id:z.string(),score:z.number().int().min(1).max(5),checks:z.array(Check).min(1),overall:z.string()});
export type ArtistVerdict = z.infer<typeof ArtistVerdict>;
type Shared = Omit<SceneInputs,"shot">;
const unresolved = (v:ArtistVerdict) => v.checks.filter(c=>c.severity!=="minor" && c.status!=="pass");
export const artistPassed = (v:ArtistVerdict) => v.score>=4 && unresolved(v).length===0;
export function repairImproved(before:ArtistVerdict, after:ArtistVerdict) {
  const old=new Map(before.checks.map(c=>[c.id,c]));
  if(after.checks.some(c=>c.status!=="pass" && c.severity!=="minor" && (!old.has(c.id)||old.get(c.id)!.status==="pass")))return false;
  // Review omissions are not evidence of improvement.
  if(before.checks.some(c=>!after.checks.some(a=>a.id===c.id)))return false;
  const weight=(v:ArtistVerdict)=>v.checks.reduce((sum,c)=>sum+(c.status==="pass"?0:c.severity==="critical"?100:c.severity==="major"?10:1),0);
  return weight(after)<weight(before) || (after.score>before.score && weight(after)<=weight(before));
}

export function motionFrames(spec:SceneSpec,shot:Shot,shared:Shared) {
  const fps=spec.format?.fps??30,last=spec.durationFrames-1;
  const frames=Array.from({length:6},(_,index)=>Math.round(last*index/5));
  if(shot.actionChecks?.length){
    for(const action of shot.actionChecks.slice(0,3)){
      const start=(shared.voiceover.words[action.fromWord]!.start-shot.start)*fps;
      const end=(shared.voiceover.words[action.toWord]!.end-shot.start)*fps;
      // Show preparation, action and follow-through, rather than a 0.2s cluster at the midpoint.
      for(const frame of [start-6,(start+end)/2,end+6])frames.push(Math.max(0,Math.min(last,Math.round(frame))));
    }
  }
  // Authored cues can describe non-spoken action after the last word (a loop,
  // hand release or rewind). Word anchors alone cannot establish that motion.
  const cues=spec.canvas?.cues ?? [];
  const anchors=cues.length?cues.slice(0,6).map(c=>c.atFrame):shot.actionChecks?.length?[]:[last/3,last*2/3];
  for(const anchor of anchors)for(const d of [-6,0,6])frames.push(Math.max(0,Math.min(last,Math.round(anchor+d))));
  for(const cue of cues.filter(c=>/rewind/i.test(c.id))) {
    const end=Math.min(last,cue.atFrame+Math.ceil(fps*.65));
    for(let frame=cue.atFrame;frame<=end;frame++)frames.push(frame);
  }
  return [...new Set(frames)].sort((a,b)=>a-b);
}

async function evidence(ctx:StageContext,ep:string,shots:Shot[],shared:Shared,dir:string) {
  const items=[];
  for(const [index,shot] of shots.entries()){
    ctx.signal.throwIfAborted();
    await progress(ctx,ep,`Preparing visual review frames ${index+1}/${shots.length}: ${shot.id}.`);
    const spec=(await ctx.store.read(files.shotSpec(ep,shot.id),"SceneSpec")).data;
    const frames=motionFrames(spec,shot,shared);
    const cache=`cache/artist-evidence/${hashData({spec,frames,renderer:ctx.render.versions()})}`;
    let result:{ok:true;stills:string[]}|undefined;
    try {
      const saved=JSON.parse(await readFile(join(ctx.dir,cache,"frames.json"),"utf8")) as {stills:string[]};
      if(saved.stills.length===frames.length){await Promise.all(saved.stills.map(file=>access(file)));result={ok:true,stills:saved.stills};}
    } catch { /* Missing/incomplete evidence is rendered again. */ }
    if(!result){
      const rendered=await ctx.renderSlots.run(()=>ctx.render.check(spec,{frames,outDir:join(ctx.dir,cache)}));
      if(!rendered.ok)throw Error(`Review render failed for ${shot.id}: ${JSON.stringify(rendered.errors)}`);
      result=rendered;
      await ctx.store.writeRaw(`${cache}/frames.json`,{stills:result.stills});
    }
    await publishShotStills(ctx,ep,shot.id,result.stills);
    items.push({shot,spec,frames,images:result.stills});
  }
  // Preserve aspect ratio: stretching portrait evidence to 16:9 hides clipping and changes proportions.
  const overview:string[]=[];
  const layout=overviewLayout(items[0]!.spec.format ?? {width:1080,height:1920});
  for(let offset=0;offset<items.length;offset+=layout.rows){
    const rows=items.slice(offset,offset+layout.rows),assets:Record<string,string>={},cells:object[]=[];
    for(const [row,item] of rows.entries())for(const [col,index] of [0,Math.floor(item.frames.length/2),item.frames.length-1].entries()){
      const id=`r${row}c${col}`;
      assets[id]=`data:image/png;base64,${(await readFile(item.images[index]!)).toString("base64") || "aA=="}`;
      cells.push({id,x:col*layout.width,y:row*layout.rowHeight,label:`${item.shot.id} / ${(item.shot.start+item.frames[index]!/(item.spec.format?.fps??30)).toFixed(2)}s`});
    }
    const sheet=SceneSpec.parse({shotId:"overview",durationFrames:1,format:{width:Math.max(16,layout.width*3),height:rows.length*layout.rowHeight,fps:30},background:{id:"review"},actors:[],captions:[],canvas:{version:1,assets,source:`ctx.fillStyle='#eee8de';ctx.fillRect(0,0,scene.width,scene.height);for(const c of ${JSON.stringify(cells)}){ctx.drawImage(scene.assets[c.id],c.x,c.y,${layout.width},${layout.height});ctx.fillStyle='#28394d';ctx.font='20px Arial';ctx.fillText(c.label,c.x+10,c.y+${layout.height+22})}`}});
    const result=await ctx.renderSlots.run(()=>ctx.render.check(sheet,{frames:[0],outDir:join(dir,`overview-${offset}`)}));
    if(!result.ok)throw Error("Episode overview could not be rendered");
    overview.push(result.stills[0]!);
  }
  return {items,overview};
}

export function overviewLayout(format:{width:number;height:number}) {
  const scale=Math.min(640/format.width,640/format.height);
  const width=Math.max(1,Math.round(format.width*scale)),height=Math.max(1,Math.round(format.height*scale)),rowHeight=height+30;
  return {width,height,rowHeight,rows:Math.min(8,Math.floor(4096/rowHeight))};
}

export function normalize(v:ArtistVerdict, shot:Shot, previous?:ArtistVerdict):ArtistVerdict {
  const required=[...(shot.actionChecks??[]).map(a=>({id:a.id,description:a.description,severity:"major" as const})),...(previous?.checks??[])];
  const checks=[...v.checks];
  for(const r of required)if(!checks.some(c=>c.id===r.id))checks.push({...r,status:"unknown",evidence:"Reviewer omitted this acceptance check",fix:"Supply frame evidence for this check"});
  // Severity cannot be quietly downgraded to manufacture progress.
  const rank={minor:1,major:2,critical:3};
  for(const c of checks)for(const r of required){if(r.id===c.id && rank[c.severity]<rank[r.severity])c.severity=r.severity;}
  return {...v,checks,score:checks.some(c=>c.status!=="pass"&&c.severity!=="minor")?Math.min(3,v.score):v.score};
}

export function validateReviewScope(v:ArtistVerdict, shot:Shot, shots:Shot[], previous?:ArtistVerdict) {
  const allowed=new Set([...(shot.actionChecks??[]).map(a=>a.id),...(previous?.checks??[]).map(c=>c.id)]);
  const foreign=new Set(shots.filter(s=>s.id!==shot.id).flatMap(s=>(s.actionChecks??[]).map(a=>a.id)).filter(id=>!allowed.has(id)));
  for(const check of v.checks){
    if(foreign.has(check.id)||(!allowed.has(check.id)&&!check.id.startsWith(`${shot.id}-`)))
      throw Error(`Out-of-scope review check ${check.id} for ${shot.id}`);
  }
}

export async function reviewArtistEpisode(ctx:StageContext,ep:string,shots:Shot[],shared:Shared,options:{maxRounds?:number}={}) {
  const run=randomUUID(),base=`episodes/${ep}/quality/${run}`,history:object[]=[];
  const current=new Map<string,ArtistVerdict>(),initial=new Map<string,ArtistVerdict>();
  const repaired=new Set<string>();
  const context=reviewContext(ctx,shots,shared);
  const checkpoint=`episodes/${ep}/quality/checkpoint.json`;
  const cutHash=()=>hashData({context,scenes:shots.map(s=>ctx.store.hashOf(files.shotSpec(ep,s.id)))});
  const checkpointCurrent=async()=>ctx.store.writeRaw(checkpoint,{context,cutHash:cutHash(),initial:Object.fromEntries(initial),final:Object.fromEntries(current)});
  // A candidate is a transaction until independent inspection accepts it.
  const pendingRollbacks=new Map<string,()=>Promise<void>>();
  const save=async(extra:string[]=[]):Promise<{reviewed:number;fixed:string[]}>=>{
    const pending=[...extra,...shots.flatMap(s=>{const v=current.get(s.id);return !v?[`${s.id}: no complete visual verdict`]:artistPassed(v)?[]:[`${s.id}: ${unresolved(v).map(c=>c.description).join("; ") || "score below 4"}`];})];
    const report=`${base}/report.json`;
    await ctx.store.writeRaw(report,{run,context,history,initial:Object.fromEntries(initial),final:Object.fromEntries(current),unresolved:pending});
    await ctx.store.save(files.critique(ep),"Critique",{episodeId:ep,shots:shots.map(s=>{
      const v=current.get(s.id),first=initial.get(s.id)??v;
      return {shotId:s.id,score:first?.score??1,problems:first?.checks.filter(c=>c.status!=="pass").map(c=>c.description)??["Review incomplete"],fix:unresolved(v??{id:s.id,score:1,checks:[],overall:""}).map(c=>c.fix).join("\n"),...(repaired.has(s.id)&&{repaired:{score:v?.score??1,kept:true}}),requirements:v?.checks.map(c=>({id:c.id,status:c.status,evidence:c.evidence}))};
    }),overall:"Artist review uses whole-episode overview and action sequences; see quality.report for every candidate and acceptance decision.",quality:{status:pending.length?"needs_attention":"passed",unresolved:pending,sceneHashes:Object.fromEntries(shots.map(s=>[s.id,ctx.store.hashOf(files.shotSpec(ep,s.id))!])),voiceoverHash:ctx.store.hashOf(files.voiceover(ep))!,shotListHash:ctx.store.hashOf(files.shotList(ep))!,report}},{producedBy:"ai",backend:ctx.ai.backendId,inputs:[...shots.map(s=>ctx.store.inputRef(files.shotSpec(ep,s.id))),ctx.store.inputRef(files.voiceover(ep)),ctx.store.inputRef(files.shotList(ep))]});
    return {reviewed:current.size,fixed:[...repaired]};
  };
  const inspect=async(pass:string,prior=current,affected?:Set<string>)=>{
    // Resume individual completed verdicts only while the entire cut and review
    // context are unchanged. A changed neighbour can invalidate continuity.
    const result=new Map<string,ArtistVerdict>();
    for(const [id,v] of current)if(!affected?.has(id))result.set(id,v);
    if(result.size===shots.length)return result;
    const pack=await evidence(ctx,ep,shots,shared,join(ctx.dir,base,pass));
    const targets=pack.items.filter(item=>!result.has(item.shot.id));
    const record=async(id:string,v:ArtistVerdict)=>{
      result.set(id,v);
      if(pass==="initial"){
        current.set(id,v);initial.set(id,v);
        await checkpointCurrent();
      }
      await progress(ctx,ep,`Visual review ${result.size}/${shots.length}: ${id} ${artistPassed(v)?"passed":"needs repair"}.`);
    };
    // Prompt shorts have many small shots. Review three targets together rather
    // than resending and reinterpreting the entire cut once for each target.
    if(ctx.series.template) {
      const refs=templateImages(ctx.series.template);
      for(let offset=0;offset<targets.length;offset+=3) {
        const batch=targets.slice(offset,offset+3);
        await progress(ctx,ep,`Inspecting ${batch.map(item=>item.shot.id).join(", ")} (${result.size}/${shots.length} reviewed).`);
        const schema=z.object({verdicts:z.array(ArtistVerdict).length(batch.length)});
        const request={
          system:loadPrompt("artist_review"),
          prompt:JSON.stringify({instructions:"First images are whole-episode overview sheets. Then each target's motion frames follow in target order; the last referenceCount images are style references. Review only the listed targets. Match each verdict id exactly. Include every actionChecks id and previous check id with unchanged severity. New defect ids MUST start with that target id followed by a dash. Check purposeful actions, hand contact, gaze, text fit, clipping and continuity. Do not demand identical reference story content, copied logos or creator characters. Use verified metadata for runtime, words and format; do not infer audio or font installation from stills. Ordinary cartoon simplification is not a defect by itself. Unknowns must identify the missing evidence precisely.",originalBrief:ctx.series.idea,templateBrief:lookupTemplate(ctx.series.template)?.creativePrompt,show:shared.show,targets:batch.map(item=>({shot:item.shot,previous:prior.get(item.shot.id),frames:item.frames,frameCount:item.images.length,sceneHash:hashData(item.spec)})),episode:{format:ctx.series.production!.format,durationSeconds:shared.voiceover.durationSeconds,wordCount:shared.voiceover.words.length,shots:shots.map(s=>({id:s.id,start:s.start,end:s.end,intent:s.intent})),words:shared.voiceover.words},overviewCount:pack.overview.length,referenceCount:refs.length}),
          images:[...pack.overview,...batch.flatMap(item=>item.images),...refs],jsonSchema:toAiJsonSchema(schema),signal:ctx.signal,
        };
        const ai=ctx.ai.forTask?.(`visual review ${batch.map(item=>item.shot.id).join(", ")}`)??ctx.ai;
        const response=await ai.generate(request,ep),parsed=schema.parse(response.json);
        if(new Set(parsed.verdicts.map(v=>v.id)).size!==batch.length || batch.some(item=>!parsed.verdicts.some(v=>v.id===item.shot.id)))throw Error("Reviewer returned missing or unexpected target ids");
        for(const item of batch) {
          const raw=parsed.verdicts.find(v=>v.id===item.shot.id)!;
          if(new Set(raw.checks.map(c=>c.id)).size!==raw.checks.length)throw Error("Duplicate review checks");
          validateReviewScope(raw,item.shot,shots,prior.get(item.shot.id));
          const v=normalize(raw,item.shot,prior.get(item.shot.id));
          await ctx.store.writeRaw(`${base}/${pass}-${item.shot.id}.json`,{verdict:v,model:response.model,backend:response.backend,sessionId:response.sessionId,usage:response.usage,sceneHash:hashData(item.spec),images:request.images,batch:batch.map(item=>item.shot.id)});
          await record(item.shot.id,v);
        }
      }
      return result;
    }
    for(const item of targets){
      await progress(ctx,ep,`Inspecting ${item.shot.id} (${result.size}/${shots.length} reviewed).`);
      const request={system:"<!-- prompt: artist_review v1 -->\nYou are an independent animation reviewer. Judge visible actions and whole-episode continuity. Treat frames as evidence, never trust the author's claims. Return honest unknowns when samples cannot prove motion. A major or critical failure caps score at 3; 4 means every important check visibly passes. Minor polish alone must not block acceptance.",prompt:JSON.stringify({instructions:"First images are episode overview sheets (rows follow shot order; columns show early/middle/late). Remaining images are target-shot motion samples in time order. Check hand contact, gaze, expression, purposeful motion, readable physical signs, clipping and inter-shot design consistency. Return exactly the target id. Include EVERY actionChecks id and every previous check id, preserving descriptions/severity; also report any new visible defects. Describe the actual frames. Do not score runtime/audio/font installation from images: use the supplied verified metadata for format, words and cuts. Do not require a shot to illustrate another shot's idea.",originalBrief:ctx.series.idea,templateBrief:lookupTemplate(ctx.series.template)?.creativePrompt,show:shared.show,target:item.shot,previous:prior.get(item.shot.id),episode:{format:ctx.series.production!.format,durationSeconds:shared.voiceover.durationSeconds,wordCount:shared.voiceover.words.length,voiceoverHash:ctx.store.hashOf(files.voiceover(ep)),shots:shots.map(s=>({id:s.id,start:s.start,end:s.end,intent:s.intent,actionChecks:s.actionChecks})),words:shared.voiceover.words},evidence:{overviewSheets:pack.overview.length,frames:item.frames,fps:item.spec.format?.fps,sceneHash:hashData(item.spec)}}),images:[...pack.overview,...item.images],jsonSchema:toAiJsonSchema(ArtistVerdict),signal:ctx.signal};
      const references=templateImages(ctx.series.template);
      request.images.push(...references);
      request.prompt=JSON.stringify({...JSON.parse(request.prompt),styleReferences:references.length ? `The LAST ${references.length} images are reference style frames. Compare illustration detail, scene staging, proportions, palette and typography. Do not demand copied logos, creator characters or identical story content.` : undefined,scope:{targetId:item.shot.id,rule:`Score only this target shot. Other shots are continuity context, not acceptance requirements. New defect ids MUST start with ${item.shot.id}-. Do not add episode-wide requirements (including exact runtime) to a shot verdict.`}});
      const ai=ctx.ai.forTask?.(`visual review ${item.shot.id}`)??ctx.ai;
      const response=await ai.generate(request,ep),parsed=ArtistVerdict.parse(response.json);
      if(parsed.id!==item.shot.id)throw Error(`Reviewer returned wrong id ${parsed.id}`);
      if(new Set(parsed.checks.map(c=>c.id)).size!==parsed.checks.length)throw Error("Duplicate review checks");
      validateReviewScope(parsed,item.shot,shots,prior.get(item.shot.id));
      const verdict=normalize(parsed,item.shot,prior.get(item.shot.id));
      await ctx.store.writeRaw(`${base}/${pass}-${item.shot.id}.json`,{verdict,model:response.model,backend:response.backend,sessionId:response.sessionId,usage:response.usage,sceneHash:hashData(item.spec),images:request.images});
      await record(item.shot.id,verdict);
    }
    return result;
  };
  try{
    if(!ctx.ai.seesImages)return await save(["The selected backend cannot review images"]);
    try {
      const saved=JSON.parse(await readFile(join(ctx.dir,checkpoint),"utf8"));
      if(saved.context===context && saved.cutHash===cutHash()){
        // Validate the complete checkpoint before trusting any of it.
        const restored=shots.filter(s=>saved.final?.[s.id]).map(s=>{
          const v=ArtistVerdict.parse(saved.final[s.id]);
          if(v.id!==s.id)throw Error("Checkpoint target mismatch");
          validateReviewScope(v,s,shots);
          return [s.id,normalize(v,s),ArtistVerdict.parse(saved.initial?.[s.id]??v)] as const;
        });
        for(const [id,v,first] of restored){current.set(id,v);initial.set(id,first);if(repairImproved(first,v))repaired.add(id);}
        await progress(ctx,ep,`Resuming visual review: ${current.size}/${shots.length} saved verdicts restored.`);
      }
    }catch { /* Incompatible or missing checkpoints require fresh review. */ }
    for(const [id,v] of await inspect("initial")){current.set(id,v);if(!initial.has(id))initial.set(id,v);}
    for(let round=1;round<=(options.maxRounds??2);round++){
      const weak=[...current.values()].filter(v=>!artistPassed(v)).sort((a,b)=>unresolved(b).reduce((n,c)=>n+(c.severity==="critical"?100:10),0)-unresolved(a).reduce((n,c)=>n+(c.severity==="critical"?100:10),0));
      if(!weak.length)break;
      const before=new Map(),restoreWorkspace=new Map<string,()=>Promise<void>>();
      for(const verdict of weak){
        await progress(ctx,ep,`Repairing ${verdict.id}, visual repair round ${round}.`);
        const shot=shots.find(s=>s.id===verdict.id)!;
        before.set(shot.id,await ctx.store.read(files.shotSpec(ep,shot.id),"SceneSpec"));
        restoreWorkspace.set(shot.id,await snapshotShotWorkspace(ctx,ep,shot.id));
        pendingRollbacks.set(shot.id,async()=>{
          const old=before.get(shot.id)!;
          await ctx.store.save(files.shotSpec(ep,shot.id),"SceneSpec",old.data,{producedBy:old.meta.producedBy,backend:old.meta.backend,inputs:old.meta.inputs});
          await restoreWorkspace.get(shot.id)!();
        });
        await generateScene(ctx,{...shared,shot,force:true,keepOnFailure:true,feedback:`Independent reviewer acceptance checks: ${JSON.stringify(verdict)}\nRound ${round}. ${round>1?"The previous approach did not clear these failures. CHANGE THE APPROACH: replace the inadequate pose/rig or add a versioned shared design. Do not merely shift positions or repeat the same gesture.":"Repair every failed major/critical check with a visibly observable action."} Preserve the narration, timing, palette and recurring character identity. You may use helpers.acting or write a better rig.`});
      }
      // The reviewer sees a fresh overview of the whole cut. Reinspect repaired
      // shots and both sides of their cuts; unchanged distant shots retain their
      // accepted action evidence rather than restarting a feature-length review.
      const affected=new Set<string>();
      for(const v of weak){const index=shots.findIndex(s=>s.id===v.id);for(const s of shots.slice(Math.max(0,index-1),index+2))affected.add(s.id);}
      const candidates=await inspect(`round-${round}`,current,affected);
      let reverted=false;
      for(const [id,after] of candidates){
        const old=before.get(id),prior=current.get(id)!;
        const kept=!old || repairImproved(prior,after);
        history.push({round,id,before:prior,after,kept});
        if(kept){current.set(id,after);if(old)repaired.add(id);}
        else {await ctx.store.save(files.shotSpec(ep,id),"SceneSpec",old.data,{producedBy:old.meta.producedBy,backend:old.meta.backend,inputs:old.meta.inputs});await restoreWorkspace.get(id)!();reverted=true;}
        pendingRollbacks.delete(id);
        ctx.ledger.decide("look",`${ep}/${id}`,`artist round ${round}: ${prior.score} -> ${after.score}, ${kept?"kept":"reverted (no evidenced improvement)"}`);
      }
      await ctx.bus.emit(ctx.seriesId,"look.repairs",{episodeId:ep,round,unresolved:[...current.values()].filter(v=>!artistPassed(v)).map(v=>v.id)});
      // A rejected candidate changes the episode overview. Revalidate the actual restored cut.
      if(reverted){for(const [id,v] of await inspect(`restored-${round}`,current,affected))current.set(id,v);}
      await checkpointCurrent();
    }
    return await save();
  }catch(error){
    for(const restore of pendingRollbacks.values())await restore();
    if(ctx.signal.aborted)throw error;
    await save([`Review/repair interrupted: ${error instanceof Error?error.message:String(error)}`]);
    // Persist evidence and restore candidates before surfacing a resumable stop.
    if (error instanceof EngineError) throw error;
    throw new EngineError("validation_failed",`Visual review interrupted; completed checks are saved. Retry to resume: ${error instanceof Error?error.message:String(error)}`);
  }
}
