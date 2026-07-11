import CoreGraphics
import Foundation
import ImageIO

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func readImage(_ path: String) -> CGImage {
    let url = URL(fileURLWithPath: path) as CFURL
    guard let source = CGImageSourceCreateWithURL(url, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fail("Cannot read image: \(path)")
    }
    return image
}

let args = CommandLine.arguments
guard args.count >= 8 else {
    fail("Usage: region-composite <source> <edit> <output> <xPct> <yPct> <wPct> <hPct> [percent|fit]")
}

let sourcePath = args[1]
let editPath = args[2]
let outputPath = args[3]
let xPct = max(0.0, min(100.0, Double(args[4]) ?? 0.0))
let yPct = max(0.0, min(100.0, Double(args[5]) ?? 0.0))
let wPct = max(0.1, min(100.0 - xPct, Double(args[6]) ?? 0.1))
let hPct = max(0.1, min(100.0 - yPct, Double(args[7]) ?? 0.1))
let mode = args.count >= 9 ? args[8] : "percent"

let sourceImage = readImage(sourcePath)
let editImage = readImage(editPath)

let sourceWidth = sourceImage.width
let sourceHeight = sourceImage.height
let editWidth = editImage.width
let editHeight = editImage.height

let destRect = CGRect(
    x: CGFloat(xPct / 100.0) * CGFloat(sourceWidth),
    y: CGFloat((100.0 - yPct - hPct) / 100.0) * CGFloat(sourceHeight),
    width: CGFloat(wPct / 100.0) * CGFloat(sourceWidth),
    height: CGFloat(hPct / 100.0) * CGFloat(sourceHeight)
).integral

let destAspect = max(1.0, destRect.width) / max(1.0, destRect.height)
let editAspect = CGFloat(editWidth) / CGFloat(editHeight)
let cropRect: CGRect
if mode == "fit" {
    if editAspect > destAspect {
        let cropWidth = CGFloat(editHeight) * destAspect
        cropRect = CGRect(x: (CGFloat(editWidth) - cropWidth) / 2, y: 0, width: cropWidth, height: CGFloat(editHeight)).integral
    } else {
        let cropHeight = CGFloat(editWidth) / destAspect
        cropRect = CGRect(x: 0, y: (CGFloat(editHeight) - cropHeight) / 2, width: CGFloat(editWidth), height: cropHeight).integral
    }
} else {
    cropRect = CGRect(
        x: CGFloat(xPct / 100.0) * CGFloat(editWidth),
        y: CGFloat(yPct / 100.0) * CGFloat(editHeight),
        width: CGFloat(wPct / 100.0) * CGFloat(editWidth),
        height: CGFloat(hPct / 100.0) * CGFloat(editHeight)
    ).integral
}

guard let patch = editImage.cropping(to: cropRect) else {
    fail("Cannot crop edited region")
}

let colorSpace = CGColorSpaceCreateDeviceRGB()
let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue
guard let context = CGContext(
    data: nil,
    width: sourceWidth,
    height: sourceHeight,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: bitmapInfo
) else {
    fail("Cannot create bitmap context")
}

let canvas = CGRect(x: 0, y: 0, width: sourceWidth, height: sourceHeight)
context.clear(canvas)
context.draw(sourceImage, in: canvas)
context.interpolationQuality = .high
context.draw(patch, in: destRect)

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
