#import <Cocoa/Cocoa.h>

#import "native_titlebar_darwin.h"

@interface AKMDTitleBarDragView : NSView
@end

@implementation AKMDTitleBarDragView

- (BOOL)isOpaque {
    return NO;
}

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
    return YES;
}

- (void)mouseDown:(NSEvent *)event {
    if (event.clickCount == 2) {
        [self.window zoom:nil];
        return;
    }

    [self.window performWindowDragWithEvent:event];
}

- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];

    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
    [center removeObserver:self];
    if (self.window == nil) return;

    [center addObserver:self
               selector:@selector(windowFullscreenChanged:)
                   name:NSWindowDidEnterFullScreenNotification
                 object:self.window];
    [center addObserver:self
               selector:@selector(windowFullscreenChanged:)
                   name:NSWindowDidExitFullScreenNotification
                 object:self.window];
    [self updateFullscreenVisibility];
}

- (void)windowFullscreenChanged:(NSNotification *)notification {
    [self updateFullscreenVisibility];
}

- (void)updateFullscreenVisibility {
    self.hidden = self.window != nil
        && (self.window.styleMask & NSWindowStyleMaskFullScreen) != 0;
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    [super dealloc];
}

@end

static NSWindow *AKMDWailsWindow(void) {
    Class wailsWindowClass = NSClassFromString(@"WailsWindow");
    NSWindow *fallbackWindow = nil;

    for (NSWindow *window in NSApp.windows) {
        if (window.contentView == nil) continue;
        if (wailsWindowClass != Nil && [window isKindOfClass:wailsWindowClass]) {
            return window;
        }
        if (fallbackWindow == nil && window.isVisible) {
            fallbackWindow = window;
        }
    }

    return fallbackWindow;
}

void akmdInstallTitleBarDrag(double height, double leftInset) {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSWindow *window = AKMDWailsWindow();
        if (window == nil) window = NSApp.mainWindow ?: NSApp.keyWindow;
        if (window == nil) return;

        NSView *contentView = window.contentView;
        if (contentView == nil) return;

        NSArray *subviews = [[contentView subviews] copy];
        for (NSView *subview in subviews) {
            if ([subview isKindOfClass:[AKMDTitleBarDragView class]]) {
                [subview removeFromSuperview];
            }
        }
        [subviews release];

        NSRect bounds = contentView.bounds;
        CGFloat dragHeight = MIN(height, bounds.size.height);
        CGFloat inset = MIN(leftInset, MAX(0, bounds.size.width - 1));
        NSRect frame = NSMakeRect(
            inset,
            bounds.size.height - dragHeight,
            MAX(1, bounds.size.width - inset),
            dragHeight
        );

        AKMDTitleBarDragView *dragView = [[AKMDTitleBarDragView alloc] initWithFrame:frame];
        dragView.autoresizingMask = NSViewWidthSizable | NSViewMinYMargin;
        [contentView addSubview:dragView positioned:NSWindowAbove relativeTo:nil];
        [dragView release];
    });
}
