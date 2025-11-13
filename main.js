/*
 * WebGL Water
 * http://madebyevan.com/webgl-water/
 *
 * Copyright 2011 Evan Wallace
 * Released under the MIT license
 */

function text2html(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

function handleError(text) {
  var html = text2html(text);
  if (html == 'WebGL not supported') {
    html = 'Your browser does not support WebGL.<br>Please see\
    <a href="http://www.khronos.org/webgl/wiki/Getting_a_WebGL_Implementation">\
    Getting a WebGL Implementation</a>.';
  }
  var loading = document.getElementById('loading');
  loading.innerHTML = html;
  loading.style.zIndex = 1;
}

window.onerror = handleError;

var gl = GL.create();
// We now support multiple containers (pools) side-by-side. Each container has its own Water
// instance and caustic texture. The renderer still handles drawing, but we will manage
// which container is active and animate the camera between them.
var containers = []; // array of { water: Water, causticTex: GL.Texture, rendererState... }
var activeContainerIndex = 0;
var cubemap;
var renderer;
var angleX = -25;
var angleY = -200.5;
// layout mode: stack vertically instead of horizontally
var stackVertical = true;
var cameraX = 0.0; // horizontal camera offset to center on active container
var cameraY = 0.0; // vertical camera offset when stacking vertically
var verticalSpacing = 3.0; // world units between stacked containers
// physical pool dimensions (meters). For a 10x10x10 m cube set these to 10.
var poolWidth = 10.0;
var poolDepth = 10.0;
var poolHeightMeters = 10.0;

// Sphere physics info
var useSpherePhysics = false;
var center;
var oldCenter;
var velocity;
var gravity;
var radius;
var paused = false;

window.onload = function() {
  var ratio = window.devicePixelRatio || 1;
  var help = document.getElementById('help');

  function onresize() {
    var width = innerWidth - help.clientWidth - 20;
    var height = innerHeight;
    gl.canvas.width = width * ratio;
    gl.canvas.height = height * ratio;
    gl.canvas.style.width = width + 'px';
    gl.canvas.style.height = height + 'px';
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.matrixMode(gl.PROJECTION);
    gl.loadIdentity();
    gl.perspective(45, gl.canvas.width / gl.canvas.height, 0.01, 100);
    gl.matrixMode(gl.MODELVIEW);
    draw();
  }

  document.body.appendChild(gl.canvas);
  gl.clearColor(0, 0, 0, 1);

  renderer = new Renderer();
  // attempt to load a replacement model (OBJ) and assign it to renderer.modelMesh
  (function loadModel() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'free_low_poly_male_base_mesh.obj', true);
    xhr.onreadystatechange = function() {
      if (xhr.readyState === 4) {
        if (xhr.status === 200 || xhr.responseText) {
          try {
            if (GL.Mesh.fromOBJ) {
              var mesh = GL.Mesh.fromOBJ(xhr.responseText);
              if (mesh) {
                try { mesh.compile(); } catch(e) {}
                try { mesh.boundingSphere = mesh.getBoundingSphere(); } catch(e) {}
                renderer.modelMesh = mesh;
                // set default placement to the previous sphere center/scale
                renderer.modelPosition = center || new GL.Vector(0, -0.75, 0.2);
                renderer.modelScale = radius || 0.1552303307647887;
                // console.log('modelScale (initial):', renderer.modelScale);
                // attempt to load .mtl for color
                var mtlXHR = new XMLHttpRequest();
                mtlXHR.open('GET', 'free_low_poly_male_base_mesh.mtl', true);
                mtlXHR.onreadystatechange = function() {
                  if (mtlXHR.readyState === 4) {
                    if (mtlXHR.status === 200 || mtlXHR.responseText) {
                      var mtl = mtlXHR.responseText;
                      var kd = mtl.match(/Kd\s+([0-9.\s]+)/);
                      if (kd && kd[1]) {
                        var parts = kd[1].trim().split(/\s+/).map(parseFloat);
                        if (parts.length >= 3) renderer.modelColor = parts;
                      }
                    }
                  }
                };
                mtlXHR.send();
              }
            }
          } catch (e) { console.warn('OBJ load failed', e); }
        } else {
          console.warn('Could not load OBJ model:', xhr.status);
        }
      }
    };
    xhr.send();
  })();
  // create a helper to spawn a container at a given offset (x or y depending on layout)
  function spawnContainer(offset) {
    var w = new Water();
    // a caustic texture per container
    var ct = new GL.Texture(1024, 1024);
    // initialize some defaults
    w.waterLevel = renderer.waterLevel;
    if (stackVertical) {
      w.poolOffsetY = offset || 0; // used to place pool in world space vertically
    } else {
      w.poolOffsetX = offset || 0; // used to place pool in world space horizontally
    }
    return { water: w, causticTex: ct };
  }

  // start with one container at x=0
  containers.push(spawnContainer(0));
  // keep the renderer synchronized with the active container
  renderer.waterLevel = containers[activeContainerIndex].water.waterLevel || 0.0;
  // center camera on the initial container
  cameraX = containers[activeContainerIndex].water.poolOffsetX || 0.0;
  cameraY = containers[activeContainerIndex].water.poolOffsetY || 0.0;
  // ensure page is scrollable for stacked layout
  document.body.style.height = (containers.length * window.innerHeight) + 'px';
  cubemap = new Cubemap({
    xneg: document.getElementById('xneg'),
    xpos: document.getElementById('xpos'),
    yneg: document.getElementById('ypos'),
    ypos: document.getElementById('ypos'),
    zneg: document.getElementById('zneg'),
    zpos: document.getElementById('zpos')
  });

  // Make sure the first container's water supports rendering to float textures
  var firstWater = containers[activeContainerIndex].water;
  if (!firstWater.textureA.canDrawTo() || !firstWater.textureB.canDrawTo()) {
    throw new Error('Rendering to floating-point textures is required but not supported');
  }

  center = oldCenter = new GL.Vector(-0.4, -0.75, 0.2);
  velocity = new GL.Vector();
  gravity = new GL.Vector(0, -4, 0);
  radius = 0.1552303307647887;

  for (var i = 0; i < 20; i++) {
    containers[activeContainerIndex].water.addDrop(Math.random() * 2 - 1, Math.random() * 2 - 1, 0.03, (i & 1) ? 0.01 : -0.01);
  }

  document.getElementById('loading').innerHTML = '';
  onresize();

  // wire water level slider
  var slider = document.getElementById('waterLevelSlider');
  var sliderValue = document.getElementById('waterLevelValue');
  var riseRateInput = document.getElementById('riseRate');
  var riseToggleBtn = document.getElementById('riseToggle');
  var resetToSliderBtn = document.getElementById('resetToSlider');
  var isRising = false;
  // Ripple generation while rising
  var rippleConfig = {
    // average seconds between ripples
    frequency: 0.25,
    // ripple radius
    radius: 0.12,
    // ripple strength (positive for up, negative for down)
    strength: 0.09,
    // max spread across plane (-1..1 for x and z)
    spread: 0.9
  };
  var rippleAcc = 0;
  function applyWaterLevel(v) {
    if (!renderer) return;
    renderer.waterLevel = parseFloat(v);
    renderer.poolHeight = 1.0; // keep pool height default; could be exposed if needed
    // apply to active container
    var container = containers[activeContainerIndex];
    if (container) {
      container.water.waterLevel = renderer.waterLevel;
    }
    sliderValue.textContent = parseFloat(v).toFixed(2);
    if (paused) {
      containers[activeContainerIndex].water.updateNormals();
      renderer.updateCaustics(containers[activeContainerIndex].water, containers[activeContainerIndex].causticTex);
      draw();
    }
  }
  slider.addEventListener('input', function(e) { applyWaterLevel(e.target.value); });
  slider.addEventListener('change', function(e) { applyWaterLevel(e.target.value); });

  // Toggle rising behavior
  riseToggleBtn.addEventListener('click', function() {
    isRising = !isRising;
    riseToggleBtn.textContent = isRising ? 'Stop Rising' : 'Start Rising';
    // if starting, ensure renderer/water initialized
    if (isRising && renderer && typeof renderer.waterLevel !== 'undefined') {
      // ensure current slider shows the current water level
      slider.value = renderer.waterLevel;
      sliderValue.textContent = parseFloat(renderer.waterLevel).toFixed(2);
    }
  });

  // Reset water to slider's current value (force update)
  resetToSliderBtn.addEventListener('click', function() {
    applyWaterLevel(slider.value);
    // stop rising when resetting
    isRising = false;
    riseToggleBtn.textContent = 'Start Rising';
  });

  var requestAnimationFrame =
    window.requestAnimationFrame ||
    window.webkitRequestAnimationFrame ||
    function(callback) { setTimeout(callback, 0); };

  var prevTime = new Date().getTime();
  function animate() {
    var nextTime = new Date().getTime();
    var delta = (nextTime - prevTime) / 1000;
    if (!paused) {
      update(delta);
      draw();
    }

    // Handle rising water when enabled (runs even if paused is false above). We update renderer and slider.
    if (isRising && renderer) {
  // parse rise rate from input (liters/sec). Convert liters/sec -> world units/sec (meters/sec)
  // 1 liter = 0.001 m^3. Height change (m) = liters * 0.001 / area.
  var rateLiters = parseFloat(riseRateInput.value) || 0;
  var area = poolWidth * poolDepth; // m^2
  var rate = rateLiters * 0.001 / area; // meters (world units) per second
      // increment water level based on delta time
      var newLevel = renderer.waterLevel + rate * delta;
      // clamp to slider bounds
      var min = parseFloat(slider.getAttribute('min'));
      var max = parseFloat(slider.getAttribute('max'));
      if (newLevel >= max && !cameraTransition.active) {
        newLevel = max;
        // When container reaches max, spawn a single new empty container and transition the camera to it.
        var lastOffset = stackVertical ? containers[containers.length - 1].water.poolOffsetY : containers[containers.length - 1].water.poolOffsetX;
        // spawn under the previous container when stacking vertically
        var newOffset = lastOffset + (stackVertical ? -verticalSpacing : 3.0);
        var newContainer = spawnContainer(newOffset);
  // initialize new container empty (use slider min)
  var minAttr = parseFloat(slider.getAttribute('min')) || 0.0;
  newContainer.water.waterLevel = minAttr;
  containers.push(newContainer);
  // ensure the old container remains at max (explicitly set it)
  var oldIndex = cameraTransition.startIndex || activeContainerIndex;
  if (containers[oldIndex]) containers[oldIndex].water.waterLevel = max;
        // setup camera transition from current to new container
        cameraTransition.startIndex = activeContainerIndex;
        cameraTransition.endIndex = containers.length - 1;
        cameraTransition.progress = 0;
        cameraTransition.duration = 1.2; // seconds
        cameraTransition.active = true;
  // expand scrollable area so the user can scroll to view stacked containers
  document.body.style.height = (containers.length * window.innerHeight) + 'px';
        // optionally smooth-scroll the page to the new container's scroll position
        try { window.scrollTo({ left:0, top: (containers.length - 1) * window.innerHeight, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, (containers.length - 1) * window.innerHeight); }
      }
      // apply and sync slider and visuals
      renderer.waterLevel = newLevel;
  var activeContainer = containers[activeContainerIndex];
  if (activeContainer) activeContainer.water.waterLevel = renderer.waterLevel;
      slider.value = renderer.waterLevel;
      sliderValue.textContent = parseFloat(renderer.waterLevel).toFixed(2);
      // if paused, force update visuals immediately for the active container
      if (paused) {
        var pausedActive = containers[activeContainerIndex];
        if (pausedActive) {
          pausedActive.water.updateNormals();
          renderer.updateCaustics(pausedActive.water, pausedActive.causticTex);
        }
        draw();
      }
      // Generate ripples while rising. Use a poisson-ish process based on frequency.
      // We accumulate time and generate one or more ripples depending on elapsed time.
    if (containers[activeContainerIndex] && rippleConfig.frequency > 0) {
        rippleAcc += delta;
        var interval = rippleConfig.frequency;
        while (rippleAcc >= interval) {
          rippleAcc -= interval;
          // choose a random position within spread bounds but biased toward center
          var x = (Math.random() * 2 - 1) * rippleConfig.spread;
          var z = (Math.random() * 2 - 1) * rippleConfig.spread;
          // small variation in radius/strength so ripples look natural
          var r = rippleConfig.radius * (0.7 + Math.random() * 0.6);
          var s = rippleConfig.strength * (0.6 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1);
          containers[activeContainerIndex].water.addDrop(x, z, r, s);
        }
        // If paused, make sure visuals reflect the added ripples
        if (paused) {
          var pausedActive2 = containers[activeContainerIndex];
          if (pausedActive2) {
            pausedActive2.water.updateNormals();
            renderer.updateCaustics(pausedActive2.water, pausedActive2.causticTex);
          }
          draw();
        }
      }
    }
    prevTime = nextTime;
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  window.onresize = onresize;

  // update cameraY from scroll when not animating a transition
  window.addEventListener('scroll', function() {
    if (cameraTransition.active) return; // don't override during transition
    if (!stackVertical) return;
    var scrollY = window.scrollY || window.pageYOffset || 0;
    var maxScroll = Math.max(1, (containers.length - 1) * window.innerHeight);
    var scrollFraction = scrollY / maxScroll;
    // compute min and max pool offsets (top and bottom positions)
    var minOffset = 0, maxOffset = 0;
    for (var i = 0; i < containers.length; i++) {
      var off = containers[i].water.poolOffsetY || 0;
      if (i === 0 || off < minOffset) minOffset = off;
      if (i === 0 || off > maxOffset) maxOffset = off;
    }
    // map scroll fraction (0..1) to cameraY between maxOffset (top) and minOffset (bottom)
    cameraY = maxOffset + (minOffset - maxOffset) * scrollFraction;
  });

  var prevHit;
  var planeNormal;
  var mode = -1;
  var MODE_ADD_DROPS = 0;
  var MODE_MOVE_SPHERE = 1;
  var MODE_MOVE_MODEL = 3;
  var MODE_ORBIT_CAMERA = 2;

  var oldX, oldY;

  function startDrag(x, y) {
    oldX = x;
    oldY = y;
    var tracer = new GL.Raytracer();
    var ray = tracer.getRayForPixel(x * ratio, y * ratio);
    var pointOnPlane = tracer.eye.add(ray.multiply(-tracer.eye.y / ray.y));
    var sphereHitTest = GL.Raytracer.hitTestSphere(tracer.eye, ray, center, radius);
    var modelHit = false;
    if (renderer.modelMesh && renderer.modelMesh.boundingSphere) {
      var bs = renderer.modelMesh.boundingSphere;
      var worldCenter = (renderer.modelPosition) ? renderer.modelPosition : new GL.Vector(bs.center[0], bs.center[1], bs.center[2]);
      var worldRadius = (renderer.modelScale || 1.0) * bs.radius;
      var mh = GL.Raytracer.hitTestSphere(tracer.eye, ray, worldCenter, worldRadius);
      if (mh) modelHit = mh;
    }
    if (sphereHitTest) {
      mode = MODE_MOVE_SPHERE;
      prevHit = sphereHitTest.hit;
      planeNormal = tracer.getRayForPixel(gl.canvas.width / 2, gl.canvas.height / 2).negative();
    } else if (modelHit) {
      mode = MODE_MOVE_MODEL;
      prevHit = modelHit.hit;
      planeNormal = tracer.getRayForPixel(gl.canvas.width / 2, gl.canvas.height / 2).negative();
    } else if (Math.abs(pointOnPlane.x) < 1 && Math.abs(pointOnPlane.z) < 1) {
      mode = MODE_ADD_DROPS;
      duringDrag(x, y);
    } else {
      mode = MODE_ORBIT_CAMERA;
    }
  }

  function duringDrag(x, y) {
    switch (mode) {
      case MODE_ADD_DROPS: {
        var tracer = new GL.Raytracer();
        var ray = tracer.getRayForPixel(x * ratio, y * ratio);
        var pointOnPlane = tracer.eye.add(ray.multiply(-tracer.eye.y / ray.y));
        // add drop to active container
        var activeC = containers[activeContainerIndex];
        if (activeC) {
          activeC.water.addDrop(pointOnPlane.x, pointOnPlane.z, 0.03, 0.01);
          if (paused) {
            activeC.water.updateNormals();
            renderer.updateCaustics(activeC.water, activeC.causticTex);
          }
        }
        break;
      }
      case MODE_MOVE_SPHERE: {
        var tracer = new GL.Raytracer();
        var ray = tracer.getRayForPixel(x * ratio, y * ratio);
        var t = -planeNormal.dot(tracer.eye.subtract(prevHit)) / planeNormal.dot(ray);
        var nextHit = tracer.eye.add(ray.multiply(t));
        center = center.add(nextHit.subtract(prevHit));
        center.x = Math.max(radius - 1, Math.min(1 - radius, center.x));
        center.y = Math.max(radius - 1, Math.min(10, center.y));
        center.z = Math.max(radius - 1, Math.min(1 - radius, center.z));
        prevHit = nextHit;
        if (paused) {
          var ac = containers[activeContainerIndex];
          if (ac) renderer.updateCaustics(ac.water, ac.causticTex);
        }
        break;
      }
      case MODE_MOVE_MODEL: {
        var tracer = new GL.Raytracer();
        var ray = tracer.getRayForPixel(x * ratio, y * ratio);
        var t = -planeNormal.dot(tracer.eye.subtract(prevHit)) / planeNormal.dot(ray);
        var nextHit = tracer.eye.add(ray.multiply(t));
        var delta = nextHit.subtract(prevHit);
        // move modelPosition by delta
        renderer.modelPosition = renderer.modelPosition || new GL.Vector(0,0,0);
        renderer.modelPosition = renderer.modelPosition.add(delta);
        prevHit = nextHit;
        break;
      }
      case MODE_ORBIT_CAMERA: {
        angleY -= x - oldX;
        angleX -= y - oldY;
        angleX = Math.max(-89.999, Math.min(89.999, angleX));
        break;
      }
    }
    oldX = x;
    oldY = y;
    if (paused) draw();
  }

  function stopDrag() {
    mode = -1;
  }

  function isHelpElement(element) {
    return element === help || element.parentNode && isHelpElement(element.parentNode);
  }

  document.onmousedown = function(e) {
    if (!isHelpElement(e.target)) {
      e.preventDefault();
      startDrag(e.pageX, e.pageY);
    }
  };

  document.onmousemove = function(e) {
    duringDrag(e.pageX, e.pageY);
  };

  document.onmouseup = function() {
    stopDrag();
  };

  document.ontouchstart = function(e) {
    if (e.touches.length === 1 && !isHelpElement(e.target)) {
      e.preventDefault();
      startDrag(e.touches[0].pageX, e.touches[0].pageY);
    }
  };

  document.ontouchmove = function(e) {
    if (e.touches.length === 1) {
      duringDrag(e.touches[0].pageX, e.touches[0].pageY);
    }
  };

  document.ontouchend = function(e) {
    if (e.touches.length == 0) {
      stopDrag();
    }
  };

  document.onkeydown = function(e) {
    if (e.which == ' '.charCodeAt(0)) paused = !paused;
    else if (e.which == 'G'.charCodeAt(0)) useSpherePhysics = !useSpherePhysics;
    else if (e.which == 'L'.charCodeAt(0) && paused) draw();
  };

  var frame = 0;

  function update(seconds) {
    if (seconds > 1) return;
    frame += seconds * 2;

    if (mode == MODE_MOVE_SPHERE) {
      // Start from rest when the player releases the mouse after moving the sphere
      velocity = new GL.Vector();
    } else if (useSpherePhysics) {
      // Fall down with viscosity under water
      var surfaceY = (renderer && typeof renderer.waterLevel !== 'undefined') ? renderer.waterLevel : 0.0;
      var percentUnderWater = Math.max(0, Math.min(1, (radius - (center.y - surfaceY)) / (2 * radius)));
      velocity = velocity.add(gravity.multiply(seconds - 1.1 * seconds * percentUnderWater));
      velocity = velocity.subtract(velocity.unit().multiply(percentUnderWater * seconds * velocity.dot(velocity)));
      center = center.add(velocity.multiply(seconds));

      // Bounce off the bottom
      if (center.y < radius - 1) {
        center.y = radius - 1;
        velocity.y = Math.abs(velocity.y) * 0.7;
      }
    }

    // Displace water around the sphere using the active container's water
    // Sphere rendering/physics can be disabled by not applying its volume.
    var active = containers[activeContainerIndex];
    if (useSpherePhysics) {
      // apply sphere volume only when sphere physics are enabled
      active.water.moveSphere(oldCenter, center, radius);
      oldCenter = center;
    } else {
      // make sure renderer is told there's no sphere so shaders ignore it
      // (renderer.sphereRadius will be set before drawing as well)
    }

    // Update the active water simulation and graphics
    active.water.stepSimulation();
    active.water.stepSimulation();
    active.water.updateNormals();
    renderer.updateCaustics(active.water, active.causticTex);

    // Update camera transition if active
    updateCameraTransition(seconds);
  }

  function draw() {
    // Change the light direction to the camera look vector when the L key is pressed
    if (GL.keys.L) {
      renderer.lightDir = GL.Vector.fromAngles((90 - angleY) * Math.PI / 180, -angleX * Math.PI / 180);
      if (paused) {
        var lac = containers[activeContainerIndex];
        if (lac) renderer.updateCaustics(lac.water, lac.causticTex);
      }
    }

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.loadIdentity();
  // apply camera offset so we center on the active container
  if (stackVertical) {
    gl.translate(0, -cameraY, -4);
  } else {
    gl.translate(-cameraX, 0, -4);
  }
  gl.rotate(-angleX, 1, 0, 0);
  gl.rotate(-angleY, 0, 1, 0);
  gl.translate(0, 0.5, 0);

    gl.enable(gl.DEPTH_TEST);
    // Keep the sphere disabled in the renderer so it doesn't appear in reflections
    // or cast shadows. Physics can still update the water simulation via moveSphere.
    renderer.sphereRadius = 0;
    // Render all containers. We'll translate per container using gl.push/pop via matrix stack.
    for (var i = 0; i < containers.length; i++) {
      var c = containers[i];
      gl.pushMatrix();
      if (stackVertical) gl.translate(0, c.water.poolOffsetY, 0);
      else gl.translate(c.water.poolOffsetX, 0, 0);
      // synchronize renderer state
      // Save and restore renderer.waterLevel to avoid corrupting simulation state
      var prevRendererWater = renderer.waterLevel;
      renderer.waterLevel = c.water.waterLevel;
      renderer.poolHeight = 1.0;
      // render scene using the static cubemap only (disable dynamic reflections)
      renderer.renderCube(c.water, c.causticTex);
      renderer.renderWater(c.water, cubemap, c.causticTex);
      // draw the loaded model (visual only)
      renderer.renderModel();
      // only draw the sphere in the active container
      // if (i === activeContainerIndex) renderer.renderSphere(c.water, c.causticTex);
      // restore renderer.waterLevel
      renderer.waterLevel = prevRendererWater;
      gl.popMatrix();
    }
    gl.disable(gl.DEPTH_TEST);
  }
};

// camera transition state
var cameraTransition = {
  active: false,
  progress: 0,
  duration: 1.0,
  startIndex: 0,
  endIndex: 0
};

  // keyboard handlers for model scale and reset
  window.addEventListener('keydown', function(e) {
    if (!renderer) return;
    if (e.key === '+' || e.key === '=' ) {
      renderer.modelScale = (renderer.modelScale || 1) * 1.1;
    } else if (e.key === '-') {
      renderer.modelScale = (renderer.modelScale || 1) / 1.1;
    } else if (e.key === 'r' || e.key === 'R') {
      renderer.modelPosition = new GL.Vector(0, -0.75, 0.2);
      renderer.modelScale = 0.1552303307647887;
    // Print current model scale so it's easy to read and hardcode later
    // try { console.log('modelScale (current):', renderer.modelScale); } catch (e) {}

    }
  });

function updateCameraTransition(delta) {
  if (!cameraTransition.active) return;
  cameraTransition.progress += delta;
  var t = cameraTransition.progress / cameraTransition.duration;
  if (t >= 1) {
    t = 1;
    cameraTransition.active = false;
    // finalize the active container switch
    activeContainerIndex = cameraTransition.endIndex;
    // ensure renderer waterLevel points to the new container
    renderer.waterLevel = containers[activeContainerIndex].water.waterLevel;
    // snap camera to exact end offset and align scroll position
    if (stackVertical) {
      var endY = containers[cameraTransition.endIndex].water.poolOffsetY || 0;
      cameraY = endY;
      // align page scroll so the viewport corresponds to the endY position
      try { window.scrollTo({ left: 0, top: (cameraTransition.endIndex) * window.innerHeight, behavior: 'auto' }); } catch (e) { window.scrollTo(0, (cameraTransition.endIndex) * window.innerHeight); }
    } else {
      var endX = containers[cameraTransition.endIndex].water.poolOffsetX || 0;
      cameraX = endX;
    }
  }
  // simple ease in-out
  var ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  if (stackVertical) {
    var startY = containers[cameraTransition.startIndex].water.poolOffsetY || 0;
    var endY = containers[cameraTransition.endIndex].water.poolOffsetY || 0;
    cameraY = startY + (endY - startY) * ease;
    if (!cameraTransition.active) cameraY = endY; // ensure final value
  } else {
    // interpolate cameraX so the scene is translated horizontally to center on the target container
    var startX = containers[cameraTransition.startIndex].water.poolOffsetX;
    var endX = containers[cameraTransition.endIndex].water.poolOffsetX;
    cameraX = startX + (endX - startX) * ease;
    if (!cameraTransition.active) cameraX = endX;
  }
  // zoom (translate z) controlled indirectly by modifying a global camera zoom variable if desired
}
