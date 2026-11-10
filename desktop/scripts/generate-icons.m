// Run from desktop: make icons (macOS only).
// Rasterize the shared vector mark at each native icon size.
#import <AppKit/AppKit.h>

static void writePNG(NSImage *image, NSInteger size, NSString *path) {
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc]
        initWithBitmapDataPlanes:NULL pixelsWide:size pixelsHigh:size
        bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO
        colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:context];
    [image drawInRect:NSMakeRect(0, 0, size, size) fromRect:NSZeroRect
           operation:NSCompositingOperationCopy fraction:1];
    [context flushGraphics];
    [NSGraphicsContext restoreGraphicsState];
    NSData *data = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    if (!data || ![data writeToFile:path atomically:YES]) {
        NSLog(@"Cannot write icon: %@", path);
        exit(1);
    }
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 3) return 1;
        NSString *assets = @(argv[1]);
        NSString *iconset = @(argv[2]);
        NSImage *image = [[NSImage alloc] initWithContentsOfFile:[assets stringByAppendingPathComponent:@"teddox.svg"]];
        if (!image) { NSLog(@"Cannot load Teddox SVG"); return 1; }
        writePNG(image, 1024, [assets stringByAppendingPathComponent:@"teddox.png"]);
        for (NSNumber *value in @[@16, @32, @128, @256, @512]) {
            NSInteger size = value.integerValue;
            writePNG(image, size, [iconset stringByAppendingPathComponent:
                [NSString stringWithFormat:@"icon_%ldx%ld.png", (long)size, (long)size]]);
            writePNG(image, size * 2, [iconset stringByAppendingPathComponent:
                [NSString stringWithFormat:@"icon_%ldx%ld@2x.png", (long)size, (long)size]]);
        }
    }
    return 0;
}
