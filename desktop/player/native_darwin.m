//go:build darwin && cgo

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#include <math.h>

// These views deliberately use a fresh configuration, no Wails content
// controller/message handlers, and a non-persistent cookie/credential store.
@interface BeskarYouTubeContainer : NSView
@end
@implementation BeskarYouTubeContainer
- (BOOL)isFlipped { return YES; }
@end

@interface BeskarYouTubeView : WKWebView <WKNavigationDelegate, WKUIDelegate>
@property(nonatomic,copy) NSString *videoID;
@property(nonatomic,assign) NSView *inlineContainer;
@property(nonatomic,assign) NSRect inlineFrame;
@end
static BOOL publicYouTubeLink(NSURL *url) {
    return [url.scheme isEqualToString:@"https"] && !url.user && !url.password && !url.port &&
        ([@[@"www.youtube.com",@"youtube.com",@"youtu.be"] containsObject:url.host]);
}
@implementation BeskarYouTubeView
- (void)viewDidMoveToSuperview {
    [super viewDidMoveToSuperview];
    // WebKit moves this view into its own fullscreen window, then restores it.
    if(self.inlineContainer && self.superview==self.inlineContainer) self.frame=self.inlineFrame;
}
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    NSURL *url=action.request.URL;
    BOOL embed=[url.scheme isEqualToString:@"https"] && [url.host isEqualToString:@"www.youtube-nocookie.com"] && !url.user && !url.password && !url.port && [url.path isEqualToString:[@"/embed/" stringByAppendingString:self.videoID]];
    BOOL safeChild=[url.scheme isEqualToString:@"https"] || [url.absoluteString isEqualToString:@"about:blank"] || [url.absoluteString hasPrefix:@"blob:https://"];
    BOOL allowed=action.targetFrame && (action.targetFrame.mainFrame ? embed : safeChild);
    if(!allowed && action.navigationType==WKNavigationTypeLinkActivated && publicYouTubeLink(url))
        [[NSWorkspace sharedWorkspace] openURL:url];
    handler(allowed ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
- (void)webView:(WKWebView *)view requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin initiatedByFrame:(WKFrameInfo *)frame type:(WKMediaCaptureType)type decisionHandler:(void (^)(WKPermissionDecision))handler API_AVAILABLE(macos(12.0)) { handler(WKPermissionDecisionDeny); }
- (void)dealloc { [_videoID release]; [super dealloc]; }
@end
static char playersKey;
static char playerViewKey;
static WKWebView *findBrowser(NSView *view) {
    if ([view isKindOfClass:[WKWebView class]]) return (WKWebView *)view;
    for(NSView *child in view.subviews){ WKWebView *found=findBrowser(child);if(found)return found; }
    return nil;
}
static NSMutableDictionary *players(WKWebView *browser) {
    NSMutableDictionary *value=objc_getAssociatedObject(browser,&playersKey);
    if(!value){ value=[NSMutableDictionary dictionary];objc_setAssociatedObject(browser,&playersKey,value,OBJC_ASSOCIATION_RETAIN_NONATOMIC); }
    return value;
}
bool beskarShowPlayer(void *handle,const char *rawID,const char *rawVideo,double x,double y,double width,double height,double cx,double cy,double cw,double ch,double vw,double vh) {
    if(!handle || ![NSThread isMainThread])return false;
    WKWebView *browser=findBrowser(((NSWindow *)handle).contentView);if(!browser)return false;
    CGFloat sx=browser.bounds.size.width/vw,sy=browser.bounds.size.height/vh;
    if(!isfinite(sx) || !isfinite(sy) || sx<=0 || sy<=0 || width*sx>16384 || height*sy>16384)return false;
    NSString *key=[NSString stringWithUTF8String:rawID],*video=[NSString stringWithUTF8String:rawVideo];
    NSMutableDictionary *all=players(browser);
    NSView *container=all[key];
    if(!container){
        if(all.count>=8)return false;
        container=[[[BeskarYouTubeContainer alloc] initWithFrame:NSZeroRect] autorelease];
        container.wantsLayer=YES;container.layer.masksToBounds=YES;
        WKWebViewConfiguration *configuration=[[[WKWebViewConfiguration alloc] init] autorelease];
        configuration.websiteDataStore=[WKWebsiteDataStore nonPersistentDataStore];
        if(@available(macOS 12.3,*)) configuration.preferences.elementFullscreenEnabled=YES;
        configuration.mediaTypesRequiringUserActionForPlayback=WKAudiovisualMediaTypeAll;
        BeskarYouTubeView *player=[[[BeskarYouTubeView alloc] initWithFrame:NSZeroRect configuration:configuration] autorelease];
        player.navigationDelegate=player;player.UIDelegate=player;player.inlineContainer=container;
        objc_setAssociatedObject(container,&playerViewKey,player,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        [container addSubview:player];[browser.superview addSubview:container positioned:NSWindowAbove relativeTo:browser];all[key]=container;
    }
    BeskarYouTubeView *player=objc_getAssociatedObject(container,&playerViewKey);
    if(![player.videoID isEqualToString:video]) {
        player.videoID=video;
        NSString *identity=[[[NSBundle mainBundle] bundleIdentifier] lowercaseString];
        if(!identity.length)return false;
        NSURL *url=[NSURL URLWithString:[@"https://www.youtube-nocookie.com/embed/" stringByAppendingString:video]];
        NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:url];
        [request setValue:[@"https://" stringByAppendingString:identity] forHTTPHeaderField:@"Referer"];
        [player loadRequest:request];
    }
    NSRect full=NSMakeRect(x*sx,y*sy,width*sx,height*sy);
    NSRect clip=NSIntersectionRect(full,NSMakeRect(cx*sx,cy*sy,cw*sx,ch*sy));
    clip=NSIntersectionRect(clip,browser.bounds);
    container.hidden=NSIsEmptyRect(clip);
    if(!browser.isFlipped){full.origin.y=browser.bounds.size.height-NSMaxY(full);clip.origin.y=browser.bounds.size.height-NSMaxY(clip);}
    NSView *parent=browser.superview;
    NSRect parentClip=[browser convertRect:clip toView:parent],parentFull=[browser convertRect:full toView:parent];
    container.frame=parentClip;
    CGFloat playerY=parent.isFlipped ? parentFull.origin.y-parentClip.origin.y : NSMaxY(parentClip)-NSMaxY(parentFull);
    player.inlineFrame=NSMakeRect(parentFull.origin.x-parentClip.origin.x,playerY,parentFull.size.width,parentFull.size.height);
    if(player.superview==container) player.frame=player.inlineFrame;
    return true;
}
void beskarHidePlayer(void *handle,const char *rawID,bool destroy) {
    if(!handle || ![NSThread isMainThread])return;
    WKWebView *browser=findBrowser(((NSWindow *)handle).contentView);if(!browser)return;
    NSMutableDictionary *all=objc_getAssociatedObject(browser,&playersKey);NSString *key=[NSString stringWithUTF8String:rawID];NSView *container=all[key];
    container.hidden=YES;
    if(destroy){
        BeskarYouTubeView *player=objc_getAssociatedObject(container,&playerViewKey);
        player.inlineContainer=nil;
        NSWindow *window=(NSWindow *)handle;
        if([window.firstResponder isKindOfClass:[NSView class]] && [(NSView *)window.firstResponder isDescendantOf:container]) [window makeFirstResponder:browser];
        player.navigationDelegate=nil;player.UIDelegate=nil;
        if(@available(macOS 12.0,*)){
            [player pauseAllMediaPlaybackWithCompletionHandler:nil];
            [player closeAllMediaPresentationsWithCompletionHandler:nil];
        }
        [player stopLoading];[player loadHTMLString:@"" baseURL:nil];
        [container removeFromSuperview];[all removeObjectForKey:key];
    }
}
