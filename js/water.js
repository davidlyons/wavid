var Water = function( width, bounds, color, showHeightmap ){

	THREE.Group.call( this );

	// Texture width for simulation
	var WIDTH = width || 128;
	this.WIDTH = WIDTH;

	// Water size in system units
	var BOUNDS = bounds || 512;
	this.BOUNDS = BOUNDS;

	var materialColor = color || 0x0040C0;

	var geometry = new THREE.PlaneBufferGeometry( BOUNDS, BOUNDS, WIDTH - 1, WIDTH -1 );

	// material: make a ShaderMaterial clone of MeshPhongMaterial, with customized vertex shader
	var material = new THREE.ShaderMaterial( {
		uniforms: THREE.UniformsUtils.merge( [
			THREE.ShaderLib[ 'phong' ].uniforms,
			{
				heightmap: { value: null }
			}
		] ),
		vertexShader: waterShader.vertexShader,
		fragmentShader: THREE.ShaderChunk[ 'meshphong_frag' ]

	} );

	material.lights = true;
	material.side = THREE.DoubleSide;

	// Material attributes from MeshPhongMaterial
	material.color = new THREE.Color( materialColor );
	material.specular = new THREE.Color( 0x111111 );
	material.shininess = 50;
	material.transparent = true;
	material.opacity = 0.8;
	// material.wireframe = true;

	// Sets the uniforms with the material values
	material.uniforms.diffuse.value = material.color;
	material.uniforms.specular.value = material.specular;
	material.uniforms.shininess.value = Math.max( material.shininess, 1e-4 );
	material.uniforms.opacity.value = material.opacity;

	// Defines
	material.defines.WIDTH = WIDTH.toFixed( 1 );
	material.defines.BOUNDS = BOUNDS.toFixed( 1 );

	this.waterUniforms = material.uniforms;

	var mesh = new THREE.Mesh( geometry, material );
	mesh.rotation.x = - Math.PI / 2;
	mesh.matrixAutoUpdate = false;
	mesh.updateMatrix();
	this.add( mesh );
	this.mesh = mesh;

	// Creates the gpu computation class and sets it up

	var gpuCompute = new GPUComputationRenderer( WIDTH, WIDTH, renderer );
	this.gpuCompute = gpuCompute;

	var heightmap0 = gpuCompute.createTexture();

	this.fillTexture( heightmap0 );

	var heightmapVariable = gpuCompute.addVariable( "heightmap", heightmapShader.fragmentShader, heightmap0 );
	this.heightmapVariable = heightmapVariable;

	gpuCompute.setVariableDependencies( heightmapVariable, [ heightmapVariable ] );

	heightmapVariable.material.uniforms.wakePos1 = { value: new THREE.Vector2( 10000, 10000 ) };
	heightmapVariable.material.uniforms.wakePos2 = { value: new THREE.Vector2( 10000, 10000 ) };
	heightmapVariable.material.uniforms.wakePos3 = { value: new THREE.Vector2( 10000, 10000 ) };
	heightmapVariable.material.uniforms.wakePos4 = { value: new THREE.Vector2( 10000, 10000 ) };

	heightmapVariable.material.uniforms.wakeSize = { value: 8.0 };
	heightmapVariable.material.uniforms.viscosityConstant = { value: 0.03 };
	heightmapVariable.material.defines.BOUNDS = BOUNDS.toFixed( 1 );

	var error = gpuCompute.init();
	if ( error !== null ) {
		console.error( error );
	}

	// Create compute shader to smooth the water surface and velocity
	this.smoothShaderMat = gpuCompute.createShaderMaterial(
		smoothShader.fragmentShader,
		{ texture: { value: null } }
	);

	if ( showHeightmap ) {
		var heightmapViz = new THREE.Mesh(
			new THREE.PlaneBufferGeometry( BOUNDS, BOUNDS ),
			new THREE.MeshBasicMaterial()
		);
		heightmapViz.rotation.x = - Math.PI / 2;
		heightmapViz.position.set( - BOUNDS, 0, 0 );
		this.add( heightmapViz );
		this.heightmapViz = heightmapViz;
	}

	this.wakeMove = true;

};

Water.prototype = Object.create( THREE.Group.prototype );
Water.prototype.constructor = Water;

Water.prototype.smooth = function(){

	var gpuCompute = this.gpuCompute;
	var smoothShaderMat = this.smoothShaderMat;
	var heightmapVariable = this.heightmapVariable;

	var currentRenderTarget = gpuCompute.getCurrentRenderTarget( heightmapVariable );
	var alternateRenderTarget = gpuCompute.getAlternateRenderTarget( heightmapVariable );

	for ( var i = 0; i < 10; i++ ) {

		smoothShaderMat.uniforms.texture.value = currentRenderTarget.texture;
		gpuCompute.doRenderTarget( smoothShaderMat, alternateRenderTarget );

		smoothShaderMat.uniforms.texture.value = alternateRenderTarget.texture;
		gpuCompute.doRenderTarget( smoothShaderMat, currentRenderTarget );

	}

};

Water.prototype.update = function( time ){

	var gpuCompute = this.gpuCompute;
	var heightmapVariable = this.heightmapVariable;

	// Set uniforms: wake position

	// var uniforms = heightmapVariable.material.uniforms;

	// if ( this.wakeMove ) {

	// 	for ( var i = 1; i <= 4; i ++ ) {

	// 		var point = new THREE.Vector3();
	// 		point.x = Math.pow(-1,i) * Math.cos( time ) * i * 50;
	// 		point.z = Math.sin( time ) * i * 50;

	// 		uniforms['wakePos'+i].value.set( point.x, point.z );

	// 	}

	// } else {

	// 	for ( var i = 1; i <= 4; i ++ ) {
	// 		uniforms['wakePos'+i].value.set( 10000, 10000 );
	// 	}

	// }

	gpuCompute.compute();

	// Get compute output in custom uniform
	this.waterUniforms.heightmap.value = gpuCompute.getCurrentRenderTarget( heightmapVariable ).texture;

	if ( this.heightmapViz ) {
		this.heightmapViz.material.map = gpuCompute.getCurrentRenderTarget( heightmapVariable ).texture;
	}

};

Water.simplex = new SimplexNoise();

Water.prototype.fillTexture = function( texture ){

	var WIDTH = this.WIDTH;
	var simplex = Water.simplex;

	var waterMaxHeight = 10;

	function noise( x, y, z ) {
		var multR = waterMaxHeight;
		var mult = 0.025;
		var r = 0;
		for ( var i = 0; i < 15; i++ ) {
			r += multR * simplex.noise( x * mult, y * mult );
			multR *= 0.53 + 0.025 * i;
			mult *= 1.25;
		}
		return r;
	}

	var pixels = texture.image.data;

	var p = 0;
	for ( var j = 0; j < WIDTH; j++ ) {
		for ( var i = 0; i < WIDTH; i++ ) {

			var x = i * 128 / WIDTH;
			var y = j * 128 / WIDTH;

			pixels[ p + 0 ] = noise( x, y, 123.4 );
			pixels[ p + 1 ] = 0;
			pixels[ p + 2 ] = 0;
			pixels[ p + 3 ] = 1;

			p += 4;
		}
	}

};