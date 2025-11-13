/*
 * WebGL Water
 * http://madebyevan.com/webgl-water/
 *
 * Copyright 2011 Evan Wallace
 * Released under the MIT license
 */

var helperFunctions = '\
  const float IOR_AIR = 1.0;\
  const float IOR_WATER = 1.333;\
  const vec3 abovewaterColor = vec3(0.25, 1.0, 1.25);\
  const vec3 underwaterColor = vec3(0.4, 0.9, 1.0);\
  uniform float poolHeight;\
  uniform float waterLevel;\
  uniform vec3 light;\
  uniform vec3 sphereCenter;\
  uniform float sphereRadius;\
  uniform sampler2D tiles;\
  uniform sampler2D causticTex;\
  uniform sampler2D water;\
  \
  vec2 intersectCube(vec3 origin, vec3 ray, vec3 cubeMin, vec3 cubeMax) {\
    vec3 tMin = (cubeMin - origin) / ray;\
    vec3 tMax = (cubeMax - origin) / ray;\
    vec3 t1 = min(tMin, tMax);\
    vec3 t2 = max(tMin, tMax);\
    float tNear = max(max(t1.x, t1.y), t1.z);\
    float tFar = min(min(t2.x, t2.y), t2.z);\
    return vec2(tNear, tFar);\
  }\
  \
  float intersectSphere(vec3 origin, vec3 ray, vec3 sphereCenter, float sphereRadius) {\
    vec3 toSphere = origin - sphereCenter;\
    float a = dot(ray, ray);\
    float b = 2.0 * dot(toSphere, ray);\
    float c = dot(toSphere, toSphere) - sphereRadius * sphereRadius;\
    float discriminant = b*b - 4.0*a*c;\
    if (discriminant > 0.0) {\
      float t = (-b - sqrt(discriminant)) / (2.0 * a);\
      if (t > 0.0) return t;\
    }\
    return 1.0e6;\
  }\
  \
  vec3 getSphereColor(vec3 point) {\
    vec3 color = vec3(0.5);\
    \
    /* ambient occlusion with walls */\
    color *= 1.0 - 0.9 / pow((1.0 + sphereRadius - abs(point.x)) / sphereRadius, 3.0);\
    color *= 1.0 - 0.9 / pow((1.0 + sphereRadius - abs(point.z)) / sphereRadius, 3.0);\
    color *= 1.0 - 0.9 / pow((point.y + 1.0 + sphereRadius) / sphereRadius, 3.0);\
    \
    /* caustics */\
    vec3 sphereNormal = (point - sphereCenter) / sphereRadius;\
    vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);\
    float diffuse = max(0.0, dot(-refractedLight, sphereNormal)) * 0.5;\
    vec4 info = texture2D(water, point.xz * 0.5 + 0.5);\
    float surfaceY = info.r + waterLevel;\
    if (point.y < surfaceY) {\
      vec4 caustic = texture2D(causticTex, 0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) * 0.5 + 0.5);\
      diffuse *= caustic.r * 4.0;\
    }\
    color += diffuse;\
    \
    return color;\
  }\
  \
  vec3 getWallColor(vec3 point) {\
    float scale = 0.5;\
    \
    vec3 wallColor;\
    vec3 normal;\
    if (abs(point.x) > 0.999) {\
      wallColor = texture2D(tiles, point.yz * 0.5 + vec2(1.0, 0.5)).rgb;\
      normal = vec3(-point.x, 0.0, 0.0);\
    } else if (abs(point.z) > 0.999) {\
      wallColor = texture2D(tiles, point.yx * 0.5 + vec2(1.0, 0.5)).rgb;\
      normal = vec3(0.0, 0.0, -point.z);\
    } else {\
      wallColor = texture2D(tiles, point.xz * 0.5 + 0.5).rgb;\
      normal = vec3(0.0, 1.0, 0.0);\
    }\
    \
    scale /= length(point); /* pool ambient occlusion */\
    scale *= 1.0 - 0.9 / pow(length(point - sphereCenter) / sphereRadius, 4.0); /* sphere ambient occlusion */\
    \
    /* caustics */\
    vec3 refractedLight = -refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);\
    float diffuse = max(0.0, dot(refractedLight, normal));\
    vec4 info = texture2D(water, point.xz * 0.5 + 0.5);\
    float surfaceY2 = info.r + waterLevel;\
    if (point.y < surfaceY2) {\
      vec4 caustic = texture2D(causticTex, 0.75 * (point.xz - point.y * refractedLight.xz / refractedLight.y) * 0.5 + 0.5);\
      scale += diffuse * caustic.r * 2.0 * caustic.g;\
      /* tint tiles underwater */\
      wallColor = mix(wallColor, underwaterColor, 0.35);\
    } else {\
      /* shadow for the rim of the pool */\
      vec2 t = intersectCube(point, refractedLight, vec3(-1.0, -poolHeight, -1.0), vec3(1.0, 2.0, 1.0));\
      diffuse *= 1.0 / (1.0 + exp(-200.0 / (1.0 + 10.0 * (t.y - t.x)) * (point.y + refractedLight.y * t.y - 2.0 / 12.0)));\
      \
      scale += diffuse * 0.5;\
    }\
    \
    return wallColor * scale;\
  }\
';

function Renderer() {
  this.tileTexture = GL.Texture.fromImage(document.getElementById('tiles'), {
    minFilter: gl.LINEAR_MIPMAP_LINEAR,
    wrap: gl.REPEAT,
    format: gl.RGB
  });
  this.lightDir = new GL.Vector(2.0, 2.0, -1.0).unit();
  this.causticTex = new GL.Texture(1024, 1024);
  this.waterMesh = GL.Mesh.plane({ detail: 200 });
  this.waterShaders = [];
  for (var i = 0; i < 2; i++) {
    this.waterShaders[i] = new GL.Shader('\
      uniform sampler2D water;\
      uniform float waterLevel;\
      varying vec3 position;\
      void main() {\
        vec4 info = texture2D(water, gl_Vertex.xy * 0.5 + 0.5);\
        position = gl_Vertex.xzy;\
        position.y += info.r + waterLevel;\
        gl_Position = gl_ModelViewProjectionMatrix * vec4(position, 1.0);\
      }\
    ', helperFunctions + '\
      uniform vec3 eye;\
      varying vec3 position;\
      uniform samplerCube sky;\
      \
      vec3 getSurfaceRayColor(vec3 origin, vec3 ray, vec3 waterColor) {\
        vec3 color;\
        float q = intersectSphere(origin, ray, sphereCenter, sphereRadius);\
        if (q < 1.0e6) {\
          color = getSphereColor(origin + ray * q);\
        } else if (ray.y < 0.0) {\
          vec2 t = intersectCube(origin, ray, vec3(-1.0, -poolHeight, -1.0), vec3(1.0, 2.0, 1.0));\
          color = getWallColor(origin + ray * t.y);\
        } else {\
          vec2 t = intersectCube(origin, ray, vec3(-1.0, -poolHeight, -1.0), vec3(1.0, 2.0, 1.0));\
          vec3 hit = origin + ray * t.y;\
          if (hit.y < 2.0 / 12.0) {\
            color = getWallColor(hit);\
          } else {\
            color = textureCube(sky, ray).rgb;\
            color += vec3(pow(max(0.0, dot(light, ray)), 5000.0)) * vec3(10.0, 8.0, 6.0);\
          }\
        }\
        if (ray.y < 0.0) color *= waterColor;\
        return color;\
      }\
      \
      void main() {\
        vec2 coord = position.xz * 0.5 + 0.5;\
        vec4 info = texture2D(water, coord);\
        \
        /* make water look more "peaked" */\
        for (int i = 0; i < 5; i++) {\
          coord += info.ba * 0.005;\
          info = texture2D(water, coord);\
        }\
        \
        vec3 normal = vec3(info.b, sqrt(1.0 - dot(info.ba, info.ba)), info.a);\
        vec3 incomingRay = normalize(position - eye);\
        \
        ' + (i ? /* underwater */ '\
          normal = -normal;\
          vec3 reflectedRay = reflect(incomingRay, normal);\
          vec3 refractedRay = refract(incomingRay, normal, IOR_WATER / IOR_AIR);\
          float fresnel = mix(0.5, 1.0, pow(1.0 - dot(normal, -incomingRay), 3.0));\
          \
          vec3 reflectedColor = getSurfaceRayColor(position, reflectedRay, underwaterColor);\
          vec3 refractedColor = getSurfaceRayColor(position, refractedRay, vec3(1.0)) * vec3(0.8, 1.0, 1.1);\
          \
          gl_FragColor = vec4(mix(reflectedColor, refractedColor, (1.0 - fresnel) * length(refractedRay)), 1.0);\
        ' : /* above water */ '\
          vec3 reflectedRay = reflect(incomingRay, normal);\
          vec3 refractedRay = refract(incomingRay, normal, IOR_AIR / IOR_WATER);\
          float fresnel = mix(0.25, 1.0, pow(1.0 - dot(normal, -incomingRay), 3.0));\
          \
          vec3 reflectedColor = getSurfaceRayColor(position, reflectedRay, abovewaterColor);\
          vec3 refractedColor = getSurfaceRayColor(position, refractedRay, abovewaterColor);\
          \
          gl_FragColor = vec4(mix(refractedColor, reflectedColor, fresnel), 1.0);\
        ') + '\
      }\
    ');
  }
  this.sphereMesh = GL.Mesh.sphere({ detail: 0 });
  this.sphereShader = new GL.Shader(helperFunctions + '\
    varying vec3 position;\
    void main() {\
      position = sphereCenter + gl_Vertex.xyz * sphereRadius;\
      gl_Position = gl_ModelViewProjectionMatrix * vec4(position, 1.0);\
    }\
  ', helperFunctions + '\
    varying vec3 position;\
    void main() {\
      gl_FragColor = vec4(getSphereColor(position), 1.0);\
      vec4 info = texture2D(water, position.xz * 0.5 + 0.5);\
      if (position.y < info.r + waterLevel) {\
        gl_FragColor.rgb *= underwaterColor * 1.2;\
      }\
    }\
  ');
  this.cubeMesh = GL.Mesh.cube();
  this.cubeMesh.triangles.splice(4, 2);
  this.cubeMesh.compile();
  this.cubeShader = new GL.Shader(helperFunctions + '\
    varying vec3 position;\
    void main() {\
      position = gl_Vertex.xyz;\
      position.y = ((1.0 - position.y) * (7.0 / 12.0) - 1.0) * poolHeight;\
      gl_Position = gl_ModelViewProjectionMatrix * vec4(position, 1.0);\
    }\
  ', helperFunctions + '\
    varying vec3 position;\
    void main() {\
      gl_FragColor = vec4(getWallColor(position), 1.0);\
      vec4 info = texture2D(water, position.xz * 0.5 + 0.5);\
      if (position.y < info.r + waterLevel) {\
        gl_FragColor.rgb *= underwaterColor * 1.2;\
      }\
    }\
  ');
  this.sphereCenter = new GL.Vector();
  this.sphereRadius = 0;
  // model (OBJ) mesh and matrix
  this.modelMesh = null;
  this.modelMatrix = new GL.Matrix();
  this.modelShader = new GL.Shader(helperFunctions + '\
    varying vec3 position;\
    varying vec3 normal;\
    void main() {\
      position = gl_Vertex.xyz;\
      normal = gl_Normal;\
      gl_Position = gl_ModelViewProjectionMatrix * vec4(position, 1.0);\
    }\
  ', helperFunctions + '\
    varying vec3 position;\
    varying vec3 normal;\
    uniform vec3 modelColor;\
    void main() {\
      vec3 col = modelColor;\
      vec3 L = normalize(light);\
      float d = max(0.0, dot(normal, L));\
      gl_FragColor = vec4(col * (0.2 + 0.8 * d), 1.0);\
    }\
  ');
  // expose levels controllable from JS
  this.poolHeight = 1.2;
  this.waterLevel = 0.0;
  // dynamic cubemap for reflecting dynamic objects (like the loaded model)
  this._dynamicCubeSize = 256;
  this._dynamicCube = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, this._dynamicCube);
  for (var f = 0; f < 6; f++) {
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + f, 0, gl.RGBA, this._dynamicCubeSize, this._dynamicCubeSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  this._dynamicCubeFBO = gl.createFramebuffer();
  var self = this;
  this.dynamicSky = {
    bind: function(unit) {
      gl.activeTexture(gl.TEXTURE0 + (unit || 0));
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, self._dynamicCube);
    }
  };
  var hasDerivatives = !!gl.getExtension('OES_standard_derivatives');
  this.causticsShader = new GL.Shader(helperFunctions + '\
    varying vec3 oldPos;\
    varying vec3 newPos;\
    varying vec3 ray;\
    \
    /* project the ray onto the plane */\
    vec3 project(vec3 origin, vec3 ray, vec3 refractedLight) {\
      vec2 tcube = intersectCube(origin, ray, vec3(-1.0, -poolHeight, -1.0), vec3(1.0, 2.0, 1.0));\
      origin += ray * tcube.y;\
      float tplane = (-origin.y - 1.0) / refractedLight.y;\
      return origin + refractedLight * tplane;\
    }\
    \
    void main() {\
      vec4 info = texture2D(water, gl_Vertex.xy * 0.5 + 0.5);\
      info.ba *= 0.5;\
      vec3 normal = vec3(info.b, sqrt(1.0 - dot(info.ba, info.ba)), info.a);\
      \
      /* project the vertices along the refracted vertex ray */\
      vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);\
      ray = refract(-light, normal, IOR_AIR / IOR_WATER);\
      oldPos = project(gl_Vertex.xzy, refractedLight, refractedLight);\
      newPos = project(gl_Vertex.xzy + vec3(0.0, info.r, 0.0), ray, refractedLight);\
      \
      gl_Position = vec4(0.75 * (newPos.xz + refractedLight.xz / refractedLight.y), 0.0, 1.0);\
    }\
  ', (hasDerivatives ? '#extension GL_OES_standard_derivatives : enable\n' : '') + '\
    ' + helperFunctions + '\
    varying vec3 oldPos;\
    varying vec3 newPos;\
    varying vec3 ray;\
    \
    void main() {\
      ' + (hasDerivatives ? '\
        /* if the triangle gets smaller, it gets brighter, and vice versa */\
        float oldArea = length(dFdx(oldPos)) * length(dFdy(oldPos));\
        float newArea = length(dFdx(newPos)) * length(dFdy(newPos));\
        gl_FragColor = vec4(oldArea / newArea * 0.2, 1.0, 0.0, 0.0);\
      ' : '\
        gl_FragColor = vec4(0.2, 0.2, 0.0, 0.0);\
      ' ) + '\
      \
      vec3 refractedLight = refract(-light, vec3(0.0, 1.0, 0.0), IOR_AIR / IOR_WATER);\
      \
      /* compute a blob shadow and make sure we only draw a shadow if the player is blocking the light */\
      float shadow = 1.0;\
      if (sphereRadius > 0.0) {\
        vec3 dir = (sphereCenter - newPos) / sphereRadius;\
        vec3 area = cross(dir, refractedLight);\
        float sa = dot(area, area);\
        float dist = dot(dir, -refractedLight);\
        shadow = 1.0 + (sa - 1.0) / (0.05 + dist * 0.025);\
        shadow = clamp(1.0 / (1.0 + exp(-shadow)), 0.0, 1.0);\
        shadow = mix(1.0, shadow, clamp(dist * 2.0, 0.0, 1.0));\
      }\
      gl_FragColor.g = shadow;\
      \
      /* shadow for the rim of the pool */\
      vec2 t = intersectCube(newPos, -refractedLight, vec3(-1.0, -poolHeight, -1.0), vec3(1.0, 2.0, 1.0));\
      gl_FragColor.r *= 1.0 / (1.0 + exp(-200.0 / (1.0 + 10.0 * (t.y - t.x)) * (newPos.y - refractedLight.y * t.y - 2.0 / 12.0)));\
    }\
  ');
}

// Update caustics for a given water instance and optionally output to a provided texture.
// If no destCausticTex is provided, fall back to the renderer's default caustic texture.
Renderer.prototype.updateCaustics = function(water, destCausticTex) {
  if (!this.causticsShader) return;
  var this_ = this;
  var target = destCausticTex || this.causticTex;
  target.drawTo(function() {
    gl.clear(gl.COLOR_BUFFER_BIT);
    water.textureA.bind(0);
    this_.causticsShader.uniforms({
      light: this_.lightDir,
      water: 0,
      sphereCenter: this_.sphereCenter,
      sphereRadius: this_.sphereRadius,
      poolHeight: this_.poolHeight,
      waterLevel: this_.waterLevel
    }).draw(this_.waterMesh);
  });
};

// Render dynamic cubemap by calling a scene draw callback for each face.
Renderer.prototype.updateDynamicCubemap = function(sceneDrawCallback) {
  var size = this._dynamicCubeSize;
  var fbo = this._dynamicCubeFBO;
  var tex = this._dynamicCube;
  var oldViewport = [gl.getParameter(gl.VIEWPORT)[0], gl.getParameter(gl.VIEWPORT)[1], gl.getParameter(gl.VIEWPORT)[2], gl.getParameter(gl.VIEWPORT)[3]];
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, size, size);
  var captures = [
    { target: gl.TEXTURE_CUBE_MAP_POSITIVE_X, eye: [1,0,0], up: [0,-1,0], center: [0,0,0] },
    { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_X, eye: [-1,0,0], up: [0,-1,0], center: [0,0,0] },
    { target: gl.TEXTURE_CUBE_MAP_POSITIVE_Y, eye: [0,1,0], up: [0,0,1], center: [0,0,0] },
    { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, eye: [0,-1,0], up: [0,0,-1], center: [0,0,0] },
    { target: gl.TEXTURE_CUBE_MAP_POSITIVE_Z, eye: [0,0,1], up: [0,-1,0], center: [0,0,0] },
    { target: gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, eye: [0,0,-1], up: [0,-1,0], center: [0,0,0] }
  ];
  for (var i = 0; i < captures.length; i++) {
    var c = captures[i];
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, c.target, tex, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // set up a temporary projection and view for this face
    gl.matrixMode(gl.PROJECTION);
    gl.pushMatrix();
    gl.loadIdentity();
    gl.perspective(90, 1, 0.01, 100);
    gl.matrixMode(gl.MODELVIEW);
    gl.pushMatrix();
    gl.loadIdentity();
    // lookAt(eye, center, up)
    gl.lookAt(c.eye[0], c.eye[1], c.eye[2], c.center[0], c.center[1], c.center[2], c.up[0], c.up[1], c.up[2]);
    try {
      sceneDrawCallback();
    } catch (e) {
      // ignore
    }
    gl.popMatrix();
    gl.matrixMode(gl.PROJECTION);
    gl.popMatrix();
    gl.matrixMode(gl.MODELVIEW);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(oldViewport[0], oldViewport[1], oldViewport[2], oldViewport[3]);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
  gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
};

// Simple model rendering: draws `this.modelMesh` with `this.modelShader` if set.
Renderer.prototype.renderModel = function() {
  if (!this.modelMesh) return;
  // model transform: translate to modelPosition and apply uniform scale
  var pos = this.modelPosition || new GL.Vector(0, 0, 0);
  var scale = this.modelScale || 1.0;
  // if mesh has boundingSphere, transform it by scale and position for caustics approximations
  // We intentionally do NOT set sphereCenter/sphereRadius from the model bounding sphere
  // to avoid approximate blob shadows/caustics caused by the bounding-sphere hack.
  // Keep sphereRadius == 0 so shader paths that render analytic sphere are disabled.
  this.sphereRadius = 0;
  // set model color default and draw
  var defaultColor = this.modelColor || [0.6, 0.6, 0.7];
  try {
    gl.pushMatrix();
    gl.translate(pos.x || 0, pos.y || 0, pos.z || 0);
    gl.scale(scale, scale, scale);
    this.modelShader.uniforms({ light: this.lightDir, modelColor: defaultColor }).draw(this.modelMesh);
    gl.popMatrix();
  } catch (e) {
    // ignore draw errors (mesh compilation etc.)
  }
};

// Render water for a given water instance. Optionally provide a caustic texture to use
// (so multiple pools can have their own caustics).
Renderer.prototype.renderWater = function(water, sky, causticTex) {
  var tracer = new GL.Raytracer();
  water.textureA.bind(0);
  this.tileTexture.bind(1);
  sky.bind(2);
  (causticTex || this.causticTex).bind(3);
  gl.enable(gl.CULL_FACE);
  for (var i = 0; i < 2; i++) {
    gl.cullFace(i ? gl.BACK : gl.FRONT);
    this.waterShaders[i].uniforms({
      light: this.lightDir,
      water: 0,
      tiles: 1,
      sky: 2,
      causticTex: 3,
      eye: tracer.eye,
      sphereCenter: this.sphereCenter,
      sphereRadius: this.sphereRadius
    }).uniforms({
      poolHeight: this.poolHeight,
      waterLevel: this.waterLevel
    }).draw(this.waterMesh);
  }
  gl.disable(gl.CULL_FACE);
};

// Render sphere for a given water instance. Optionally supply a caustic texture to use.
// Renderer.prototype.renderSphere = function(water, causticTex) {
//   water.textureA.bind(0);
//   (causticTex || this.causticTex).bind(1);
//   this.sphereShader.uniforms({
//     light: this.lightDir,
//     water: 0,
//     causticTex: 1,
//     sphereCenter: this.sphereCenter,
//     sphereRadius: this.sphereRadius
//   }).uniforms({
//     poolHeight: this.poolHeight,
//     waterLevel: this.waterLevel
//   }).draw(this.sphereMesh);
// };

// Render cube (pool walls) for a given water instance. Optionally supply a caustic texture to use.
Renderer.prototype.renderCube = function(water, causticTex) {
  gl.enable(gl.CULL_FACE);
  water.textureA.bind(0);
  this.tileTexture.bind(1);
  (causticTex || this.causticTex).bind(2);
  this.cubeShader.uniforms({
    light: this.lightDir,
    water: 0,
    tiles: 1,
    causticTex: 2,
    sphereCenter: this.sphereCenter,
    sphereRadius: this.sphereRadius
  }).uniforms({
    poolHeight: this.poolHeight,
    waterLevel: this.waterLevel
  }).draw(this.cubeMesh);
  gl.disable(gl.CULL_FACE);
};
