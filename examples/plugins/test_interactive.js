/**
 * Minimal test plugin — just a clickable button and draggable box.
 * If this isn't interactive, the iframe sandbox is blocking events.
 */

window.cairn.render = function(msg) {
  document.body.innerHTML = "";

  var info = document.createElement("div");
  info.style.cssText = "padding:12px;font-size:13px;color:#c9d1d9;";
  info.innerHTML = "<b>Interactive test plugin</b> — step " + msg.step +
    "<br>If you can click the button and drag the box, events work.";
  document.body.appendChild(info);

  // Clickable button
  var btn = document.createElement("button");
  btn.textContent = "Click me (count: 0)";
  btn.style.cssText = "margin:12px;padding:8px 16px;font-size:14px;cursor:pointer;background:#0969da;color:white;border:none;border-radius:4px;";
  var count = 0;
  btn.onclick = function() { count++; btn.textContent = "Click me (count: " + count + ")"; };
  document.body.appendChild(btn);

  // Draggable box
  var box = document.createElement("div");
  box.style.cssText = "width:80px;height:80px;background:#3fb950;border-radius:8px;position:absolute;top:100px;left:50px;cursor:grab;display:flex;align-items:center;justify-content:center;color:black;font-weight:bold;font-size:12px;user-select:none;";
  box.textContent = "DRAG ME";
  document.body.appendChild(box);

  var dragging = false, ox = 0, oy = 0;
  box.onmousedown = function(e) {
    dragging = true; ox = e.offsetX; oy = e.offsetY;
    box.style.cursor = "grabbing";
  };
  document.onmousemove = function(e) {
    if (!dragging) return;
    box.style.left = (e.clientX - ox) + "px";
    box.style.top = (e.clientY - oy) + "px";
  };
  document.onmouseup = function() {
    dragging = false;
    box.style.cursor = "grab";
  };

  // Mouse position tracker
  var tracker = document.createElement("div");
  tracker.style.cssText = "position:fixed;bottom:8px;left:8px;font-size:10px;color:#8b949e;";
  tracker.textContent = "mouse: -";
  document.body.appendChild(tracker);
  document.onmousemove = function(e) {
    tracker.textContent = "mouse: " + e.clientX + ", " + e.clientY;
    if (dragging) {
      box.style.left = (e.clientX - ox) + "px";
      box.style.top = (e.clientY - oy) + "px";
    }
  };
};
