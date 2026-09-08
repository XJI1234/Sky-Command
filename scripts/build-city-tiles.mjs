import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

import gltfPipeline from 'gltf-pipeline'
import {
  Cartesian3,
  Ellipsoid,
  Math as CesiumMath,
  Matrix4,
  Transforms,
} from 'cesium'

const require = createRequire(import.meta.url)
const gltfPipelineRequire = createRequire(require.resolve('gltf-pipeline/package.json'))
const draco3d = gltfPipelineRequire('draco3d')

const { gltfToGlb } = gltfPipeline

const Z_UP_TO_Y_UP_ROOT_MATRIX = [
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
]

const defaultInputDir = path.resolve('Map', 'hangzhou')
const defaultOutputDir = path.resolve('Map', 'hangzhou-3dtiles')
const defaultLeafSize = 12
const defaultMinHeight = -30
const defaultMaxHeight = 600
const LOCAL_WELD_EPSILON = 0.08
const MIN_BUILDING_AREA_SQUARE_METERS = 6
const MIN_BUILDING_SPAN_METERS = 1.5
const FOOTPRINT_RASTER_CELL_SIZE = 0.8
const FOOTPRINT_SIMPLIFY_TOLERANCE = 1.0

let decoderModulePromise = null

const parseArgs = () => {
  const options = {
    inputDir: defaultInputDir,
    outputDir: defaultOutputDir,
    leafSize: defaultLeafSize,
    minHeight: defaultMinHeight,
    maxHeight: defaultMaxHeight,
    force: false,
    limit: null,
  }

  const args = process.argv.slice(2)

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (arg === '--input') {
      options.inputDir = path.resolve(args[index + 1])
      index += 1
      continue
    }

    if (arg === '--output') {
      options.outputDir = path.resolve(args[index + 1])
      index += 1
      continue
    }

    if (arg === '--leafSize') {
      options.leafSize = Number(args[index + 1]) || defaultLeafSize
      index += 1
      continue
    }

    if (arg === '--minHeight') {
      options.minHeight = Number(args[index + 1]) || defaultMinHeight
      index += 1
      continue
    }

    if (arg === '--maxHeight') {
      options.maxHeight = Number(args[index + 1]) || defaultMaxHeight
      index += 1
      continue
    }

    if (arg === '--limit') {
      options.limit = Number(args[index + 1]) || null
      index += 1
      continue
    }

    if (arg === '--force') {
      options.force = true
    }
  }

  return options
}

const ensureEmptyDirectory = async (directoryPath, force) => {
  if (fs.existsSync(directoryPath)) {
    if (!force) {
      throw new Error(`输出目录已存在: ${directoryPath}，如需覆盖请添加 --force`)
    }

    await fsPromises.rm(directoryPath, { recursive: true, force: true })
  }

  await fsPromises.mkdir(directoryPath, { recursive: true })
}

const readJsonFile = async (filePath) => {
  const content = await fsPromises.readFile(filePath, 'utf8')
  return JSON.parse(content)
}

const getDracoDecoderModule = async () => {
  if (!decoderModulePromise) {
    decoderModulePromise = Promise.resolve(draco3d.createDecoderModule({}))
  }

  return decoderModulePromise
}

const roundByStep = (value, step) => {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) {
    return value
  }

  return globalThis.Math.round(value / step) * step
}

const polygonSignedArea = (points) => {
  if (!Array.isArray(points) || points.length < 3) {
    return 0
  }

  let sum = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    sum += current.x * next.y - next.x * current.y
  }

  return sum / 2
}

const removeCollinearPoints = (points, epsilon = 1e-6) => {
  if (!Array.isArray(points) || points.length < 4) {
    return points || []
  }

  const filtered = []

  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length]
    const current = points[index]
    const next = points[(index + 1) % points.length]

    const cross =
      (current.x - previous.x) * (next.y - current.y) -
      (current.y - previous.y) * (next.x - current.x)

    if (globalThis.Math.abs(cross) > epsilon) {
      filtered.push(current)
    }
  }

  return filtered
}

const perpendicularDistance = (point, start, end) => {
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (dx === 0 && dy === 0) {
    return globalThis.Math.sqrt(distanceSquared(point, start))
  }

  return globalThis.Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x)
    / globalThis.Math.sqrt(dx * dx + dy * dy)
}

const simplifyPolylineRdp = (points, tolerance) => {
  if (!Array.isArray(points) || points.length <= 2) {
    return points || []
  }

  let maxDistance = 0
  let maxIndex = -1

  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = perpendicularDistance(points[index], points[0], points[points.length - 1])
    if (distance > maxDistance) {
      maxDistance = distance
      maxIndex = index
    }
  }

  if (maxDistance <= tolerance || maxIndex === -1) {
    return [points[0], points[points.length - 1]]
  }

  const left = simplifyPolylineRdp(points.slice(0, maxIndex + 1), tolerance)
  const right = simplifyPolylineRdp(points.slice(maxIndex), tolerance)
  return [...left.slice(0, -1), ...right]
}

const simplifyClosedPolygon = (points, tolerance) => {
  if (!Array.isArray(points) || points.length < 4) {
    return points || []
  }

  const closed = [...points, points[0]]
  const simplified = simplifyPolylineRdp(closed, tolerance)

  if (simplified.length > 1) {
    simplified.pop()
  }

  return removeCollinearPoints(simplified, 1e-4)
}

const pointInLocalPolygon = (point, polygon) => {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) {
    return false
  }

  let inside = false
  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index++) {
    const current = polygon[index]
    const previous = polygon[previousIndex]

    const intersects =
      current.y > point.y !== previous.y > point.y
      && point.x < ((previous.x - current.x) * (point.y - current.y)) / ((previous.y - current.y) || 1e-12) + current.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

const distanceSquared = (left, right) => {
  const deltaX = left.x - right.x
  const deltaY = left.y - right.y
  return deltaX * deltaX + deltaY * deltaY
}

const pointToSegmentDistanceSquared = (point, start, end) => {
  const dx = end.x - start.x
  const dy = end.y - start.y

  if (dx === 0 && dy === 0) {
    return distanceSquared(point, start)
  }

  const t = globalThis.Math.max(0, globalThis.Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)))
  const projection = {
    x: start.x + t * dx,
    y: start.y + t * dy,
  }

  return distanceSquared(point, projection)
}

const orientation = (left, middle, right) => {
  const value = (middle.y - left.y) * (right.x - middle.x) - (middle.x - left.x) * (right.y - middle.y)
  if (globalThis.Math.abs(value) < 1e-8) {
    return 0
  }

  return value > 0 ? 1 : 2
}

const onSegment = (left, point, right) => {
  return point.x <= globalThis.Math.max(left.x, right.x) + 1e-8
    && point.x >= globalThis.Math.min(left.x, right.x) - 1e-8
    && point.y <= globalThis.Math.max(left.y, right.y) + 1e-8
    && point.y >= globalThis.Math.min(left.y, right.y) - 1e-8
}

const segmentsIntersect = (startA, endA, startB, endB) => {
  const o1 = orientation(startA, endA, startB)
  const o2 = orientation(startA, endA, endB)
  const o3 = orientation(startB, endB, startA)
  const o4 = orientation(startB, endB, endA)

  if (o1 !== o2 && o3 !== o4) {
    return true
  }

  if (o1 === 0 && onSegment(startA, startB, endA)) return true
  if (o2 === 0 && onSegment(startA, endB, endA)) return true
  if (o3 === 0 && onSegment(startB, startA, endB)) return true
  if (o4 === 0 && onSegment(startB, endA, endB)) return true

  return false
}

const segmentsDistanceSquared = (startA, endA, startB, endB) => {
  if (segmentsIntersect(startA, endA, startB, endB)) {
    return 0
  }

  return globalThis.Math.min(
    pointToSegmentDistanceSquared(startA, startB, endB),
    pointToSegmentDistanceSquared(endA, startB, endB),
    pointToSegmentDistanceSquared(startB, startA, endA),
    pointToSegmentDistanceSquared(endB, startA, endA),
  )
}

const bboxOverlapWithGap = (left, right, gapMeters) => {
  return left.minX <= right.maxX + gapMeters
    && left.maxX >= right.minX - gapMeters
    && left.minY <= right.maxY + gapMeters
    && left.maxY >= right.minY - gapMeters
}

const polygonsConnected = (leftBuilding, rightBuilding, gapMeters = 0.8) => {
  if (!bboxOverlapWithGap(leftBuilding.localBbox, rightBuilding.localBbox, gapMeters)) {
    return false
  }

  if (leftBuilding.localRing.some((point) => pointInLocalPolygon(point, rightBuilding.localRing))) {
    return true
  }

  if (rightBuilding.localRing.some((point) => pointInLocalPolygon(point, leftBuilding.localRing))) {
    return true
  }

  const maxDistanceSquared = gapMeters * gapMeters

  for (let leftIndex = 0; leftIndex < leftBuilding.localRing.length; leftIndex += 1) {
    const leftStart = leftBuilding.localRing[leftIndex]
    const leftEnd = leftBuilding.localRing[(leftIndex + 1) % leftBuilding.localRing.length]

    for (let rightIndex = 0; rightIndex < rightBuilding.localRing.length; rightIndex += 1) {
      const rightStart = rightBuilding.localRing[rightIndex]
      const rightEnd = rightBuilding.localRing[(rightIndex + 1) % rightBuilding.localRing.length]

      if (segmentsDistanceSquared(leftStart, leftEnd, rightStart, rightEnd) <= maxDistanceSquared) {
        return true
      }
    }
  }

  return false
}

const tracePointBoundaryLoops = (boundaryEdges) => {
  const pointKey = (point) => `${point.x},${point.y}`
  const edgeKey = (leftKey, rightKey) => (leftKey < rightKey ? `${leftKey}|${rightKey}` : `${rightKey}|${leftKey}`)
  const pointMap = new Map()
  const adjacency = new Map()

  const addNeighbor = (from, to) => {
    if (!adjacency.has(from)) {
      adjacency.set(from, [])
    }
    adjacency.get(from).push(to)
  }

  boundaryEdges.forEach(([left, right]) => {
    const leftKey = pointKey(left)
    const rightKey = pointKey(right)
    pointMap.set(leftKey, left)
    pointMap.set(rightKey, right)
    addNeighbor(leftKey, rightKey)
    addNeighbor(rightKey, leftKey)
  })

  const visitedEdges = new Set()
  const loops = []

  adjacency.forEach((neighbors, startKey) => {
    neighbors.forEach((nextKey) => {
      const startingEdgeKey = edgeKey(startKey, nextKey)
      if (visitedEdges.has(startingEdgeKey)) {
        return
      }

      const loop = [pointMap.get(startKey)]
      let previousKey = startKey
      let currentKey = nextKey
      visitedEdges.add(startingEdgeKey)

      while (true) {
        loop.push(pointMap.get(currentKey))

        const currentNeighbors = adjacency.get(currentKey) || []
        const nextNeighborKey = currentNeighbors.find(
          (neighborKey) => neighborKey !== previousKey && !visitedEdges.has(edgeKey(currentKey, neighborKey)),
        )

        if (nextNeighborKey == null) {
          const closingKey = currentNeighbors.find((neighborKey) => neighborKey === startKey)
          if (closingKey) {
            visitedEdges.add(edgeKey(currentKey, closingKey))
          }
          break
        }

        visitedEdges.add(edgeKey(currentKey, nextNeighborKey))
        previousKey = currentKey
        currentKey = nextNeighborKey

        if (currentKey === startKey) {
          break
        }
      }

      if (loop.length >= 4 && loop[0]?.x === loop[loop.length - 1]?.x && loop[0]?.y === loop[loop.length - 1]?.y) {
        loop.pop()
      }

      if (loop.length >= 3) {
        loops.push(loop)
      }
    })
  })

  return loops
}

const rasterizeGroupOutline = (group) => {
  const allPoints = group.flatMap((building) => building.localRing)
  if (allPoints.length === 0) {
    return []
  }

  const minX = globalThis.Math.min(...allPoints.map((point) => point.x)) - FOOTPRINT_RASTER_CELL_SIZE
  const minY = globalThis.Math.min(...allPoints.map((point) => point.y)) - FOOTPRINT_RASTER_CELL_SIZE
  const maxX = globalThis.Math.max(...allPoints.map((point) => point.x)) + FOOTPRINT_RASTER_CELL_SIZE
  const maxY = globalThis.Math.max(...allPoints.map((point) => point.y)) + FOOTPRINT_RASTER_CELL_SIZE

  const width = globalThis.Math.max(1, globalThis.Math.ceil((maxX - minX) / FOOTPRINT_RASTER_CELL_SIZE))
  const height = globalThis.Math.max(1, globalThis.Math.ceil((maxY - minY) / FOOTPRINT_RASTER_CELL_SIZE))
  const occupied = Array.from({ length: height }, () => new Array(width).fill(false))

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const samplePoint = {
        x: minX + (column + 0.5) * FOOTPRINT_RASTER_CELL_SIZE,
        y: minY + (row + 0.5) * FOOTPRINT_RASTER_CELL_SIZE,
      }

      occupied[row][column] = group.some((building) => pointInLocalPolygon(samplePoint, building.localRing))
    }
  }

  const boundaryEdges = []
  const addEdge = (fromX, fromY, toX, toY) => {
    boundaryEdges.push([
      { x: fromX, y: fromY },
      { x: toX, y: toY },
    ])
  }

  const isOccupied = (row, column) => {
    return row >= 0 && row < height && column >= 0 && column < width && occupied[row][column]
  }

  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      if (!occupied[row][column]) {
        continue
      }

      if (!isOccupied(row - 1, column)) {
        addEdge(column, row, column + 1, row)
      }
      if (!isOccupied(row, column + 1)) {
        addEdge(column + 1, row, column + 1, row + 1)
      }
      if (!isOccupied(row + 1, column)) {
        addEdge(column + 1, row + 1, column, row + 1)
      }
      if (!isOccupied(row, column - 1)) {
        addEdge(column, row + 1, column, row)
      }
    }
  }

  const loops = tracePointBoundaryLoops(boundaryEdges)
    .map((loop) => loop.map((point) => ({
      x: minX + point.x * FOOTPRINT_RASTER_CELL_SIZE,
      y: minY + point.y * FOOTPRINT_RASTER_CELL_SIZE,
    })))
    .map((loop) => removeCollinearPoints(loop, 1e-4))
    .map((loop) => simplifyClosedPolygon(loop, FOOTPRINT_SIMPLIFY_TOLERANCE))
    .filter((loop) => loop.length >= 3)

  if (loops.length === 0) {
    return []
  }

  return loops
    .map((loop) => ({ loop, area: globalThis.Math.abs(polygonSignedArea(loop)) }))
    .sort((left, right) => right.area - left.area)[0]?.loop || []
}

const buildLocalToGeographicConverter = (item) => {
  const originCartesian = Cartesian3.fromDegrees(
    item.center.longitude,
    item.center.latitude,
    0,
  )

  const enuMatrix = Transforms.eastNorthUpToFixedFrame(
    originCartesian,
    Ellipsoid.WGS84,
    new Matrix4(),
  )

  return (x, y, z = 0) => {
    const localCartesian = new Cartesian3(x, y, z)
    const worldCartesian = Matrix4.multiplyByPoint(
      enuMatrix,
      localCartesian,
      new Cartesian3(),
    )
    const cartographic = Ellipsoid.WGS84.cartesianToCartographic(worldCartesian)

    return {
      longitude: CesiumMath.toDegrees(cartographic.longitude),
      latitude: CesiumMath.toDegrees(cartographic.latitude),
      height: cartographic.height,
    }
  }
}

const readBufferViewBytes = async (gltf, gltfPath, bufferViewIndex) => {
  const bufferView = gltf.bufferViews?.[bufferViewIndex]
  if (!bufferView) {
    throw new Error(`未找到 bufferView: ${bufferViewIndex}`)
  }

  const bufferDefinition = gltf.buffers?.[bufferView.buffer]
  if (!bufferDefinition?.uri) {
    throw new Error(`bufferView ${bufferViewIndex} 缺少外部 buffer uri`)
  }

  const bufferPath = path.resolve(path.dirname(gltfPath), bufferDefinition.uri)
  const fileBuffer = await fsPromises.readFile(bufferPath)
  const byteOffset = bufferView.byteOffset || 0
  const byteLength = bufferView.byteLength || 0
  return fileBuffer.subarray(byteOffset, byteOffset + byteLength)
}

const getBuildingTopPrimitive = (gltf) => {
  const topNode = (gltf.nodes || []).find((node) => node?.name === 'buildingTop')
  if (!topNode || typeof topNode.mesh !== 'number') {
    return null
  }

  const mesh = gltf.meshes?.[topNode.mesh]
  return mesh?.primitives?.[0] || null
}

const decodeDracoPrimitive = async (gltf, primitive, gltfPath) => {
  const extension = primitive?.extensions?.KHR_draco_mesh_compression
  if (!extension) {
    return null
  }

  const decoderModule = await getDracoDecoderModule()
  const decoder = new decoderModule.Decoder()
  const decoderBuffer = new decoderModule.DecoderBuffer()

  try {
    const compressedBuffer = await readBufferViewBytes(gltf, gltfPath, extension.bufferView)
    const source = new Uint8Array(
      compressedBuffer.buffer,
      compressedBuffer.byteOffset,
      compressedBuffer.byteLength,
    )

    decoderBuffer.Init(source, source.length)

    const geometryType = decoder.GetEncodedGeometryType(decoderBuffer)
    if (geometryType !== decoderModule.TRIANGULAR_MESH) {
      throw new Error('Draco 数据不是三角网格')
    }

    const mesh = new decoderModule.Mesh()
    const status = decoder.DecodeBufferToMesh(decoderBuffer, mesh)

    if (!status.ok() || mesh.ptr === 0) {
      throw new Error(`Draco 解码失败: ${status.error_msg()}`)
    }

    const numberOfFaces = mesh.num_faces()
    const numberOfPoints = mesh.num_points()
    const indexArray = new decoderModule.DracoInt32Array()
    const indices = new Uint32Array(numberOfFaces * 3)

    for (let faceIndex = 0; faceIndex < numberOfFaces; faceIndex += 1) {
      decoder.GetFaceFromMesh(mesh, faceIndex, indexArray)
      const offset = faceIndex * 3
      indices[offset] = indexArray.GetValue(0)
      indices[offset + 1] = indexArray.GetValue(1)
      indices[offset + 2] = indexArray.GetValue(2)
    }

    const positionAttributeId = extension.attributes?.POSITION
    const positionAttribute = decoder.GetAttributeByUniqueId(mesh, positionAttributeId)
    const positionData = new decoderModule.DracoFloat32Array()

    if (!decoder.GetAttributeFloatForAllPoints(mesh, positionAttribute, positionData)) {
      throw new Error('无法读取 buildingTop POSITION 属性')
    }

    const positions = new Float32Array(numberOfPoints * 3)
    for (let index = 0; index < positions.length; index += 1) {
      positions[index] = positionData.GetValue(index)
    }

    decoderModule.destroy(positionData)
    decoderModule.destroy(indexArray)
    decoderModule.destroy(mesh)

    return {
      positions,
      indices,
    }
  } finally {
    decoderModule.destroy(decoderBuffer)
    decoderModule.destroy(decoder)
  }
}

const weldRoofVertices = (positions, epsilon = LOCAL_WELD_EPSILON) => {
  const remap = new Uint32Array(positions.length / 3)
  const weldedPoints = []
  const pointLookup = new Map()

  for (let offset = 0; offset < positions.length; offset += 3) {
    const pointIndex = offset / 3
    const x = positions[offset]
    const y = positions[offset + 1]
    const z = positions[offset + 2]
    const key = [
      roundByStep(x, epsilon),
      roundByStep(y, epsilon),
      roundByStep(z, epsilon),
    ].join('|')

    if (!pointLookup.has(key)) {
      pointLookup.set(key, weldedPoints.length)
      weldedPoints.push({ x, y, z })
    }

    remap[pointIndex] = pointLookup.get(key)
  }

  return { weldedPoints, remap }
}

const splitRoofByConnectedComponents = (positions, indices) => {
  const { weldedPoints, remap } = weldRoofVertices(positions)
  const faces = []
  const edgeToFaces = new Map()

  const edgeKey = (left, right) => (left < right ? `${left}|${right}` : `${right}|${left}`)

  for (let offset = 0; offset < indices.length; offset += 3) {
    const left = remap[indices[offset]]
    const middle = remap[indices[offset + 1]]
    const right = remap[indices[offset + 2]]

    if (left === middle || middle === right || left === right) {
      continue
    }

    const faceIndex = faces.length
    faces.push([left, middle, right])

    ;[[left, middle], [middle, right], [right, left]].forEach(([from, to]) => {
      const key = edgeKey(from, to)
      if (!edgeToFaces.has(key)) {
        edgeToFaces.set(key, [])
      }
      edgeToFaces.get(key).push(faceIndex)
    })
  }

  const adjacency = Array.from({ length: faces.length }, () => new Set())

  edgeToFaces.forEach((faceIndices) => {
    if (faceIndices.length < 2) {
      return
    }

    for (let leftIndex = 0; leftIndex < faceIndices.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < faceIndices.length; rightIndex += 1) {
        const from = faceIndices[leftIndex]
        const to = faceIndices[rightIndex]
        adjacency[from].add(to)
        adjacency[to].add(from)
      }
    }
  })

  const visited = new Array(faces.length).fill(false)
  const components = []

  for (let startFaceIndex = 0; startFaceIndex < faces.length; startFaceIndex += 1) {
    if (visited[startFaceIndex]) {
      continue
    }

    const queue = [startFaceIndex]
    const componentFaces = []
    visited[startFaceIndex] = true

    while (queue.length > 0) {
      const currentFaceIndex = queue.shift()
      componentFaces.push(faces[currentFaceIndex])

      adjacency[currentFaceIndex].forEach((neighborFaceIndex) => {
        if (!visited[neighborFaceIndex]) {
          visited[neighborFaceIndex] = true
          queue.push(neighborFaceIndex)
        }
      })
    }

    components.push({
      faces: componentFaces,
      weldedPoints,
    })
  }

  return components
}

const traceBoundaryLoops = (boundaryEdges) => {
  const adjacency = new Map()
  const addNeighbor = (from, to) => {
    if (!adjacency.has(from)) {
      adjacency.set(from, [])
    }
    adjacency.get(from).push(to)
  }

  boundaryEdges.forEach(([left, right]) => {
    addNeighbor(left, right)
    addNeighbor(right, left)
  })

  const edgeKey = (left, right) => (left < right ? `${left}|${right}` : `${right}|${left}`)
  const visitedEdges = new Set()
  const loops = []

  adjacency.forEach((neighbors, start) => {
    neighbors.forEach((nextCandidate) => {
      const startingEdgeKey = edgeKey(start, nextCandidate)
      if (visitedEdges.has(startingEdgeKey)) {
        return
      }

      const loop = [start]
      let previous = start
      let current = nextCandidate
      visitedEdges.add(startingEdgeKey)

      while (true) {
        loop.push(current)

        const currentNeighbors = adjacency.get(current) || []
        const next = currentNeighbors.find(
          (neighbor) => neighbor !== previous && !visitedEdges.has(edgeKey(current, neighbor)),
        )

        if (next == null) {
          const closing = currentNeighbors.find((neighbor) => neighbor === start)
          if (closing != null) {
            visitedEdges.add(edgeKey(current, closing))
          }
          break
        }

        visitedEdges.add(edgeKey(current, next))
        previous = current
        current = next

        if (current === start) {
          break
        }
      }

      if (loop.length >= 4 && loop[0] === loop[loop.length - 1]) {
        loop.pop()
      }

      if (loop.length >= 3) {
        loops.push(loop)
      }
    })
  })

  return loops
}

const extractOuterRingFromComponent = (component) => {
  const edgeCounter = new Map()
  const edgeKey = (left, right) => (left < right ? `${left}|${right}` : `${right}|${left}`)

  component.faces.forEach(([left, middle, right]) => {
    ;[[left, middle], [middle, right], [right, left]].forEach(([from, to]) => {
      const key = edgeKey(from, to)
      edgeCounter.set(key, (edgeCounter.get(key) || 0) + 1)
    })
  })

  const boundaryEdges = []
  edgeCounter.forEach((count, key) => {
    if (count !== 1) {
      return
    }

    const [left, right] = key.split('|').map(Number)
    boundaryEdges.push([left, right])
  })

  const loops = traceBoundaryLoops(boundaryEdges)
    .map((loop) => loop.map((index) => component.weldedPoints[index]))
    .map((loop) => removeCollinearPoints(loop))
    .filter((loop) => loop.length >= 3)

  if (loops.length === 0) {
    return null
  }

  const loopWithMaxArea = loops
    .map((loop) => ({ loop, area: globalThis.Math.abs(polygonSignedArea(loop)) }))
    .sort((left, right) => right.area - left.area)[0]

  return loopWithMaxArea
}

const buildBuildingRecord = (item, component, ringResult, buildingIndex) => {
  const ring = ringResult?.loop
  const localArea = ringResult?.area || 0

  if (!Array.isArray(ring) || ring.length < 3 || localArea < MIN_BUILDING_AREA_SQUARE_METERS) {
    return null
  }

  const xs = ring.map((point) => point.x)
  const ys = ring.map((point) => point.y)
  const spanX = globalThis.Math.max(...xs) - globalThis.Math.min(...xs)
  const spanY = globalThis.Math.max(...ys) - globalThis.Math.min(...ys)

  if (spanX < MIN_BUILDING_SPAN_METERS || spanY < MIN_BUILDING_SPAN_METERS) {
    return null
  }

  const centerX = xs.reduce((sum, value) => sum + value, 0) / xs.length
  const centerY = ys.reduce((sum, value) => sum + value, 0) / ys.length
  const centerZ = component.faces
    .flat()
    .map((index) => component.weldedPoints[index]?.z || 0)
    .reduce((sum, value, currentIndex, array) => sum + value / array.length, 0)

  const toGeographic = buildLocalToGeographicConverter(item)
  const footprint = ring.map((point) => {
    const geographic = toGeographic(point.x, point.y, 0)
    return [
      Number(geographic.longitude.toFixed(11)),
      Number(geographic.latitude.toFixed(11)),
    ]
  })

  const center = toGeographic(centerX, centerY, 0)
  const bbox = [
    globalThis.Math.min(...footprint.map((point) => point[0])),
    globalThis.Math.min(...footprint.map((point) => point[1])),
    globalThis.Math.max(...footprint.map((point) => point[0])),
    globalThis.Math.max(...footprint.map((point) => point[1])),
  ]

  return {
    id: `${item.id}-${buildingIndex}`,
    bbox,
    center: {
      longitude: Number(center.longitude.toFixed(11)),
      latitude: Number(center.latitude.toFixed(11)),
    },
    roofHeight: Number(centerZ.toFixed(2)),
    area: Number(localArea.toFixed(2)),
    footprint,
    localRing: ring.map((point) => ({ x: point.x, y: point.y })),
    localBbox: {
      minX: globalThis.Math.min(...xs),
      minY: globalThis.Math.min(...ys),
      maxX: globalThis.Math.max(...xs),
      maxY: globalThis.Math.max(...ys),
    },
  }
}

const mergeConnectedBuildings = (tileId, buildings, item) => {
  if (!Array.isArray(buildings) || buildings.length === 0) {
    return []
  }

  const visited = new Array(buildings.length).fill(false)
  const groups = []

  for (let index = 0; index < buildings.length; index += 1) {
    if (visited[index]) {
      continue
    }

    const queue = [index]
    const group = []
    visited[index] = true

    while (queue.length > 0) {
      const currentIndex = queue.shift()
      group.push(buildings[currentIndex])

      for (let neighborIndex = 0; neighborIndex < buildings.length; neighborIndex += 1) {
        if (visited[neighborIndex]) {
          continue
        }

        if (polygonsConnected(buildings[currentIndex], buildings[neighborIndex])) {
          visited[neighborIndex] = true
          queue.push(neighborIndex)
        }
      }
    }

    groups.push(group)
  }

  const toGeographic = buildLocalToGeographicConverter(item)

  return groups.map((group, groupIndex) => {
    const simplifiedLocalRing = rasterizeGroupOutline(group)

    if (!Array.isArray(simplifiedLocalRing) || simplifiedLocalRing.length < 3) {
      return null
    }

    const footprint = simplifiedLocalRing.map((point) => {
      const geographic = toGeographic(point.x, point.y, 0)
      return [
        Number(geographic.longitude.toFixed(11)),
        Number(geographic.latitude.toFixed(11)),
      ]
    })

    const bbox = [
      globalThis.Math.min(...footprint.map((point) => point[0])),
      globalThis.Math.min(...footprint.map((point) => point[1])),
      globalThis.Math.max(...footprint.map((point) => point[0])),
      globalThis.Math.max(...footprint.map((point) => point[1])),
    ]

    const centerLongitude = group.reduce((sum, building) => sum + Number(building.center.longitude || 0), 0) / group.length
    const centerLatitude = group.reduce((sum, building) => sum + Number(building.center.latitude || 0), 0) / group.length

    return {
      id: `${tileId}-${groupIndex}`,
      bbox,
      center: {
        longitude: Number(centerLongitude.toFixed(11)),
        latitude: Number(centerLatitude.toFixed(11)),
      },
      roofHeight: Number(globalThis.Math.max(...group.map((building) => Number(building.roofHeight || 0))).toFixed(2)),
      area: Number(group.reduce((sum, building) => sum + Number(building.area || 0), 0).toFixed(2)),
      footprint,
    }
  }).filter(Boolean)
}

const extractTileBuildings = async (item) => {
  const gltf = await readJsonFile(item.gltfPath)
  const primitive = getBuildingTopPrimitive(gltf)

  if (!primitive) {
    return []
  }

  const decoded = await decodeDracoPrimitive(gltf, primitive, item.gltfPath)
  if (!decoded) {
    return []
  }

  const components = splitRoofByConnectedComponents(decoded.positions, decoded.indices)

  return mergeConnectedBuildings(item.id, components
    .map((component, buildingIndex) => {
      const ringResult = extractOuterRingFromComponent(component)
      return buildBuildingRecord(item, component, ringResult, buildingIndex)
    })
    .filter(Boolean), item)
}

const buildTransform = (longitude, latitude) => {
  const position = Cartesian3.fromDegrees(longitude, latitude, 0)
  const matrix = Transforms.eastNorthUpToFixedFrame(
    position,
    Ellipsoid.WGS84,
    new Matrix4(),
  )

  return Array.from(Matrix4.pack(matrix, new Array(16)))
}

const toRegion = (bbox, minHeight, maxHeight) => {
  return [
    CesiumMath.toRadians(bbox[0]),
    CesiumMath.toRadians(bbox[1]),
    CesiumMath.toRadians(bbox[2]),
    CesiumMath.toRadians(bbox[3]),
    minHeight,
    maxHeight,
  ]
}

const computeUnionBbox = (items) => {
  return items.reduce(
    (accumulator, item) => {
      return [
        Math.min(accumulator[0], item.bbox[0]),
        Math.min(accumulator[1], item.bbox[1]),
        Math.max(accumulator[2], item.bbox[2]),
        Math.max(accumulator[3], item.bbox[3]),
      ]
    },
    [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  )
}

const estimateGeometricError = (bbox) => {
  const middleLatitude = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180)
  const lonMeters = Math.abs(bbox[2] - bbox[0]) * 111320 * Math.cos(middleLatitude)
  const latMeters = Math.abs(bbox[3] - bbox[1]) * 110540
  return Math.max(lonMeters, latMeters)
}

const splitItems = (items) => {
  if (items.length <= 1) {
    return [items]
  }

  const bbox = computeUnionBbox(items)
  const lonSpan = bbox[2] - bbox[0]
  const latSpan = bbox[3] - bbox[1]
  const axis = lonSpan >= latSpan ? 'longitude' : 'latitude'
  const sortedItems = [...items].sort((left, right) => left.center[axis] - right.center[axis])
  const midIndex = Math.ceil(sortedItems.length / 2)
  return [sortedItems.slice(0, midIndex), sortedItems.slice(midIndex)].filter((group) => group.length > 0)
}

const createLeafTile = (item, minHeight, maxHeight) => {
  return {
    boundingVolume: {
      region: toRegion(item.bbox, minHeight, maxHeight),
    },
    geometricError: 0,
    refine: 'ADD',
    transform: item.transform,
    content: {
      uri: `content/${item.id}.b3dm`,
    },
  }
}

const createTileNode = (items, leafSize, minHeight, maxHeight) => {
  if (items.length <= leafSize) {
    const bbox = computeUnionBbox(items)
    return {
      boundingVolume: {
        region: toRegion(bbox, minHeight, maxHeight),
      },
      geometricError: Math.max(estimateGeometricError(bbox) / 2, 1),
      refine: 'ADD',
      children: items.map((item) => createLeafTile(item, minHeight, maxHeight)),
    }
  }

  const groups = splitItems(items)
  const bbox = computeUnionBbox(items)
  return {
    boundingVolume: {
      region: toRegion(bbox, minHeight, maxHeight),
    },
    geometricError: Math.max(estimateGeometricError(bbox), 1),
    refine: 'ADD',
    children: groups.map((group) => createTileNode(group, leafSize, minHeight, maxHeight)),
  }
}

const normalizeGltfUpAxisForB3dm = (gltf) => {
  if (!Array.isArray(gltf.scenes) || gltf.scenes.length === 0) {
    return gltf
  }

  if (!Array.isArray(gltf.nodes)) {
    gltf.nodes = []
  }

  const rootWrapperIndices = new Map()

  for (const scene of gltf.scenes) {
    if (!Array.isArray(scene.nodes) || scene.nodes.length === 0) {
      continue
    }

    scene.nodes = scene.nodes.map((nodeIndex) => {
      if (rootWrapperIndices.has(nodeIndex)) {
        return rootWrapperIndices.get(nodeIndex)
      }

      const wrapperIndex = gltf.nodes.length
      gltf.nodes.push({
        name: `zUpWrapper_${nodeIndex}`,
        matrix: [...Z_UP_TO_Y_UP_ROOT_MATRIX],
        children: [nodeIndex],
      })
      rootWrapperIndices.set(nodeIndex, wrapperIndex)
      return wrapperIndex
    })
  }

  return gltf
}

const convertGltfToGlb = async (gltfPath, glbPath) => {
  const gltf = normalizeGltfUpAxisForB3dm(await readJsonFile(gltfPath))
  const result = await gltfToGlb(gltf, {
    resourceDirectory: path.dirname(gltfPath),
  })
  await fsPromises.writeFile(glbPath, result.glb)
}

const padBuffer = (buffer, multiple, fillValue) => {
  const remainder = buffer.length % multiple

  if (remainder === 0) {
    return buffer
  }

  const padding = Buffer.alloc(multiple - remainder, fillValue)
  return Buffer.concat([buffer, padding])
}

const convertGlbToB3dm = async (glbPath, b3dmPath) => {
  const featureTableJson = padBuffer(Buffer.from('{"BATCH_LENGTH":0}', 'utf8'), 8, 0x20)
  const glbBuffer = await fsPromises.readFile(glbPath)
  const paddedGlbBuffer = padBuffer(glbBuffer, 8, 0x00)
  const header = Buffer.alloc(28)
  const byteLength = header.length + featureTableJson.length + paddedGlbBuffer.length

  header.write('b3dm', 0, 4, 'ascii')
  header.writeUInt32LE(1, 4)
  header.writeUInt32LE(byteLength, 8)
  header.writeUInt32LE(featureTableJson.length, 12)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(0, 20)
  header.writeUInt32LE(0, 24)

  await fsPromises.writeFile(b3dmPath, Buffer.concat([header, featureTableJson, paddedGlbBuffer]))
}

const loadInputItems = async (inputDir, limit) => {
  const modelInfoPath = path.join(inputDir, 'modelinfo.json')
  const modelInfo = await readJsonFile(modelInfoPath)
  const entries = Object.entries(modelInfo)
    .sort((left, right) => Number.parseInt(left[0], 10) - Number.parseInt(right[0], 10))
    .slice(0, limit || Number.POSITIVE_INFINITY)

  const items = entries.map(([fileName, meta]) => {
    const id = path.basename(fileName, path.extname(fileName))
    return {
      id,
      fileName,
      gltfPath: path.join(inputDir, fileName),
      center: {
        longitude: Number(meta.center[0]),
        latitude: Number(meta.center[1]),
      },
      bbox: [
        Number(meta.bbox[0]),
        Number(meta.bbox[1]),
        Number(meta.bbox[2]),
        Number(meta.bbox[3]),
      ],
      transform: buildTransform(Number(meta.center[0]), Number(meta.center[1])),
    }
  })

  for (const [index, item] of items.entries()) {
    item.buildings = await extractTileBuildings(item)

    if ((index + 1) % 10 === 0 || index === items.length - 1) {
      console.log(`  已提取 footprint ${index + 1}/${items.length}`)
    }
  }

  return items
}

const writeTileset = async (outputDir, items, leafSize, minHeight, maxHeight) => {
  const root = createTileNode(items, leafSize, minHeight, maxHeight)
  const tileset = {
    asset: {
      version: '1.1',
      generator: 'build-city-model-3dtiles',
    },
    geometricError: root.geometricError,
    root,
  }

  await fsPromises.writeFile(path.join(outputDir, 'tileset.json'), JSON.stringify(tileset, null, 2), 'utf8')
}

const writeManifest = async (outputDir, items, options) => {
  const manifest = {
    source: path.relative(process.cwd(), options.inputDir),
    generatedAt: new Date().toISOString(),
    count: items.length,
    leafSize: options.leafSize,
    minHeight: options.minHeight,
    maxHeight: options.maxHeight,
    items: items.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      center: item.center,
      bbox: item.bbox,
      buildingCount: Array.isArray(item.buildings) ? item.buildings.length : 0,
    })),
  }

  await fsPromises.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

const main = async () => {
  const options = parseArgs()
  const temporaryDir = path.join(options.outputDir, '.tmp')
  const contentDir = path.join(options.outputDir, 'content')

  console.log(`[1/4] 读取模型元数据: ${options.inputDir}`)
  const items = await loadInputItems(options.inputDir, options.limit)

  if (items.length === 0) {
    throw new Error('未找到可转换的模型分块')
  }

  console.log(`[2/4] 准备输出目录: ${options.outputDir}`)
  await ensureEmptyDirectory(options.outputDir, options.force)
  await fsPromises.mkdir(temporaryDir, { recursive: true })
  await fsPromises.mkdir(contentDir, { recursive: true })

  console.log(`[3/4] 转换 ${items.length} 个 glTF 分块为 b3dm`)
  for (const [index, item] of items.entries()) {
    const glbPath = path.join(temporaryDir, `${item.id}.glb`)
    const b3dmPath = path.join(contentDir, `${item.id}.b3dm`)

    await convertGltfToGlb(item.gltfPath, glbPath)
    await convertGlbToB3dm(glbPath, b3dmPath)

    if ((index + 1) % 10 === 0 || index === items.length - 1) {
      console.log(`  已完成 ${index + 1}/${items.length}`)
    }
  }

  console.log('[4/4] 生成 tileset.json 与 manifest.json')
  await writeTileset(options.outputDir, items, options.leafSize, options.minHeight, options.maxHeight)
  await writeManifest(options.outputDir, items, options)
  await fsPromises.rm(temporaryDir, { recursive: true, force: true })

  console.log(`转换完成，输出目录: ${options.outputDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
