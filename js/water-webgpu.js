import * as THREE from 'three'
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js'
import {
  instanceIndex,
  uint,
  int,
  float,
  length,
  clamp,
  vec2,
  cos,
  vec3,
  vertexIndex,
  Fn,
  uniform,
  instancedArray,
  min,
  max,
  positionLocal,
  transformNormalToView,
  select,
  globalId,
} from 'three/tsl'

export class Water extends THREE.Group {
  constructor(renderer) {
    super()

    this.renderer = renderer
    this.width = 128
    this.bounds = 5 - 0.2
    this.waterMaxHeight = 0.1
    this.frame = 0
    this.pingPong = 0

    this.effectController = {
      wakePos: uniform(new THREE.Vector2()).setName('wakePos'),
      wakeSpeed: uniform(new THREE.Vector2()).setName('wakeSpeed'),
      wakeDeep: uniform(0.5).setName('wakeDeep'),
      wakeSize: uniform(0.12).setName('wakeSize'),
      viscosity: uniform(0.96).setName('viscosity'),
      wireframe: false,
      speed: 5,
    }

    this.readFromA = uniform(1)
    this.createBuffers()
    this.createMesh()
  }

  createBuffers() {
    const simplex = new SimplexNoise()
    const heightArray = new Float32Array(this.width * this.width)
    const prevHeightArray = new Float32Array(this.width * this.width)

    let offset = 0
    for (let y = 0; y < this.width; y++) {
      for (let x = 0; x < this.width; x++) {
        const height = this.noise(simplex, (x * 128) / this.width, (y * 128) / this.width)
        heightArray[offset] = height
        prevHeightArray[offset] = height
        offset++
      }
    }

    this.heightStorageA = instancedArray(heightArray).setName('HeightA')
    this.heightStorageB = instancedArray(new Float32Array(heightArray)).setName('HeightB')
    this.prevHeightStorage = instancedArray(prevHeightArray).setName('PrevHeight')

    this.computeHeightAtoB = this.createComputeHeight(this.heightStorageA, this.heightStorageB).setName(
      'Update Height A→B'
    )
    this.computeHeightBtoA = this.createComputeHeight(this.heightStorageB, this.heightStorageA).setName(
      'Update Height B→A'
    )
  }

  noise(simplex, x, y) {
    let multR = this.waterMaxHeight
    let mult = 0.025
    let result = 0

    for (let i = 0; i < 15; i++) {
      result += multR * simplex.noise(x * mult, y * mult)
      multR *= 0.53 + 0.025 * i
      mult *= 1.25
    }

    return result
  }

  getNeighborIndices(index) {
    const width = uint(this.width)
    const x = int(index.mod(this.width))
    const y = int(index.div(this.width))

    const leftX = max(0, x.sub(1))
    const rightX = min(x.add(1), width.sub(1))
    const bottomY = max(0, y.sub(1))
    const topY = min(y.add(1), width.sub(1))

    return {
      northIndex: topY.mul(width).add(x),
      southIndex: bottomY.mul(width).add(x),
      eastIndex: y.mul(width).add(rightX),
      westIndex: y.mul(width).add(leftX),
    }
  }

  getNeighborValues(index, storage) {
    const { northIndex, southIndex, eastIndex, westIndex } = this.getNeighborIndices(index)

    return {
      north: storage.element(northIndex),
      south: storage.element(southIndex),
      east: storage.element(eastIndex),
      west: storage.element(westIndex),
    }
  }

  createComputeHeight(readBuffer, writeBuffer) {
    return Fn(() => {
      const { viscosity, wakePos, wakeSize, wakeDeep, wakeSpeed } = this.effectController

      const height = readBuffer.element(instanceIndex).toVar()
      const prevHeight = this.prevHeightStorage.element(instanceIndex).toVar()
      const { north, south, east, west } = this.getNeighborValues(instanceIndex, readBuffer)

      const neighborHeight = north.add(south).add(east).add(west)
      neighborHeight.mulAssign(0.5)
      neighborHeight.subAssign(prevHeight)

      const newHeight = neighborHeight.mul(viscosity)
      const x = float(globalId.x).mul(1 / this.width)
      const y = float(globalId.y).mul(1 / this.width)
      const centerVec = vec2(0.5)
      const wakePhase = clamp(
        length(vec2(x, y).sub(centerVec).mul(this.bounds).sub(wakePos)).mul(Math.PI).div(wakeSize),
        0.0,
        Math.PI
      )

      newHeight.addAssign(cos(wakePhase).add(1.0).mul(wakeDeep).mul(wakeSpeed.length()))
      this.prevHeightStorage.element(instanceIndex).assign(height)
      writeBuffer.element(instanceIndex).assign(newHeight)
    })().compute(this.width * this.width, [16, 16])
  }

  getCurrentHeight(index) {
    return select(this.readFromA, this.heightStorageA.element(index), this.heightStorageB.element(index))
  }

  getCurrentNormals(index) {
    const { northIndex, southIndex, eastIndex, westIndex } = this.getNeighborIndices(index)
    const north = this.getCurrentHeight(northIndex)
    const south = this.getCurrentHeight(southIndex)
    const east = this.getCurrentHeight(eastIndex)
    const west = this.getCurrentHeight(westIndex)

    return {
      normalX: west.sub(east).mul(this.width / this.bounds),
      normalY: south.sub(north).mul(this.width / this.bounds),
    }
  }

  createMesh() {
    const geometry = new THREE.PlaneGeometry(this.bounds, this.bounds, this.width - 1, this.width - 1)
    const material = new THREE.MeshStandardNodeMaterial({
      color: 0x9bd2ec,
      metalness: 0.9,
      roughness: 0,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
    })

    material.normalNode = Fn(() => {
      const { normalX, normalY } = this.getCurrentNormals(vertexIndex)
      return transformNormalToView(vec3(normalX, normalY.negate(), 1.0)).toVertexStage()
    })()

    material.positionNode = Fn(() => {
      return vec3(positionLocal.x, positionLocal.y, this.getCurrentHeight(vertexIndex))
    })()

    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.name = 'water'
    this.mesh.receiveShadow = true
    this.mesh.rotation.x = -Math.PI * 0.5
    this.mesh.matrixAutoUpdate = false
    this.mesh.updateMatrix()
    this.add(this.mesh)
  }

  update(sourcePosition) {
    const { wakePos, wakeSpeed } = this.effectController

    wakeSpeed.value.set(sourcePosition.x - wakePos.value.x, sourcePosition.z - wakePos.value.y)
    wakePos.value.set(sourcePosition.x, sourcePosition.z)

    this.frame++
    if (this.frame >= 7 - this.effectController.speed) {
      if (this.pingPong === 0) {
        this.renderer.compute(this.computeHeightAtoB, [8, 8, 1])
        this.readFromA.value = 0
      } else {
        this.renderer.compute(this.computeHeightBtoA, [8, 8, 1])
        this.readFromA.value = 1
      }

      this.pingPong = 1 - this.pingPong
      this.frame = 0
    }
  }
}
