import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers

// The web editor supplies ordered raster overlays and original photo geometry.
// All photo operations run in extended linear light; browser canvas never encodes HDR.
struct Rect: Codable { let x: Double; let y: Double; let width: Double; let height: Double }
struct Entry: Codable {
    let kind: String
    let file: String
    let mask: String?
    let crop: Rect?
    let x: Double?
    let y: Double?
    let width: Double?
    let height: Double?
    let rotation: Double?
    let blur: Double?
}
struct Scene: Codable { let width: Int; let height: Int; let pixelRatio: Double; let entries: [Entry] }
enum RenderError: Error, CustomStringConvertible {
    case message(String)
    var description: String { switch self { case .message(let value): return value } }
}
let context = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!, .workingFormat: CIFormat.RGBAh])
let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!
let p3 = CGColorSpace(name: CGColorSpace.displayP3)!
func load(_ url: URL, hdr: Bool) throws -> CIImage {
    guard let image = CIImage(contentsOf: url, options: [.applyOrientationProperty: true, .expandToHDR: hdr, .toneMapHDRtoSDR: !hdr]) else {
        throw RenderError.message("Could not decode the original photo: \(url.lastPathComponent)")
    }
    return image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
}
func localFile(_ root: URL, _ name: String) throws -> URL {
    guard !name.isEmpty, name.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "_" || $0 == "-") }) else { throw RenderError.message("Invalid file identifier") }
    return root.appendingPathComponent(name)
}
func render(_ scene: Scene, root: URL, hdr: Bool) throws -> CIImage {
    let ratio = scene.pixelRatio
    let bounds = CGRect(x: 0, y: 0, width: Double(scene.width) * ratio, height: Double(scene.height) * ratio)
    var output = CIImage(color: CIColor(red: 1, green: 1, blue: 1)).cropped(to: bounds)
    for entry in scene.entries {
        let original = try load(localFile(root, entry.file), hdr: entry.kind == "photo" && hdr)
        if entry.kind == "raster" {
            output = original.composited(over: output).cropped(to: bounds)
            continue
        }
        guard entry.kind == "photo", let crop = entry.crop, let x = entry.x, let y = entry.y,
              let w = entry.width, let h = entry.height, let mask = entry.mask,
              crop.width > 0, crop.height > 0, w > 0, h > 0 else { throw RenderError.message("Invalid photo geometry") }
        let sourceRect = CGRect(x: crop.x, y: original.extent.height - crop.y - crop.height, width: crop.width, height: crop.height)
        var photo = original.cropped(to: sourceRect)
            .transformed(by: CGAffineTransform(translationX: -sourceRect.minX, y: -sourceRect.minY))
            .transformed(by: CGAffineTransform(scaleX: w / crop.width, y: h / crop.height))
            .transformed(by: CGAffineTransform(translationX: -w / 2, y: -h / 2))
            .transformed(by: CGAffineTransform(rotationAngle: -(entry.rotation ?? 0) * .pi / 180))
            .transformed(by: CGAffineTransform(translationX: x + w / 2, y: Double(scene.height) - y - h / 2))
            .transformed(by: CGAffineTransform(scaleX: ratio, y: ratio))
        if let blur = entry.blur, blur > 0 { photo = photo.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: blur * ratio]) }
        let alpha = try load(localFile(root, mask), hdr: false)
        output = photo.composited(over: output).applyingFilter("CIBlendWithAlphaMask", parameters: [kCIInputBackgroundImageKey: output, kCIInputMaskImageKey: alpha]).cropped(to: bounds)
    }
    return output
}
func maximumRGB(_ image: CIImage) -> Float {
    let maxImage = image.applyingFilter("CIAreaMaximum", parameters: [kCIInputExtentKey: CIVector(cgRect: image.extent)])
    var pixel = [Float](repeating: 0, count: 4)
    context.render(maxImage, toBitmap: &pixel, rowBytes: 16, bounds: CGRect(x: 0, y: 0, width: 1, height: 1), format: .RGBAf, colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB))
    return max(pixel[0], max(pixel[1], pixel[2]))
}
func encode(_ sdr: CIImage, hdr: CIImage, to url: URL) throws {
    let options: [CIImageRepresentationOption: Any] = [.hdrImage: hdr, .hdrGainMapAsRGB: true, kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.95]
    if url.pathExtension.lowercased() == "heic" {
        try context.writeHEIFRepresentation(of: sdr, to: url, format: .RGBA8, colorSpace: p3, options: options)
    } else {
        try context.writeJPEGRepresentation(of: sdr, to: url, colorSpace: p3, options: options)
    }
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeISOGainMap) != nil || CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeHDRGainMap) != nil else {
        throw RenderError.message("The encoder did not produce an HDR gain map. No SDR substitution was made.")
    }
}
func inspect(_ url: URL) throws {
    let hdr = try load(url, hdr: true)
    let sdr = try load(url, hdr: false)
    let source = CGImageSourceCreateWithURL(url as CFURL, nil)!
    let iso = CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeISOGainMap) != nil
    let legacy = CGImageSourceCopyAuxiliaryDataInfoAtIndex(source, 0, kCGImageAuxiliaryDataTypeHDRGainMap) != nil
    let result: [String: Any] = ["width": hdr.extent.width, "height": hdr.extent.height, "gainMap": iso || legacy, "isoGainMap": iso, "maxLinearHDR": maximumRGB(hdr), "maxLinearSDR": maximumRGB(sdr), "contentHeadroom": hdr.contentHeadroom]
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}
func main() throws {
    let args = CommandLine.arguments
    guard args.count >= 3 else { throw RenderError.message("Usage: HDRRenderer preview|render|inspect|fixture <input> [output]") }
    let input = URL(fileURLWithPath: args[2])
    switch args[1] {
    case "preview":
        guard args.count == 4 else { throw RenderError.message("Missing output") }
        let image = try load(input, hdr: false)
        try context.writeJPEGRepresentation(of: image, to: URL(fileURLWithPath: args[3]), colorSpace: sRGB, options: [:])
    case "inspect": try inspect(input)
    case "fixture":
        let bounds = CGRect(x: 0, y: 0, width: 640, height: 480)
        let base = CIImage(color: CIColor(red: 0.4, green: 0.2, blue: 0.1)).cropped(to: bounds)
        let bright = CIImage(color: CIColor(red: 4, green: 2, blue: 1, alpha: 1, colorSpace: CGColorSpace(name: CGColorSpace.extendedLinearSRGB)!)!).cropped(to: CGRect(x: 320, y: 0, width: 320, height: 480))
        let hdr = bright.composited(over: base).cropped(to: bounds)
        print("Fixture linear peak: \(maximumRGB(hdr))")
        try encode(base, hdr: hdr, to: input)
        try inspect(input)
    case "render":
        guard args.count == 4 else { throw RenderError.message("Missing output") }
        let scene = try JSONDecoder().decode(Scene.self, from: Data(contentsOf: input))
        guard scene.width > 0, scene.height > 0, scene.width <= 12000, scene.height <= 12000, [1.0, 2.0].contains(scene.pixelRatio), Double(scene.width * scene.height) * scene.pixelRatio * scene.pixelRatio <= 24_000_000 else { throw RenderError.message("Export exceeds the 24 megapixel limit") }
        let root = input.deletingLastPathComponent()
        let hdrSources = try scene.entries.filter { $0.kind == "photo" }.map { try load(localFile(root, $0.file), hdr: true).contentHeadroom }
        guard hdrSources.contains(where: { $0 > 1.01 }) else { throw RenderError.message("This slide has no HDR source photos. Wide-gamut SDR is not HDR; choose SDR export.") }
        let hdr = try render(scene, root: root, hdr: true)
        let sdr = try render(scene, root: root, hdr: false)
        let delta = hdr.applyingFilter("CIDifferenceBlendMode", parameters: [kCIInputBackgroundImageKey: sdr])
        guard maximumRGB(delta) > 0.02, maximumRGB(hdr) > 1.01 else { throw RenderError.message("This slide contains no visible HDR highlights. Export it as SDR instead.") }
        let output = URL(fileURLWithPath: args[3])
        try encode(sdr, hdr: hdr, to: output)
        try inspect(output)
    default: throw RenderError.message("Unknown operation")
    }
}
do { try main() } catch {
    FileHandle.standardError.write(Data("\(error)\n".utf8))
    exit(1)
}
