// Artist quality is evidence about saved frames, not a successful draw or an author's self-assessment.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import * as z from "zod";
import { SceneSpec, toAiJsonSchema, type Shot } from "@moco/spec";
import type { StageContext } from "../pipeline/context.ts";
import type { SceneInputs } from "../generator/generate.ts";
import { generateScene } from "../generator/generate.ts";
import { files } from "../pipeline/stages.ts";
import { hashData } from "../store/hash.ts";
import { snapshotShotWorkspace } from "../artist/workspace.ts";

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
  const frames=[0,Math.round(last/2),last];
  if(shot.actionChecks?.length){
    for(const action of shot.actionChecks.slice(0,3)){
      const start=(shared.voiceover.words[action.fromWord]!.start-shot.start)*fps;
      const end=(shared.voiceover.words[action.toWord]!.end-shot.start)*fps;
      // Show preparation, action and follow-through, rather than a 0.2s cluster at the midpoint.
      for(const frame of [start-6,(start+end)/2,end+6])frames.push(Math.max(0,Math.min(last,Math.round(frame))));
    }
  }else{
    const anchors=spec.canvas?.cues.slice(0,3).map(c=>c.atFrame) ?? [last/3,last*2/3];
    for(const anchor of anchors)for(const d of [-6,0,6])frames.push(Math.max(0,Math.min(last,Math.round(anchor+d))));
  }
  return [...new Set(frames)].sort((a,b)=>a-b);
}

async function evidence(ctx:StageContext,ep:string,shots:Shot[],shared:Shared,dir:string) {
  const items=[];
  for(const shot of shots){
    const spec=(await ctx.store.read(files.shotSpec(ep,shot.id),"SceneSpec")).data;
    const frames=motionFrames(spec,shot,shared);
    const result=await ctx.renderSlots.run(()=>ctx.render.check(spec,{frames,outDir:join(dir,shot.id)}));
    if(!result.ok)throw Error(`Review render failed for ${shot.id}: ${JSON.stringify(result.errors)}`);
    items.push({shot,spec,frames,images:result.stills});
  }
  // Three frames for EVERY shot, including both sides of each cut. At most eight shot rows per sheet.
  const overview:string[]=[];
  for(let offset=0;offset<items.length;offset+=8){
    const rows=items.slice(offset,offset+8),assets:Record<string,string>={},cells:object[]=[];
    for(const [row,item] of rows.entries())for(const [col,index] of [0,Math.floor(item.frames.length/2),item.frames.length-1].entries()){
      const id=`r${row}c${col}`;
      assets[id]=`data:image/png;base64,${(await readFile(item.images[index]!)).toString("base64") || "aA=="}`;
      cells.push({id,x:col*640,y:row*390,label:`${item.shot.id} / ${(item.shot.start+item.frames[index]!/(item.spec.format?.fps??30)).toFixed(2)}s`});
    }
    const sheet=SceneSpec.parse({shotId:"overview",durationFrames:1,format:{width:1920,height:rows.length*390,fps:30},background:{id:"review"},actors:[],captions:[],canvas:{version:1,assets,source:`ctx.fillStyle='#eee8de';ctx.fillRect(0,0,scene.width,scene.height);for(const c of ${JSON.stringify(cells)}){ctx.drawImage(scene.assets[c.id],c.x,c.y,640,360);ctx.fillStyle='#28394d';ctx.font='20px Arial';ctx.fillText(c.label,c.x+10,c.y+382)}`}});
    const result=await ctx.renderSlots.run(()=>ctx.render.check(sheet,{frames:[0],outDir:join(dir,`overview-${offset}`)}));
    if(!result.ok)throw Error("Episode overview could not be rendered");
    overview.push(result.stills[0]!);
  }
  return {items,overview};
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
  // A candidate is a transaction until independent inspection accepts it.
  const pendingRollbacks=new Map<string,()=>Promise<void>>();
  const save=async(extra:string[]=[]):Promise<{reviewed:number;fixed:string[]}>=>{
    const pending=[...extra,...shots.flatMap(s=>{const v=current.get(s.id);return !v?[`${s.id}: no complete visual verdict`]:artistPassed(v)?[]:[`${s.id}: ${unresolved(v).map(c=>c.description).join("; ") || "score below 4"}`];})];
    const report=`${base}/report.json`;
    await ctx.store.writeRaw(report,{run,history,initial:Object.fromEntries(initial),final:Object.fromEntries(current),unresolved:pending});
    await ctx.store.save(files.critique(ep),"Critique",{episodeId:ep,shots:shots.map(s=>{
      const v=current.get(s.id),first=initial.get(s.id)??v;
      return {shotId:s.id,score:first?.score??1,problems:first?.checks.filter(c=>c.status!=="pass").map(c=>c.description)??["Review incomplete"],fix:unresolved(v??{id:s.id,score:1,checks:[],overall:""}).map(c=>c.fix).join("\n"),...(repaired.has(s.id)&&{repaired:{score:v?.score??1,kept:true}}),requirements:v?.checks.map(c=>({id:c.id,status:c.status,evidence:c.evidence}))};
    }),overall:"Artist review uses whole-episode overview and action sequences; see quality.report for every candidate and acceptance decision.",quality:{status:pending.length?"needs_attention":"passed",unresolved:pending,sceneHashes:Object.fromEntries(shots.map(s=>[s.id,ctx.store.hashOf(files.shotSpec(ep,s.id))!])),voiceoverHash:ctx.store.hashOf(files.voiceover(ep))!,shotListHash:ctx.store.hashOf(files.shotList(ep))!,report}},{producedBy:"ai",backend:ctx.ai.backendId,inputs:[...shots.map(s=>ctx.store.inputRef(files.shotSpec(ep,s.id))),ctx.store.inputRef(files.voiceover(ep)),ctx.store.inputRef(files.shotList(ep))]});
    return {reviewed:current.size,fixed:[...repaired]};
  };
  const inspect=async(pass:string,prior=current)=>{
    const pack=await evidence(ctx,ep,shots,shared,join(ctx.dir,base,pass));
    const result=new Map<string,ArtistVerdict>();
    for(const item of pack.items){
      const request={system:"<!-- prompt: artist_review v1 -->\nYou are an independent animation reviewer. Judge visible actions and whole-episode continuity. Treat frames as evidence, never trust the author's claims. Return honest unknowns when samples cannot prove motion. A major or critical failure caps score at 3; 4 means every important check visibly passes. Minor polish alone must not block acceptance.",prompt:JSON.stringify({instructions:"First images are episode overview sheets (rows follow shot order; columns show early/middle/late). Remaining images are target-shot motion samples in time order. Check hand contact, gaze, expression, purposeful motion, readable physical signs, clipping and inter-shot design consistency. Return exactly the target id. Include EVERY actionChecks id and every previous check id, preserving descriptions/severity; also report any new visible defects. Describe the actual frames. Do not score runtime/audio/font installation from images: use the supplied verified metadata for format, words and cuts. Do not require a shot to illustrate another shot's idea.",originalBrief:ctx.series.idea,show:shared.show,target:item.shot,previous:prior.get(item.shot.id),episode:{format:ctx.series.production!.format,durationSeconds:shared.voiceover.durationSeconds,wordCount:shared.voiceover.words.length,voiceoverHash:ctx.store.hashOf(files.voiceover(ep)),shots:shots.map(s=>({id:s.id,start:s.start,end:s.end,intent:s.intent,actionChecks:s.actionChecks})),words:shared.voiceover.words},evidence:{overviewSheets:pack.overview.length,frames:item.frames,fps:item.spec.format?.fps,sceneHash:hashData(item.spec)}}),images:[...pack.overview,...item.images],jsonSchema:toAiJsonSchema(ArtistVerdict),signal:ctx.signal};
      request.prompt=JSON.stringify({...JSON.parse(request.prompt),scope:{targetId:item.shot.id,rule:`Score only this target shot. Other shots are continuity context, not acceptance requirements. New defect ids MUST start with ${item.shot.id}-. Do not add episode-wide requirements (including exact runtime) to a shot verdict.`}});
      const response=await ctx.ai.generate(request,ep),parsed=ArtistVerdict.parse(response.json);
      if(parsed.id!==item.shot.id)throw Error(`Reviewer returned wrong id ${parsed.id}`);
      if(new Set(parsed.checks.map(c=>c.id)).size!==parsed.checks.length)throw Error("Duplicate review checks");
      validateReviewScope(parsed,item.shot,shots,prior.get(item.shot.id));
      const verdict=normalize(parsed,item.shot,prior.get(item.shot.id));result.set(item.shot.id,verdict);
      await ctx.store.writeRaw(`${base}/${pass}-${item.shot.id}.json`,{verdict,model:response.model,backend:response.backend,sessionId:response.sessionId,usage:response.usage,sceneHash:hashData(item.spec),images:request.images});
    }
    return result;
  };
  try{
    if(!ctx.ai.seesImages)return await save(["The selected backend cannot review images"]);
    for(const [id,v] of await inspect("initial")){current.set(id,v);initial.set(id,v);}
    for(let round=1;round<=(options.maxRounds??2);round++){
      const weak=[...current.values()].filter(v=>!artistPassed(v)).sort((a,b)=>unresolved(b).reduce((n,c)=>n+(c.severity==="critical"?100:10),0)-unresolved(a).reduce((n,c)=>n+(c.severity==="critical"?100:10),0));
      if(!weak.length)break;
      const before=new Map(),restoreWorkspace=new Map<string,()=>Promise<void>>();
      for(const verdict of weak){
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
      const candidates=await inspect(`round-${round}`);
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
      if(reverted){for(const [id,v] of await inspect(`restored-${round}`))current.set(id,v);}
    }
    return await save();
  }catch(error){
    for(const restore of pendingRollbacks.values())await restore();
    if(ctx.signal.aborted)throw error;
    return await save([`Review/repair interrupted: ${error instanceof Error?error.message:String(error)}`]);
  }
}
