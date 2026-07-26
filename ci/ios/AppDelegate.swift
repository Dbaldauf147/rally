import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    // Required by @capacitor/push-notifications: iOS hands the APNs device token
    // to the app delegate, and Capacitor only sees it if we forward it. Without
    // these two, PushNotifications.register() succeeds, no error is raised, and
    // the JS "registration" listener simply never fires — so no device token is
    // ever saved and the daily Reach Out push has nobody to send to.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    // NOTE: The Capacitor 8.3.4 template also scaffolds an
    // application(_:continue:restorationHandler:) handler for Universal Links /
    // Handoff. The Capacitor framework resolved via Swift Package Manager
    // (capacitor-swift-pm 8.3.4) does not expose a matching overload, so that
    // call fails to compile ("extra argument 'restorationHandler'"). Rally does
    // not use Universal Links, so the handler is intentionally omitted here.
    // This file is copied over the generated AppDelegate.swift during CI.
}
