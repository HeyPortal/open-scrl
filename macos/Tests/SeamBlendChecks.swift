import AppKit
import AVFoundation
import QuartzCore
import UniformTypeIdentifiers
import Darwin
@testable import OpenSCRL

final class Fixtures: ImageProviding {
    var images: [String: CGImage] = [:]
    func image(for asset: MediaAsset, pixelEdge: CGFloat) -> CGImage? { images[asset.id] }
}

@main
@MainActor
struct SeamBlendChecks {
    static var checks = 0
    static func expect(_ condition: Bool, _ message: String) {
        precondition(condition, message)
        checks += 1
    }
    static func asset(_ id: String, width: Double = 96, height: Double = 96) -> MediaAsset {
        MediaAsset(id: id, name: id, fileName: "\(id).png", mime: "image/png", contentType: "public.png",
                   width: width, height: height, size: 0, hash: id, mediaKind: .image, duration: 0)
    }
    static func picture(_ width: Int, _ height: Int, _ color: (Int, Int) -> SIMD3<Double>) -> CGImage {
        var pixels = SeamRenderer.Pixels(width: width, height: height, draw: { _ in })!
        for y in 0..<height { for x in 0..<width {
            let value = color(x, y), i = (y * width + x) * 4
            for c in 0..<3 { pixels.bytes[i + c] = UInt8(clamp(Int(value[c] * 255), 0, 255)) }
            pixels.bytes[i + 3] = 255
        } }
        return pixels.image()!
    }
    static func layer(_ id: String, x: Double = 0, y: Double = 0, width: Double = 96, height: Double = 96) -> Layer {
        Layer(id: id, name: id, x: x, y: y, width: width, height: height, content: .image(ImageProperties(assetID: id)))
    }
    static func render(_ project: Project, _ fixtures: Fixtures, scale: Double = 1) -> SeamRenderer.Pixels {
        SeamRenderer.Pixels(width: Int(project.format.width * scale), height: Int(project.format.height * scale)) { cg in
            cg.scaleBy(x: scale, y: scale)
            Renderer.drawSlide(project, index: 0, cg: cg, images: fixtures)
        }!
    }
    static func main() async throws {
        setbuf(stdout, nil)
        let output = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "macos/build/seam-check-artifacts", isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let fixtures = Fixtures()
        checkGPU()
        fixtures.images["red"] = picture(96, 96) { _, _ in SIMD3(1, 0, 0) }
        fixtures.images["blue"] = picture(96, 96) { _, _ in SIMD3(0, 0, 1) }
        var project = Project(format: CanvasFormat(name: "Test", width: 144, height: 96))
        project.assets = [asset("red"), asset("blue")]
        let base = layer("red")
        var front = layer("blue", x: 48)
        front.image?.seamBlend = SeamBlend(targetLayerID: base.id, width: 24)
        project.slides[0].background = .solid("#00ff00")
        project.slides[0].layers = [base, front]
        let horizontal = render(project, fixtures)
        let start = horizontal.sample(52, 40), middle = horizontal.sample(72, 40), end = horizontal.sample(92, 40)
        expect(start.x > 245 && start.z < 10, "Seam starts with the background photo")
        expect(middle.x > 80 && middle.z > 80 && middle.y < 3, "Center mixes the photos without exposing the canvas")
        expect(end.z > 245 && end.x < 10, "Seam ends with the foreground photo")
        expect(horizontal.sample(130, 40).z == 255, "Pixels away from the seam stay unchanged")
        let scene = SlideScene(project: project, index: 0)
        let thumbnail = SeamRenderer.Pixels(width: 144, height: 96) {
            Renderer.drawScene(scene.items, cg: $0, assets: scene.assets, images: fixtures, options: RenderOptions())
        }!
        expect(thumbnail.sample(72, 40) == middle, "Filmstrip scenes use the same seam as full-slide exports")
        let retina = render(project, fixtures, scale: 2).sample(144, 80)
        expect(abs(retina.x - middle.x) < 12 && abs(retina.z - middle.z) < 12, "Seam uses project coordinates at 2x export scale")
        for edge in SeamEdge.allCases {
            var p = Project(format: CanvasFormat(name: "Edge", width: 144, height: 144))
            p.assets = project.assets; p.slides[0].background = .solid("#00ff00")
            let target = layer("red", x: edge == .right ? 48 : 0, y: edge == .bottom ? 48 : 0)
            var foreground = layer("blue", x: edge == .left ? 48 : 0, y: edge == .top ? 48 : 0)
            foreground.image?.seamBlend = SeamBlend(targetLayerID: target.id, edge: edge, width: 24)
            p.slides[0].layers = [target, foreground]
            let pixels = render(p, fixtures)
            let value = pixels.sample(edge.isHorizontal ? 72 : 40, edge.isHorizontal ? 40 : 72)
            expect(value.x > 80 && value.z > 80 && value.y < 3, "All four seam directions blend without a gap")
        }
        var hidden = project
        hidden.slides[0].layers[0].visible = false
        expect(render(hidden, fixtures).sample(52, 40).z == 255, "Hiding a partner restores the intact foreground")
        hidden.slides[0].layers.removeFirst()
        expect(render(hidden, fixtures).sample(52, 40).z == 255, "An orphaned seam never makes holes")
        var rounded = project
        rounded.slides[0].layers[0].image?.cornerRadius = 35
        expect(render(rounded, fixtures).sample(73, 1).z > 240, "Partner corner coverage leaves uncovered foreground pixels intact")
        var rotated = project
        rotated.slides[0].layers[0].rotation = 20
        expect(render(rotated, fixtures).sample(72, 40).y < 5, "Rotated partner coverage stays aligned with the blend")
        var narrow = project
        narrow.slides[0].layers[1].x = 95.5
        expect(render(narrow, fixtures).sample(100, 40).z == 255, "Subpixel overlaps safely fall back to the original image")
        var masked = project
        masked.slides[0].layers[0].image?.mask = .ellipse
        expect(render(masked, fixtures).sample(80, 1).z > 240, "The new photo masks preserve uncovered foreground pixels")
        var transparent = SeamRenderer.Pixels(width: 96, height: 96, draw: { _ in })!
        for y in 0..<96 { for x in 80..<96 {
            let i = (y * 96 + x) * 4
            transparent.bytes[i] = 255; transparent.bytes[i + 3] = 255
        } }
        fixtures.images["transparent"] = transparent.image()!
        var cutout = project
        cutout.assets.append(asset("transparent"))
        cutout.slides[0].layers[0].image?.assetID = "transparent"
        expect(render(cutout, fixtures).sample(52, 40).z == 255, "Transparent source pixels never punch holes in the foreground")
        var shiftedCorner = Project(format: CanvasFormat(name: "Corner", width: 96, height: 96))
        shiftedCorner.assets = project.assets
        var cornerFront = layer("blue")
        cornerFront.image?.cornerRadius = 35
        cornerFront.image?.seamBlend = SeamBlend(targetLayerID: "red", width: 32, offsetX: 48, offsetY: 48, followsDetail: false)
        shiftedCorner.slides[0].layers = [base, cornerFront]
        expect(render(shiftedCorner, fixtures).sample(48, 48).z > 100, "Alignment into a transparent corner keeps the original detail")
        print("PASS: geometry, all directions, opacity coverage, missing partners, rotation, and 2x exports")

        func pattern(_ x: Int, _ y: Int) -> SIMD3<Double> {
            let v = 0.45 + sin(Double(x) * 0.23) * 0.15 + cos(Double(y) * 0.19) * 0.12 + sin(Double(x + y) * 0.13) * 0.1
            return SIMD3(v * 0.82, v * 0.9, v)
        }
        fixtures.images["reference"] = picture(96, 96, pattern)
        fixtures.images["shifted"] = picture(96, 96) { x, y in pattern(x - 6, y + 4) }
        let reference = layer("reference"), shifted = layer("shifted")
        let matchAssets = Dictionary(uniqueKeysWithValues: [asset("reference"), asset("shifted")].map { ($0.id, $0) })
        let match = SeamRenderer.analyze(foreground: SceneItem(layer: shifted, slideIndex: 0, origin: .zero),
                                         target: SceneItem(layer: reference, slideIndex: 0, origin: .zero), edge: .left, images: fixtures, assets: matchAssets)!
        expect(match.alignmentFound, "Shared details are detected")
        expect(abs(match.shiftX + 6) <= 1 && abs(match.shiftY - 4) <= 1, "Registration translation has the correct direction")
        expect(!match.path.isEmpty && match.path.allSatisfy { (0...1).contains($0) }, "Content-aware seam produces a valid path")
        fixtures.images["bright"] = picture(96, 96) { x, y in pattern(x, y) * 1.15 + SIMD3(repeating: 0.06) }
        let bright = layer("bright")
        var colors = matchAssets; colors["bright"] = asset("bright")
        let colorMatch = SeamRenderer.analyze(foreground: SceneItem(layer: bright, slideIndex: 0, origin: .zero),
                                              target: SceneItem(layer: reference, slideIndex: 0, origin: .zero), edge: .left, images: fixtures, assets: colors)!
        expect(colorMatch.bias.contains { $0 < -0.01 }, "Local analysis detects exposure differences")
        var colorProject = Project(format: CanvasFormat(name: "Color", width: 96, height: 96))
        colorProject.assets = Array(colors.values)
        var corrected = bright
        corrected.image?.seamBlend = SeamBlend(targetLayerID: reference.id, width: 32, followsDetail: false, analysis: colorMatch)
        colorProject.slides[0].layers = [reference, corrected]
        let matched = render(colorProject, fixtures).sample(48, 48)
        colorProject.slides[0].layers[1].image?.seamBlend?.colorMatch = 0
        let unmatched = render(colorProject, fixtures).sample(48, 48)
        let expected = pattern(48, 48) * 255
        let matchedError = abs(matched.x - expected.x) + abs(matched.y - expected.y) + abs(matched.z - expected.z)
        let unmatchedError = abs(unmatched.x - expected.x) + abs(unmatched.y - expected.y) + abs(unmatched.z - expected.z)
        print("Color match error: \(matchedError.rounded()) vs \(unmatchedError.rounded()) without matching")
        expect(matchedError < unmatchedError * 0.7, "Color matching reduces the visible seam error")
        let originalFar = render(colorProject, fixtures).sample(90, 48)
        colorProject.slides[0].layers[1].image?.seamBlend?.colorMatch = 1
        expect(render(colorProject, fixtures).sample(90, 48) == originalFar, "Color correction leaves pixels away from the seam intact")
        var moved = bright; moved.x = 1
        expect(!colorMatch.matches(moved, reference, edge: .left), "Changing geometry invalidates old matching data")
        print("PASS: automatic alignment direction, content-aware path, localized color matching, and invalidation")

        let document = ProjectDocument(format: project.format)
        document.perform("Fixture", undoManager: nil) { $0 = project; $0.slides[0].layers[1].image?.seamBlend = nil; $0.slides[0].layers[1].x = 96 }
        for photo in project.assets { document.media.register(photo.id, wrapper: FileWrapper(regularFileWithContents: ImageDecoding.pngData(fixtures.images[photo.id]!)!)) }
        let controller = EditorController(document: document)
        controller.selectLayer("blue")
        let undo = UndoManager(); undo.groupsByEvent = false; controller.undoManager = undo
        let before = document.project
        undo.beginUndoGrouping(); controller.startSeamBlend("blue", with: "red"); undo.endUndoGrouping()
        controller.seamAnalysisTask?.cancel(); controller.analyzingSeamLayerID = nil
        let blended = document.project
        expect(blended.slides[0].layers[1].x < 96, "Touching images get an overlap automatically")
        expect(blended.slides[0].layers[1].width == 96 && blended.slides[0].layers[1].height == 96, "Overlap preserves the original aspect ratio")
        undo.undo(); expect(document.project == before, "Undo restores placement and removes the effect")
        undo.redo(); expect(document.project == blended, "Redo restores the complete effect")
        let data = try ProjectFile(project: blended).encoded()
        let decoded = try ProjectFile.decode(data).makeProject()
        expect(decoded.hasSameContent(as: blended) && decoded.id == blended.id, "Project serialization preserves the seam")
        expect(abs(decoded.createdAt.timeIntervalSince(blended.createdAt)) < 0.001 && abs(decoded.updatedAt.timeIntervalSince(blended.updatedAt)) < 0.001, "Millisecond project timestamps survive serialization")
        var legacy = blended; legacy.slides[0].layers[1].image?.seamBlend = nil
        expect(try ProjectFile.decode(ProjectFile(project: legacy).encoded()).makeProject().hasSameContent(as: legacy), "Old projects without seam settings still open")
        undo.beginUndoGrouping(); controller.duplicateSlide(blended.slides[0].id); undo.endUndoGrouping()
        let copied = document.project.slides[1]
        expect(copied.layers[1].image?.seamBlend?.targetLayerID == copied.layers[0].id, "Duplicating a slide remaps its seam partner")
        controller.selectLayer("blue")
        undo.beginUndoGrouping(); controller.deleteLayer("red"); undo.endUndoGrouping()
        expect(document.project.layer("blue")?.image?.seamBlend == nil, "Deleting a partner removes the dangling effect")
        undo.undo(); expect(document.project.layer("blue")?.image?.seamBlend != nil, "Undoing deletion restores the linked effect")
        let copiedPair = Layer.freshCopies(blended.slides[0].layers)
        expect(copiedPair[1].image?.seamBlend?.targetLayerID == copiedPair[0].id, "Clipboard pairs remap their seam to the copied partner")
        expect(Layer.freshCopies([blended.slides[0].layers[1]])[0].image?.seamBlend == nil, "Copying a lone layer drops an absent partner")
        var duplicatePair = blended.slides[0]
        let duplicates = duplicatePair.duplicateLayers(duplicatePair.layers.map(\.id))
        expect(duplicatePair.layers.first(where: { $0.id == duplicates["blue"] })?.image?.seamBlend?.targetLayerID == duplicates["red"], "Multi-selection duplicates remap their seam")
        var scaledPair = Layer.scaled(blended.slides[0].layers[1], from: CGRect(x: 0, y: 0, width: 144, height: 96), to: CGRect(x: 0, y: 0, width: 288, height: 192))
        expect(scaledPair.image!.seamBlend!.width == blended.slides[0].layers[1].image!.seamBlend!.width * 2, "Group resizing scales the seam width")
        scaledPair.image?.mask = .ellipse
        expect(SeamSource(scaledPair).mask == .ellipse, "Matching snapshots include the new mask geometry")
        controller.selectLayer("blue")
        undo.beginUndoGrouping(); controller.useAsset(asset("reference")); undo.endUndoGrouping()
        expect(controller.selectedLayer?.image?.seamBlend == nil && controller.selectedLayer?.image?.cropScale == 1, "Selecting a new photo resets seam and crop settings")
        print("PASS: auto overlap, aspect ratio, undo/redo, project compatibility, copied slides, and deletion")

        let pairDocument = ProjectDocument(format: project.format)
        pairDocument.perform("Pair fixture", undoManager: nil) { p in
            p = project
            p.slides[0].layers[1].image?.seamBlend = nil
            p.slides[0].layers.insert(layer("reference", x: 47), at: 0)
        }
        let pairController = EditorController(document: pairDocument)
        pairController.selectLayers(["red", "blue"], primary: "blue")
        expect(pairController.canBlendSelectedSeam, "A two-photo selection exposes the blend action")
        pairController.blendSelectedSeam()
        pairController.seamAnalysisTask?.cancel()
        expect(pairDocument.project.layer("blue")?.image?.seamBlend?.targetLayerID == "red", "Blending two selected photos uses their selected partner, even with a closer third photo")
        pairController.selectLayers(["red", "blue", "reference"])
        expect(!pairController.canBlendSelectedSeam, "Ambiguous three-layer selections cannot silently blend an arbitrary pair")

        let matchDocument = ProjectDocument(format: colorProject.format)
        matchDocument.perform("Matched fixture", undoManager: nil) { p in
            p = colorProject; p.slides[0].layers[1].image?.seamBlend = nil
        }
        for photo in colorProject.assets {
            if let image = fixtures.images[photo.id] { matchDocument.media.register(photo.id, wrapper: FileWrapper(regularFileWithContents: ImageDecoding.pngData(image)!)) }
        }
        let matchController = EditorController(document: matchDocument)
        let matchUndo = UndoManager(); matchUndo.groupsByEvent = false; matchController.undoManager = matchUndo
        let matchBefore = matchDocument.project
        matchUndo.beginUndoGrouping(); matchController.startSeamBlend("bright", with: "reference"); matchUndo.endUndoGrouping()
        await matchController.seamAnalysisTask?.value
        expect(matchDocument.project.layer("bright")?.image?.seamBlend?.analysis != nil, "Automatic matching finishes with stored analysis")
        matchUndo.undo()
        expect(matchDocument.project.hasSameContent(as: matchBefore) && !matchUndo.canUndo, "Creation and automatic matching undo together in one step")
        matchUndo.redo()
        expect(matchDocument.project.layer("bright")?.image?.seamBlend?.analysis != nil, "Redo restores the completed analysis")
        print("PASS: PR 15 masks, selection, group resizing, clipboard links, and automatic matching undo")

        let firstURL = output.appending(path: "first.mp4"), secondURL = output.appending(path: "second.mp4")
        try await makeVideo(firstURL, channel: 0); try await makeVideo(secondURL, channel: 2)
        let videoDocument = ProjectDocument(format: CanvasFormat(name: "Video", width: 96, height: 64))
        let videoController = EditorController(document: videoDocument)
        await videoController.importMediaNow([firstURL, secondURL], placement: .libraryOnly)
        expect(videoDocument.project.assets.count == 2, "Both generated video fixtures import")
        let videoAssets = videoDocument.project.assets
        videoDocument.perform("Video setup", undoManager: nil) { p in
            var a = layer(videoAssets[0].id, width: 64, height: 64)
            a.name = "First video"
            var b = layer(videoAssets[1].id, x: 32, width: 64, height: 64)
            b.name = "Second video"; b.image?.seamBlend = SeamBlend(targetLayerID: a.id, width: 20)
            p.slides[0].layers = [a, b]
        }
        let videoOutput = output.appending(path: "blended.mp4")
        try await VideoSlideRenderer.render(project: videoDocument.project, slide: 0, media: videoDocument.media, scale: 1, fps: 10, to: videoOutput) { _ in }
        var samples: [SIMD4<Double>] = []
        for time in [0.2, 0.6] {
            let image = await ImageDecoding.videoFrame(url: videoOutput, at: time, maxPixel: nil)!
            let pixels = SeamRenderer.Pixels(width: 96, height: 64) { Renderer.drawImageFlipped(image, in: CGRect(x: 0, y: 0, width: 96, height: 64), cg: $0) }!
            let value = pixels.sample(48, 32)
            let left = pixels.sample(8, 32), right = pixels.sample(88, 32)
            // H.264 color conversion and chroma subsampling introduce small cross-channel values.
            expect(value.x > 30 && value.z > 30 && value.y < min(value.x, value.z) * 0.3, "MP4 frames blend both videos at the seam")
            expect(abs(value.x - (left.x + right.x) / 2) < 16 && abs(value.z - (left.z + right.z) / 2) < 16, "The MP4 seam matches the two decoded source regions")
            expect(left.z < max(12, left.x * 0.12) && right.x < max(12, right.z * 0.12), "Video pixels outside the seam remain separate")
            samples.append(value)
        }
        expect(abs(samples[0].x - samples[1].x) > 15 && abs(samples[0].z - samples[1].z) > 15, "Both exported clips advance, rather than freezing a poster")
        videoController.selectLayer(videoDocument.project.slides[0].layers[1].id)
        let canvas = CanvasView(frame: CGRect(x: 0, y: 0, width: 400, height: 300))
        canvas.controller = videoController
        let priorDomain = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
        var testDomain = priorDomain
        testDomain[Preferences.Key.playAnimatedMedia] = true
        UserDefaults.standard.setVolatileDomain(testDomain, forName: UserDefaults.argumentDomain)
        defer { UserDefaults.standard.setVolatileDomain(priorDomain, forName: UserDefaults.argumentDomain) }
        canvas.syncPlayback()
        expect(canvas.playbacks.count == 2, "Linked video layers both play in the live canvas")
        var frameCounts: [Int] = []
        for _ in 0..<20 {
            try await Task.sleep(for: .milliseconds(100))
            frameCounts = canvas.playbacks.values.map { $0.currentFrame() == nil ? 0 : 1 }
            if frameCounts.reduce(0, +) == 2 { break }
        }
        expect(frameCounts.reduce(0, +) == 2, "Both preview players deliver live frames")
        canvas.teardown(); expect(canvas.playbacks.isEmpty, "Closing the canvas releases the players")
        print("PASS: real two-video MP4 export, advancing frames, and linked live playback")

        // A real project for checking the native inspector without touching user documents.
        let demo = ProjectDocument(format: CanvasFormat(name: "Seam Demo", width: 640, height: 400))
        let demoController = EditorController(document: demo)
        for (id, warm) in [("Cool landscape", false), ("Warm landscape", true)] {
            let image = picture(400, 320) { x, y in
                let horizon = 165 + Int(sin(Double(x) / 43) * 24) + (warm ? 9 : 0)
                let sky = Double(y) / 320
                if y < horizon { return warm ? SIMD3(0.76 - sky * 0.2, 0.61 - sky * 0.16, 0.45) : SIMD3(0.37, 0.57 - sky * 0.08, 0.73 - sky * 0.1) }
                let texture = sin(Double(x + y) * 0.12) * 0.025
                return warm ? SIMD3(0.31 + texture, 0.39 + texture, 0.18 + texture) : SIMD3(0.15 + texture, 0.32 + texture, 0.31 + texture)
            }
            let photo = asset(id, width: 400, height: 320)
            demo.media.register(id, wrapper: FileWrapper(regularFileWithContents: ImageDecoding.pngData(image)!))
            demo.perform("Demo", undoManager: nil) { p in
                p.assets.append(photo)
                p.slides[0].layers.append(layer(id, x: warm ? 260 : 20, y: 40, width: 360, height: 288))
            }
        }
        demoController.selectLayer("Warm landscape")
        demoController.startSeamBlend("Warm landscape", with: "Cool landscape")
        await demoController.seamAnalysisTask?.value
        let snapshot = try await demo.snapshot(contentType: .openSCRLProject)
        let wrapper = try ProjectDocument.makeFileWrapper(snapshot, previous: nil)
        let demoURL = output.appending(path: "Seam Demo.openscrl")
        try wrapper.write(to: demoURL, options: .atomic, originalContentsURL: nil)
        let source = ExportImageSource(media: demo.media)
        let image = CarouselExporter.renderStill(demo.project, slide: 0, images: source, scale: 1)!
        try ImageDecoding.pngData(image)!.write(to: output.appending(path: "photo-seam.png"))
        print("PASS: \(checks) assertions. Native QA project: \(demoURL.path)")
    }

    static func checkGPU() {
        guard let gpu = SeamGPU.shared else { fatalError("Metal seam kernel was not loaded") }
        print("GPU checks on \(gpu.deviceName)")
        let image = picture(96, 96) { x, y in SIMD3(Double((x * 3 + y * 7) % 220) / 255,
                                                  Double((x * 11 + y * 3) % 200) / 255, 0.7) }
        for edge in SeamEdge.allCases { for scale in [1.0, 2.0] {
            var base = layer("base", x: edge == .right ? 48 : 0, y: edge == .bottom ? 48 : 0)
            base.rotation = 7
            base.opacity = 0.7
            base.image?.mask = .ellipse
            var front = layer("front", x: edge == .left ? 48 : 0, y: edge == .top ? 48 : 0)
            front.image?.cornerRadius = 8
            let a = asset("front"), b = asset("base"), assets = [a.id: a, b.id: b]
            let foreground = SceneItem(layer: front, slideIndex: 0, origin: front.frame.origin)
            let target = SceneItem(layer: base, slideIndex: 0, origin: base.frame.origin)
            let analysis = SeamAnalysis(foreground: SeamSource(front), background: SeamSource(base), edge: edge,
                                        gain: [0.8, 1.2, 0.9], bias: [0.03, -0.01, 0.02], shiftX: 3, shiftY: -2,
                                        alignmentFound: true, path: (0..<24).map { 0.5 + sin(Double($0) / 5) * 0.12 })
            let blend = SeamBlend(targetLayerID: base.id, edge: edge, width: 24, position: 0.6,
                                  colorMatch: 0.65, alignment: 0.75, offsetX: 1, offsetY: -1, analysis: analysis)
            let cpu = SeamRenderer.imageCPU(image, asset: a, foreground: foreground, target: target, blend: blend,
                                            pixelScale: scale, assets: assets, targetImage: image)!
            let accelerated = gpu.image(image, asset: a, foreground: foreground, target: target, blend: blend,
                                        pixelScale: scale, assets: assets, targetImage: image)!
            func bytes(_ image: CGImage) -> [UInt8] {
                SeamRenderer.Pixels(width: image.width, height: image.height) {
                    Renderer.drawImageFlipped(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height), cg: $0)
                }!.bytes
            }
            let reference = bytes(cpu), actual = bytes(accelerated)
            let differences = zip(reference, actual).map { abs(Int($0) - Int($1)) }
            let maxError = differences.max()!
            let meanError = Double(differences.reduce(0, +)) / Double(differences.count)
            print("GPU vs CPU \(edge) \(scale)x: max \(maxError), mean \(meanError)")
            // Float path/weight quantization and hardware interpolation differ at a few
            // high-contrast edge pixels. Mean error stays below 0.1 of an 8-bit step.
            expect(maxError <= 5 && meanError < 0.1, "GPU matches CPU alignment, detail path, rotated mask, and linear color correction")
        } }
    }

    static func makeVideo(_ url: URL, channel: Int) async throws {
        try? FileManager.default.removeItem(at: url)
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 64, AVVideoHeightKey: 64])
        let receiver = writer.inputPixelBufferReceiver(for: input, pixelBufferAttributes: CVPixelBufferCreationAttributes(
            pixelFormatType: CVPixelFormatType(rawValue: kCVPixelFormatType_32BGRA), size: CVImageSize(width: 64, height: 64), compatibility: [.cgImage, .cgBitmapContext]))
        try writer.start(); writer.startSession(atSourceTime: .zero)
        for frame in 0..<10 {
            let buffer = try receiver.pixelBufferPool!.makeMutablePixelBuffer()
            buffer.withUnsafeBuffer { pixels in
                CVPixelBufferLockBaseAddress(pixels, [])
                defer { CVPixelBufferUnlockBaseAddress(pixels, []) }
                let cg = CGContext(data: CVPixelBufferGetBaseAddress(pixels), width: 64, height: 64, bitsPerComponent: 8,
                                   bytesPerRow: CVPixelBufferGetBytesPerRow(pixels), space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                   bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
                let brightness = 0.3 + Double(frame) * 0.065
                cg.setFillColor(CGColor(srgbRed: channel == 0 ? brightness : 0, green: 0, blue: channel == 2 ? brightness : 0, alpha: 1))
                cg.fill(CGRect(x: 0, y: 0, width: 64, height: 64))
            }
            try await receiver.append(CVReadOnlyPixelBuffer(buffer), with: CMTime(value: CMTimeValue(frame), timescale: 10))
        }
        receiver.finish(); await writer.finishWriting()
        if writer.status == .failed { throw writer.error! }
    }
}
