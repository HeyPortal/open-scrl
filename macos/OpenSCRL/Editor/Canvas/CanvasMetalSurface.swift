import AppKit
import CoreImage
import MetalKit

/// Presents the composition straight into a Metal drawable. Only a new editor state or
/// video frame schedules a draw; a stationary canvas never runs a rendering loop.
///
/// Frames are presented in the Core Animation transaction that redraws the selection
/// chrome, so the photos, the workspace around them and the handles above them always
/// appear together. Asynchronous presentation let the chrome and the uncovered workspace
/// run ahead of a frame still on the GPU, which made photos wobble during scrolling.
final class CanvasMetalSurface: MTKView {
    private let renderer: GPUSceneRenderer
    private var failedSize: CGSize?
    private var inFlightFrames = 0
    private var pendingFrame = false
    private(set) var hasPresented = false
    private(set) var completedFrameCount = 0
    var onUnavailable: (() -> Void)?
    /// A frame was skipped while the GPU was busy; the newest state should be drawn now.
    var onReady: (() -> Void)?

    init(renderer: GPUSceneRenderer) {
        self.renderer = renderer
        super.init(frame: .zero, device: renderer.device)
        framebufferOnly = false
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColorMake(0, 0, 0, 0)
        autoResizeDrawable = false
        // Drawing is explicit: `present` renders, and MTKView never draws on its own.
        isPaused = true
        enableSetNeedsDisplay = false
        presentsWithTransaction = true
        wantsLayer = true
        // Each frame paints the workspace as well as the deck.
        layer?.isOpaque = true
        setAccessibilityElement(false)
        isHidden = true
    }

    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var isOpaque: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    /// Bounds the visible render target, rather than allocating the entire zoomed deck.
    /// Selection handles and text editing still draw at the display's native scale.
    var pixelsPerPoint: CGFloat {
        let backing = window?.backingScaleFactor ?? 1
        let longest = max(1, max(bounds.width, bounds.height))
        let area = max(1, bounds.width * bounds.height)
        return min(backing, 4096 / longest, sqrt(16_777_216 / area))
    }

    var canPresent: Bool {
        window?.isVisible == true && bounds.width > 0 && bounds.height > 0 && failedSize != bounds.size
    }

    /// Renders `composition` into the current Core Animation transaction. Returns false when
    /// earlier frames still occupy the GPU: the caller keeps showing the previous frame and
    /// its chrome, and `onReady` asks for the newest state once a frame completes. Never
    /// blocks the event thread waiting for queued GPU work.
    @discardableResult
    func present(_ composition: CIImage) -> Bool {
        guard inFlightFrames < 2 else { pendingFrame = true; return false }
        let scale = pixelsPerPoint
        let size = CGSize(width: max(1, (bounds.width * scale).rounded(.up)),
                          height: max(1, (bounds.height * scale).rounded(.up)))
        // Drawables come straight from the layer, rather than through MTKView's draw cycle,
        // so size the layer itself: AppKit resets it to its 1x bounds on layout.
        guard let metalLayer = layer as? CAMetalLayer else { fail(); return false }
        if metalLayer.contentsScale != scale { metalLayer.contentsScale = scale }
        if metalLayer.drawableSize != size { metalLayer.drawableSize = size }
        guard let drawable = metalLayer.nextDrawable(), let commandBuffer = renderer.canvasQueue.makeCommandBuffer() else {
            fail()
            return false
        }
        let rect = CGRect(origin: .zero, size: size)
        let destination = CIRenderDestination(mtlTexture: drawable.texture, commandBuffer: commandBuffer)
        // Core Image's first logical row is the bottom of the image; a presented Metal
        // texture's first memory row is its top. Match the flipped AppKit canvas explicitly.
        destination.isFlipped = true
        destination.alphaMode = .premultiplied
        destination.colorSpace = HexColor.srgb
        do {
            // Include clear pixels so a moved/removed layer never leaves the preceding frame.
            let image = composition.composited(over: CIImage(color: .clear).cropped(to: rect)).cropped(to: rect)
            _ = try renderer.canvasContext.startTask(toRender: image, from: rect, to: destination, at: .zero)
        } catch {
            fail()
            return false
        }
        inFlightFrames += 1
        commandBuffer.addCompletedHandler { [weak self] buffer in
            let failed = buffer.status == .error
            DispatchQueue.main.async {
                guard let self else { return }
                self.inFlightFrames -= 1
                if failed {
                    self.fail()
                    return
                }
                self.completedFrameCount += 1
                self.hasPresented = !self.isHidden
                if self.pendingFrame {
                    self.pendingFrame = false
                    self.onReady?()
                }
            }
        }
        commandBuffer.commit()
        // A transaction-synchronized drawable is presented after its work is scheduled.
        commandBuffer.waitUntilScheduled()
        drawable.present()
        isHidden = false
        return true
    }

    func resetAvailability() { failedSize = nil }

    func clear() {
        pendingFrame = false
        hasPresented = false
        isHidden = true
    }

    private func fail() {
        failedSize = bounds.size
        clear()
        onUnavailable?()
    }
}

/// AppKit draws the lightweight editing affordances above the GPU content. Returning no
/// hit keeps every existing canvas gesture, drop target and first responder on CanvasView.
final class CanvasChromeOverlay: NSView {
    var drawChrome: ((CGContext) -> Void)?
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.isOpaque = false
        layerContentsRedrawPolicy = .onSetNeedsDisplay
        setAccessibilityElement(false)
        isHidden = true
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var isFlipped: Bool { true }
    override var isOpaque: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    override func draw(_ dirtyRect: NSRect) {
        guard let cg = NSGraphicsContext.current?.cgContext else { return }
        cg.clear(dirtyRect)
        drawChrome?(cg)
    }
}
