"""Class-based Python plugin using WebGL via Pyodide's js bridge.

Demonstrates accessing WebGL2 directly from Python code running in the
browser. The render() method creates a canvas, gets a WebGL2 context,
and draws a rotating colored triangle.
"""

from cairn import PythonPlugin


class WebGLDemo(PythonPlugin):
    """Rotating triangle rendered with WebGL2 from Python via Pyodide."""

    name = "webgl_demo"
    requires = ["numpy"]

    def render(self, data, metadata, step):
        from js import document
        import numpy as np
        import struct

        # Clear previous content.
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

        # Vertex shader.
        vs_src = """#version 300 es
        in vec2 a_pos;
        in vec3 a_color;
        out vec3 v_color;
        uniform float u_angle;
        void main() {
            float c = cos(u_angle), s = sin(u_angle);
            mat2 rot = mat2(c, -s, s, c);
            gl_Position = vec4(rot * a_pos, 0.0, 1.0);
            v_color = a_color;
        }
        """

        fs_src = """#version 300 es
        precision mediump float;
        in vec3 v_color;
        out vec4 fragColor;
        void main() {
            fragColor = vec4(v_color, 1.0);
        }
        """

        # Compile shaders.
        def compile_shader(gl, src, shader_type):
            shader = gl.createShader(shader_type)
            gl.shaderSource(shader, src)
            gl.compileShader(shader)
            return shader

        vs = compile_shader(gl, vs_src, gl.VERTEX_SHADER)
        fs = compile_shader(gl, fs_src, gl.FRAGMENT_SHADER)

        prog = gl.createProgram()
        gl.attachShader(prog, vs)
        gl.attachShader(prog, fs)
        gl.linkProgram(prog)
        gl.useProgram(prog)

        # Triangle vertices: position (x,y) + color (r,g,b).
        # Use step to vary the colors.
        t = step * 0.1
        verts = np.array([
            0.0,  0.6,  0.0 + t % 1, 0.6, 0.85,  # top
           -0.5, -0.4,  0.85, 0.0 + t % 1, 0.6,   # bottom-left
            0.5, -0.4,  0.6, 0.85, 0.0 + t % 1,    # bottom-right
        ], dtype=np.float32)

        from js import Float32Array
        js_verts = Float32Array.new(verts.tobytes())

        buf = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, buf)
        gl.bufferData(gl.ARRAY_BUFFER, js_verts, gl.STATIC_DRAW)

        a_pos = gl.getAttribLocation(prog, "a_pos")
        gl.enableVertexAttribArray(a_pos)
        gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, False, 20, 0)

        a_color = gl.getAttribLocation(prog, "a_color")
        gl.enableVertexAttribArray(a_color)
        gl.vertexAttribPointer(a_color, 3, gl.FLOAT, False, 20, 8)

        # Rotation angle from step.
        angle = step * 0.3
        u_angle = gl.getUniformLocation(prog, "u_angle")
        gl.uniform1f(u_angle, angle)

        # Draw.
        gl.viewport(0, 0, 400, 400)
        gl.clearColor(0.086, 0.106, 0.133, 1.0)  # #161b22
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLES, 0, 3)

        # Add label.
        label = document.createElement("div")
        label.style.cssText = "color:#8b949e;font-size:11px;text-align:center;margin-top:4px;"
        label.textContent = f"WebGL2 from Python — step {step}, angle={angle:.1f}rad"
        target.appendChild(label)
