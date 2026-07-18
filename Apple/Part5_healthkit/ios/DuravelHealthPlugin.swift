//
//  DuravelHealthPlugin.swift
//  Duravel iOS — Part 5 (HealthKit & wearables)
//
//  Thin custom Capacitor 6 plugin: authorization, reads, anchored incremental
//  sync, and background delivery for new Apple Watch workouts. Emits data in a
//  shape close to Duravel's shared ingestion schema (see Ingestion_Mapping.md).
//
//  Target: iOS 15+. Read-only (no HKHealthStore.save calls in v1).
//
//  Companion files:
//    - DuravelHealthPlugin.m   (Capacitor registration)
//    - definitions.ts          (JS interface)
//    - healthkit.service.ts    (web-app import surface)
//
//  Notes:
//   * HealthKit read authorization is intentionally NOT introspectable by iOS
//     for privacy: a denied read type just returns empty results. So we never
//     claim a type is "denied" — we report authorization only for the overall
//     request completion, and treat empty reads as "no data yet".
//   * Anchors are persisted in UserDefaults so incremental sync survives app
//     relaunches. The web layer may ALSO pass a `since` date as a safety net.
//

import Foundation
import Capacitor
import HealthKit

@objc(DuravelHealthPlugin)
public class DuravelHealthPlugin: CAPPlugin {

    private let healthStore = HKHealthStore()

    // UserDefaults keys for persisted HKAnchoredObjectQuery anchors.
    private let workoutAnchorKey = "duravel.hk.anchor.workout"

    // Active long-running observer queries, kept so they aren't deallocated.
    private var activeObservers: [HKObserverQuery] = []

    // MARK: - Type catalog

    /// Quantity types Duravel reads for daily context + per-workout metrics.
    private func quantityType(_ id: HKQuantityTypeIdentifier) -> HKQuantityType? {
        return HKQuantityType.quantityType(forIdentifier: id)
    }

    /// The full set of object types we request READ access to.
    private func readTypes() -> Set<HKObjectType> {
        var types: Set<HKObjectType> = [HKObjectType.workoutType()]
        let ids: [HKQuantityTypeIdentifier] = [
            .heartRate,
            .heartRateVariabilitySDNN,
            .vo2Max,
            .restingHeartRate,
            .activeEnergyBurned,
            .distanceWalkingRunning,
            .distanceCycling,
            .distanceSwimming
        ]
        for id in ids {
            if let t = quantityType(id) { types.insert(t) }
        }
        return types
    }

    // MARK: - Availability

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    // MARK: - Authorization

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device")
            return
        }
        // Read-only: no share (write) types in v1.
        healthStore.requestAuthorization(toShare: nil, read: readTypes()) { success, error in
            if let error = error {
                call.reject("Authorization failed: \(error.localizedDescription)", nil, error)
                return
            }
            // `success` == the sheet was presented/handled, NOT that everything
            // was granted (read grants are not observable). Report status for
            // the one type we CAN introspect meaningfully in aggregate.
            call.resolve(["granted": success])
        }
    }

    // MARK: - Workout sync (anchored, incremental)

    /// Pull workouts. If `sinceMillis` provided, uses a predicate floor as a
    /// safety net; otherwise relies purely on the persisted anchor.
    @objc func queryWorkouts(_ call: CAPPluginCall) {
        let sinceMillis = call.getDouble("sinceMillis")
        runWorkoutAnchoredQuery(sinceMillis: sinceMillis) { workouts, error in
            if let error = error {
                call.reject("queryWorkouts failed: \(error.localizedDescription)", nil, error)
                return
            }
            call.resolve(["workouts": workouts])
        }
    }

    private func loadAnchor(_ key: String) -> HKQueryAnchor? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    private func saveAnchor(_ anchor: HKQueryAnchor?, key: String) {
        guard let anchor = anchor,
              let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
        else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    private func runWorkoutAnchoredQuery(sinceMillis: Double?,
                                         completion: @escaping ([[String: Any]], Error?) -> Void) {
        let anchor = loadAnchor(workoutAnchorKey)

        var predicate: NSPredicate? = nil
        if let sinceMillis = sinceMillis {
            let start = Date(timeIntervalSince1970: sinceMillis / 1000.0)
            predicate = HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate)
        }

        let query = HKAnchoredObjectQuery(
            type: HKObjectType.workoutType(),
            predicate: predicate,
            anchor: anchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, newAnchor, error in
            guard let self = self else { return }
            if let error = error {
                completion([], error)
                return
            }
            self.saveAnchor(newAnchor, key: self.workoutAnchorKey)

            let workouts = (samples as? [HKWorkout]) ?? []
            // Enrich each workout with per-workout metric summaries, then return.
            self.serializeWorkouts(workouts) { serialized in
                completion(serialized, nil)
            }
        }
        healthStore.execute(query)
    }

    // MARK: - Workout serialization + per-workout metric enrichment

    private func serializeWorkouts(_ workouts: [HKWorkout],
                                   completion: @escaping ([[String: Any]]) -> Void) {
        guard !workouts.isEmpty else { completion([]); return }

        let group = DispatchGroup()
        var results: [[String: Any]] = []
        let lock = NSLock()

        for workout in workouts {
            group.enter()
            enrich(workout: workout) { dict in
                lock.lock(); results.append(dict); lock.unlock()
                group.leave()
            }
        }

        group.notify(queue: .main) {
            completion(results)
        }
    }

    /// Build the JSON dict for one workout, including avg/max HR and totals for
    /// the window of the workout. Distance/energy come from HKWorkout totals
    /// where present; HR is averaged from samples inside the workout window.
    private func enrich(workout: HKWorkout, completion: @escaping ([String: Any]) -> Void) {
        var dict: [String: Any] = [
            "uuid": workout.uuid.uuidString,
            "activityType": activityTypeName(workout.workoutActivityType),
            "activityTypeRaw": Int(workout.workoutActivityType.rawValue),
            "startDate": isoString(workout.startDate),
            "endDate": isoString(workout.endDate),
            "startMillis": workout.startDate.timeIntervalSince1970 * 1000.0,
            "endMillis": workout.endDate.timeIntervalSince1970 * 1000.0,
            "durationSeconds": workout.duration,
            "sourceName": workout.sourceRevision.source.name,
            "sourceBundleId": workout.sourceRevision.source.bundleIdentifier,
            "deviceName": workout.device?.name ?? NSNull(),
            "wasUserEntered": workout.metadata?[HKMetadataKeyWasUserEntered] as? Bool ?? false
        ]

        // Totals (HealthKit 15 exposes these convenience accessors).
        if let energy = workout.totalEnergyBurned {
            dict["activeEnergyKcal"] = energy.doubleValue(for: .kilocalorie())
        } else {
            dict["activeEnergyKcal"] = NSNull()
        }
        if let distance = workout.totalDistance {
            dict["distanceMeters"] = distance.doubleValue(for: .meter())
        } else {
            dict["distanceMeters"] = NSNull()
        }

        // Average + max heart rate over the workout window.
        averageAndMaxHeartRate(start: workout.startDate, end: workout.endDate) { avg, max in
            dict["avgHeartRate"] = avg ?? NSNull()
            dict["maxHeartRate"] = max ?? NSNull()
            completion(dict)
        }
    }

    private func averageAndMaxHeartRate(start: Date, end: Date,
                                        completion: @escaping (Double?, Double?) -> Void) {
        guard let hrType = quantityType(.heartRate) else { completion(nil, nil); return }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let bpmUnit = HKUnit.count().unitDivided(by: .minute())

        let query = HKStatisticsQuery(quantityType: hrType,
                                      quantitySamplePredicate: predicate,
                                      options: [.discreteAverage, .discreteMax]) { _, stats, _ in
            let avg = stats?.averageQuantity()?.doubleValue(for: bpmUnit)
            let max = stats?.maximumQuantity()?.doubleValue(for: bpmUnit)
            completion(avg, max)
        }
        healthStore.execute(query)
    }

    // MARK: - Daily-context quantity reads (resting HR, HRV, VO2max, etc.)

    /// Generic quantity reader for the daily-context types. Returns the latest
    /// sample(s) in [start,end]. `identifier` is the JS-friendly key.
    @objc func queryQuantity(_ call: CAPPluginCall) {
        guard let identifier = call.getString("identifier") else {
            call.reject("Missing 'identifier'")
            return
        }
        guard let (type, unit) = quantityTypeAndUnit(for: identifier) else {
            call.reject("Unsupported identifier: \(identifier)")
            return
        }

        let end = Date()
        let start: Date
        if let sinceMillis = call.getDouble("sinceMillis") {
            start = Date(timeIntervalSince1970: sinceMillis / 1000.0)
        } else {
            // default: last 30 days
            start = Calendar.current.date(byAdding: .day, value: -30, to: end) ?? end
        }
        let limit = call.getInt("limit") ?? 500

        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]

        let query = HKSampleQuery(sampleType: type,
                                  predicate: predicate,
                                  limit: limit,
                                  sortDescriptors: sort) { _, samples, error in
            if let error = error {
                call.reject("queryQuantity failed: \(error.localizedDescription)", nil, error)
                return
            }
            let out: [[String: Any]] = (samples as? [HKQuantitySample] ?? []).map { s in
                [
                    "uuid": s.uuid.uuidString,
                    "value": s.quantity.doubleValue(for: unit),
                    "unit": self.unitDisplay(for: identifier),
                    "startDate": self.isoString(s.startDate),
                    "endDate": self.isoString(s.endDate),
                    "startMillis": s.startDate.timeIntervalSince1970 * 1000.0,
                    "sourceName": s.sourceRevision.source.name
                ]
            }
            call.resolve(["samples": out])
        }
        healthStore.execute(query)
    }

    private func quantityTypeAndUnit(for identifier: String) -> (HKQuantityType, HKUnit)? {
        switch identifier {
        case "heartRate":
            guard let t = quantityType(.heartRate) else { return nil }
            return (t, HKUnit.count().unitDivided(by: .minute()))
        case "restingHeartRate":
            guard let t = quantityType(.restingHeartRate) else { return nil }
            return (t, HKUnit.count().unitDivided(by: .minute()))
        case "hrvSDNN":
            guard let t = quantityType(.heartRateVariabilitySDNN) else { return nil }
            return (t, HKUnit.secondUnit(with: .milli))
        case "vo2Max":
            guard let t = quantityType(.vo2Max) else { return nil }
            // ml/(kg·min)
            let ml = HKUnit.literUnit(with: .milli)
            let perKgMin = HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute())
            return (t, ml.unitDivided(by: perKgMin))
        case "activeEnergy":
            guard let t = quantityType(.activeEnergyBurned) else { return nil }
            return (t, HKUnit.kilocalorie())
        case "distanceWalkingRunning":
            guard let t = quantityType(.distanceWalkingRunning) else { return nil }
            return (t, HKUnit.meter())
        case "distanceCycling":
            guard let t = quantityType(.distanceCycling) else { return nil }
            return (t, HKUnit.meter())
        default:
            return nil
        }
    }

    private func unitDisplay(for identifier: String) -> String {
        switch identifier {
        case "heartRate", "restingHeartRate": return "count/min"
        case "hrvSDNN": return "ms"
        case "vo2Max": return "ml/kg/min"
        case "activeEnergy": return "kcal"
        case "distanceWalkingRunning", "distanceCycling": return "m"
        default: return ""
        }
    }

    // MARK: - Background delivery + observers

    /// Register an observer + background delivery for workouts so new Apple
    /// Watch workouts wake Duravel and trigger an anchored sync. Idempotent-ish:
    /// safe to call once after authorization and again on cold start.
    @objc func startBackgroundSync(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device")
            return
        }
        let workoutType = HKObjectType.workoutType()

        let observer = HKObserverQuery(sampleType: workoutType, predicate: nil) { [weak self] _, completionHandler, error in
            guard let self = self else { completionHandler(); return }
            if error != nil {
                // Must still call the completion handler so HealthKit doesn't
                // back off / stop delivering.
                completionHandler()
                return
            }
            // Pull new workouts via the persisted anchor, then notify JS.
            self.runWorkoutAnchoredQuery(sinceMillis: nil) { workouts, _ in
                if !workouts.isEmpty {
                    self.notifyListeners("workoutsUpdated", data: ["workouts": workouts])
                }
                // Signal HealthKit we've finished handling this background wake.
                completionHandler()
            }
        }

        healthStore.execute(observer)
        activeObservers.append(observer)

        // Ask HealthKit to wake us for new workouts. .immediate is honored for
        // workout/category types; frequency is a floor, HealthKit may batch.
        healthStore.enableBackgroundDelivery(for: workoutType, frequency: .immediate) { success, error in
            if let error = error {
                call.reject("enableBackgroundDelivery failed: \(error.localizedDescription)", nil, error)
                return
            }
            call.resolve(["backgroundDeliveryEnabled": success])
        }
    }

    /// Stop background delivery + tear down observers (e.g. on logout).
    @objc func stopBackgroundSync(_ call: CAPPluginCall) {
        for q in activeObservers { healthStore.stop(q) }
        activeObservers.removeAll()
        healthStore.disableAllBackgroundDelivery { success, error in
            if let error = error {
                call.reject("disableAllBackgroundDelivery failed: \(error.localizedDescription)", nil, error)
                return
            }
            call.resolve(["stopped": success])
        }
    }

    /// Reset the persisted anchor (forces the next sync to re-read everything).
    /// Useful for debugging / a "re-sync from scratch" button.
    @objc func resetSyncAnchor(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: workoutAnchorKey)
        call.resolve(["reset": true])
    }

    // MARK: - Helpers

    private lazy var isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private func isoString(_ date: Date) -> String {
        return isoFormatter.string(from: date)
    }

    /// Map HKWorkoutActivityType to a stable string Duravel understands.
    /// Keep in sync with the mapping table in Ingestion_Mapping.md.
    private func activityTypeName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "run"
        case .walking: return "walk"
        case .cycling: return "ride"
        case .swimming: return "swim"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "strength"
        case .highIntensityIntervalTraining: return "hiit"
        case .rowing: return "row"
        case .elliptical: return "elliptical"
        case .stairClimbing, .stairs: return "stairs"
        case .coreTraining: return "core"
        case .crossTraining: return "cross_training"
        case .mixedCardio: return "cardio"
        case .hiking: return "hike"
        case .yoga: return "yoga"
        case .flexibility: return "mobility"
        default: return "other"
        }
    }
}
