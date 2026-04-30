"""Class-based Python plugin using WebGL2 via Pyodide's js bridge.

Renders a Phong-shaded rotating cube using WebGL2 — same visual as
the server 3D scene but running entirely in the browser via Pyodide.
"""

from cairn import PythonPlugin


class WebGLCube(PythonPlugin):
    """Rotating Phong-shaded cube rendered with WebGL2 from Python."""

    name = "webgl_cube"
    requires = ["numpy"]

    def render(self, data, metadata, step):
        from js import document
        from pyodide.ffi import to_js
        import numpy as np
        import math
        import struct

        output = document.getElementById("output")
        if output:
            output.innerHTML = ""

        canvas = document.createElement("canvas")
        canvas.width = 400
        canvas.height = 400
        canvas.style.background = "#161b22"
        target = document.getElementById("output") or document.body
        target.appendChild(canvas)

        gl = canvas.getContext("webgl2")
        if not gl:
            target.innerHTML = '<pre style="color:#f85149">WebGL2 not available</pre>'
            return

        # --- Shaders ---
        vs_src = """#version 300 es
        in vec3 a_pos;
        in vec3 a_normal;
        out vec3 v_normal;
        out vec3 v_pos;
        uniform mat4 u_mvp;
        uniform mat4 u_model;
        void main() {
            gl_Position = u_mvp * vec4(a_pos, 1.0);
            v_pos = (u_model * vec4(a_pos, 1.0)).xyz;
            v_normal = mat3(u_model) * a_normal;
        }
        """

        fs_src = """#version 300 es
        precision mediump float;
        in vec3 v_normal;
        in vec3 v_pos;
        out vec4 frag_color;
        uniform vec3 u_light;
        uniform vec3 u_eye;
        uniform vec3 u_color;
        void main() {
            vec3 n = normalize(v_normal);
            vec3 l = normalize(u_light - v_pos);
            vec3 v = normalize(u_eye - v_pos);
            vec3 h = normalize(l + v);
            float diff = max(dot(n, l), 0.0) * 0.7;
            float spec = pow(max(dot(n, h), 0.0), 64.0) * 0.4;
            frag_color = vec4((0.15 + diff + spec) * u_color, 1.0);
        }
        """

        def compile_shader(src, stype):
            s = gl.createShader(stype)
            gl.shaderSource(s, src)
            gl.compileShader(s)
            if not gl.getShaderParameter(s, gl.COMPILE_STATUS):
                raise RuntimeError(gl.getShaderInfoLog(s))
            return s

        vs = compile_shader(vs_src, gl.VERTEX_SHADER)
        fs = compile_shader(fs_src, gl.FRAGMENT_SHADER)
        prog = gl.createProgram()
        gl.attachShader(prog, vs)
        gl.attachShader(prog, fs)
        gl.linkProgram(prog)
        if not gl.getProgramParameter(prog, gl.LINK_STATUS):
            raise RuntimeError(gl.getProgramInfoLog(prog))
        gl.useProgram(prog)

        # --- Cube geometry: 36 verts, pos(3) + normal(3) ---
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

        vert_data = np.array(verts, dtype=np.float32)
        from js import Float32Array
        js_buf = Float32Array.new(to_js(vert_data.tobytes()).buffer)

        buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, js_buf, gl.STATIC_DRAW)

        stride = 6 * 4  # 6 floats * 4 bytes
        a_pos = gl.getAttribLocation(prog, "a_pos")
        gl.enableVertexAttribArray(a_pos)
        gl.vertexAttribPointer(a_pos, 3, gl.FLOAT, False, stride, 0)

        a_normal = gl.getAttribLocation(prog, "a_normal")
        gl.enableVertexAttribArray(a_normal)
        gl.vertexAttribPointer(a_normal, 3, gl.FLOAT, False, stride, 3 * 4)

        # --- Matrices (column-major flat arrays) ---
        def perspective(fovy, aspect, near, far):
            t = math.tan(fovy / 2)
            r = aspect * t
            return np.array([
                1/r, 0, 0, 0,
                0, 1/t, 0, 0,
                0, 0, -(far+near)/(far-near), -1,
                0, 0, -2*far*near/(far-near), 0,
            ], dtype=np.float32)

        def lookat(eye, target, up):
            e, t, u = np.array(eye,'f'), np.array(target,'f'), np.array(up,'f')
            f = t - e; f /= np.linalg.norm(f)
            s = np.cross(f, u); s /= np.linalg.norm(s)
            u2 = np.cross(s, f)
            return np.array([
                s[0], u2[0], -f[0], 0,
                s[1], u2[1], -f[1], 0,
                s[2], u2[2], -f[2], 0,
                -s@e, -u2@e, f@e, 1,
            ], dtype=np.float32)

        def rot_x(a):
            c, s = math.cos(a), math.sin(a)
            return np.array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1], dtype=np.float32)

        def rot_y(a):
            c, s = math.cos(a), math.sin(a)
            return np.array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1], dtype=np.float32)

        def mat_mul(a, b):
            A = a.reshape(4, 4, order='F')
            B = b.reshape(4, 4, order='F')
            return (A @ B).flatten(order='F').astype('f4')

        ax = 0.3 + step * 0.05
        ay = 0.5 + step * 0.07
        model = mat_mul(rot_y(ay), rot_x(ax))
        view = lookat((0,0,5), (0,0,0), (0,1,0))
        proj = perspective(math.radians(45), 1.0, 0.1, 100)
        mvp = mat_mul(proj, mat_mul(view, model))

        # Upload uniforms.
        def set_mat4(name, m):
            loc = gl.getUniformLocation(prog, name)
            gl.uniformMatrix4fv(loc, False, Float32Array.new(to_js(m.tobytes()).buffer))

        set_mat4("u_mvp", mvp)
        set_mat4("u_model", model)

        light_loc = gl.getUniformLocation(prog, "u_light")
        gl.uniform3f(light_loc, 3.0, 3.0, 5.0)
        eye_loc = gl.getUniformLocation(prog, "u_eye")
        gl.uniform3f(eye_loc, 0.0, 0.0, 5.0)

        t = (step % 20) / 20.0
        color_loc = gl.getUniformLocation(prog, "u_color")
        gl.uniform3f(color_loc,
            0.2 + 0.6 * abs(math.sin(t * 3.14)),
            0.4 + 0.4 * abs(math.cos(t * 4.08)),
            0.6 + 0.3 * abs(math.sin(t * 2.20)),
        )

        # --- Draw ---
        gl.viewport(0, 0, 400, 400)
        gl.clearColor(0.086, 0.106, 0.133, 1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
        gl.enable(gl.DEPTH_TEST)
        gl.drawArrays(gl.TRIANGLES, 0, 36)

        label = document.createElement("div")
        label.style.cssText = "color:#8b949e;font-size:11px;text-align:center;margin-top:4px;"
        label.textContent = f"WebGL2 Phong cube \u2014 step {step}"
        target.appendChild(label)
