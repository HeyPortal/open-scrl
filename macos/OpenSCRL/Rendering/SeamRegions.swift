import CoreGraphics
import Foundation

/// Regional matching for the refined seam. Everything here runs once per match at the
/// analysis resolution, so playback and export never re-estimate colors or alignment.
struct SeamRegions {
    var gain: [SIMD3<Double>]
    var bias: [SIMD3<Double>]
    /// Translations in analysis pixels.
    var shift: [SIMD2<Double>]
    var path: [Double]
    var softPath: [Double]
    var sameScene: Bool

    /// The overlap, addressed along the seam (rows) and across it (columns).
    private struct Grid {
        let a: SeamRenderer.Pixels
        let b: SeamRenderer.Pixels
        let rect: CGRect
        let horizontal: Bool
        var rows: Int { Int(horizontal ? rect.height : rect.width) }
        var cols: Int { Int(horizontal ? rect.width : rect.height) }
        func point(_ row: Int, _ col: Int) -> (x: Int, y: Int) {
            horizontal ? (Int(rect.minX) + col, Int(rect.minY) + row) : (Int(rect.minX) + row, Int(rect.minY) + col)
        }
        /// Converts a translation across/along the seam to image x/y.
        func xy(cross: Double, along: Double) -> SIMD2<Double> {
            horizontal ? SIMD2(cross, along) : SIMD2(along, cross)
        }
    }

    static func make(_ a: SeamRenderer.Pixels, _ b: SeamRenderer.Pixels, overlap: CGRect, edge: SeamEdge,
                     globalShift: SIMD2<Double>, globalGain: [Double], globalBias: [Double],
                     linear: [Double], encoded: [UInt8]) -> SeamRegions? {
        let grid = Grid(a: a, b: b, rect: overlap.integral, horizontal: edge.isHorizontal)
        let rows = grid.rows, cols = grid.cols
        guard rows >= 3, cols >= 3 else { return nil }
        let count = max(4, min(48, rows / 3))
        let centers = (0..<count).map { Double($0) * Double(rows - 1) / Double(count - 1) }

        // Color: moment matching per region. Comparing distributions instead of pixel pairs
        // stays reliable when water moves or nearby objects shift with parallax.
        var sums = [(n: Double, a: SIMD3<Double>, b: SIMD3<Double>, aa: SIMD3<Double>, bb: SIMD3<Double>)](
            repeating: (0, .zero, .zero, .zero, .zero), count: rows)
        for row in 0..<rows {
            for col in 0..<cols {
                let p = grid.point(row, col)
                let i = (p.y * a.width + p.x) * 4
                guard a.bytes[i + 3] > 250, b.bytes[i + 3] > 250 else { continue }
                let av = SIMD3(linear[Int(a.bytes[i])], linear[Int(a.bytes[i + 1])], linear[Int(a.bytes[i + 2])])
                let bv = SIMD3(linear[Int(b.bytes[i])], linear[Int(b.bytes[i + 1])], linear[Int(b.bytes[i + 2])])
                sums[row].n += 1; sums[row].a += av; sums[row].b += bv; sums[row].aa += av * av; sums[row].bb += bv * bv
            }
        }
        let fallbackGain = SIMD3(globalGain[0], globalGain[1], globalGain[2])
        let fallbackBias = SIMD3(globalBias[0], globalBias[1], globalBias[2])
        let sigma = max(1, Double(rows) / 12)
        var gain = [SIMD3<Double>](), bias = [SIMD3<Double>]()
        for center in centers {
            var n = 0.0, sa = SIMD3<Double>.zero, sb = sa, saa = sa, sbb = sa
            for row in 0..<rows where sums[row].n > 0 {
                let w = exp(-0.5 * pow((Double(row) - center) / sigma, 2))
                n += w * sums[row].n; sa += w * sums[row].a; sb += w * sums[row].b; saa += w * sums[row].aa; sbb += w * sums[row].bb
            }
            guard n >= 12 else { gain.append(fallbackGain); bias.append(fallbackBias); continue }
            let ma = sa / n, mb = sb / n
            let va = pointwiseMax(saa / n - ma * ma, .zero), vb = pointwiseMax(sbb / n - mb * mb, .zero)
            var g = SIMD3<Double>.zero, o = SIMD3<Double>.zero
            for c in 0..<3 {
                // The floor keeps flat regions (sky) from inventing contrast; their offset
                // carries the exposure and white-balance difference instead.
                g[c] = clamp(sqrt((vb[c] + 4e-4) / (va[c] + 4e-4)), 0.5, 2)
                o[c] = clamp(mb[c] - ma[c] * g[c], -0.5, 0.5)
            }
            gain.append(g); bias.append(o)
        }
        gain = smoothed(gain, sigma: 1.5); bias = smoothed(bias, sigma: 1.5)

        let lumaA = luma(a), lumaB = luma(b)
        var shift = regionShifts(grid, centers: centers, lumaA: lumaA, lumaB: lumaB, global: globalShift)

        // Per-row model, interpolated between region centers.
        func interpolate<T: SIMD>(_ values: [T], _ row: Int) -> T where T.Scalar == Double {
            let x = Double(row) / Double(max(1, rows - 1)) * Double(values.count - 1)
            let i = min(values.count - 2, Int(x)), f = x - Double(i)
            return values[i] * (1 - f) + values[i + 1] * f
        }
        // The foreground after regional alignment and color mapping, against the partner.
        var mappedLuma = [Double](repeating: 0, count: rows * cols), partnerLuma = mappedLuma
        var difference = [Double](repeating: 0, count: rows * cols)
        var valid = [Bool](repeating: false, count: rows * cols)
        for row in 0..<rows {
            let s = interpolate(shift, row), g = interpolate(gain, row), o = interpolate(bias, row)
            for col in 0..<cols {
                let p = grid.point(row, col), j = row * cols + col
                let av = a.sample(Double(p.x) - s.x, Double(p.y) - s.y)
                let i = (p.y * a.width + p.x) * 4
                let bv = SIMD3(Double(b.bytes[i]), Double(b.bytes[i + 1]), Double(b.bytes[i + 2])) / 255
                var mapped = SIMD3<Double>.zero
                for c in 0..<3 {
                    let value = clamp(linear[clamp(Int(av[c].rounded()), 0, 255)] * g[c] + o[c], 0, 1)
                    mapped[c] = Double(encoded[clamp(Int(value * 65535), 0, 65535)]) / 255
                }
                mappedLuma[j] = mapped.x * 0.2126 + mapped.y * 0.7152 + mapped.z * 0.0722
                partnerLuma[j] = bv.x * 0.2126 + bv.y * 0.7152 + bv.z * 0.0722
                valid[j] = av.w > 250 && b.bytes[i + 3] > 250
                difference[j] = abs(mapped.x - bv.x) + abs(mapped.y - bv.y) + abs(mapped.z - bv.z)
            }
        }
        difference = blur(difference, rows: rows, cols: cols)
        let gradA = gradient(blur(mappedLuma, rows: rows, cols: cols), rows: rows, cols: cols)
        let gradB = gradient(blur(partnerLuma, rows: rows, cols: cols), rows: rows, cols: cols)
        let detail = zip(gradA, gradB).map { max($0, $1) }

        // Seamless: cut where both photos agree and detail is low, so moving or misaligned
        // content is never cross-faded into a ghost.
        var stitchCost = [Double](repeating: 1000, count: rows * cols)
        for j in 0..<(rows * cols) where valid[j] {
            let col = j % cols
            stitchCost[j] = difference[j] + 0.8 * detail[j] + 0.25 * abs((Double(col) + 0.5) / Double(cols) - 0.5)
        }
        // Soft: cross through calm areas (sky, water, mist), where a wider transition reads
        // as atmosphere rather than a double exposure.
        let calm = blur(blur(detail, rows: rows, cols: cols), rows: rows, cols: cols)
        var softCost = [Double](repeating: 1000, count: rows * cols)
        for j in 0..<(rows * cols) where valid[j] {
            let col = j % cols
            softCost[j] = 2 * calm[j] + 0.35 * abs((Double(col) + 0.5) / Double(cols) - 0.5)
        }
        let path = cheapestPath(stitchCost, rows: rows, cols: cols, low: 0.15, high: 0.85, smoothing: 2)
        let softPath = cheapestPath(softCost, rows: rows, cols: cols, low: 0.2, high: 0.8, smoothing: 3)

        // Same scene: the aligned fine detail correlates, and no region needs an implausible
        // color change. Different photos can share coarse structure, like a horizon.
        let highA = zip(mappedLuma, blur(blur(mappedLuma, rows: rows, cols: cols), rows: rows, cols: cols)).map { $0 - $1 }
        let highB = zip(partnerLuma, blur(blur(partnerLuma, rows: rows, cols: cols), rows: rows, cols: cols)).map { $0 - $1 }
        var ab = 0.0, aa = 0.0, bb = 0.0
        for j in 0..<(rows * cols) where valid[j] { ab += highA[j] * highB[j]; aa += highA[j] * highA[j]; bb += highB[j] * highB[j] }
        let correlation = aa > 1e-6 && bb > 1e-6 ? ab / sqrt(aa * bb) : 0
        let plausible = zip(gain, bias).filter { g, o in
            (0..<3).allSatisfy { abs(log(g[$0])) < log(1.6) && abs(o[$0]) < 0.12 }
        }.count
        // Measured on real pairs: a two-shot panorama with moving surf correlates near 0.33,
        // different scenes near 0.
        let sameScene = correlation > 0.15 && Double(plausible) >= Double(count) * 0.6
        // Different photos have no detail to align; local shifts there are coincidences.
        if !sameScene { shift = [SIMD2<Double>](repeating: globalShift, count: count) }
        return SeamRegions(gain: gain, bias: bias, shift: shift, path: path, softPath: softPath, sameScene: sameScene)
    }

    /// Each region searches near the global translation and keeps its own result only when
    /// it is clearly better. Smooth gradients, like sky, match at any shift and keep the global one.
    private static func regionShifts(_ grid: Grid, centers: [Double], lumaA: [Double], lumaB: [Double],
                                     global: SIMD2<Double>) -> [SIMD2<Double>] {
        let a = grid.a, rows = grid.rows, cols = grid.cols
        let globalCross = grid.horizontal ? global.x : global.y, globalAlong = grid.horizontal ? global.y : global.x
        let reach = max(2, min(10, cols / 6))
        let half = max(2, rows / 16)
        let colRange = Int(Double(cols) * 0.2)..<max(Int(Double(cols) * 0.2) + 1, Int(Double(cols) * 0.8))
        var result = [SIMD2<Double>]()
        for center in centers {
            let rowRange = max(0, Int(center) - half)..<min(rows, Int(center) + half + 1)
            func ncc(_ cross: Int, _ along: Int) -> Double {
                let s = grid.xy(cross: Double(cross), along: Double(along))
                let dx = Int(s.x), dy = Int(s.y)
                var n = 0.0, sa = 0.0, sb = 0.0, saa = 0.0, sbb = 0.0, sab = 0.0
                for row in rowRange {
                    for col in colRange {
                        let p = grid.point(row, col)
                        let ax = p.x - dx, ay = p.y - dy
                        guard ax >= 0, ay >= 0, ax < a.width, ay < a.height else { continue }
                        let ia = ay * a.width + ax, ib = p.y * a.width + p.x
                        guard a.bytes[ia * 4 + 3] > 250, grid.b.bytes[ib * 4 + 3] > 250 else { continue }
                        let va = lumaA[ia], vb = lumaB[ib]
                        n += 1; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb
                    }
                }
                guard n >= 24 else { return -1 }
                let varA = saa - sa * sa / n, varB = sbb - sb * sb / n
                // Texture-free windows (under 1% luma deviation) can't anchor a translation.
                guard varA / n > 1e-4, varB / n > 1e-4 else { return -1 }
                return (sab - sa * sb / n) / sqrt(varA * varB)
            }
            let baseCross = Int(globalCross.rounded()), baseAlong = Int(globalAlong.rounded())
            let baseline = ncc(baseCross, baseAlong)
            var best = (score: -1.0, cross: baseCross, along: baseAlong)
            for along in (baseAlong - 3)...(baseAlong + 3) {
                for cross in (baseCross - reach)...(baseCross + reach) {
                    let score = ncc(cross, along)
                    if score > best.score { best = (score, cross, along) }
                }
            }
            if best.score > 0.6, best.score > baseline + 0.03 {
                result.append(grid.xy(cross: Double(best.cross), along: Double(best.along)))
            } else {
                result.append(global)
            }
        }
        return smoothed(result, sigma: 1.5)
    }

    /// Minimum-cost top-to-bottom cut, three-connected, then smoothed so a narrow detail
    /// transition never shows stair steps.
    private static func cheapestPath(_ cost: [Double], rows: Int, cols: Int, low: Double, high: Double, smoothing: Double) -> [Double] {
        let lo = max(1, Int(Double(cols) * low)), hi = min(cols - 2, Int(Double(cols) * high))
        guard hi > lo else { return [] }
        var previous = [Double](repeating: .infinity, count: cols)
        var parents = [Int16](repeating: 0, count: rows * cols)
        for row in 0..<rows {
            var next = [Double](repeating: .infinity, count: cols)
            for col in lo...hi {
                var best = col
                if row > 0 {
                    for p in max(lo, col - 1)...min(hi, col + 1) where previous[p] < previous[best] { best = p }
                }
                next[col] = cost[row * cols + col] + (row > 0 ? previous[best] : 0)
                parents[row * cols + col] = Int16(best)
            }
            previous = next
        }
        var col = (lo...hi).min { previous[$0] < previous[$1] } ?? cols / 2
        var path = [Double](repeating: 0.5, count: rows)
        for row in (0..<rows).reversed() {
            path[row] = (Double(col) + 0.5) / Double(cols)
            col = Int(parents[row * cols + col])
        }
        return smoothed(path.map { SIMD2($0, 0) }, sigma: smoothing).map { clamp($0.x, 0, 1) }
    }

    private static func luma(_ p: SeamRenderer.Pixels) -> [Double] {
        (0..<(p.width * p.height)).map { i in
            (Double(p.bytes[i * 4]) * 0.2126 + Double(p.bytes[i * 4 + 1]) * 0.7152 + Double(p.bytes[i * 4 + 2]) * 0.0722) / 255
        }
    }

    /// 3×3 box blur with clamped edges.
    private static func blur(_ values: [Double], rows: Int, cols: Int) -> [Double] {
        var result = values
        for row in 0..<rows {
            for col in 0..<cols {
                var sum = 0.0
                for dr in -1...1 {
                    for dc in -1...1 { sum += values[clamp(row + dr, 0, rows - 1) * cols + clamp(col + dc, 0, cols - 1)] }
                }
                result[row * cols + col] = sum / 9
            }
        }
        return result
    }

    private static func gradient(_ values: [Double], rows: Int, cols: Int) -> [Double] {
        var result = values
        for row in 0..<rows {
            for col in 0..<cols {
                let gx = (values[row * cols + min(cols - 1, col + 1)] - values[row * cols + max(0, col - 1)]) / 2
                let gy = (values[min(rows - 1, row + 1) * cols + col] - values[max(0, row - 1) * cols + col]) / 2
                result[row * cols + col] = (gx * gx + gy * gy).squareRoot()
            }
        }
        return result
    }

    private static func smoothed<T: SIMD>(_ values: [T], sigma: Double) -> [T] where T.Scalar == Double {
        guard values.count > 1 else { return values }
        let radius = Int(ceil(sigma * 3))
        return values.indices.map { i in
            var sum = T.zero, total = 0.0
            for j in (i - radius)...(i + radius) {
                let w = exp(-0.5 * pow(Double(j - i) / sigma, 2))
                sum += values[clamp(j, 0, values.count - 1)] * w; total += w
            }
            return sum / total
        }
    }
}
