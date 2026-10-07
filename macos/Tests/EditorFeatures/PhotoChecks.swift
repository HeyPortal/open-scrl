import AppKit

@MainActor
func runPhotoChecks() -> Int {
    var checks = 0
    func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else { fatalError("FAIL: photo frames: \(name)") }
        checks += 1
    }
    func photo(_ id: String, _ assetID: String?, locked: Bool = true) -> Layer {
        var layer = Layer(id: id, name: id, x: 12, y: 28, width: 160, height: 90,
                          rotation: 15, locked: locked, content: .image(ImageProperties(assetID: assetID)))
        layer.image?.cropOffsetX = 19; layer.image?.cropOffsetY = -7; layer.image?.cropScale = 2
        layer.image?.cornerRadius = 11; layer.image?.mask = .arch
        layer.image?.stroke = "#f00"; layer.image?.strokeWidth = 3
        return layer
    }
    func asset(_ id: String) -> MediaAsset {
        MediaAsset(id: id, name: id, fileName: "\(id).png", mime: "image/png", contentType: "public.png",
                   width: 500, height: 1000, size: 1, hash: id, mediaKind: .image, duration: 0)
    }
    func assigned(_ frame: Layer, _ assetID: String?) -> Layer {
        var result = frame
        result.image?.assetID = assetID
        result.image?.cropOffsetX = 0; result.image?.cropOffsetY = 0; result.image?.cropScale = 1
        result.image?.seamBlend = nil
        return result
    }
    func fixture(_ layers: [Layer], other: [Layer] = []) -> (EditorController, UndoManager) {
        let document = ProjectDocument(format: .default)
        document.perform("Fixture", undoManager: nil) { p in
            p.slides = [Slide(id: "photos", background: .white, layers: layers)]
            if !other.isEmpty { p.slides.append(Slide(id: "other", background: .white, layers: other)) }
            p.assets = [asset("one"), asset("two"), asset("new"), asset("extra")]
        }
        let controller = EditorController(document: document)
        let undo = UndoManager(); undo.groupsByEvent = false; controller.undoManager = undo
        return (controller, undo)
    }
    func action(_ undo: UndoManager, _ body: () -> Void) {
        undo.beginUndoGrouping(); body(); undo.endUndoGrouping()
    }
    func reversible(_ controller: EditorController, _ undo: UndoManager, _ before: Project) {
        let after = controller.project
        undo.undo(); check(controller.project.hasSameContent(as: before), "undo restores all frame content")
        check(!undo.canUndo, "one action is one undo step")
        undo.redo(); check(controller.project.hasSameContent(as: after), "redo restores the result")
    }

    let original = photo("frame", "one")
    let (replace, replaceUndo) = fixture([original])
    let beforeReplace = replace.project
    action(replaceUndo) { replace.assign(asset("new"), to: "frame") }
    check(replace.project.layer("frame") == assigned(original, "new"), "replacement preserves frame, lock and styling")
    reversible(replace, replaceUndo, beforeReplace)
    action(replaceUndo) { replace.assign(asset("two"), to: "frame") }
    replaceUndo.undo(); check(replace.project.layer("frame")?.image?.assetID == "new", "rapid replacements undo separately")

    let empty = photo("empty", nil, locked: false)
    var hidden = photo("hidden", nil); hidden.visible = false
    let occupied = photo("occupied", "two")
    let (fill, fillUndo) = fixture([empty, hidden, occupied, original], other: [photo("elsewhere", nil)])
    fill.selectSlide("other")
    let beforeFill = fill.project
    action(fillUndo) { check(fill.assignPhotos([asset("new"), asset("extra"), asset("one")], to: "frame") == 2, "batch reports capacity") }
    check(fill.project.layer("frame") == assigned(original, "new"), "batch replaces target")
    check(fill.project.layer("empty") == assigned(empty, "extra"), "batch fills frames in stored order")
    check(fill.project.layer("hidden") == hidden && fill.project.layer("occupied") == occupied, "batch skips hidden and occupied frames")
    check(fill.project.layer("elsewhere") == beforeFill.layer("elsewhere"), "batch stays on owning slide")
    check(fill.project.slides[0].layers.count == 4, "batch never stacks leftovers")
    reversible(fill, fillUndo, beforeFill)

    let a = photo("a", "one"), b = photo("b", "two", locked: false)
    let (swap, swapUndo) = fixture([a, b])
    let beforeSwap = swap.project
    action(swapUndo) { check(swap.swapPhotos("a", "b"), "occupied frames can swap") }
    check(swap.project.layer("a") == assigned(a, "two") && swap.project.layer("b") == assigned(b, "one"), "swap preserves both frames")
    reversible(swap, swapUndo, beforeSwap)
    check(!swap.swapPhotos("a", "a") && !swap.swapPhotos("a", "missing"), "invalid swap is rejected")

    let (move, moveUndo) = fixture([a], other: [empty])
    let beforeMove = move.project
    action(moveUndo) { check(move.swapPhotos("a", "empty"), "cross-slide move succeeds") }
    check(move.project.layer("a") == assigned(a, nil) && move.project.layer("empty") == assigned(empty, "one"), "move leaves source empty")
    reversible(move, moveUndo, beforeMove)

    var hiddenFilled = photo("hidden", "new"); hiddenFilled.visible = false
    var blendA = photo("blend-a", "new"), blendB = photo("blend-b", "extra")
    blendA.groupID = "blend"; blendA.groupKind = .blend
    blendB.groupID = "blend"; blendB.groupKind = .blend
    blendB.image?.seamBlend = SeamBlend(targetLayerID: blendA.id, edge: .left)
    let frames = [a, photo("same", "one"), b]
    let (shuffle, shuffleUndo) = fixture(frames + [empty, hiddenFilled, blendA, blendB])
    check(shuffle.canShufflePhotos, "distinct visible filled frames can shuffle")
    let beforeShuffle = shuffle.project
    action(shuffleUndo) { check(shuffle.shufflePhotos(), "shuffle succeeds") }
    let shuffled = frames.compactMap { shuffle.project.layer($0.id)?.image?.assetID }
    check(shuffled.sorted() == ["one", "one", "two"], "shuffle preserves duplicate-photo multiset")
    check(shuffled != frames.compactMap { $0.image?.assetID }, "shuffle always changes the arrangement")
    for (index, frame) in frames.enumerated() { check(shuffle.project.layer(frame.id) == assigned(frame, shuffled[index]), "shuffle keeps frame styling and resets crop") }
    check(shuffle.project.layer("empty") == empty && shuffle.project.layer("hidden") == hiddenFilled, "shuffle ignores empty and hidden frames")
    check(shuffle.project.layer("blend-a") == blendA && shuffle.project.layer("blend-b") == blendB, "shuffle preserves blend groups")
    check(!shuffle.canSwapPhotos("a", "blend-a"), "swap excludes blend-group members")
    reversible(shuffle, shuffleUndo, beforeShuffle)
    let fallback = PhotoFrames.shuffledIDs(["one", "one", "two"], randomIndex: { $0 - 1 })!
    check(fallback != ["one", "one", "two"] && fallback.sorted() == ["one", "one", "two"], "identity shuffle terminates with a changed arrangement")
    let (same, sameUndo) = fixture([a, photo("same", "one")])
    check(!same.canShufflePhotos && !same.shufflePhotos() && !sameUndo.canUndo, "identical photos cannot shuffle")

    let (blended, blendedUndo) = fixture([blendA, blendB])
    let beforeBlend = blended.project
    action(blendedUndo) { blended.assign(asset("two"), to: blendA.id) }
    check(blended.project.layer(blendA.id)?.frame == blendA.frame, "blend-member replacement keeps geometry")
    check(blended.project.layer(blendB.id)?.image?.seamBlend?.targetLayerID == blendA.id, "blend-member replacement keeps its incoming join")
    reversible(blended, blendedUndo, beforeBlend)

    print("PASS \(checks) photo frame checks")
    return checks
}
