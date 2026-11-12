"""Read-only reference measurements; all extracted media stays in the supplied scratch directory."""
from pathlib import Path
import argparse, json, re, subprocess
import numpy as np
from PIL import Image, ImageDraw

def run(*args):
    return subprocess.run(list(map(str,args)), check=True, capture_output=True, text=True, encoding='utf8').stdout

def sheet(files, out, cols=4, width=384, labels=None):
    height=width//2
    canvas=Image.new('RGB',(cols*width,((len(files)+cols-1)//cols)*(height+26)), '#d4d4d4')
    d=ImageDraw.Draw(canvas)
    for i,file in enumerate(files):
        img=Image.open(file).convert('RGB'); img.thumbnail((width,height))
        x=(i%cols)*width; y=(i//cols)*(height+26)
        canvas.paste(img,(x,y)); d.text((x+7,y+height+5),(labels[i] if labels else file.stem),fill='#161616')
    canvas.save(out)

def main():
    p=argparse.ArgumentParser();p.add_argument('root');a=p.parse_args()
    root=Path(a.root);video=root/'reference.mp4'
    probe=json.loads(run('ffprobe','-v','error','-show_streams','-show_format','-of','json',video))
    (root/'probe.json').write_text(json.dumps(probe,indent=2))
    overview=root/'overview';overview.mkdir(exist_ok=True)
    run('ffmpeg','-v','error','-i',video,'-vf','fps=1/10,scale=768:-1','-q:v','3','-y',overview/'%04d.jpg')
    files=sorted(overview.glob('*.jpg'))
    for start in range(0,len(files),32):
        sheet(files[start:start+32],root/f'overview-{start//32+1}.jpg', labels=[f'{(i+start)*10+5:.0f} s' for i in range(len(files[start:start+32]))])
    scenes=run('ffmpeg','-v','error','-i',video,'-vf',"scale=192:-1,select='gt(scene,0.22)',metadata=print:file=-",'-an','-f','null','-')
    (root/'scene-detection.txt').write_text(scenes)
    cuts=[float(x) for x in re.findall(r'pts_time:([0-9.]+)',scenes)]
    duration=float(probe['format']['duration']);bounds=[0]+cuts+[duration]
    lengths=np.diff(bounds)
    stats={'threshold':.22,'candidateCuts':cuts,'count':len(cuts),'duration':duration,'medianSeconds':float(np.median(lengths)),'meanSeconds':float(np.mean(lengths)),'p10p90':np.quantile(lengths,[.1,.9]).tolist()}
    srt=(root/'reference.en-US.srt').read_text(encoding='utf8')
    captions=[]
    for b in re.split(r'\n\s*\n',srt.strip()):
        lines=b.splitlines()
        if len(lines)<3:continue
        ts=lines[1].split(' --> ')
        def secs(t):
            h,m,s=t.replace(',','.').split(':');return 3600*float(h)+60*float(m)+float(s)
        text=' '.join(lines[2:]);words=len(re.findall(r"\b[\w']+\b",text))
        captions.append({'start':secs(ts[0]),'end':secs(ts[1]),'text':text,'words':words,'wps':words/max(.01,secs(ts[1])-secs(ts[0]))})
    stats['captions']={'words':sum(x['words'] for x in captions),'overallWps':sum(x['words'] for x in captions)/duration,'medianCaptionWps':float(np.median([x['wps'] for x in captions]))}
    (root/'measurements.json').write_text(json.dumps(stats,indent=2));(root/'captions.json').write_text(json.dumps(captions,indent=2))
    # Native-frame strips at key action points; review sequential poses, not just poster frames.
    for start in [1,15,65,106,180,350,600,910,1380,1750]:
        dest=root/f'motion-{start}';dest.mkdir(exist_ok=True)
        run('ffmpeg','-v','error','-ss',start,'-i',video,'-t','1','-vf','scale=576:-1','-fps_mode','passthrough','-q:v','3','-y',dest/'%03d.jpg')
        frames=sorted(dest.glob('*.jpg'))
        for n in range(0,len(frames),30):sheet(frames[n:n+30],root/f'motion-{start}-{n}.jpg',cols=5,width=288,labels=[f'{start+(i+n)/60:.3f}s' for i in range(len(frames[n:n+30]))])
    audio=run('ffmpeg','-hide_banner','-i',video,'-vn','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-') if False else subprocess.run(['ffmpeg','-hide_banner','-i',str(video),'-vn','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True).stderr
    (root/'audio-loudness.txt').write_text(audio)
    print(json.dumps(stats|{'candidateCuts':'see measurements.json'},indent=2))

if __name__=='__main__':main()
