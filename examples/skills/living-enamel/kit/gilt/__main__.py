"""Local still, contact sheet and streaming ffmpeg renderer."""
import argparse,importlib.util,json,subprocess,time,tempfile,math
from concurrent.futures import ProcessPoolExecutor
from functools import lru_cache
from pathlib import Path
from PIL import Image,ImageDraw
from . import ROOT
from .engine import Painter,Format,Context
from .shader import shade
from .feed import captions as phone_captions, composite

def load(filename):
    spec=importlib.util.spec_from_file_location('gilt_story',filename);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    tf=ROOT/'work/timeline.json'
    if m.film.use_timeline and tf.exists():
        timeline=json.loads(tf.read_text(encoding='utf-8-sig'))
        from .feedcheck import select_profile
        m.film.profile=select_profile(timeline.get('profile',m.film.profile))
        scenes={s['id']:s for s in timeline['scenes']}
        for shot in m.film.shots:
            if shot.id in scenes:
                source=scenes[shot.id];shot.start=source['start'];shot.end=source['end'];shot.clauses=source['clauses']
    return m

def frame(film,fmt,t,captions=None,setup=None,event_sink=None):
    shot=next((s for s in film.shots if s.start<=t<s.end),film.shots[-1])
    timeline=_timeline() if film.use_timeline else None
    ctx=Context(shot,fmt,timeline);p=Painter(fmt,t,shot.camera(t-shot.start) if shot.camera else None)
    (setup or shot.draw)(p,t-shot.start,ctx)
    hook=film.hook if fmt.name=='portrait' and setup is None else None
    hook_active=hook is not None and hook.active(t,film.duration)
    if captions if captions is not None else fmt.name=='portrait':
        if fmt.name=='portrait':
            if not hook_active:phone_captions(p,ctx,t,profile=film.profile)
        else:
            # Explicit landscape captions retain the original material treatment.
            _legacy_captions(p,ctx,t)
    if event_sink is not None:
        for event in p.events:
            ev=dict(event);ev['time']+=shot.start
            if ev not in event_sink:event_sink.append(ev)
    if hook_active:p.screen_overlays.extend(hook.overlays())
    return composite(shade(p),p.screen_overlays,fmt)


def _legacy_captions(p,ctx,t):
    import skia
    words=[];breaks=set()
    for clause in ctx.clauses:
        breaks.add(len(words));words+=clause.get('words',[])
    idx=next((i for i in reversed(range(len(words))) if words[i]['start']<=t<words[i]['end']+.22),None)
    if idx is None:return
    size=84;font=skia.Font(p.font,size);font.setEmbolden(True)
    groups=[];group=[];width=0
    for i,w in enumerate(words):
        ww=font.measureText(w['w'].upper())
        if group and (i in breaks or len(group)==3 or width+28+ww>810):groups.append(group);group=[];width=0
        group.append((i,w,ww));width+=ww+(28 if len(group)>1 else 0)
    if group:groups.append(group)
    group=next(g for g in groups if any(i==idx for i,w,ww in g))
    total=sum(ww for i,w,ww in group)+28*(len(group)-1)
    factor=min(1,810/total);size*=factor;total*=factor
    p.plaque('',505,1160,'oxblood',size=size,width=total+60)
    x=505-total/2
    for i,w,ww in group:
        p.text(w['w'],x,1160+size*.36,size,anchor='left',highlight=i==idx);x+=(ww+28)*factor

@lru_cache(1)
def _timeline():
    f=ROOT/'work/timeline.json'
    return json.loads(f.read_text(encoding='utf-8')) if f.exists() else None

def segment(task):
    story,name,scale,start,lo,hi,setup_name,captions,output=task
    m=load(story);fmt=Format(name,scale);events=[]
    setup=getattr(m,setup_name) if setup_name else None
    w,h=fmt.size
    cmd=['ffmpeg','-y','-loglevel','error','-threads','1','-f','rawvideo','-pix_fmt','rgb24','-s',f'{w}x{h}','-r','30','-i','-','-c:v','ffv1','-level','3','-threads','1','-pix_fmt','bgr0',output]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    try:
        for i in range(lo,hi):
            proc.stdin.write(frame(m.film,fmt,start+i/30,captions,setup,events).tobytes())
    finally:proc.stdin.close()
    if proc.wait():raise RuntimeError('segment encode failed')
    return events

def video(args,film,fmt,out):
    count=round(((args.end if args.end is not None else film.duration)-args.start)*30)
    if count<=0:raise ValueError('empty frame range')
    jobs=min(args.jobs,count)
    with tempfile.TemporaryDirectory(prefix='gilt-') as tmp:
        tasks=[]
        for j in range(jobs):
            tasks.append((str(Path(args.story).resolve()),fmt.name,fmt.scale,args.start,count*j//jobs,count*(j+1)//jobs,args.setup,False if args.no_captions or args.setup else None,str(Path(tmp)/f'{j}.mkv')))
        if jobs==1:results=[segment(tasks[0])]
        else:
            from gilt.__main__ import segment as worker
            with ProcessPoolExecutor(max_workers=jobs) as pool:results=list(pool.map(worker,tasks))
        manifest=Path(tmp)/'concat.txt'
        manifest.write_text(''.join("file '"+Path(t[-1]).as_posix()+"'\n" for t in tasks))
        cmd=['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',str(manifest)]
        if args.audio:cmd+=['-ss',str(args.start),'-i',args.audio]
        # All source segments are lossless RGB. One final encode makes output
        # independent of chunk boundaries and uses the same GOP for every jobs value.
        cmd+=['-c:v','libx264','-threads','2','-preset','fast','-crf','16','-pix_fmt','yuv420p']
        if args.audio:cmd+=['-c:a','aac','-shortest']
        subprocess.run(cmd+['-movflags','+faststart',str(out)],check=True)
    events=list(film.events)
    for batch in results:
        for event in batch:
            if event not in events:events.append(event)
    return count,events

def main():
    ap=argparse.ArgumentParser();ap.add_argument('command',choices=['still','clip','render','sheet','world-check']);ap.add_argument('story');ap.add_argument('--format',choices=['portrait','landscape'],default='portrait');ap.add_argument('--t',type=float,default=0);ap.add_argument('--out',required=True);ap.add_argument('--start',type=float,default=0);ap.add_argument('--end',type=float);ap.add_argument('--scale',type=float,default=1);ap.add_argument('--audio');ap.add_argument('--n',type=int,default=8);ap.add_argument('--setup');ap.add_argument('--no-captions',action='store_true');ap.add_argument('--jobs',type=int,default=1);ap.add_argument('--strict',action='store_true',help='world-check: exit nonzero for unwaived bare-stage warnings')
    ap.add_argument('--opening',action='store_true',help='sheet: six opening samples plus last/first pair and Short-profile report')
    ap.add_argument('--strict-feed',action='store_true',help='opening sheet: fail on unwaived selected Short-profile checks')
    ap.add_argument('--allow-feed-exception',metavar='REASON',help='Record a portrait long-form/other-work exception, retaining raw feed results')
    args=ap.parse_args()
    if args.jobs<1:ap.error('--jobs must be positive')
    if args.opening and args.command!='sheet':ap.error('--opening is a sheet option')
    if args.strict_feed and not args.opening:ap.error('--strict-feed needs --opening')
    if args.allow_feed_exception is not None and not args.allow_feed_exception.strip():ap.error('Feed exception needs a nonempty reason')
    m=load(args.story);fmt=Format(args.format,args.scale);film=m.film;out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True);setup=getattr(m,args.setup) if args.setup else None
    events_out=list(film.events)
    if args.command in ('sheet','world-check'):
        from .worldcheck import audit,write_report
        world_report=audit(film,fmt.name,setup)
        write_report(world_report,out if args.command=='world-check' else out.with_suffix('.world.json'))
        if args.command=='world-check':
            if args.strict and world_report['warnings']:raise SystemExit(1)
            return
    def f(t):return frame(film,fmt,t,False if args.no_captions or setup else None,setup,events_out)
    start=time.perf_counter();count=0
    if args.command=='still':Image.fromarray(f(args.t)).save(out);count=1
    elif args.command=='sheet':
        feed_report=None
        if args.opening:
            args.start=0;args.end=min(3.,film.duration-1/30);args.n=6
            if fmt.name=='portrait':
                from .feedcheck import measure,write
                timeline=_timeline() if film.use_timeline else None
                timeline=timeline or dict(duration=film.duration,scenes=[dict(id=s.id,clauses=s.clauses) for s in film.shots])
                feed_report=measure(film.duration,timeline,f(0),f((round(film.duration*30)-1)/30),film.hook,args.allow_feed_exception,
                                    profile=film.profile,film_dir=ROOT)
                feed_report['stage']='authoring preview; timing may be estimated, encoded QA still required'
                write(feed_report,out.with_suffix('.feed.json'))
        times=[args.start+((args.end if args.end is not None else film.duration-1/30)-args.start)*i/max(1,args.n-1) for i in range(args.n)];cols=4;thumbw=270;thumbh=round(fmt.size[1]/fmt.size[0]*thumbw)
        if args.opening:times.extend([(round(film.duration*30)-1)/30,0.])
        sheet=Image.new('RGB',(cols*thumbw,((len(times)+cols-1)//cols)*(thumbh+30)),(16,16,23));d=ImageDraw.Draw(sheet)
        for i,t in enumerate(times):
            im=Image.fromarray(f(t));im.thumbnail((thumbw,thumbh));x=(i%cols)*thumbw;y=(i//cols)*(thumbh+30);sheet.paste(im,(x,y))
            shot=next((s for s in film.shots if s.start<=t<s.end),film.shots[-1])
            result=next(r for r in world_report['shots'] if r['shot']==shot.id)
            label=' | BARE STAGE' if result['warning'] else ' | WORLD WAIVER' if result['waived'] else ''
            if args.opening and i>=6:label=' | BOUNDARY '+('LAST' if i==6 else 'FIRST')
            if feed_report is not None and i==0:label+=' | '+feed_report['profile'].upper()+' '+('WAIVED' if feed_report['waived'] else 'OK' if feed_report['passed'] else 'FAIL')
            d.text((x+12,y+thumbh+6),f'{t:.2f} s'+label,fill='#ffad82' if result['warning'] else '#ecd299');count+=1
        sheet.save(out)
        if args.strict_feed and feed_report is not None and not feed_report['accepted']:raise SystemExit(1)
    else:
        count,events_out=video(args,film,fmt,out)
    if args.command=='render' and args.start==0 and (args.end is None or args.end>=film.duration):
        events=ROOT/'work/sfx_events.json';events.parent.mkdir(exist_ok=True)
        events.write_text(json.dumps(sorted(events_out,key=lambda e:e.get('time',e.get('t',0))),indent=2),encoding='utf-8')
    elapsed=time.perf_counter()-start;print(f'{count} frames in {elapsed:.2f}s = {count/elapsed:.2f} fps')
    if args.command in ('clip','render'):
        report=dict(frames=count,seconds=elapsed,fps=count/elapsed,jobs=args.jobs,format=fmt.name,scale=fmt.scale)
        out.with_suffix('.benchmark.json').write_text(json.dumps(report,indent=2))
if __name__=='__main__':main()
