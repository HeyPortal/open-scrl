import AppKit
import CoreImage
import MetalKit

/// Presents the composition straight into a Metal drawable. Only a new editor state or
/// video frame schedules a draw; a stationary canvas never runs a rendering loop.
final class CanvasMetalSurface: MTKView, MTKViewDelegate {
    private let renderer: GPUSceneRenderer
    private var composition: CIImage?
    private var failedSize: CGSize?
    private var inFlightFrames = 0
    private var pendingFrame = false
    private(set) var hasPresented = false
    var onUnavailable: (() -> Void)?

    init(renderer: GPUSceneRenderer) {
        self.renderer = renderer
        super.init(frame: .zero, device: renderer.device)
        framebufferOnly = false
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColorMake(0, 0, 0, 0)
        autoResizeDrawable = false
        isPaused = true
        enableSetNeedsDisplay = true
        delegate = self
        wantsLayer = true
        layer?.isOpaque = false
        setAccessibilityElement(false)
        isHidden = true
    }

    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override var isOpaque: Bool { false }
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

    func update(_ image: CIImage) {
        let scale = pixelsPerPoint
        drawableSize = CGSize(width: max(1, (bounds.width * scale).rounded(.up)),
                              height: max(1, (bounds.height * scale).rounded(.up)))
        composition = image
        isHidden = false
        needsDisplay = true
    }

    func resetAvailability() { failedSize = nil }

    func clear() {
        composition = nil
        pendingFrame = false
        hasPresented = false
        isHidden = true
    }

    func draw(in view: MTKView) {
        guard let composition else { return }
        // Retain only the newest pending state if rendering is behind playback or dragging.
        // Never block the event thread waiting for a free drawable or queued GPU work.
        guard inFlightFrames < 2 else { pendingFrame = true; return }
        guard let drawable = currentDrawable, let commandBuffer = renderer.queue.makeCommandBuffer() else {
            failedSize = bounds.size
            clear()
            onUnavailable?()
            return
        }
        let rect = CGRect(origin: .zero, size: drawableSize)
        // Include clear pixels so a moved/removed layer never leaves the preceding frame.
        let image = composition.composited(over: CIImage(color: .clear).cropped(to: rect)).cropped(to: rect)
        let destination = CIRenderDestination(mtlTexture: drawable.texture, commandBuffer: commandBuffer)
        // Core Image's first logical row is the bottom of the image; a presented Metal
        // texture's first memory row is its top. Match the flipped AppKit canvas explicitly.
        destination.isFlipped = true
        destination.alphaMode = .premultiplied
        destination.colorSpace = HexColor.srgb
        do {
            _ = try renderer.context.startTask(toRender: image, from: rect, to: destination, at: .zero)
        } catch {
            failedSize = bounds.size
            clear()
            onUnavailable?()
            return
        }
        inFlightFrames += 1
        commandBuffer.addCompletedHandler { [weak self] buffer in
            let failed = buffer.status == .error
            DispatchQueue.main.async {
                guard let self else { return }
                self.inFlightFrames -= 1
                if failed {
                    self.failedSize = self.bounds.size
                    self.clear()
                    self.onUnavailable?()
                } else if self.pendingFrame {
                    self.hasPresented = self.composition != nil
                    self.pendingFrame = false
                    self.needsDisplay = true
                } else {
                    self.hasPresented = self.composition != nil
                }
            }
        }
        commandBuffer.present(drawable)
        commandBuffer.commit()
    }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}
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
