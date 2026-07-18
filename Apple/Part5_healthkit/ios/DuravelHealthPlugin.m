//
//  DuravelHealthPlugin.m
//  Duravel iOS — Part 5 (HealthKit & wearables)
//
//  Capacitor 6 Objective-C registration macros. This is what makes the Swift
//  plugin (and each @objc method) visible to the Capacitor JS bridge. The
//  JS-side plugin name here ("DuravelHealth") MUST match registerPlugin<>()
//  in definitions.ts.
//
//  Place alongside DuravelHealthPlugin.swift in ios/App/App/.
//

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(DuravelHealthPlugin, "DuravelHealth",
    CAP_PLUGIN_METHOD(isAvailable, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestAuthorization, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(queryWorkouts, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(queryQuantity, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(startBackgroundSync, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopBackgroundSync, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(resetSyncAnchor, CAPPluginReturnPromise);
)
