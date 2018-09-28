// This is the 'compute shader' for the water heightmap
var heightmapShader = {
  // vertexShader: [
  //   "void main() {",
  //     "gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );",
  //   "}"
  // ].join( "\n" ),

  fragmentShader: [
    '#include <common>',

    'uniform vec2 wakePos1;',
    'uniform vec2 wakePos2;',
    'uniform vec2 wakePos3;',
    'uniform vec2 wakePos4;',

    'uniform float wakeSize;',
    'uniform float viscosityConstant;',

    '#define deltaTime ( 1.0 / 60.0 )',
    '#define GRAVITY_CONSTANT ( resolution.x * deltaTime * 3.0 )',

    'float phase( vec2 pos, vec2 uv ){',
      'float wakePhase = clamp( length( ( uv - vec2( 0.5 ) ) * BOUNDS - vec2( pos.x, - pos.y ) ) * PI / wakeSize, 0.0, PI );',
      'return cos( wakePhase ) + 1.0;',
    '}',

    'void main() {',

      'vec2 cellSize = 1.0 / resolution.xy;',

      'vec2 uv = gl_FragCoord.xy * cellSize;',

      '// heightmapValue.x == height',
      '// heightmapValue.y == velocity',
      '// heightmapValue.z, heightmapValue.w not used',
      'vec4 heightmapValue = texture2D( heightmap, uv );',

      '// Get neighbours',
      'vec4 north = texture2D( heightmap, uv + vec2( 0.0, cellSize.y ) );',
      'vec4 south = texture2D( heightmap, uv + vec2( 0.0, - cellSize.y ) );',
      'vec4 east = texture2D( heightmap, uv + vec2( cellSize.x, 0.0 ) );',
      'vec4 west = texture2D( heightmap, uv + vec2( - cellSize.x, 0.0 ) );',

      'float sump = north.x + south.x + east.x + west.x - 4.0 * heightmapValue.x;',

      'float accel = sump * GRAVITY_CONSTANT;',

      '// Dynamics',
      'heightmapValue.y += accel;',
      'heightmapValue.x += heightmapValue.y * deltaTime;',

      '// Viscosity',
      'heightmapValue.x += sump * viscosityConstant;',

      '// Mouse influence',
      'heightmapValue.x += phase( wakePos1, uv );',
      'heightmapValue.x += phase( wakePos2, uv );',
      'heightmapValue.x += phase( wakePos3, uv );',
      'heightmapValue.x += phase( wakePos4, uv );',

      'gl_FragColor = heightmapValue;',

    '}'
  ].join('\n')
};