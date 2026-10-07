import AppKit
import CoreImage
import SwiftUI
import Observation
@testable import OpenSCRL

@main @MainActor struct CanvasRenderingChecks {
    static var checks = 0
    static func expect(_ value: Bool, _ message: String) {
        precondition(value, message)
        checks += 1
    }
    static func photo(_ id: String, x: Double, y: Double = 20, width: Double = 30, height: Double = 30) -> Layer {
        Layer(id: id, name: id, x: x, y: y, width: width, height: height,
              content: .image(ImageProperties(assetID: id)))
    }
    final class Sources: GPUImageProviding {
        var requests: [String: Int] = [:]
        let cgImage: CGImage
        let ciImage: CIImage
        init() {
            let cg = CGContext(data: nil, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 0,
                               space: HexColor.srgb, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            cg.setFillColor(CGColor(srgbRed: 0.2, green: 0.5, blue: 0.3, alpha: 1))
            cg.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
            cgImage = cg.makeImage()!
            ciImage = CIImage(cgImage: cgImage)
        }
        func image(for asset: MediaAsset, pixelEdge: CGFloat) -> CGImage? {
            requests[asset.id, default: 0] += 1
            return cgImage
        }
        func gpuImage(for asset: MediaAsset, pixelEdge: CGFloat) -> CIImage? {
            requests[asset.id, default: 0] += 1
            return ciImage
        }
    }

    static func visibility() {
        var project = Project(format: CanvasFormat(name: "Visibility", width: 100, height: 100))
        var shadow = photo("shadow", x: -60)
        shadow.shadow = Shadow(opacity: 0.7, blur: 5, offsetX: 45, offsetY: 0)
        let stroke = Layer(id: "stroke", name: "Stroke", x: 105, y: 40, width: 20, height: 20,
                           content: .shape(ShapeProperties(shape: .rect, stroke: "#000000", strokeWidth: 20)))
        let highlight = Layer(id: "highlight", name: "Highlight", x: 115, y: 60, width: 30, height: 20,
                              content: .text(TextProperties(text: "M", fontSize: 20, align: .left,
                                                            highlight: TextHighlight(padding: 30))))
        let glyph = Layer(id: "glyph", name: "Glyph", x: 50, y: -5, width: 20, height: 3,
                          content: .text(TextProperties(text: "M", fontSize: 60, align: .left, lineHeight: 0.2)))
        let partner = photo("partner", x: 300)
        var foreground = photo("foreground", x: 10)
        foreground.image?.seamBlend = SeamBlend(targetLayerID: partner.id)
        let above = photo("above", x: 400)
        project.slides[0].layers = [shadow, stroke, highlight, glyph, partner, foreground, above]
        project.slides += [Slide(id: "s2", background: .white, layers: []),
                           Slide(id: "s3", background: .white, layers: [photo("distant", x: 20)])]
        let viewport = CGRect(x: 0, y: 0, width: 100, height: 100)
        var options = RenderOptions(editor: true)
        let items = CanvasSceneVisibility.items(in: project, intersecting: viewport, options: options)
        let ids = items.map(\.layer.id)
        expect(ids.contains("shadow"), "Offscreen photo's visible shadow must survive culling")
        expect(ids.contains("stroke"), "Offscreen shape's visible stroke must survive culling")
        expect(ids.contains("highlight"), "Offscreen text's highlight must survive culling")
        expect(ids.contains("glyph"), "Glyphs outside a short text frame must survive culling")
        expect(ids.contains("partner"), "Offscreen lower seam partner must be retained")
        expect(!ids.contains("distant") && !ids.contains("above"), "Distant unrelated photos must be culled")
        expect(ids.firstIndex(of: "partner")! < ids.firstIndex(of: "foreground")!, "Seam partners retain paint order")
        options.hiddenLayerIDs = ["partner"]
        expect(!CanvasSceneVisibility.items(in: project, intersecting: viewport, options: options).contains { $0.layer.id == "partner" },
               "Hidden seam partners must remain hidden")
        options.hiddenLayerIDs = []
        var reverse = project
        reverse.slides[0].layers[5].image?.seamBlend?.targetLayerID = "above"
        expect(!CanvasSceneVisibility.items(in: reverse, intersecting: viewport, options: options).contains { $0.layer.id == "above" },
               "Seam does not pull in a partner above the foreground")
        var rotated = glyph
        rotated.rotation = 37
        let item = SceneItem(layer: rotated, slideIndex: 0, origin: rotated.frame.origin)
        let local = TextLayout.make(rotated.text!, width: rotated.width, height: rotated.height).glyphOutlines().boundingBoxOfPath
        let actual = [CGPoint(x: local.minX, y: local.minY), CGPoint(x: local.maxX, y: local.maxY)]
            .map { Geometry.parentPoint($0, in: item.globalFrame, degrees: rotated.rotation) }
        expect(actual.allSatisfy { CanvasSceneVisibility.visualBounds(item).contains($0) }, "Overflow rotates around the original layer center")

        project.assets = project.scene().compactMap { $0.layer.image?.assetID }.map {
            MediaAsset(id: $0, name: $0, fileName: "\($0).png", mime: "image/png", contentType: "public.png",
                       width: 8, height: 8, size: 0, hash: $0, mediaKind: .image, duration: 0)
        }
        let sources = Sources()
        let canvas = CanvasView(frame: viewport)
        let image = canvas.metalComposition(project, viewport: viewport, images: sources, options: options, scale: 1)
        expect(image != nil, "Culled canvas composition must build an actual GPU graph")
        expect(sources.requests["distant"] == nil && sources.requests["above"] == nil,
               "Canvas composition must never request decoded distant photos")
        expect(sources.requests["partner", default: 0] > 0 && sources.requests["foreground", default: 0] > 0,
               "Canvas composition must request both connected seam inputs")
        print("PASS canvas visual bounds and source culling")
    }

    static func findCanvas(_ view: NSView) -> CanvasView? {
        if let canvas = view as? CanvasView { return canvas }
        return view.subviews.lazy.compactMap(findCanvas).first
    }

    final class ObservationCount: @unchecked Sendable {
        private let lock = NSLock()
        private var count = 0
        func increment() { lock.withLock { count += 1 } }
        var value: Int { lock.withLock { count } }
    }

    static func canvasTransactions() throws {
        let document = ProjectDocument(format: .default)
        document.perform("Fixture", undoManager: nil) { $0.slides[0].layers = [photo("moving", x: 40)] }
        let controller = EditorController(document: document)
        controller.selectLayer("moving")
        let undo = UndoManager()
        undo.groupsByEvent = false
        controller.undoManager = undo
        let before = document.project
        let published = ObservationCount(), canvas = ObservationCount()
        withObservationTracking { _ = document.project } onChange: { published.increment() }
        withObservationTracking { _ = document.canvasRevision } onChange: { canvas.increment() }
        undo.beginUndoGrouping()
        controller.beginCanvasGesture()
        for x in 41...100 { controller.updateLayer("moving", "Move") { $0.x = Double(x) } }
        expect(document.project.layer("moving")!.x == 100, "Live document reads see the latest canvas geometry")
        expect(controller.project.layer("moving")!.x == 100, "Controller reads see the live gesture")
        expect(published.value == 0, "Mouse events do not invalidate the entire SwiftUI document UI")
        expect(canvas.value == 1, "Live changes invalidate canvas observation")
        let serialized = try ProjectFile.decode(ProjectFile(project: document.project).encoded()).makeProject()
        expect(serialized.layer("moving")!.x == 100, "Serializing during a gesture preserves the latest geometry")
        controller.endGesture("Move Layer")
        undo.endUndoGrouping()
        expect(published.value == 1 && document.project.layer("moving")!.x == 100, "Release publishes the final document once")
        let final = document.project
        undo.undo()
        expect(document.project == before && !undo.canUndo, "One Undo restores the complete gesture")
        undo.redo()
        expect(document.project == final, "Redo restores the final geometry")
        controller.beginCanvasGesture()
        controller.updateLayer("moving", "Resize") { $0.width = 500 }
        controller.cancelGesture()
        expect(document.project == final && !document.isInGesture, "Cancelling restores geometry and clears preview state")
        let ordinary = ObservationCount()
        withObservationTracking { _ = document.project } onChange: { ordinary.increment() }
        controller.beginGesture()
        controller.updateLayer("moving", "Slider") { $0.opacity = 0.5 }
        expect(ordinary.value == 1, "Sliders and text gestures retain live SwiftUI publication")
        controller.cancelGesture()
        expect(document.project == final, "Ordinary gesture cancellation still restores the project")
        print("PASS live canvas transaction publication, serialization, undo/redo and cancellation")
    }

    static func textLifecycle() {
        let document = ProjectDocument(format: .default)
        let controller = EditorController(document: document)
        let window = NSWindow(contentRect: CGRect(x: -1600, y: -1600, width: 1280, height: 900),
                              styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
        let host = NSHostingView(rootView: EditorView(controller: controller))
        window.contentView = host
        func settle() {
            for _ in 0..<35 {
                host.layoutSubtreeIfNeeded()
                RunLoop.main.run(until: Date().addingTimeInterval(0.01))
            }
        }
        settle()
        controller.addText()
        settle()
        let id = controller.selectedLayerID!
        controller.beginTextEditing(id)
        settle()
        let canvas = findCanvas(host)!
        expect(canvas.textEditor != nil, "Full SwiftUI editor host must create the native text editor")
        let editor = canvas.textEditor!
        expect(window.firstResponder === editor, "Canvas text editor must receive first responder")
        editor.string = "GPU canvas verified"
        editor.didChangeText()
        settle()
        expect(controller.project.layer(id)?.text?.text == "GPU canvas verified", "Native text edits update the document")
        canvas.finishTextEditing()
        settle()
        expect(canvas.textEditor == nil && controller.editingTextLayerID == nil, "Native text edit commits and removes the editor")
        controller.updateLayer(id, "Rotate fixture") { $0.rotation = 28 }
        controller.beginTextEditing(id)
        settle()
        let rotated = canvas.textEditor!
        let frame = rotated.frame
        rotated.needsLayout = false
        for _ in 0..<200 { canvas.layoutTextEditor() }
        expect(rotated.frame == frame && !rotated.needsLayout, "Unchanged rotated text geometry must not dirty the layout repeatedly")
        canvas.needsLayout = false
        canvas.setFrameSize(canvas.frame.size)
        expect(!canvas.needsLayout, "An unchanged canvas size must not schedule another layout")
        canvas.finishTextEditing()
        settle()
        expect(controller.project.layer(id)?.text?.text == "GPU canvas verified", "Repeated text lifecycle preserves committed content")
        canvas.teardown()
        window.contentView = nil
        print("PASS full SwiftUI-hosted native text lifecycle and idempotent layout")
    }

    static func main() throws {
        NSApplication.shared.setActivationPolicy(.prohibited)
        precondition(GPUSceneRenderer.shared != nil, "Tests require the app's real GPU renderer")
        visibility()
        try canvasTransactions()
        textLifecycle()
        print("PASS \(checks) canvas rendering assertions")
    }
}
