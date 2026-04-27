"""Interactive server-side 3D renderer using OpenGL.

Uses ModernGL for headless GPU rendering. Renders a lit, rotating cube
with Phong shading. Mouse drag rotates the camera.

Requirements (server-side):
    pip install moderngl numpy Pillow
"""

import math
import struct
from cairn import ServerPlugin
import numpy as np


VERTEX_SHADER = """
#version 330 core

uniform mat4 mvp;
uniform mat4 model;

in vec3 in_position;
in vec3 in_normal;

out vec3 v_normal;
out vec3 v_pos;

void main() {
    gl_Position = mvp * vec4(in_position, 1.0);
    v_pos = vec3(model * vec4(in_position, 1.0));
    v_normal = mat3(model) * in_normal;
}
"""

FRAGMENT_SHADER = """
#version 330 core

uniform vec3 light_pos;
uniform vec3 cam_pos;
uniform vec3 color;

in vec3 v_normal;
in vec3 v_pos;
out vec4 f_color;

void main() {
    vec3 n = normalize(v_normal);
    vec3 l = normalize(light_pos - v_pos);
    vec3 v = normalize(cam_pos - v_pos);
    vec3 h = normalize(l + v);

    float diff = max(dot(n, l), 0.0);
    float spec = pow(max(dot(n, h), 0.0), 64.0);
    vec3 c = color * (0.15 + 0.65 * diff) + vec3(0.3) * spec;
    f_color = vec4(c, 1.0);
}
"""


def _mat_perspective(fovy, aspect, near, far):
    """Column-major perspective matrix as flat float32 array for OpenGL."""
    t = math.tan(fovy / 2)
    r = aspect * t
    # Column-major flat layout:
    return np.array([
        1/r, 0, 0, 0,
        0, 1/t, 0, 0,
        0, 0, -(far+near)/(far-near), -1,
        0, 0, -2*far*near/(far-near), 0,
    ], dtype='f4')


def _mat_lookat(eye, target, up):
    """Column-major lookat matrix as flat float32 array for OpenGL."""
    e = np.array(eye, dtype='f4')
    t = np.array(target, dtype='f4')
    u = np.array(up, dtype='f4')
    f = t - e; f /= np.linalg.norm(f)
    s = np.cross(f, u); s /= np.linalg.norm(s)
    u2 = np.cross(s, f)
    # Column-major flat layout:
    return np.array([
        s[0], u2[0], -f[0], 0,
        s[1], u2[1], -f[1], 0,
        s[2], u2[2], -f[2], 0,
        -s@e, -u2@e, f@e, 1,
    ], dtype='f4')


def _mat_rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1], dtype='f4')

def _mat_rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1], dtype='f4')

def _mat_mul(a, b):
    """Multiply two column-major 4x4 matrices."""
    A = a.reshape(4, 4, order='F')
    B = b.reshape(4, 4, order='F')
    return (A @ B).flatten(order='F').astype('f4')


def _cube_data():
    """Return packed vertex data: 36 * (pos3 + normal3) as bytes."""
    V = [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),
         (-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]
    F = [(0,1,2,3,(0,0,-1)), (4,5,6,7,(0,0,1)),
         (3,2,6,7,(0,1,0)),  (0,1,5,4,(0,-1,0)),
         (0,3,7,4,(-1,0,0)), (1,2,6,5,(1,0,0))]
    verts = []
    for a,b,c,d,n in F:
        for i in (a,b,c,a,c,d):
            verts.extend(V[i]); verts.extend(n)
    return struct.pack(f'{len(verts)}f', *verts)


class Server3DScene(ServerPlugin):
    """Interactive Phong-shaded cube rendered with ModernGL."""
    name = "server_3d"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.ax = 0.4
        self.ay = 0.6
        self._drag = False
        self._mx = self._my = 0
        self._gl = None

    def _init_gl(self, w=512, h=512):
        if self._gl: return
        import moderngl
        try:
            ctx = moderngl.create_standalone_context(backend='egl')
        except Exception:
            ctx = moderngl.create_standalone_context()
        prog = ctx.program(vertex_shader=VERTEX_SHADER, fragment_shader=FRAGMENT_SHADER)
        vbo = ctx.buffer(_cube_data())
        vao = ctx.simple_vertex_array(prog, vbo, 'in_position', 'in_normal')
        fbo = ctx.simple_framebuffer((w, h))
        self._gl = dict(ctx=ctx, prog=prog, vao=vao, fbo=fbo, mgl=moderngl, w=w, h=h)

    def render(self, data, metadata, step):
        import io; from PIL import Image
        self._init_gl()
        g = self._gl
        ctx, prog, vao, fbo = g['ctx'], g['prog'], g['vao'], g['fbo']

        fbo.use()
        ctx.clear(0.086, 0.106, 0.133, 1.0)
        ctx.enable(g['mgl'].DEPTH_TEST)

        ax = self.ax + step * 0.05
        ay = self.ay + step * 0.07

        model = _mat_mul(_mat_rot_y(ay), _mat_rot_x(ax))
        view = _mat_lookat((0,0,5), (0,0,0), (0,1,0))
        proj = _mat_perspective(math.radians(45), g['w']/g['h'], 0.1, 100)
        mvp = _mat_mul(proj, _mat_mul(view, model))

        prog['mvp'].write(mvp)
        prog['model'].write(model)
        prog['light_pos'].value = (3.0, 3.0, 5.0)
        prog['cam_pos'].value = (0.0, 0.0, 5.0)

        t = (step % 20) / 20.0
        prog['color'].value = (
            0.2 + 0.6*abs(math.sin(t*3.14)),
            0.4 + 0.4*abs(math.cos(t*4.08)),
            0.6 + 0.3*abs(math.sin(t*2.20)),
        )
        vao.render()

        raw = fbo.read(components=3)
        img = Image.frombytes('RGB', (g['w'], g['h']), raw).transpose(Image.FLIP_TOP_BOTTOM)
        buf = io.BytesIO(); img.save(buf, format='PNG')
        return buf.getvalue()

    def on_mouse(self, event):
        a = event.get('action')
        x, y = event.get('x', 0), event.get('y', 0)
        if a == 'down':
            self._drag = True; self._mx, self._my = x, y
        elif a == 'up':
            self._drag = False
        elif a == 'move' and self._drag:
            self.ay += (x - self._mx) * 0.01
            self.ax += (y - self._my) * 0.01
            self._mx, self._my = x, y
            self.request_rerender()
