"""Run with: python -m unittest discover -s tests -p test_worlds.py.

Regression checks for camera compatibility, paired static caches and the warning.
Visual judgment still belongs to the author.
"""
import unittest
import numpy as np
from gilt import Painter,Format,Camera,rect,Film,Shot
from gilt.engine import _SCENERY
from gilt.worldcheck import measure,audit
from stories import world as W
from stories import pilot_sets as S


class Worlds(unittest.TestCase):
    def test_depth_one_keeps_legacy_camera_and_nested_transform(self):
        for fmt in (Format('portrait',.25),Format('landscape',.25)):
            a,b=[Painter(fmt,1,Camera((603,511),1.2,4)) for _ in range(2)]
            with a.transform(translate=(17,22),rotate=8,pivot=(540,540)):
                a.cell(rect(150,100,490,600),'jade')
            with b.transform(translate=(17,22),rotate=8,pivot=(540,540)),b.layer(1):
                b.cell(rect(150,100,490,600),'jade')
            for x,y in zip(a.arrays(),b.arrays()):np.testing.assert_array_equal(x,y)

    def test_pan_parallax_and_absolute_nested_depth(self):
        p=Painter(Format('portrait',.5),camera=Camera((640,540)))
        def x():return p.cs[0].getTotalMatrix().mapXY(540,540).x()
        self.assertAlmostEqual(x(),220)
        with p.layer(.25):
            self.assertAlmostEqual(x(),257.5)
            with p.layer(1):self.assertAlmostEqual(x(),220)
            self.assertAlmostEqual(x(),257.5)
        self.assertAlmostEqual(x(),220)
        with p.layer(0):self.assertAlmostEqual(x(),270)

    def test_cached_materials_match_direct_under_camera_clip_and_scale(self):
        def drawing(p):
            p.cell(rect(-500,-500,2200,2600),'midnight',1)
            p.cell(W.archway(540,900,500,700),'#67534a',3)
            p.rivet(540,530,20)
        for size in (.25,.5):
            a,b=[Painter(Format('portrait',size),camera=Camera((572,549),1.04,2)) for _ in range(2)]
            for p in (a,b):
                with p.layer(.6),p.clip(rect(100,-200,800,1400)):
                    if p is a:drawing(p)
                    else:p.cached(('test-arch',),drawing)
            for x,y in zip(a.arrays(),b.arrays()):np.testing.assert_array_equal(x,y)

    def test_static_cache_is_bounded_and_keys_change_style(self):
        p=Painter(Format('portrait',.1))
        for i in range(40):
            p.cached(('bounded-test',i),lambda q:q.cell(rect(0,0,100,100),'jade'))
        self.assertLessEqual(len(_SCENERY),32)
        p.cached(('colour-test','lapis'),lambda q:q.cell(rect(0,0,1000,1000),'lapis'))
        first=p.arrays()[0].copy()
        p.cached(('colour-test','ivory'),lambda q:q.cell(rect(0,0,1000,1000),'ivory'))
        self.assertFalse(np.array_equal(first,p.arrays()[0]))

    def test_worlds_are_deterministic_and_cover_both_crops(self):
        for name in ('portrait','landscape'):
            fmt=Format(name,.15)
            for fn,kwargs in [(W.court,{}),(W.exhibition,{}),(W.workshop,{}),(W.tent,{})]:
                a,b=[Painter(fmt,2) for _ in range(2)]
                for p in (a,b):fn(p,2,fmt,**kwargs)
                for x,y in zip(a.arrays(),b.arrays()):np.testing.assert_array_equal(x,y)
                rgb=a.arrays()[0]
                for x,y in ((0,0),(0,-1),(-1,0),(-1,-1)):
                    self.assertGreater(rgb[y,x].sum(),0)

    def test_ambient_changes_albedo_without_shader_help(self):
        fmt=Format('portrait',.2)
        def drawing(t):
            p=Painter(fmt,t);W.sky(p,t,fmt);W.water(p,t,fmt)
            W.crowd(p,t,fmt,positions=[(300,850,240)])
            return p.arrays()[0]
        self.assertFalse(np.array_equal(drawing(0),drawing(1.1)))

    def test_bare_field_warns_and_exception_stays_visible(self):
        def empty(p,t,c):p.cell(rect(-900,-700,2900,2700),'midnight',1)
        film=Film([Shot('empty',0,3,empty),Shot('map',3,6,empty,world_exception='Map: schematic route')],use_timeline=False)
        report=audit(film)
        self.assertEqual(report['warnings'],1)
        self.assertTrue(report['shots'][0]['flagged'])
        self.assertTrue(report['shots'][1]['waived'])
        self.assertTrue(report['shots'][1]['flagged'])

    def test_pilot_set_api_still_draws(self):
        fmt=Format('portrait',.1)
        for fn in (S.city,S.walls,S.aqueduct,S.hippodrome):
            p=Painter(fmt)
            self.assertIsInstance(fn(p,1,fmt),dict)


if __name__=='__main__':unittest.main()
