#!/usr/bin/env swift
// Run from the repository root: swift dev/export-brand-icons.swift
// Mechanical native exports only; the original imagegen artwork stays unmodified.
import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceURL = root.appendingPathComponent("packages/brand/source/agentroom-roommate.png")
guard let artwork = NSImage(contentsOf: sourceURL) else {
    fatalError("Run from the repository root; the AgentRoom source artwork is required.")
}
artwork.size = NSSize(width: 1254, height: 1254)

// The generated master includes transparent scraps beyond the tile.
// Crop to the tile, then apply a clean native mask instead of altering the artwork.
// AppKit source coordinates start at the lower-left corner.
let sourceTile = NSRect(x: 100, y: 94, width: 1056, height: 1056)
let matte = NSColor(srgbRed: 0.86, green: 0.90, blue: 0.77, alpha: 1)

func exportPNG(size: Int, native: Bool, to url: URL) throws {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
        isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0
    ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        fatalError("Cannot create icon bitmap.")
    }
    bitmap.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.imageInterpolation = .high
    let canvas = NSRect(x: 0, y: 0, width: size, height: size)
    (native ? NSColor.clear : matte).setFill()
    canvas.fill(using: .copy)
    let scale = CGFloat(size) / 1024
    let target = native
        ? NSRect(x: 100 * scale, y: 100 * scale, width: 824 * scale, height: 824 * scale)
        : canvas
    if native {
        let radius = 184 * scale
        NSBezierPath(roundedRect: target, xRadius: radius, yRadius: radius).addClip()
    }
    artwork.draw(in: target, from: sourceTile, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    // AppKit cannot draw directly into a 24-bit RGB bitmap context.
    // Opaque consumers are composited first, then packed as RGB for PNG encoding.
    var output = bitmap
    if !native {
        guard let rgb = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
            bitsPerSample: 8, samplesPerPixel: 3, hasAlpha: false,
            isPlanar: false, colorSpaceName: .deviceRGB,
            bytesPerRow: 0, bitsPerPixel: 0
        ), let source = bitmap.bitmapData, let destination = rgb.bitmapData else {
            fatalError("Cannot create opaque icon bitmap.")
        }
        for y in 0..<size {
            for x in 0..<size {
                let inputOffset = y * bitmap.bytesPerRow + x * 4
                let outputOffset = y * rgb.bytesPerRow + x * 3
                for channel in 0..<3 {
                    destination[outputOffset + channel] = source[inputOffset + channel]
                }
            }
        }
        output = rgb
    }
    guard let png = output.representation(using: .png, properties: [:]) else {
        fatalError("Cannot encode PNG.")
    }
    try png.write(to: url, options: .atomic)
}

try exportPNG(size: 1024, native: true,
    to: root.appendingPathComponent("apps/desktop/resources/icon.png"))
try exportPNG(size: 1024, native: false,
    to: root.appendingPathComponent("packages/brand/assets/agentstudio.png"))
try exportPNG(size: 1024, native: false,
    to: root.appendingPathComponent("apps/mobile/assets/icon.png"))
try exportPNG(size: 48, native: true,
    to: root.appendingPathComponent("apps/mobile/assets/favicon.png"))

let iconset = FileManager.default.temporaryDirectory
    .appendingPathComponent("agentroom-\(UUID().uuidString).iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: false)
defer { try? FileManager.default.removeItem(at: iconset) }
for points in [16, 32, 128, 256, 512] {
    try exportPNG(size: points, native: true,
        to: iconset.appendingPathComponent("icon_\(points)x\(points).png"))
    try exportPNG(size: points * 2, native: true,
        to: iconset.appendingPathComponent("icon_\(points)x\(points)@2x.png"))
}
let process = Process()
process.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
process.arguments = ["-c", "icns", iconset.path, "-o",
    root.appendingPathComponent("apps/desktop/resources/icon.icns").path]
try process.run()
process.waitUntilExit()
guard process.terminationStatus == 0 else { fatalError("iconutil failed.") }
print("Exported AgentRoom desktop PNG/ICNS, shared brand PNG, mobile icon and favicon.")
