import CoreGraphics
import Foundation
import Vision

/// Matches a pair once, then reuses its spatial mask and color correction for every frame.
/// Keeping analysis out of playback prevents the seam and exposure from flickering in videos.
enum SeamRenderer {
    private struct MaskKey: Hashable {
        var foreground: SeamSource
        var background: SeamSource
        var backgroundOpacity: Double
        var relativeX: Double
        var relativeY: Double
        var coverageImageID: ObjectIdentifier?
        var blend: SeamBlend
        var width: Int
        var height: Int
    }
    private final class KeyBox: NSObject {
        let value: MaskKey
        // Retain the image while its identity is cached, so identities cannot be recycled.
        let coverageImage: CGImage?
        init(_ value: MaskKey, coverageImage: CGImage?) { self.value = value; self.coverageImage = coverageImage }
        override var hash: Int { value.hashValue }
        override func isEqual(_ object: Any?) -> Bool { (object as? KeyBox)?.value == value }
    }
    private final class Mask {
        let alpha: [UInt8]
        let localWeight: [UInt8]
        init(alpha: [UInt8], localWeight: [UInt8]) { self.alpha = alpha; self.localWeight = localWeight }
    }
    private static let masks: NSCache<KeyBox, Mask> = {
        let cache = NSCache<KeyBox, Mask>()
        cache.totalCostLimit = 64 * 1024 * 1024
        return cache
    }()
    private static let linear = (0...255).map { value -> Double in
        let v = Double(value) / 255
        return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
    }
    private static let encoded = (0...65535).map { value -> UInt8 in
        let v = Double(value) / 65535
        let s = v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1 / 2.4) - 0.055
        return UInt8(clamp(Int((s * 255).rounded()), 0, 255))
    }

    struct Pixels {
        let width: Int
        let height: Int
        var bytes: [UInt8]

        init?(width: Int, height: Int, draw: (CGContext) -> Void) {
            guard width > 0, height > 0, width <= 8192, height <= 8192,
                  width * height <= 32 * 1024 * 1024 else { return nil }
            self.width = width; self.height = height
            var data = [UInt8](repeating: 0, count: width * height * 4)
            let succeeded = data.withUnsafeMutableBytes { storage -> Bool in
                guard let cg = CGContext(data: storage.baseAddress, width: width, height: height, bitsPerComponent: 8,
                                         bytesPerRow: width * 4, space: HexColor.srgb,
                                         bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
                cg.translateBy(x: 0, y: CGFloat(height)); cg.scaleBy(x: 1, y: -1)
                draw(cg)
                return true
            }
            guard succeeded else { return nil }
            bytes = data
        }

        func image() -> CGImage? {
            guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
            return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                           space: HexColor.srgb, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue),
                           provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
        }

        func sample(_ x: Double, _ y: Double) -> SIMD4<Double> {
            let x = clamp(x, 0, Double(width - 1)), y = clamp(y, 0, Double(height - 1))
            let x0 = Int(x), y0 = Int(y), x1 = min(width - 1, x0 + 1), y1 = min(height - 1, y0 + 1)
            let fx = x - Double(x0), fy = y - Double(y0)
            func pixel(_ x: Int, _ y: Int) -> SIMD4<Double> {
                let i = (y * width + x) * 4
                return SIMD4(Double(bytes[i]), Double(bytes[i + 1]), Double(bytes[i + 2]), Double(bytes[i + 3]))
            }
            return (pixel(x0, y0) * (1 - fx) + pixel(x1, y0) * fx) * (1 - fy)
                + (pixel(x0, y1) * (1 - fx) + pixel(x1, y1) * fx) * fy
        }

        func overlapBounds() -> CGRect? {
            var left = width, right = -1, top = height, bottom = -1
            for y in 0..<height { for x in 0..<width where bytes[(y * width + x) * 4 + 3] > 8 {
                left = min(left, x); right = max(right, x); top = min(top, y); bottom = max(bottom, y)
            } }
            guard right - left >= 2, bottom - top >= 2 else { return nil }
            return CGRect(x: left, y: top, width: right - left + 1, height: bottom - top + 1)
        }
    }

    /// Rasterizes the partner in the foreground's coordinate space, including crop, rotation,
    /// rounded corners and opacity. Coverage-only renders don't decode any media.
    static func raster(_ item: SceneItem, relativeTo foreground: SceneItem, width: Int, height: Int,
                       assets: [String: MediaAsset], images: ImageProviding?, coverageOnly: Bool = false, coverageImage: CGImage? = nil) -> Pixels? {
        Pixels(width: width, height: height) { cg in
            let layer = foreground.layer
            cg.scaleBy(x: Double(width) / layer.width, y: Double(height) / layer.height)
            cg.translateBy(x: layer.width / 2, y: layer.height / 2)
            cg.rotate(by: -Geometry.radians(layer.rotation))
            cg.translateBy(x: -foreground.origin.x - layer.width / 2, y: -foreground.origin.y - layer.height / 2)
            if coverageOnly {
                let target = item.layer
                cg.translateBy(x: item.origin.x + target.width / 2, y: item.origin.y + target.height / 2)
                cg.rotate(by: Geometry.radians(target.rotation))
                cg.translateBy(x: -target.width / 2, y: -target.height / 2)
                cg.setFillColor(CGColor(gray: 1, alpha: clamp(target.opacity, 0, 1)))
                cg.addPath(MaskGeometry.path(target.image?.mask ?? .rect, size: target.frame.size, cornerRadius: target.image?.cornerRadius ?? 0))
                cg.fillPath()
                if let coverageImage, let asset = assets[target.image?.assetID ?? ""], let props = target.image {
                    cg.addPath(MaskGeometry.path(props.mask, size: target.frame.size, cornerRadius: props.cornerRadius))
                    cg.clip()
                    cg.setBlendMode(.destinationIn)
                    Renderer.drawImageFlipped(coverageImage, in: Geometry.mediaRect(mediaSize: asset.pixelSize, box: target.frame.size, image: props), cg: cg)
                }
            } else {
                var flat = item.layer
                flat.image?.seamBlend = nil
                flat.shadow = nil
                flat.opacity = 1
                Renderer.drawLayer(flat, origin: item.origin, cg: cg, assets: assets, images: images, options: RenderOptions())
            }
        }
    }

    private static func smooth(_ t: Double) -> Double {
        let t = clamp(t, 0, 1)
        return t * t * (3 - 2 * t)
    }

    private static func makeMask(_ foreground: SceneItem, target: SceneItem, blend: SeamBlend, width: Int, height: Int,
                                 assets: [String: MediaAsset], targetImage: CGImage) -> Mask? {
        let opaque = [.none, .noneSkipFirst, .noneSkipLast].contains(targetImage.alphaInfo)
        let coverageImage = opaque ? nil : targetImage
        let key = KeyBox(MaskKey(foreground: SeamSource(foreground.layer), background: SeamSource(target.layer),
                                backgroundOpacity: target.layer.opacity,
                                relativeX: target.origin.x - foreground.origin.x, relativeY: target.origin.y - foreground.origin.y,
                                coverageImageID: coverageImage.map(ObjectIdentifier.init), blend: blend, width: width, height: height), coverageImage: coverageImage)
        if let cached = masks.object(forKey: key) { return cached }
        guard let coverage = raster(target, relativeTo: foreground, width: width, height: height, assets: assets, images: nil, coverageOnly: true, coverageImage: coverageImage),
              let overlap = coverage.overlapBounds() else { return nil }
        let horizontal = blend.edge.isHorizontal
        let minCross = horizontal ? overlap.minX : overlap.minY
        let crossSize = horizontal ? overlap.width : overlap.height
        let minAlong = horizontal ? overlap.minY : overlap.minX
        let alongSize = horizontal ? overlap.height : overlap.width
        let scale = horizontal ? Double(width) / foreground.layer.width : Double(height) / foreground.layer.height
        let feather = max(1, min(blend.width * scale, crossSize * 0.9))
        let analysis = blend.analysis.flatMap { $0.matches(foreground.layer, target.layer, edge: blend.edge) ? $0 : nil }
        let path = blend.followsDetail ? analysis?.path ?? [] : []
        var alpha = [UInt8](repeating: 255, count: width * height)
        var weight = [UInt8](repeating: 0, count: width * height)
        for y in 0..<height { for x in 0..<width {
            let i = y * width + x
            let covered = Double(coverage.bytes[i * 4 + 3]) / 255
            guard covered > 0 else { continue }
            let cross = Double(horizontal ? x : y) + 0.5
            let along = (Double(horizontal ? y : x) + 0.5 - minAlong) / alongSize
            var center = blend.position
            if !path.isEmpty {
                let index = clamp(along, 0, 1) * Double(path.count - 1)
                let a = Int(index), b = min(path.count - 1, a + 1), fraction = index - Double(a)
                center += path[a] * (1 - fraction) + path[b] * fraction - 0.5
            }
            let boundary = minCross + clamp(center, 0.05, 0.95) * crossSize
            let distance = (cross - boundary) * (blend.edge.isReversed ? -1 : 1)
            let foregroundWeight = smooth(distance / feather + 0.5)
            alpha[i] = UInt8(clamp(Int((255 * (1 - covered * (1 - foregroundWeight))).rounded()), 0, 255))
            let edgeDistance = min(cross - minCross, minCross + crossSize - cross)
            let local = max(0, 1 - abs(distance) / feather) * smooth(edgeDistance / (feather * 0.5))
            weight[i] = UInt8(clamp(Int((255 * local * covered).rounded()), 0, 255))
        } }
        let result = Mask(alpha: alpha, localWeight: weight)
        masks.setObject(result, forKey: key, cost: alpha.count + weight.count + (coverageImage.map { $0.bytesPerRow * $0.height } ?? 0))
        return result
    }

    /// Returns a locally corrected foreground with a feathered alpha mask. The actual partner
    /// already exists underneath, so transparent pixels never fade both images to the background.
    static func image(_ image: CGImage, asset: MediaAsset, foreground: SceneItem, target: SceneItem,
                      blend: SeamBlend, pixelScale: Double, assets: [String: MediaAsset], targetImage: CGImage,
                      preparedTargetImage: CGImage? = nil) -> CGImage? {
        if let gpu = SeamGPU.shared,
           let result = gpu.image(image, asset: asset, foreground: foreground, target: target,
                                  blend: blend, pixelScale: pixelScale, assets: assets, targetImage: targetImage, preparedTargetImage: preparedTargetImage) {
            return result
        }
        return imageCPU(image, asset: asset, foreground: foreground, target: target,
                        blend: blend, pixelScale: pixelScale, assets: assets, targetImage: targetImage)
    }

    /// Reference renderer and fallback for machines without a supported Metal device.
    static func imageCPU(_ image: CGImage, asset: MediaAsset, foreground: SceneItem, target: SceneItem,
                         blend: SeamBlend, pixelScale: Double, assets: [String: MediaAsset], targetImage: CGImage) -> CGImage? {
        let layer = foreground.layer, props = layer.image ?? ImageProperties()
        let wantedScale = max(0.02, pixelScale)
        let limit = min(1, 8192 / max(layer.width * wantedScale, layer.height * wantedScale))
        let scale = wantedScale * limit
        let w = max(1, Int(ceil(layer.width * scale))), h = max(1, Int(ceil(layer.height * scale)))
        guard let mask = makeMask(foreground, target: target, blend: blend, width: w, height: h, assets: assets, targetImage: targetImage),
              var pixels = Pixels(width: w, height: h, draw: { cg in
                  cg.scaleBy(x: Double(w) / layer.width, y: Double(h) / layer.height)
                  cg.addPath(MaskGeometry.path(props.mask, size: layer.frame.size, cornerRadius: props.cornerRadius)); cg.clip()
                  Renderer.drawImageFlipped(image, in: Geometry.mediaRect(mediaSize: asset.pixelSize, box: layer.frame.size, image: props), cg: cg)
              }) else { return nil }
        let analysis = blend.analysis.flatMap { $0.matches(layer, target.layer, edge: blend.edge) ? $0 : nil }
        let shiftX = ((analysis?.shiftX ?? 0) * blend.alignment + blend.offsetX) * Double(w) / layer.width
        let shiftY = ((analysis?.shiftY ?? 0) * blend.alignment + blend.offsetY) * Double(h) / layer.height
        let shifted = abs(shiftX) > 0.01 || abs(shiftY) > 0.01
        let original = shifted ? pixels : nil
        let gain = analysis?.gain ?? [1, 1, 1], bias = analysis?.bias ?? [0, 0, 0]
        for y in 0..<h { for x in 0..<w {
            let p = y * w + x, i = p * 4
            if mask.alpha[p] == 255 && mask.localWeight[p] == 0 { continue }
            let local = Double(mask.localWeight[p]) / 255
            if local > 0, let original {
                let sample = original.sample(Double(x) - shiftX * local, Double(y) - shiftY * local)
                // Preserve the original coverage; alignment only moves detail within the seam.
                if sample.w > 1 {
                    let coverage = Double(pixels.bytes[i + 3]) / sample.w
                    for channel in 0..<3 { pixels.bytes[i + channel] = UInt8(clamp(Int((sample[channel] * coverage).rounded()), 0, 255)) }
                }
            }
            let a = Double(pixels.bytes[i + 3]) / 255
            if local > 0, a > 0, analysis != nil, blend.colorMatch > 0 {
                for channel in 0..<3 {
                    let v = linear[clamp(Int((Double(pixels.bytes[i + channel]) / a).rounded()), 0, 255)]
                    let corrected = clamp(v * gain[channel] + bias[channel], 0, 1)
                    let value = v + (corrected - v) * local * blend.colorMatch
                    pixels.bytes[i + channel] = UInt8((Double(encoded[clamp(Int(value * 65535), 0, 65535)]) * a).rounded())
                }
            }
            if mask.alpha[p] != 255 {
                let alpha = Double(mask.alpha[p]) / 255
                for channel in 0..<4 { pixels.bytes[i + channel] = UInt8((Double(pixels.bytes[i + channel]) * alpha).rounded()) }
            }
        } }
        return pixels.image()
    }

    static func analyze(foreground: SceneItem, target: SceneItem, edge: SeamEdge, images: ImageProviding,
                        assets: [String: MediaAsset]) -> SeamAnalysis? {
        let scale = min(1, 256 / max(foreground.layer.width, foreground.layer.height))
        let w = max(4, Int(foreground.layer.width * scale)), h = max(4, Int(foreground.layer.height * scale))
        guard let a = raster(foreground, relativeTo: foreground, width: w, height: h, assets: assets, images: images),
              let b = raster(target, relativeTo: foreground, width: w, height: h, assets: assets, images: images),
              let overlap = b.overlapBounds() else { return nil }
        var result = SeamAnalysis(foreground: SeamSource(foreground.layer), background: SeamSource(target.layer), edge: edge)
        let shift = alignment(a, b, overlap: overlap)
        result.shiftX = shift.x / scale; result.shiftY = shift.y / scale; result.alignmentFound = shift.found
        var sumA = SIMD3<Double>(repeating: 0), sumB = sumA, squaresA = sumA, squaresB = sumA
        var count = 0.0
        let step = max(1, Int(max(overlap.width, overlap.height) / 100))
        for y in stride(from: Int(overlap.minY), to: Int(overlap.maxY), by: step) {
            for x in stride(from: Int(overlap.minX), to: Int(overlap.maxX), by: step) {
                let av = a.sample(Double(x) - shift.x, Double(y) - shift.y), bv = b.sample(Double(x), Double(y))
                guard av.w > 250, bv.w > 250 else { continue }
                let ac = SIMD3(linear[Int(av.x)], linear[Int(av.y)], linear[Int(av.z)])
                let bc = SIMD3(linear[Int(bv.x)], linear[Int(bv.y)], linear[Int(bv.z)])
                sumA += ac; sumB += bc; squaresA += ac * ac; squaresB += bc * bc; count += 1
            }
        }
        guard count >= 12 else { return nil }
        let meanA = sumA / count, meanB = sumB / count
        for c in 0..<3 {
            let va = max(0, squaresA[c] / count - meanA[c] * meanA[c])
            let vb = max(0, squaresB[c] / count - meanB[c] * meanB[c])
            let gain = va > 0.0001 && vb > 0.0001 ? clamp(sqrt(vb / va), 0.5, 2) : 1
            result.gain[c] = gain
            result.bias[c] = clamp(meanB[c] - meanA[c] * gain, -0.25, 0.25)
        }
        if let regions = SeamRegions.make(a, b, overlap: overlap, edge: edge, globalShift: SIMD2(shift.x, shift.y),
                                          globalGain: result.gain, globalBias: result.bias, linear: linear, encoded: encoded) {
            result.regionGain = regions.gain.flatMap { [$0.x, $0.y, $0.z] }
            result.regionBias = regions.bias.flatMap { [$0.x, $0.y, $0.z] }
            result.regionShift = regions.shift.flatMap { [$0.x / scale, $0.y / scale] }
            result.path = regions.path
            result.softPath = regions.softPath
            result.sameScene = regions.sameScene
        }
        return result
    }

    private static func alignment(_ a: Pixels, _ b: Pixels, overlap: CGRect) -> (x: Double, y: Double, found: Bool) {
        func score(_ dx: Double, _ dy: Double) -> Double {
            var n = 0.0, sa = 0.0, sb = 0.0, aa = 0.0, bb = 0.0, ab = 0.0
            let step = max(1, Int(max(overlap.width, overlap.height) / 32))
            for y in stride(from: Int(overlap.minY), to: Int(overlap.maxY), by: step) {
                for x in stride(from: Int(overlap.minX), to: Int(overlap.maxX), by: step) {
                    guard Double(x) - dx >= 0, Double(x) - dx < Double(a.width), Double(y) - dy >= 0, Double(y) - dy < Double(a.height) else { continue }
                    let av = a.sample(Double(x) - dx, Double(y) - dy), bv = b.sample(Double(x), Double(y))
                    guard av.w > 250, bv.w > 250 else { continue }
                    let al = av.x * 0.2126 + av.y * 0.7152 + av.z * 0.0722
                    let bl = bv.x * 0.2126 + bv.y * 0.7152 + bv.z * 0.0722
                    n += 1; sa += al; sb += bl; aa += al * al; bb += bl * bl; ab += al * bl
                }
            }
            let va = aa - sa * sa / max(1, n), vb = bb - sb * sb / max(1, n)
            guard n >= 24, va > 1, vb > 1 else { return -1 }
            return (ab - sa * sb / n) / sqrt(va * vb)
        }
        let baseline = score(0, 0)
        var best = (x: 0.0, y: 0.0, score: baseline)
        let limitX = min(32.0, overlap.width * 0.35), limitY = min(32.0, overlap.height * 0.35)
        func consider(_ x: Double, _ y: Double) {
            guard abs(x) <= limitX, abs(y) <= limitY else { return }
            let value = score(x, y)
            if value > best.score { best = (x, y, value) }
        }
        if let floating = a.image()?.cropping(to: overlap), let reference = b.image()?.cropping(to: overlap) {
            let request = VNTranslationalImageRegistrationRequest(targetedCGImage: floating, options: [:])
            if (try? VNImageRequestHandler(cgImage: reference).perform([request])) != nil,
               let transform = request.results?.first?.alignmentTransform {
                consider(transform.tx, -transform.ty)
                consider(-transform.tx, transform.ty)
            }
        }
        for y in stride(from: -min(12, Int(limitY)), through: min(12, Int(limitY)), by: 3) {
            for x in stride(from: -min(12, Int(limitX)), through: min(12, Int(limitX)), by: 3) { consider(Double(x), Double(y)) }
        }
        let center = best
        for y in -2...2 { for x in -2...2 { consider(center.x + Double(x), center.y + Double(y)) } }
        guard best.score > 0.65, best.score > baseline + 0.04 else { return (0, 0, baseline > 0.9) }
        return (best.x, best.y, true)
    }
}
