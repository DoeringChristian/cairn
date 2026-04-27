"""Interactive server-side 3D renderer using OpenGL.

Uses ModernGL for headless GPU rendering. Renders a lit, rotating cube
with Phong shading. Mouse drag rotates the camera. Each interaction
triggers a re-render streamed to the client.

Requirements (server-side):
    pip install moderngl numpy Pillow
"""

import math
import struct
from cairn import ServerPlugin

import numpy as np


VERTEX_SHADER = """
#version 330 core
in vec3 in_position;
in vec3 in_normal;
out vec3 v_normal;
out vec3 v_frag_pos;
uniform mat4 u_mvp;
uniform mat4 u_model;
void main() {
    v_frag_pos = (u_model * vec4(in_position, 1.0)).xyz;
    v_normal = mat3(u_model) * in_normal;
    gl_Position = u_mvp * vec4(in_position, 1.0);
}
"""

FRAGMENT_SHADER = """
#version 330 core
in vec3 v_normal;
in vec3 v_frag_pos;
out vec4 frag_color;
uniform vec3 u_light_pos;
uniform vec3 u_view_pos;
uniform vec3 u_color;

void main() {
    vec3 n = normalize(v_normal);
    vec3 l = normalize(u_light_pos - v_frag_pos);
    vec3 v = normalize(u_view_pos - v_frag_pos);
    vec3 r = reflect(-l, n);

    float ambient = 0.15;
    float diffuse = max(dot(n, l), 0.0) * 0.7;
    float specular = pow(max(dot(v, r), 0.0), 32.0) * 0.4;

    frag_color = vec4((ambient + diffuse + specular) * u_color, 1.0);
}
"""


def _perspective(fov_deg, aspect, near, far):
    f = 1.0 / math.tan(math.radians(fov_deg) / 2.0)
    nf = near - far
    m = np.zeros((4, 4), dtype=np.float32)
    m[0, 0] = f / aspect
    m[1, 1] = f
    m[2, 2] = (far + near) / nf
    m[2, 3] = (2 * far * near) / nf
    m[3, 2] = -1.0
    return m


def _look_at(eye, center, up):
    eye, center, up = np.array(eye, dtype=np.float32), np.array(center, dtype=np.float32), np.array(up, dtype=np.float32)
    f = center - eye
    f = f / np.linalg.norm(f)
    s = np.cross(f, up)
    s = s / np.linalg.norm(s)
    u = np.cross(s, f)
    m = np.eye(4, dtype=np.float32)
    m[0, :3] = s
    m[1, :3] = u
    m[2, :3] = -f
    m[0, 3] = -np.dot(s, eye)
    m[1, 3] = -np.dot(u, eye)
    m[2, 3] = np.dot(f, eye)
    return m


def _rotate_xy(ax, ay):
    cx, sx = math.cos(ax), math.sin(ax)
    cy, sy = math.cos(ay), math.sin(ay)
    rx = np.array([
        [1, 0, 0, 0],
        [0, cx, -sx, 0],
        [0, sx, cx, 0],
        [0, 0, 0, 1],
    ], dtype=np.float32)
    ry = np.array([
        [cy, 0, sy, 0],
        [0, 1, 0, 0],
        [-sy, 0, cy, 0],
        [0, 0, 0, 1],
    ], dtype=np.float32)
    return ry @ rx


def _cube_vertices():
    """36 vertices (6 faces), each with position + normal."""
    faces = [
        ((-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1), (0,0,-1)),
        ((-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1), (0,0,1)),
        ((-1,1,-1),(1,1,-1),(1,1,1),(-1,1,1), (0,1,0)),
        ((-1,-1,-1),(1,-1,-1),(1,-1,1),(-1,-1,1), (0,-1,0)),
        ((-1,-1,-1),(-1,1,-1),(-1,1,1),(-1,-1,1), (-1,0,0)),
        ((1,-1,-1),(1,1,-1),(1,1,1),(1,-1,1), (1,0,0)),
    ]
    verts = []
    for v0, v1, v2, v3, n in faces:
        for v in (v0, v1, v2, v0, v2, v3):
            verts.extend(v)
            verts.extend(n)
    return verts


class Server3DScene(ServerPlugin):
    """Interactive 3D cube with Phong shading, rendered with OpenGL on the server."""

    name = "server_3d"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.angle_x = 0.3
        self.angle_y = 0.5
        self._dragging = False
        self._last_mouse = (0, 0)
        self._ctx = None
        self._fbo = None
        self._vao = None
        self._prog = None
        self._moderngl = None

    def _ensure_gl(self, width=512, height=512):
        if self._ctx is not None:
            return
        import moderngl

        self._moderngl = moderngl
        try:
            self._ctx = moderngl.create_standalone_context(backend="egl")
        except Exception:
            self._ctx = moderngl.create_standalone_context()
        self._fbo = self._ctx.simple_framebuffer((width, height))
        self._prog = self._ctx.program(
            vertex_shader=VERTEX_SHADER,
            fragment_shader=FRAGMENT_SHADER,
        )
        verts = _cube_vertices()
        vbo = self._ctx.buffer(struct.pack(f"<{len(verts)}f", *verts))
        self._vao = self._ctx.simple_vertex_array(
            self._prog, vbo, "in_position", "in_normal",
        )

    def render(self, data, metadata, step):
        import io
        from PIL import Image

        width, height = 512, 512
        self._ensure_gl(width, height)

        fbo = self._fbo
        prog = self._prog
        vao = self._vao

        fbo.use()
        self._ctx.clear(0.086, 0.106, 0.133, 1.0)
        self._ctx.enable(self._moderngl.DEPTH_TEST)

        ax = self.angle_x + step * 0.05
        ay = self.angle_y + step * 0.07

        model = _rotate_xy(ax, ay)
        view = _look_at([0, 0, 5], [0, 0, 0], [0, 1, 0])
        proj = _perspective(45, width / height, 0.1, 100)
        mvp = proj @ view @ model

        # ModernGL expects column-major (Fortran order) bytes.
        prog["u_mvp"].write(mvp.T.astype(np.float32).tobytes())
        prog["u_model"].write(model.T.astype(np.float32).tobytes())
        prog["u_light_pos"].value = (3.0, 3.0, 5.0)
        prog["u_view_pos"].value = (0.0, 0.0, 5.0)

        t = (step % 20) / 20.0
        prog["u_color"].value = (
            0.2 + 0.6 * abs(math.sin(t * math.pi)),
            0.4 + 0.4 * abs(math.cos(t * math.pi * 1.3)),
            0.6 + 0.3 * abs(math.sin(t * math.pi * 0.7)),
        )

        vao.render()

        raw = fbo.read(components=3)
        img = Image.frombytes("RGB", (width, height), raw)
        img = img.transpose(Image.FLIP_TOP_BOTTOM)

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def on_mouse(self, event):
        action = event.get("action")
        x, y = event.get("x", 0), event.get("y", 0)

        if action == "down":
            self._dragging = True
            self._last_mouse = (x, y)
        elif action == "up":
            self._dragging = False
        elif action == "move" and self._dragging:
            dx = x - self._last_mouse[0]
            dy = y - self._last_mouse[1]
            self.angle_y += dx * 0.01
            self.angle_x += dy * 0.01
            self._last_mouse = (x, y)
            self.request_rerender()
