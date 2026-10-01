// Builds the Finder layout for the Open-SCRL installer disk image.
//
//   swift DMGLayout.swift background <output-dir>
//       Renders background.png (1x) and background@2x.png.
//   swift DMGLayout.swift dsstore <mounted-volume> <app-name>
//       Writes <volume>/.DS_Store: window size, icon size and positions, and the
//       background picture at <volume>/.background/background.tiff.
//
// Finder stores folder view settings in .DS_Store, a "buddy allocator" file holding a
// B-tree of records. This writes the small subset an installer window needs.

import AppKit

let windowSize = CGSize(width: 660, height: 420)
let appIconCenter = CGPoint(x: 180, y: 210)
let applicationsIconCenter = CGPoint(x: 480, y: 210)
let iconSize = 128

// MARK: - Background artwork

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

func renderBackground(scale: CGFloat) -> Data {
    let pixels = NSSize(width: windowSize.width * scale, height: windowSize.height * scale)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(pixels.width), pixelsHigh: Int(pixels.height),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = windowSize
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    NSGraphicsContext.current = context
    let cg = context.cgContext
    // Draw in a top-left origin space so coordinates match Finder's icon positions.
    cg.translateBy(x: 0, y: windowSize.height)
    cg.scaleBy(x: 1, y: -1)
    let flipped = NSGraphicsContext(cgContext: cg, flipped: true)
    NSGraphicsContext.current = flipped
    let bounds = CGRect(origin: .zero, size: windowSize)

    // Pale lavender field. Finder draws icon labels in black on picture backgrounds, even in
    // Dark Mode, so the artwork stays light enough for them to read.
    NSGradient(colors: [color(0xFAF9FF), color(0xEAE5FF)])!.draw(in: bounds, angle: -90)
    let glow = NSGradient(colors: [color(0x7C5CFF, 0.16), color(0x7C5CFF, 0)])!
    glow.draw(fromCenter: CGPoint(x: windowSize.width / 2, y: 215), radius: 0,
              toCenter: CGPoint(x: windowSize.width / 2, y: 215), radius: 340, options: [])

    // The app's 2×2 tile mark in the corner.
    for (i, origin) in [CGPoint(x: 552, y: 30), CGPoint(x: 592, y: 30), CGPoint(x: 552, y: 70), CGPoint(x: 592, y: 70)].enumerated() {
        let tile = NSBezierPath(roundedRect: CGRect(origin: origin, size: CGSize(width: 34, height: 34)), xRadius: 9, yRadius: 9)
        (i == 0 || i == 3 ? color(0x7C5CFF, 0.30) : color(0x7C5CFF, 0.12)).setFill()
        tile.fill()
    }

    // Title.
    let title = NSAttributedString(string: "Open-SCRL", attributes: [
        .font: NSFont.systemFont(ofSize: 26, weight: .bold),
        .foregroundColor: color(0x221A4F),
    ])
    title.draw(at: CGPoint(x: 36, y: 30))
    let subtitle = NSAttributedString(string: "Photo grids and seamless carousels", attributes: [
        .font: NSFont.systemFont(ofSize: 13, weight: .medium),
        .foregroundColor: color(0x6A5EB0),
    ])
    subtitle.draw(at: CGPoint(x: 37, y: 64))

    // White plates behind the icons; their lower edge sits under Finder's labels.
    for center in [appIconCenter, applicationsIconCenter] {
        let rect = CGRect(x: center.x - 94, y: center.y - 94, width: 188, height: 202)
        let plate = NSBezierPath(roundedRect: rect, xRadius: 40, yRadius: 40)
        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = color(0x2B1F78, 0.14)
        shadow.shadowBlurRadius = 18
        shadow.shadowOffset = NSSize(width: 0, height: -6)
        shadow.set()
        color(0xFFFFFF, 0.88).setFill()
        plate.fill()
        NSGraphicsContext.restoreGraphicsState()
        color(0x7C5CFF, 0.16).setStroke()
        plate.lineWidth = 1
        plate.stroke()
    }

    // Arrow from the app to Applications.
    let start = CGPoint(x: appIconCenter.x + 108, y: appIconCenter.y)
    let end = CGPoint(x: applicationsIconCenter.x - 110, y: applicationsIconCenter.y)
    let arrow = NSBezierPath()
    arrow.move(to: start)
    arrow.curve(to: end, controlPoint1: CGPoint(x: start.x + 30, y: start.y - 28), controlPoint2: CGPoint(x: end.x - 30, y: end.y - 28))
    arrow.lineWidth = 5
    arrow.lineCapStyle = .round
    color(0x7C5CFF).setStroke()
    arrow.stroke()
    let head = NSBezierPath()
    head.move(to: CGPoint(x: end.x - 14, y: end.y - 13))
    head.line(to: end)
    head.line(to: CGPoint(x: end.x - 16, y: end.y + 9))
    head.lineWidth = 5
    head.lineCapStyle = .round
    head.lineJoinStyle = .round
    head.stroke()

    // Instruction.
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    let hint = NSAttributedString(string: "Drag Open-SCRL into the Applications folder to install it.", attributes: [
        .font: NSFont.systemFont(ofSize: 13, weight: .medium),
        .foregroundColor: color(0x5A5290),
        .paragraphStyle: paragraph,
    ])
    hint.draw(in: CGRect(x: 0, y: 360, width: windowSize.width, height: 20))

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

// MARK: - .DS_Store writer

struct DSRecord {
    var name: String
    var code: String
    var type: String
    var payload: Data
}

extension Data {
    mutating func u32(_ value: UInt32) { var v = value.bigEndian; append(Data(bytes: &v, count: 4)) }
    mutating func u8(_ value: UInt8) { append(value) }
    mutating func fourCC(_ code: String) { append(code.data(using: .macOSRoman)!) }
    mutating func utf16(_ string: String) { for unit in string.utf16 { var v = unit.bigEndian; append(Data(bytes: &v, count: 2)) } }
}

func blob(_ name: String, _ code: String, _ data: Data) -> DSRecord {
    var payload = Data()
    payload.u32(UInt32(data.count))
    payload.append(data)
    return DSRecord(name: name, code: code, type: "blob", payload: payload)
}

func long(_ name: String, _ code: String, _ value: UInt32) -> DSRecord {
    var payload = Data()
    payload.u32(value)
    return DSRecord(name: name, code: code, type: "long", payload: payload)
}

func iconLocation(_ name: String, _ center: CGPoint) -> DSRecord {
    var data = Data()
    data.u32(UInt32(center.x))
    data.u32(UInt32(center.y))
    data.append(contentsOf: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00])
    return blob(name, "Iloc", data)
}

func plist(_ object: [String: Any]) -> Data {
    try! PropertyListSerialization.data(fromPropertyList: object, format: .binary, options: 0)
}

func encode(_ record: DSRecord) -> Data {
    var data = Data()
    data.u32(UInt32(record.name.utf16.count))
    data.utf16(record.name)
    data.fourCC(record.code)
    data.fourCC(record.type)
    data.append(record.payload)
    return data
}

/// Lays out a buddy-allocated file: header block, DSDB block, bookkeeping block, one leaf node.
func dsStore(records: [DSRecord]) -> Data {
    let sorted = records.sorted {
        let a = $0.name.lowercased(), b = $1.name.lowercased()
        return a == b ? $0.code < $1.code : a < b
    }
    var leaf = Data()
    leaf.u32(0)                      // leaf node: no rightmost child
    leaf.u32(UInt32(sorted.count))
    for record in sorted { leaf.append(encode(record)) }
    precondition(leaf.count <= 4096, "records must fit one 4 KB node")

    // Offsets are relative to byte 4. Fresh buddy allocation of 32, 32, 2048 and 4096 bytes.
    let dsdbOffset: UInt32 = 32, bookkeepingOffset: UInt32 = 2048, leafOffset: UInt32 = 4096
    var dsdb = Data()
    dsdb.u32(2)                      // root node = block 2
    dsdb.u32(0)                      // levels
    dsdb.u32(UInt32(sorted.count))   // records
    dsdb.u32(1)                      // nodes
    dsdb.u32(4096)                   // page size

    var bookkeeping = Data()
    let addresses: [UInt32] = [bookkeepingOffset | 11, dsdbOffset | 5, leafOffset | 12]
    bookkeeping.u32(UInt32(addresses.count))
    bookkeeping.u32(0)
    for i in 0..<256 { bookkeeping.u32(i < addresses.count ? addresses[i] : 0) }
    bookkeeping.u32(1)               // directory: DSDB -> block 1
    bookkeeping.u8(4)
    bookkeeping.fourCC("DSDB")
    bookkeeping.u32(1)
    // Free lists for orders 0...31 after those allocations.
    for order in 0..<32 {
        if (6...10).contains(order) || (13...30).contains(order) {
            bookkeeping.u32(1)
            bookkeeping.u32(UInt32(1) << UInt32(order))
        } else {
            bookkeeping.u32(0)
        }
    }
    precondition(bookkeeping.count <= 2048)

    var body = Data(count: 8192)     // address space covered by the allocations
    func put(_ chunk: Data, at offset: UInt32) { body.replaceSubrange(Int(offset)..<Int(offset) + chunk.count, with: chunk) }
    var header = Data()
    header.fourCC("Bud1")
    header.u32(bookkeepingOffset)
    header.u32(2048)
    header.u32(bookkeepingOffset)
    header.append(Data(count: 16))
    put(header, at: 0)
    put(dsdb, at: dsdbOffset)
    put(bookkeeping, at: bookkeepingOffset)
    put(leaf, at: leafOffset)

    var file = Data()
    file.u32(1)
    file.append(body)
    return file
}

func writeDSStore(volume: URL, appName: String) throws {
    let background = volume.appending(path: ".background/background.tiff")
    let bookmark = try background.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    let windowSettings: [String: Any] = [
        "ContainerShowSidebar": false,
        "ShowPathbar": false,
        "ShowSidebar": false,
        "ShowStatusBar": false,
        "ShowTabView": false,
        "ShowToolbar": false,
        "SidebarWidth": 0,
        "WindowBounds": "{{240, 180}, {\(Int(windowSize.width)), \(Int(windowSize.height) + 32)}}",
    ]
    let iconView: [String: Any] = [
        "arrangeBy": "none",
        "backgroundColorBlue": 1.0,
        "backgroundColorGreen": 1.0,
        "backgroundColorRed": 1.0,
        "backgroundType": 2,
        "gridOffsetX": 0.0,
        "gridOffsetY": 0.0,
        "gridSpacing": 100.0,
        "iconSize": Double(iconSize),
        "labelOnBottom": true,
        "showIconPreview": true,
        "showItemInfo": false,
        "textSize": 13.0,
        "viewOptionsVersion": 1,
    ]
    let records = [
        blob(".", "bwsp", plist(windowSettings)),
        blob(".", "icvp", plist(iconView)),
        blob(".", "pBBk", bookmark),
        long(".", "vSrn", 1),
        iconLocation("\(appName).app", appIconCenter),
        iconLocation("Applications", applicationsIconCenter),
        iconLocation(".background", CGPoint(x: 900, y: 900)),
        iconLocation(".VolumeIcon.icns", CGPoint(x: 900, y: 900)),
    ]
    try dsStore(records: records).write(to: volume.appending(path: ".DS_Store"))
}

// MARK: - Main

let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "background" where args.count == 3:
    let out = URL(fileURLWithPath: args[2])
    try renderBackground(scale: 1).write(to: out.appending(path: "background.png"))
    try renderBackground(scale: 2).write(to: out.appending(path: "background@2x.png"))
case "dsstore" where args.count == 4:
    try writeDSStore(volume: URL(fileURLWithPath: args[2]), appName: args[3])
default:
    FileHandle.standardError.write(Data("usage: DMGLayout.swift background <dir> | dsstore <volume> <app-name>\n".utf8))
    exit(64)
}
