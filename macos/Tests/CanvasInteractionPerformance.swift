import AppKit
import CoreImage
import SwiftUI
@testable import OpenSCRL

/// Measures native mouse events and their full SwiftUI-hosted canvas display work.
/// Run the same workload against the before/after app builds; this is not export FPS.
@main @MainActor struct CanvasInteractionPerformance {
    static func canvas(in view: NSView) -> CanvasView? {
        if let canvas = view as? CanvasView { return canvas }
        return view.subviews.lazy.compactMap { canvas(in: $0) }.first
    }
    static func percentile(_ values: [Double], _ p: Double) -> Double {
        let sorted = values.sorted()
        return sorted[min(sorted.count - 1, Int(Double(sorted.count - 1) * p))]
    }
    static func main() {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let doc = ProjectDocument(format: .default)
        let c = EditorController(document: doc)
        let cg = CGContext(data: nil, width: 1600, height: 1200, bitsPerComponent: 8, bytesPerRow: 0,
                           space: HexColor.srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        cg.setFillColor(CGColor(srgbRed: 0.2, green: 0.6, blue: 0.8, alpha: 1))
        cg.fill(CGRect(x: 0, y: 0, width: 1600, height: 1200))
        let png = ImageDecoding.pngData(cg.makeImage()!)!
        let asset = MediaAsset(id: "photo", name: "photo", fileName: "photo.png", mime: "image/png", contentType: "public.png",
                               width: 1600, height: 1200, size: png.count, hash: "fixture", mediaKind: .image, duration: 0)
        doc.media.register(asset.id, wrapper: FileWrapper(regularFileWithContents: png))
        doc.perform("Fixture", undoManager: nil) { p in
            p.assets = [asset]
            p.slides[0].layers = (0..<6).map { i in
                var layer = Layer(id: "p\(i)", name: "Photo \(i)", x: Double(i % 2) * 430 + 40, y: Double(i / 2) * 390 + 40,
                                  width: 400, height: 300, content: .image(ImageProperties(assetID: asset.id)))
                layer.image?.mask = .rect
                layer.image?.cornerRadius = 36
                layer.image?.stroke = "#FFFFFF"
                layer.image?.strokeWidth = 4
                layer.shadow = Shadow(opacity: 0.5, blur: 20, offsetX: 8, offsetY: 12)
                return layer
            }
            if CommandLine.arguments.contains("--seam") {
                p.slides[0].layers[1].x = 300
                p.slides[0].layers[1].image?.seamBlend = SeamBlend(targetLayerID: "p0", edge: .left, width: 80)
            }
        }
        _ = doc.images.imageNow(for: asset, pixelEdge: 4096)
        c.selectLayer("p0")
        let w = NSWindow(contentRect: CGRect(x: 100, y: 100, width: 1280, height: 900),
                         styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        w.title = "Open-SCRL drag benchmark"
        let host = NSHostingView(rootView: EditorView(controller: c))
        w.contentView = host
        w.orderFrontRegardless()
        for _ in 0..<60 { host.layoutSubtreeIfNeeded(); RunLoop.main.run(until: Date().addingTimeInterval(0.01)) }
        let v = canvas(in: host)!
        print("PID \(ProcessInfo.processInfo.processIdentifier); canvas \(v.bounds.size); GPU \(GPUSceneRenderer.shared!.device.name)")
        fflush(stdout)
        func event(_ type: NSEvent.EventType, _ point: CGPoint) -> NSEvent {
            NSEvent.mouseEvent(with: type, location: v.convert(v.viewPoint(point), to: nil), modifierFlags: type == .leftMouseDragged ? [.command] : [],
                               timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: w.windowNumber,
                               context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
        }
        for resize in [false, true] {
            let layer = c.project.layer("p0")!
            let start = resize ? CGPoint(x: layer.frame.maxX, y: layer.frame.maxY) : layer.frame.center
            v.mouseDown(with: event(.leftMouseDown, start))
            if resize {
                guard case .resize = v.drag else { preconditionFailure("Benchmark must hit a resize handle") }
            } else {
                guard case .pending = v.drag else { preconditionFailure("Benchmark must begin a photo drag") }
            }
            var input: [Double] = [], display: [Double] = [], wall: [Double] = []
            let initialFrames = v.completedMetalFrameCount
            for i in 0..<180 {
                let time = CACurrentMediaTime()
                let delta = 35 * sin(Double(i) * 0.09)
                v.mouseDragged(with: event(.leftMouseDragged, CGPoint(x: start.x + delta, y: start.y + delta * 0.6)))
                let afterInput = CACurrentMediaTime()
                host.layoutSubtreeIfNeeded()
                w.displayIfNeeded()
                let afterDisplay = CACurrentMediaTime()
                RunLoop.main.run(until: Date().addingTimeInterval(0.008))
                if i >= 20 {
                    input.append((afterInput - time) * 1000)
                    display.append((afterDisplay - afterInput) * 1000)
                    wall.append((CACurrentMediaTime() - time) * 1000)
                }
            }
            let delta = 35 * sin(179.0 * 0.09)
            v.mouseUp(with: event(.leftMouseUp, CGPoint(x: start.x + delta, y: start.y + delta * 0.6)))
            let changed = c.project.layer("p0")!
            precondition(resize ? changed.frame.size != layer.frame.size : changed.frame.origin != layer.frame.origin,
                         "Benchmark must change the selected photo geometry")
            let renderedFrames = v.completedMetalFrameCount - initialFrames
            precondition(renderedFrames > 20, "Canvas must continue rendering throughout the gesture")
            print(String(format: "%@: input median %.2f / p95 %.2f ms; synchronous display median %.2f / p95 %.2f ms; loop median %.2f / p95 %.2f ms",
                         resize ? "Resize" : "Drag", percentile(input,0.5), percentile(input,0.95), percentile(display,0.5), percentile(display,0.95), percentile(wall,0.5), percentile(wall,0.95)))
            fflush(stdout)
            print("Completed GPU frames during gesture: \(renderedFrames)")
        }
        precondition(v.isPresentingMetal, "Benchmark must present through the GPU")
        v.teardown()
        w.orderOut(nil)
        w.contentView = nil
    }
}
