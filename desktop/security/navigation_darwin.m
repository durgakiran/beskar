//go:build darwin && cgo

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static BOOL trustedMainURL(NSURL *url) {
    return [url.scheme isEqualToString:@"wails"] &&
        [url.host isEqualToString:@"localhost"] && !url.user && !url.password && !url.port &&
        [url.path isEqualToString:@"/index.desktop.html"];
}
bool beskarTrustedMainURL(const char *raw) {
    @autoreleasepool { return trustedMainURL([NSURL URLWithString:[NSString stringWithUTF8String:raw]]); }
}

// Preserve Wails' lifecycle/crash delegates while enforcing navigation BEFORE
// commit. A JS click handler alone cannot stop location.replace or redirects.
@interface BeskarNavigationGuard : NSObject <WKNavigationDelegate>
@property(nonatomic, retain) id<WKNavigationDelegate> original;
@end
@implementation BeskarNavigationGuard
- (BOOL)respondsToSelector:(SEL)selector {
    return [super respondsToSelector:selector] || [self.original respondsToSelector:selector];
}
- (id)forwardingTargetForSelector:(SEL)selector { return self.original; }
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    NSURL *url = action.request.URL;
    if (action.targetFrame && !action.targetFrame.mainFrame) {
        // The parent CSP and iframe sandbox restrict external frames. None may
        // become the privileged top-level page or open a new privileged window.
        handler(WKNavigationActionPolicyAllow);
        return;
    }
    BOOL trusted = action.targetFrame.mainFrame && trustedMainURL(url);
    handler(trusted ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (void)dealloc { [_original release]; [super dealloc]; }
@end

static WKWebView *findWebView(NSView *view) {
    if ([view isKindOfClass:[WKWebView class]]) return (WKWebView *)view;
    for (NSView *child in view.subviews) {
        WKWebView *found = findWebView(child);
        if (found) return found;
    }
    return nil;
}
bool beskarInstallNavigationGuard(void *handle) {
    if (!handle || ![NSThread isMainThread]) return false;
    WKWebView *webView = findWebView(((NSWindow *)handle).contentView);
    if (!webView) return false;
    if ([webView.navigationDelegate isKindOfClass:[BeskarNavigationGuard class]]) return true;
    BeskarNavigationGuard *guard = [[BeskarNavigationGuard alloc] init];
    guard.original = webView.navigationDelegate;
    objc_setAssociatedObject(webView, @selector(beskarInstallNavigationGuard), guard, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    webView.navigationDelegate = guard;
    [guard release];
    return true;
}
