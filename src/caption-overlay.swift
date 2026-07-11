import CoreGraphics
import CoreText
import Foundation
import ImageIO

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func colorFromHex(_ value: String, fallback: (CGFloat, CGFloat, CGFloat) = (0.114, 0.306, 0.847)) -> CGColor {
    var hex = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if hex.hasPrefix("#") { hex.removeFirst() }
    guard hex.count == 6, let number = UInt32(hex, radix: 16) else {
        return CGColor(red: fallback.0, green: fallback.1, blue: fallback.2, alpha: 1)
    }
    return CGColor(
        red: CGFloat((number >> 16) & 0xff) / 255.0,
        green: CGFloat((number >> 8) & 0xff) / 255.0,
        blue: CGFloat(number & 0xff) / 255.0,
        alpha: 1
    )
}

let args = CommandLine.arguments
guard args.count >= 6 else {
    fail("Usage: caption-overlay.swift <input> <output> <caption> <hex-color> <font-size>")
}

let inputPath = args[1]
let outputPath = args[2]
let caption = args[3]
let textColor = colorFromHex(args[4])
let fontSize = max(24.0, min(72.0, Double(args[5]) ?? 46.0))

let inputURL = URL(fileURLWithPath: inputPath) as CFURL
guard let source = CGImageSourceCreateWithURL(inputURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("Cannot read input image")
}

let width = image.width
let height = image.height
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue

guard let context = CGContext(
    data: nil,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: bitmapInfo
) else {
    fail("Cannot create bitmap context")
}

let canvas = CGRect(x: 0, y: 0, width: width, height: height)
context.clear(canvas)
context.draw(image, in: canvas)

let fontNames = ["AppleSDGothicNeo-Heavy", "AppleSDGothicNeo-Bold", "Apple SD Gothic Neo"]
var font = CTFontCreateWithName(fontNames[0] as CFString, CGFloat(fontSize), nil)
for name in fontNames {
    let candidate = CTFontCreateWithName(name as CFString, CGFloat(fontSize), nil)
    if CTFontGetGlyphCount(candidate) > 0 {
        font = candidate
        break
    }
}

let attributes: [NSAttributedString.Key: Any] = [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTForegroundColorAttributeName as String): textColor,
    NSAttributedString.Key(kCTStrokeColorAttributeName as String): CGColor(red: 1, green: 1, blue: 1, alpha: 1),
    NSAttributedString.Key(kCTStrokeWidthAttributeName as String): -8.0
]
let attributed = NSAttributedString(string: caption, attributes: attributes)
let line = CTLineCreateWithAttributedString(attributed)
var ascent: CGFloat = 0
var descent: CGFloat = 0
var leading: CGFloat = 0
let lineWidth = CGFloat(CTLineGetTypographicBounds(line, &ascent, &descent, &leading))
let x = max(14, (CGFloat(width) - lineWidth) / 2)
let y = CGFloat(26) + descent

context.textPosition = CGPoint(x: x, y: y)
CTLineDraw(line, context)

guard let outputImage = context.makeImage() else {
    fail("Cannot create output image")
}

let outputURL = URL(fileURLWithPath: outputPath) as CFURL
guard let destination = CGImageDestinationCreateWithURL(outputURL, "public.png" as CFString, 1, nil) else {
    fail("Cannot create output destination")
}
CGImageDestinationAddImage(destination, outputImage, nil)
if !CGImageDestinationFinalize(destination) {
    fail("Cannot write output PNG")
}
