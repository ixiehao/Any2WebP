import AppKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(EXIT_FAILURE)
}

guard CommandLine.arguments.count == 4 else {
    fail("Usage: create-dmg-background.swift <output> <app name> <minimum macOS>")
}
let output = URL(fileURLWithPath: CommandLine.arguments[1])
let appName = CommandLine.arguments[2]
let minimum = CommandLine.arguments[3]
let size = NSSize(width: 680, height: 430)
let bounds = NSRect(origin: .zero, size: size)

guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
    bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
    colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fail("Unable to create the installer background")
}

let ink = NSColor(srgbRed: 0.09, green: 0.15, blue: 0.26, alpha: 1)
let secondary = NSColor(srgbRed: 0.27, green: 0.36, blue: 0.51, alpha: 1)
let accent = NSColor(srgbRed: 0.15, green: 0.33, blue: 0.79, alpha: 1)
let top = NSColor(srgbRed: 0.97, green: 0.985, blue: 1, alpha: 1)
let bottom = NSColor(srgbRed: 0.88, green: 0.93, blue: 0.995, alpha: 1)

func center(_ title: String, at y: CGFloat, font: NSFont, color: NSColor) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    NSAttributedString(string: title, attributes: [
        .font: font, .foregroundColor: color, .paragraphStyle: paragraph,
    ]).draw(in: NSRect(x: 36, y: y, width: size.width - 72, height: font.pointSize * 1.55))
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
NSGradient(starting: top, ending: bottom)?.draw(in: bounds, angle: -90)
center(appName, at: 342, font: .systemFont(ofSize: 32, weight: .semibold), color: ink)
center("Apple Silicon · macOS \(minimum)+", at: 320, font: .systemFont(ofSize: 13, weight: .medium), color: secondary)

// Finder places the centers of both native icons at y=193 measured from the top.
let centerY = size.height - 193
let arrow = NSBezierPath()
arrow.lineWidth = 3
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
arrow.move(to: NSPoint(x: 315, y: centerY))
arrow.line(to: NSPoint(x: 365, y: centerY))
arrow.move(to: NSPoint(x: 353, y: centerY + 12))
arrow.line(to: NSPoint(x: 365, y: centerY))
arrow.line(to: NSPoint(x: 353, y: centerY - 12))
accent.setStroke()
arrow.stroke()

center("Drag \(appName) to Applications.", at: 99, font: .systemFont(ofSize: 15, weight: .semibold), color: ink)
center("将 \(appName) 拖到「应用程序」。", at: 73, font: .systemFont(ofSize: 14), color: secondary)
center("\(appName) を「アプリケーション」にドラッグします。", at: 47, font: .systemFont(ofSize: 14), color: secondary)
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
    fail("Unable to encode the installer background")
}
try png.write(to: output, options: .atomic)
