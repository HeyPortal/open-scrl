import Foundation
import CoreGraphics

/// Photo grid templates, ported from the web app's `GRID_TEMPLATES`.
struct GridTemplate: Identifiable, Sendable {
    let id: String
    let name: String
    let count: Int
    let cells: @Sendable (_ width: Double, _ height: Double, _ gap: Double) -> [CGRect]
}

extension GridTemplate {
    private static func cell(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> CGRect {
        CGRect(x: x, y: y, width: w, height: h)
    }

    private static func uniform(_ cols: Int, _ rows: Int) -> @Sendable (Double, Double, Double) -> [CGRect] {
        { W, H, g in
            let w = (W - Double(cols - 1) * g) / Double(cols)
            let h = (H - Double(rows - 1) * g) / Double(rows)
            var out: [CGRect] = []
            for r in 0..<rows { for c in 0..<cols { out.append(cell(Double(c) * (w + g), Double(r) * (h + g), w, h)) } }
            return out
        }
    }

    static let all: [GridTemplate] = [
        GridTemplate(id: "single", name: "Single", count: 1) { W, H, _ in [cell(0, 0, W, H)] },
        GridTemplate(id: "two-h", name: "2 stacked", count: 2) { W, H, g in
            let h = (H - g) / 2
            return [cell(0, 0, W, h), cell(0, h + g, W, h)]
        },
        GridTemplate(id: "two-v", name: "2 side", count: 2) { W, H, g in
            let w = (W - g) / 2
            return [cell(0, 0, w, H), cell(w + g, 0, w, H)]
        },
        GridTemplate(id: "three-h", name: "3 row", count: 3) { W, H, g in
            let w = (W - 2 * g) / 3
            return [cell(0, 0, w, H), cell(w + g, 0, w, H), cell(2 * (w + g), 0, w, H)]
        },
        GridTemplate(id: "three-v", name: "3 stack", count: 3) { W, H, g in
            let h = (H - 2 * g) / 3
            return [cell(0, 0, W, h), cell(0, h + g, W, h), cell(0, 2 * (h + g), W, h)]
        },
        GridTemplate(id: "one-plus-two", name: "1 + 2", count: 3) { W, H, g in
            let topH = (H - g) * 0.62, botH = H - g - topH, halfW = (W - g) / 2
            return [cell(0, 0, W, topH), cell(0, topH + g, halfW, botH), cell(halfW + g, topH + g, halfW, botH)]
        },
        GridTemplate(id: "two-plus-one", name: "2 + 1", count: 3) { W, H, g in
            let topH = (H - g) * 0.38, botH = H - g - topH, halfW = (W - g) / 2
            return [cell(0, 0, halfW, topH), cell(halfW + g, 0, halfW, topH), cell(0, topH + g, W, botH)]
        },
        GridTemplate(id: "l-shape", name: "L shape", count: 3) { W, H, g in
            let bigW = (W - g) * 0.62, sideW = W - g - bigW, halfH = (H - g) / 2
            return [cell(0, 0, bigW, H), cell(bigW + g, 0, sideW, halfH), cell(bigW + g, halfH + g, sideW, halfH)]
        },
        GridTemplate(id: "four-grid", name: "2 × 2", count: 4) { W, H, g in
            let w = (W - g) / 2, h = (H - g) / 2
            return [cell(0, 0, w, h), cell(w + g, 0, w, h), cell(0, h + g, w, h), cell(w + g, h + g, w, h)]
        },
        GridTemplate(id: "one-plus-three", name: "1 + 3", count: 4) { W, H, g in
            let topH = (H - g) * 0.62, botH = H - g - topH, w = (W - 2 * g) / 3
            return [cell(0, 0, W, topH), cell(0, topH + g, w, botH), cell(w + g, topH + g, w, botH), cell(2 * (w + g), topH + g, w, botH)]
        },
        GridTemplate(id: "four-row", name: "4 row", count: 4, cells: uniform(4, 1)),
        GridTemplate(id: "four-stack", name: "4 stack", count: 4, cells: uniform(1, 4)),
        GridTemplate(id: "three-plus-one", name: "3 + 1", count: 4) { W, H, g in
            let topH = (H - g) * 0.38, botH = H - g - topH, w = (W - 2 * g) / 3
            return [cell(0, 0, w, topH), cell(w + g, 0, w, topH), cell(2 * (w + g), 0, w, topH), cell(0, topH + g, W, botH)]
        },
        GridTemplate(id: "two-plus-two", name: "2 + 2", count: 4) { W, H, g in
            let halfH = (H - g) / 2, halfW = (W - g) / 2
            return [cell(0, 0, halfW, halfH), cell(halfW + g, 0, halfW, halfH), cell(0, halfH + g, halfW, halfH), cell(halfW + g, halfH + g, halfW, halfH)]
        },
        GridTemplate(id: "two-plus-three", name: "2 + 3", count: 5) { W, H, g in
            let topH = (H - g) * 0.45, botH = H - g - topH, topW = (W - g) / 2, botW = (W - 2 * g) / 3
            return [cell(0, 0, topW, topH), cell(topW + g, 0, topW, topH),
                    cell(0, topH + g, botW, botH), cell(botW + g, topH + g, botW, botH), cell(2 * (botW + g), topH + g, botW, botH)]
        },
        GridTemplate(id: "three-plus-two", name: "3 + 2", count: 5) { W, H, g in
            let topH = (H - g) * 0.45, botH = H - g - topH, topW = (W - 2 * g) / 3, botW = (W - g) / 2
            return [cell(0, 0, topW, topH), cell(topW + g, 0, topW, topH), cell(2 * (topW + g), 0, topW, topH),
                    cell(0, topH + g, botW, botH), cell(botW + g, topH + g, botW, botH)]
        },
        GridTemplate(id: "side-feature-four", name: "1 + 4 side", count: 5) { W, H, g in
            let bigW = (W - g) * 0.58, sideW = W - g - bigW, sideH = (H - 3 * g) / 4
            return [cell(0, 0, bigW, H)] + (0..<4).map { cell(bigW + g, Double($0) * (sideH + g), sideW, sideH) }
        },
        GridTemplate(id: "five-feature", name: "1 + 4", count: 5) { W, H, g in
            let topH = (H - g) * 0.6, botH = H - g - topH, w = (W - 3 * g) / 4
            return [cell(0, 0, W, topH)] + (0..<4).map { cell(Double($0) * (w + g), topH + g, w, botH) }
        },
        GridTemplate(id: "six-tall", name: "2 × 3", count: 6, cells: uniform(2, 3)),
        GridTemplate(id: "six-grid", name: "3 × 2", count: 6, cells: uniform(3, 2)),
        GridTemplate(id: "six-feature", name: "1 + 5", count: 6) { W, H, g in
            let topH = (H - g) * 0.55, botH = H - g - topH, w = (W - 4 * g) / 5
            return [cell(0, 0, W, topH)] + (0..<5).map { cell(Double($0) * (w + g), topH + g, w, botH) }
        },
        GridTemplate(id: "eight-grid", name: "4 × 2", count: 8, cells: uniform(4, 2)),
        GridTemplate(id: "nine-grid", name: "3 × 3", count: 9, cells: uniform(3, 3)),
        GridTemplate(id: "twelve-grid", name: "4 × 3", count: 12, cells: uniform(4, 3)),
        GridTemplate(id: "sixteen-grid", name: "4 × 4", count: 16, cells: uniform(4, 4)),
    ]
}
