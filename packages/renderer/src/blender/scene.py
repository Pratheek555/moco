"""Trusted Moco bridge. Reads declarative data, never model-written Python."""
import bpy
import json
import math
import os
import sys
import textwrap
from mathutils import Vector


def rgb(value):
    values = [int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values)


def material(name, color, metallic=0, roughness=0.45, emission=0, flat=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb(color), 1)
    mat.use_nodes = True
    if flat:
        nodes = mat.node_tree.nodes
        nodes.clear()
        output = nodes.new('ShaderNodeOutputMaterial')
        shader = nodes.new('ShaderNodeEmission')
        shader.inputs['Color'].default_value = (*rgb(color), 1)
        shader.inputs['Strength'].default_value = 1
        mat.node_tree.links.new(shader.outputs[0], output.inputs['Surface'])
        return mat
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*rgb(color), 1)
    shader.inputs['Metallic'].default_value = metallic
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Emission Color'].default_value = (*rgb(color), 1)
    shader.inputs['Emission Strength'].default_value = emission
    return mat


def interpolation(obj, modes=None):
    if not obj.animation_data or not obj.animation_data.action:
        return
    action = obj.animation_data.action
    for layer in action.layers:
        for strip in layer.strips:
            bag = strip.channelbag(obj.animation_data.action_slot)
            if not bag:
                continue
            for curve in bag.fcurves:
                for key in curve.keyframe_points:
                    mode = (modes or {}).get(round(key.co.x), 'smooth')
                    key.interpolation = {'linear': 'LINEAR', 'smooth': 'BEZIER', 'hold': 'CONSTANT'}[mode]
                    if mode == 'smooth':
                        key.handle_left_type = 'AUTO_CLAMPED'
                        key.handle_right_type = 'AUTO_CLAMPED'


def point_at(obj, target):
    direction = Vector(target) - obj.location
    if direction.length > 0.00001:
        obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def contour(item, stroke=False):
    path = item['path']
    data = bpy.data.curves.new(item['id'] + (' outline' if stroke else ''), 'CURVE')
    data.dimensions = '3D' if stroke or not path['fill'] else '2D'
    data.resolution_u = 8
    points = path['points']
    spline = data.splines.new('BEZIER' if path['smooth'] else 'POLY')
    if path['smooth']:
        spline.bezier_points.add(len(points) - 1)
        for point, value in zip(spline.bezier_points, points):
            point.co = (*value, 0)
            point.handle_left_type = 'AUTO'
            point.handle_right_type = 'AUTO'
    else:
        spline.points.add(len(points) - 1)
        for point, value in zip(spline.points, points):
            point.co = (*value, 0, 1)
    spline.use_cyclic_u = path['closed']
    if stroke or not path['fill']:
        data.bevel_depth = path['strokeWidth'] / 2
        data.bevel_resolution = 2
        data.use_fill_caps = True
    else:
        data.fill_mode = 'BOTH'
    obj = bpy.data.objects.new(data.name, data)
    bpy.context.collection.objects.link(obj)
    return obj


def mesh(item):
    kind = item['kind']
    if kind == 'empty':
        obj = bpy.data.objects.new(item['id'], None)
        bpy.context.collection.objects.link(obj)
        return obj
    if kind == 'path':
        return contour(item)
    if kind == 'cube':
        bpy.ops.mesh.primitive_cube_add(size=1)
    elif kind == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=0.5)
    elif kind == 'ico_sphere':
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.5)
    elif kind == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.5, depth=1)
    elif kind == 'cone':
        bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.5, radius2=0, depth=1)
    elif kind == 'torus':
        bpy.ops.mesh.primitive_torus_add(major_segments=48, minor_segments=12, major_radius=0.4, minor_radius=0.1)
    elif kind in ('plane', 'image'):
        bpy.ops.mesh.primitive_plane_add(size=1)
    elif kind == 'text':
        data = bpy.data.curves.new(item['id'], 'FONT')
        data.body = item['text']
        data.align_x = 'CENTER'
        data.align_y = 'CENTER'
        data.align_x = {'left': 'LEFT', 'center': 'CENTER', 'right': 'RIGHT'}.get(item.get('textAlign'), 'CENTER')
        data.extrude = 0.006
        obj = bpy.data.objects.new(item['id'], data)
        bpy.context.collection.objects.link(obj)
        return obj
    else:
        raise ValueError('Unsupported primitive: ' + kind)
    obj = bpy.context.object
    obj.name = item['id']
    if kind not in ('cube', 'plane', 'ico_sphere'):
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if item.get('bevel', 0) > 0 and kind == 'cube':
        bevel = obj.modifiers.new('Soft edges', 'BEVEL')
        bevel.width = item['bevel']
        bevel.segments = 3
        obj.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return obj


def visibility(obj, start, end, duration):
    for frame, hidden in sorted({0: start > 0, start: False, end: True, duration: True}.items()):
        obj.hide_render = hidden
        obj.hide_viewport = hidden
        obj.keyframe_insert('hide_render', frame=frame)
        obj.keyframe_insert('hide_viewport', frame=frame)
    interpolation(obj, {start: 'hold', end: 'hold', 0: 'hold', duration: 'hold'})


def camera_text(camera, body, name, mat, x, y, size):
    data = bpy.data.curves.new(name, 'FONT')
    data.body = body
    data.align_x = 'CENTER'
    data.align_y = 'CENTER'
    data.size = size
    data.space_line = 1.15
    data.materials.append(mat)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = camera
    obj.location = (x, y, -0.2)
    obj.visible_shadow = False
    return obj


def build(request):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    spec = request['spec']
    source = spec['blender']
    illustration = source.get('renderStyle') == 'illustration'
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = request['samples']
    if illustration and source.get('rasterizer') == 'workbench':
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'FLAT'
        scene.display.shading.color_type = 'TEXTURE'
        scene.display.shading.show_shadows = False
        scene.display.shading.show_cavity = False
        scene.display.shading.show_specular_highlight = False
        scene.display.shading.show_object_outline = False
        scene.display.shading.background_type = 'WORLD'
        scene.display.render_aa = '8'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 15
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.render.use_sequencer = False
    scene.render.threads_mode = 'AUTO'
    scene.view_settings.view_transform = 'Standard' if illustration else 'AgX'
    format_ = spec.get('format', {'width': 1080, 'height': 1920, 'fps': 30})
    scene.render.fps = format_['fps']
    scale = request.get('scale', 1)
    scene.render.resolution_x = request.get('width', max(2, int(format_['width'] * scale) // 2 * 2))
    scene.render.resolution_y = request.get('height', max(2, int(format_['height'] * scale) // 2 * 2))
    scene.render.resolution_percentage = 100
    scene.frame_start = 0
    scene.frame_end = spec['durationFrames'] - 1
    scene.frame_step = source.get('animationStep', 1)
    world = bpy.data.worlds.new('Moco environment')
    world.use_nodes = True
    world.color = rgb(source['background'])
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (*rgb(source['background']), 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = source['ambient']
    scene.world = world
    mats = {item['id']: material(item['id'], item['color'], item['metallic'], item['roughness'], item['emission'], flat=illustration) for item in source['materials']}
    fonts = {name: bpy.data.fonts.load(path) for name, path in request.get('fonts', {}).items()}
    objects = {item['id']: mesh(item) for item in source['objects']}
    for item in source['objects']:
        obj = objects[item['id']]
        if item.get('parent'):
            obj.parent = objects[item['parent']]
        obj.location = item['position']
        obj.rotation_euler = tuple(math.radians(n) for n in item['rotation'])
        obj.scale = item['scale']
        if item.get('material') and obj.data:
            obj.data.materials.append(mats[item['material']])
        if item['kind'] == 'text' and item.get('font') in fonts:
            obj.data.font = fonts[item['font']]
            obj.data.extrude = 0 if illustration else 0.006
        if item['kind'] == 'path' and item['path'].get('strokeMaterial') and item['path']['fill']:
            outline = contour(item, stroke=True)
            outline.parent = obj
            outline.location.z = 0.002
            outline.data.materials.append(mats[item['path']['strokeMaterial']])
        if item['kind'] == 'image':
            image = bpy.data.images.load(request['assets'][item['image']], check_existing=True)
            image.pack()
            mat = material(item['id'] + ' image', '#ffffff', flat=True)
            texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
            texture.image = image
            texture.interpolation = 'Linear'
            mat.node_tree.nodes.active = texture
            shader = next(node for node in mat.node_tree.nodes if node.type == 'EMISSION')
            mat.node_tree.links.new(texture.outputs['Color'], shader.inputs['Color'])
            obj.data.materials.clear()
            obj.data.materials.append(mat)
        channels = [('position', 'location'), ('rotation', 'rotation_euler'), ('scale', 'scale')]
        for field, channel in channels:
            if any(field in key for key in item['keys']):
                obj.keyframe_insert(channel, frame=0)
        for key in item['keys']:
            for field, channel in channels:
                if field in key:
                    value = tuple(math.radians(n) for n in key[field]) if field == 'rotation' else key[field]
                    setattr(obj, channel, value)
                    obj.keyframe_insert(channel, frame=key['atFrame'])
        interpolation(obj, {key['atFrame']: key['easing'] for key in item['keys']})
    for item in source['lights']:
        data = bpy.data.lights.new(item['id'], item['type'].upper())
        data.energy = item['energy']
        data.color = rgb(item['color'])
        if item['type'] == 'area':
            data.shape = 'DISK'
            data.size = item['size']
        elif item['type'] == 'point':
            data.shadow_soft_size = item['size']
        obj = bpy.data.objects.new(item['id'], data)
        bpy.context.collection.objects.link(obj)
        obj.location = item['position']
        point_at(obj, item['target'])
    data = bpy.data.cameras.new('Moco camera')
    data.lens = source['camera']['lens']
    data.sensor_fit = 'VERTICAL'
    data.sensor_height = 36
    if source['camera'].get('projection') == 'orthographic':
        data.type = 'ORTHO'
        data.ortho_scale = source['camera']['orthoScale']
    data.clip_end = 3000
    data.clip_start = 0.01
    camera = bpy.data.objects.new('Moco camera', data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    target = bpy.data.objects.new('Camera target', None)
    bpy.context.collection.objects.link(target)
    for key in source['camera']['keys']:
        camera.location = key['eye']
        target.location = key['target']
        camera.keyframe_insert('location', frame=key['atFrame'])
        target.keyframe_insert('location', frame=key['atFrame'])
        if 'orthoScale' in key:
            data.ortho_scale = key['orthoScale']
            data.keyframe_insert('ortho_scale', frame=key['atFrame'])
    camera_modes = {key['atFrame']: key.get('easing', 'smooth') for key in source['camera']['keys']}
    interpolation(camera, camera_modes)
    interpolation(target, camera_modes)
    interpolation(data, camera_modes)
    track = camera.constraints.new('TRACK_TO')
    track.target = target
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'
    half_height = data.ortho_scale / 2 if data.type == 'ORTHO' else 0.2 * 18 / data.lens
    half_width = half_height * format_['width'] / format_['height']
    white = material('Caption white', '#ffffff', emission=1, flat=illustration)
    ink = material('Caption outline', '#08111c', emission=1, flat=illustration)
    if request['mode'] == 'thumbnail':
        text = '\n'.join(textwrap.wrap(request.get('text', ''), width=22))
        layout = request['headline']
        text_mat = material('Headline color', layout['color'], emission=1)
        size = layout['fontSize'] / format_['height'] * half_height * 2
        y = half_height * (1 - 2 * layout['top'] / format_['height']) - size * 0.4
        headline = camera_text(camera, text, 'Thumbnail headline', text_mat, 0, y, size)
        if layout['textAlign'] == 'left':
            headline.data.align_x = 'LEFT'
            headline.location.x = -half_width * 0.78
        if layout['background'] != 'transparent':
            plate = mesh({'id': 'Headline plate', 'kind': 'plane'})
            plate.parent = camera
            plate.location = (0, y, -0.2005)
            plate.scale = (half_width * 1.8, size * (text.count('\n') + 1) * 1.4, 1)
            plate.data.materials.append(material('Headline plate', layout['background'], emission=1))
        elif request.get('text'):
            outline = camera_text(camera, text, 'Headline shadow', ink, headline.location.x + size * 0.035, y - size * 0.035, size)
            outline.data.align_x = headline.data.align_x
            outline.location.z = -0.2001
    else:
        for index, caption in enumerate(spec['captions']):
            text = '\n'.join(textwrap.wrap(caption['text'], width=28))
            size = half_width * 0.12
            y = -half_height * 0.67
            for j, (dx, dy) in enumerate([(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]):
                outline = camera_text(camera, text, f'Caption {index} outline {j}', ink, dx * size * 0.045, y + dy * size * 0.045, size)
                outline.location.z = -0.2001
                visibility(outline, caption['startFrame'], caption['endFrame'], spec['durationFrames'])
            obj = camera_text(camera, text, f'Caption {index}', white, 0, y, size)
            visibility(obj, caption['startFrame'], caption['endFrame'], spec['durationFrames'])
    scene.frame_set(0)
    return scene


def main():
    with open(sys.argv[sys.argv.index('--') + 1], encoding='utf-8') as handle:
        request = json.load(handle)
    scene = build(request)
    mode = request['mode']
    if mode == 'animation':
        directory = request['outDir']
        scene.render.filepath = os.path.join(directory, 'frame-######')
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(directory, 'scene.blend'), compress=True)
        def progress(current_scene, *args):
            step = scene.frame_step
            frame = current_scene.frame_current
            if step > 1 and frame:
                original = os.path.join(directory, f'frame-{frame:06d}.png')
                packed = os.path.join(directory, f'frame-{frame // step:06d}.png')
                os.replace(original, packed)
            print(f'MOCO_FRAME {current_scene.frame_current}', flush=True)
        bpy.app.handlers.render_write.append(progress)
        bpy.ops.render.render(animation=True)
    elif mode == 'stills':
        for frame in request['frames']:
            scene.frame_set(frame)
            scene.render.filepath = os.path.join(request['outDir'], f'{frame}.png')
            bpy.ops.render.render(write_still=True)
    elif mode == 'thumbnail':
        scene.frame_set(request['frame'])
        scene.render.image_settings.file_format = 'JPEG'
        scene.render.image_settings.quality = 92
        scene.render.filepath = request['out']
        bpy.ops.render.render(write_still=True)
    else:
        raise ValueError('Unknown render mode: ' + mode)


if __name__ == '__main__':
    main()
