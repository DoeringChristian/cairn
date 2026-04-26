"""Interactive server-side 3D renderer using OpenGL.

Uses EGL for headless GPU rendering + ModernGL for the OpenGL API.
Renders a lit, rotating cube with Phong shading. Mouse drag rotates
the camera. Each interaction triggers a re-render streamed to the client.

Requirements (server-side):
    pip install moderngl Pillow

This demonstrates the server plugin pattern for GPU-heavy rendering
(Mitsuba, Polyscope, PyTorch3D, etc.) where the server has the GPU
and the browser just displays streamed frames.
"""

import math
from cairn import ServerPlugin


VERTEX_SHADER = """
#version 330 core
in vec3 in_position;
in vec3 in_normal;
out vec3 v_normal;
out vec3 v_frag_pos;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_proj;
void main() {
    vec4 world = u_model * vec4(in_position, 1.0);
    v_frag_pos = world.xyz;
    v_normal = mat3(transpose(inverse(u_model))) * in_normal;
    gl_Position = u_proj * u_view * world;
}
"""

FRAGMENT_SHADER = """
#version 330 core
in vec3 v_normal;
in vec3 v_frag_pos;
out vec4 frag_color;
uniform vec3 u_light_pos;
uniform vec3 u_view_pos;
uniform vec3 u_object_color;

void main() {
    vec3 norm = normalize(v_normal);
    vec3 light_dir = normalize(u_light_pos - v_frag_pos);

    // Ambient
    float ambient = 0.15;

    // Diffuse
    float diff = max(dot(norm, light_dir), 0.0);

    // Specular
    vec3 view_dir = normalize(u_view_pos - v_frag_pos);
    vec3 reflect_dir = reflect(-light_dir, norm);
    float spec = pow(max(dot(view_dir, reflect_dir), 0.0), 32.0);

    vec3 result = (ambient + diff * 0.7 + spec * 0.5) * u_object_color;
    frag_color = vec4(result, 1.0);
}
"""


def _mat4_perspective(fov, aspect, near, far):
    """Build a perspective projection matrix."""
    f = 1.0 / math.tan(fov / 2.0)
    return [
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) / (near - far), -1,
        0, 0, (2 * far * near) / (near - far), 0,
    ]


def _mat4_look_at(eye, center, up):
    """Build a look-at view matrix."""
    def sub(a, b): return [a[i] - b[i] for i in range(3)]
    def norm(v):
        l = math.sqrt(sum(x*x for x in v))
        return [x/l for x in v] if l > 0 else v
    def cross(a, b):
        return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
    def dot(a, b): return sum(a[i]*b[i] for i in range(3))

    f = norm(sub(center, eye))
    s = norm(cross(f, up))
    u = cross(s, f)
    return [
        s[0], u[0], -f[0], 0,
        s[1], u[1], -f[1], 0,
        s[2], u[2], -f[2], 0,
        -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
    ]


def _mat4_rotate(ax, ay):
    """Build a rotation matrix around X then Y."""
    cx, sx = math.cos(ax), math.sin(ax)
    cy, sy = math.cos(ay), math.sin(ay)
    return [
        cy, sx*sy, -cx*sy, 0,
        0, cx, sx, 0,
        sy, -sx*cy, cx*cy, 0,
        0, 0, 0, 1,
    ]


# Cube geometry: 36 vertices (6 faces * 2 triangles * 3 verts), each with position + normal.
def _cube_vertices():
    """Generate cube vertex data: [x,y,z, nx,ny,nz] * 36."""
    faces = [
        # pos                    normal
        ((-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1), (0,0,-1)),  # back
        ((-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1), (0,0,1)),       # front
        ((-1,1,-1),(1,1,-1),(1,1,1),(-1,1,1), (0,1,0)),       # top
        ((-1,-1,-1),(1,-1,-1),(1,-1,1),(-1,-1,1), (0,-1,0)),  # bottom
        ((-1,-1,-1),(-1,1,-1),(-1,1,1),(-1,-1,1), (-1,0,0)), # left
        ((1,-1,-1),(1,1,-1),(1,1,1),(1,-1,1), (1,0,0)),       # right
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

    def _ensure_gl(self, width=512, height=512):
        """Lazily create the OpenGL context and resources."""
        if self._ctx is not None:
            return
        import moderngl
        import struct as _struct

        self._ctx = moderngl.create_standalone_context(backend="egl")
        self._fbo = self._ctx.simple_framebuffer((width, height))
        self._prog = self._ctx.program(
            vertex_shader=VERTEX_SHADER,
            fragment_shader=FRAGMENT_SHADER,
        )
        verts = _cube_vertices()
        vbo = self._ctx.buffer(_struct.pack(f"<{len(verts)}f", *verts))
        self._vao = self._ctx.simple_vertex_array(
            self._prog, vbo, "in_position", "in_normal",
        )

    def render(self, data, metadata, step):
        import io
        import struct as _struct
        from PIL import Image

        width, height = 512, 512
        self._ensure_gl(width, height)

        ctx = self._ctx
        fbo = self._fbo
        prog = self._prog
        vao = self._vao

        fbo.use()
        ctx.clear(0.086, 0.106, 0.133, 1.0)  # #161b22
        ctx.enable(moderngl.DEPTH_TEST)

        # Animate rotation based on step + interactive angles.
        ax = self.angle_x + step * 0.05
        ay = self.angle_y + step * 0.07

        model = _mat4_rotate(ax, ay)
        eye = [0, 0, 4]
        view = _mat4_look_at(eye, [0, 0, 0], [0, 1, 0])
        proj = _mat4_perspective(math.radians(45), width / height, 0.1, 100)

        prog["u_model"].write(_struct.pack("16f", *model))
        prog["u_view"].write(_struct.pack("16f", *view))
        prog["u_proj"].write(_struct.pack("16f", *proj))
        prog["u_light_pos"].value = (3.0, 3.0, 3.0)
        prog["u_view_pos"].value = tuple(eye)

        # Vary color based on step.
        t = (step % 20) / 20.0
        prog["u_object_color"].value = (
            0.2 + 0.6 * abs(math.sin(t * math.pi)),
            0.4 + 0.4 * abs(math.cos(t * math.pi * 1.3)),
            0.6 + 0.3 * abs(math.sin(t * math.pi * 0.7)),
        )

        vao.render()

        # Read pixels and convert to PNG.
        raw = fbo.read(components=3)
        img = Image.frombytes("RGB", (width, height), raw)
        img = img.transpose(Image.FLIP_TOP_BOTTOM)  # OpenGL is bottom-up

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


# Need moderngl imported at module level for the DEPTH_TEST constant.
try:
    import moderngl
except ImportError:
    pass
