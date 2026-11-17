"""Bare-stage warning from unlit albedo; independent of travelling shader light.

Not a recognizer of buildings, history, meaning, depth or beauty. Patterned voids
can pass; real open sea/desert or a macro can warn. Always inspect the picture.
"""
import json
from pathlib import Path
import cv2
import numpy as np
from .engine import Painter, Format, Context

METHOD = 'dominant_flat_field_v1'
LIMITS = dict(flat_share=.48, lower_flat_share=.70, field_share=.48,
              upper_field_share=.55, ornament_radius_stage=16, clearance_stage=32,
              samples_per_shot=3, scale=.25)


def measure(p):
    """Share of inspected stage occupied by the dominant enamel far from edges.

    Ignore the rim and automatic caption rectangle, which is never drawn here.
    Erode flat colour by 32 stage units: a real floor with seams is distinguished
    from one flat fill. Mode is quantized into 16 RGB bins per channel; tolerant
    membership avoids antialiasing sensitivity. All thresholds are stage-based.
    """
    rgb,material=p.arrays();h,w=rgb.shape[:2];s=p.format.scale
    yy,xx=np.mgrid[:h,:w];x=xx/s+p.format.rect[0];y=yy/s+p.format.rect[1]
    x0,y0,x1,y1=p.format.rect
    mask=(x>x0+55)&(x<x1-55)&(y>y0+55)&(y<y1-55)
    if p.format.name=='portrait':mask &= ~((x>60)&(x<960)&(y>1070)&(y<1260))
    else:mask &= ~((y>920)&(y<1040))
    nonmetal=material[:,:,1]<80
    bins=rgb.astype(np.int32)//16
    codes=bins[:,:,0]*256+bins[:,:,1]*16+bins[:,:,2]
    samples=codes[mask&nonmetal]
    if samples.size:
        mode=int(np.bincount(samples,minlength=4096).argmax())
        chosen=(codes==mode)&nonmetal
        col=np.median(rgb[chosen],axis=0)
        same=(np.max(np.abs(rgb.astype(np.float32)-col),axis=2)<12)&nonmetal
        # Zero padding makes the edge of the visible crop an edge too.
        distance=cv2.distanceTransform(np.pad(same.astype(np.uint8),1),cv2.DIST_L2,5)[1:-1,1:-1]/s
        bare=same & (distance>=LIMITS['clearance_stage'])
        # Discount tiny stars and wire ornament. This is a second signal: do
        # not use it on lower floors, whose seams also become small at scale.
        k=2*round(LIMITS['ornament_radius_stage']*s)+1
        closed=cv2.morphologyEx(same.astype(np.uint8),cv2.MORPH_CLOSE,np.ones((k,k),np.uint8))
        broad=cv2.distanceTransform(np.pad(closed,1),cv2.DIST_L2,5)[1:-1,1:-1]/s >= LIMITS['clearance_stage']
    else:
        bare=np.zeros((h,w),bool);broad=bare;col=np.array([0,0,0])
    lower=mask & (y>1240 if p.format.name=='portrait' else y>760)
    share=lambda region:float((bare&region).sum()/max(1,region.sum()))
    total,low=share(mask),share(lower)
    upper=mask & (y<y0+(y1-y0)*.365)
    field=float((broad&mask).sum()/max(1,mask.sum()))
    upper_field=float((broad&upper).sum()/max(1,upper.sum()))
    return dict(flat_share=round(total,4),lower_flat_share=round(low,4),
                field_share=round(field,4),upper_field_share=round(upper_field,4),
                dominant_rgb=[int(v) for v in col],
                flagged=total>=LIMITS['flat_share'] or low>=LIMITS['lower_flat_share'] or
                        field>=LIMITS['field_share'] or upper_field>=LIMITS['upper_field_share'])


def audit(film,name='portrait',setup=None):
    fmt=Format(name,LIMITS['scale']);rows=[]
    for shot in film.shots:
        samples=[]
        for fraction in (.2,.5,.8):
            local=(shot.end-shot.start)*fraction;absolute=shot.start+local
            p=Painter(fmt,absolute,shot.camera(local) if shot.camera else None)
            (setup or shot.draw)(p,local,Context(shot,fmt))
            samples.append(dict(time=round(absolute,4),**measure(p)))
        flagged=any(s['flagged'] for s in samples)
        exception=getattr(shot,'world_exception','').strip()
        rows.append(dict(shot=shot.id,samples=samples,flagged=flagged,
                         exception=exception,waived=bool(flagged and exception),
                         warning=flagged and not exception))
    return dict(method=METHOD,format=name,thresholds=LIMITS,shots=rows,
                warnings=sum(bool(r['warning']) for r in rows),
                limits='Measures dominant flat colour away from edges, not whether a place is convincing. '
                       'Ornament/noise can fool it; open landscapes, macros and maps may warn. '
                       'Three samples can miss a bare interval. Inspect full and phone-size images.')


def write_report(report,out):
    out=Path(out);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(report,indent=2),encoding='utf-8')
    for row in report['shots']:
        peak=max(s['flat_share'] for s in row['samples']);low=max(s['lower_flat_share'] for s in row['samples'])
        field=max(s['field_share'] for s in row['samples']);upper=max(s['upper_field_share'] for s in row['samples'])
        state='WARN bare stage' if row['warning'] else 'WAIVED bare stage' if row['waived'] else 'OK world signal'
        print(f"{state}: {row['shot']}: flat {peak:.1%}, lower {low:.1%}, field {field:.1%}, upper {upper:.1%}"+
              (f" — {row['exception']}" if row['exception'] else ''))
    print(f'World check: {report["warnings"]} warning(s). Report: {out}')
