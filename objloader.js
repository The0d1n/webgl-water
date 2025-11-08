/* Simple OBJ parser that creates a GL.Mesh from a string. Supports v, vt, vn and triangular faces. */
(function() {
  if (typeof GL === 'undefined' || !GL.Mesh) return;
  GL.Mesh.fromOBJ = function(text) {
    console.log('GL.Mesh.fromOBJ: parsing OBJ, approx size', text.length);
    var lines = text.split(/\r?\n/);
    var positions = [];
    var normals = [];
    var texcoords = [];
    var vertices = [];
    var coords = [];
    var outNormals = [];
    var triangles = [];
    var vertexMap = {};

    function pushVertex(p, t, n) {
      var key = (p||'')+"/"+(t||'')+"/"+(n||'');
      if (key in vertexMap) return vertexMap[key];
      var idx = vertices.length;
      vertexMap[key] = idx;
      vertices.push(p ? [p[0], p[1], p[2]] : [0,0,0]);
      coords.push(t ? [t[0], t[1]] : [0,0]);
      outNormals.push(n ? [n[0], n[1], n[2]] : [0,0,1]);
      return idx;
    }

    var faceCount = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === '#') continue;
      var parts = line.split(/\s+/);
      if (parts[0] === 'v') {
        positions.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
      } else if (parts[0] === 'vn') {
        normals.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
      } else if (parts[0] === 'vt') {
        texcoords.push([parseFloat(parts[1]), parseFloat(parts[2])]);
      } else if (parts[0] === 'f') {
        // support faces with more than 3 verts by triangulating fan-style
        var face = parts.slice(1).map(function(p) { return p; });
  faceCount++;
        function idxForToken(token) {
          var comps = token.split('/');
          var pi = parseInt(comps[0], 10);
          if (pi < 0) pi = positions.length + pi + 1;
          var p = positions[pi - 1];
          var t = null, n = null;
          if (comps.length > 1 && comps[1] !== '') {
            var ti = parseInt(comps[1], 10);
            if (ti < 0) ti = texcoords.length + ti + 1;
            t = texcoords[ti - 1];
          }
          if (comps.length > 2 && comps[2] !== '') {
            var ni = parseInt(comps[2], 10);
            if (ni < 0) ni = normals.length + ni + 1;
            n = normals[ni - 1];
          }
          return pushVertex(p, t, n);
        }
        for (var a = 1; a < face.length - 1; a++) {
          var i0 = idxForToken(face[0]);
          var i1 = idxForToken(face[a]);
          var i2 = idxForToken(face[a+1]);
          triangles.push([i0, i1, i2]);
        }
      }
    }

    var mesh = new GL.Mesh({ coords: true, normals: true, triangles: true });
    mesh.vertices = vertices;
    mesh.coords = coords;
    mesh.normals = outNormals;
    mesh.triangles = triangles;
  console.log('GL.Mesh.fromOBJ: parsed vertices', vertices.length, 'triangles', triangles.length, 'faces', faceCount);
    try { mesh.compile(); } catch(e) { /* compile might fail for some meshes, caller can handle */ }
    // attach bounding sphere for convenience
    try {
      if (mesh.getBoundingSphere) mesh.boundingSphere = mesh.getBoundingSphere();
    } catch (e) {}
    return mesh;
  };
})();
