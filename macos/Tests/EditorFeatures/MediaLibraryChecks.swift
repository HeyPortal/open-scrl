import Foundation

/// Pure checks for the Media panel's display-only sort and orientation filter.
@MainActor
func runMediaLibraryChecks() -> Int {
    var checks = 0
    func check(_ condition: @autoclosure () -> Bool, _ name: String) {
        guard condition() else { fatalError("FAIL: media library: \(name)") }
        checks += 1
    }
    func asset(_ id: String, _ name: String, _ w: Double, _ h: Double, mime: String = "image/jpeg", kind: MediaKind = .image) -> MediaAsset {
        MediaAsset(id: id, name: name, fileName: "\(id).bin", mime: mime, contentType: "public.data",
                   width: w, height: h, size: 1, hash: id, mediaKind: kind, duration: 0)
    }
    func ids(_ assets: [MediaAsset]) -> [String] { assets.map(\.id) }

    let library = [
        asset("a", "IMG_10.jpg", 1000, 1000),
        asset("b", "IMG_2.jpg", 800, 1000),
        asset("c", "img_2.jpg", 1000, 800),
        asset("d", "clip.mp4", 1920, 1080, mime: "video/mp4", kind: .video),
        asset("e", "anim.gif", 400, 400, mime: "image/gif", kind: .gif),
        asset("f", "broken.png", 0, 0, mime: "image/png"),
        asset("g", "Alpha.png", 1000, 1050, mime: "image/png"),
    ]

    check(ids(MediaLibraryOrder.displayed(library, sort: .imported)) == ["a", "b", "c", "d", "e", "f", "g"], "import order by default")
    let ascending = ids(MediaLibraryOrder.displayed(library, sort: .nameAscending))
    check(ascending == ["g", "e", "f", "d", "b", "c", "a"], "name ascending is natural")
    check(ascending.firstIndex(of: "b")! < ascending.firstIndex(of: "a")!, "IMG_2 before IMG_10")
    check(ascending.firstIndex(of: "b")! < ascending.firstIndex(of: "c")!, "case-insensitive ties keep import order")
    let descending = ids(MediaLibraryOrder.displayed(library, sort: .nameDescending))
    check(descending.firstIndex(of: "a")! < descending.firstIndex(of: "b")!, "descending puts IMG_10 first")
    check(descending.firstIndex(of: "b")! < descending.firstIndex(of: "c")!, "descending ties keep import order")
    check(ids(MediaLibraryOrder.displayed(library, sort: .fileType)) == ["e", "b", "c", "a", "g", "f", "d"], "file type then filename")

    check(MediaLibraryOrder.orientation(of: asset("x", "x", 95, 100)) == .square, "0.95 is square")
    check(MediaLibraryOrder.orientation(of: asset("x", "x", 105, 100)) == .square, "1.05 is square")
    check(MediaLibraryOrder.orientation(of: asset("x", "x", 94, 100)) == .vertical, "below tolerance is vertical")
    check(MediaLibraryOrder.orientation(of: asset("x", "x", 106, 100)) == .horizontal, "above tolerance is horizontal")
    check(MediaLibraryOrder.orientation(of: asset("x", "x", 0, 10)) == nil, "invalid dimensions have no orientation")

    func shown(_ filter: Set<MediaOrientation>, _ sort: MediaSortOrder = .imported) -> [String] {
        ids(MediaLibraryOrder.displayed(library, sort: sort, orientations: filter))
    }
    check(shown([.square]) == ["a", "e", "g"], "square filter, including GIFs")
    check(shown([.vertical]) == ["b"], "vertical filter")
    check(shown([.horizontal]) == ["c", "d"], "horizontal filter, including video")
    check(shown([.square, .vertical]) == ["a", "b", "e", "g"], "filters combine")
    check(shown([]).contains("f"), "invalid dimensions stay when unfiltered")
    check(!shown([.square, .vertical, .horizontal]).contains("f"), "invalid dimensions never match a filter")
    check(shown([.horizontal], .nameDescending) == ["c", "d"], "sort composes with filter")
    print("PASS media library sort and filter")
    return checks
}
