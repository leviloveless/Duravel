//
//  Duravel iOS — Part 6
//  AppDelegate reference snippets.
//
//  You only need parts of this file:
//   • §A  Notification CATEGORIES with action buttons ("Start" / "Snooze").
//         Needed if you want the extra buttons; tap routing works without it.
//   • §B  Manual token forwarding — ONLY if you disabled Capacitor's swizzling
//         (Info.plist CapacitorPushNotificationsSwizzlingEnabled = NO).
//         With default Capacitor settings, DELETE §B — the plugin handles it.
//
//  Paste the relevant pieces into ios/App/App/AppDelegate.swift.
//

import UIKit
import Capacitor
import UserNotifications

extension AppDelegate {

    // ─────────────────────────────────────────────────────────────────────────
    // §A  Register actionable categories. Call `registerPushCategories()` from
    //     application(_:didFinishLaunchingWithOptions:). The identifiers MUST
    //     match PushCategory in notificationCategories.ts, and action ids MUST
    //     match CategoryActions[*].id.
    // ─────────────────────────────────────────────────────────────────────────
    func registerPushCategories() {
        let center = UNUserNotificationCenter.current()

        // workout_reminder → Start / Snooze
        let startSession = UNNotificationAction(
            identifier: "START_SESSION",
            title: "Start",
            options: [.foreground]
        )
        let snoozeSession = UNNotificationAction(
            identifier: "SNOOZE_SESSION",
            title: "Snooze 1h",
            options: []                       // background action; app handles reschedule
        )
        let workoutCategory = UNNotificationCategory(
            identifier: "workout_reminder",
            actions: [startSession, snoozeSession],
            intentIdentifiers: [],
            options: []
        )

        // plan_updated → View plan
        let viewPlan = UNNotificationAction(
            identifier: "VIEW_PLAN",
            title: "View plan",
            options: [.foreground]
        )
        let planCategory = UNNotificationCategory(
            identifier: "plan_updated",
            actions: [viewPlan],
            intentIdentifiers: [],
            options: []
        )

        // trial_ending → Manage plan
        let viewBilling = UNNotificationAction(
            identifier: "VIEW_BILLING",
            title: "Manage plan",
            options: [.foreground]
        )
        let trialCategory = UNNotificationCategory(
            identifier: "trial_ending",
            actions: [viewBilling],
            intentIdentifiers: [],
            options: []
        )

        center.setNotificationCategories([workoutCategory, planCategory, trialCategory])
    }

    // ─────────────────────────────────────────────────────────────────────────
    // §B  MANUAL TOKEN FORWARDING — ONLY if swizzling is DISABLED.
    //     With Capacitor's default (swizzling ON) these are provided for you and
    //     you should NOT re-declare them (duplicate symbols). Delete §B unless
    //     you set CapacitorPushNotificationsSwizzlingEnabled = NO.
    // ─────────────────────────────────────────────────────────────────────────
    /*
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken
        )
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error
        )
    }
    */
}

//
//  In application(_:didFinishLaunchingWithOptions:) add:
//
//      registerPushCategories()
//
//  before `return true`. That's the only call site needed for §A.
//
