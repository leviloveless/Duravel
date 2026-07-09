# Training Program App — Requirements Questionnaire

Fill in your answers below each question. Save the file when done.

---

## User Profile Inputs

1. What experience levels should the app support? (e.g., beginner / intermediate / advanced, or a numeric scale like years of training?)

   **Answer:** Mandatory inputs for experience level (Beginner, intermediate, advanced) for running, hybrid fitness, and weight lifting. 
   The runner experience levels are defined as 1. beginner = sustained less than 15 miles per week in the last six months; 2. intermediate = sustained 15-30 miles per week in the last six months; 3. advanced = sustained greater than 30 miles per week. 
   Hybrid experience levels are defined as 1. beginner = sustained 1 or fewer hybrid HIIT workouts per week in the last six months combined with other weight lifting / cardio training; 2. intermediate = sustained 2 hybrid HIIT workouts per week in the last six months combined with other weight lifting / cardio training; 3. advanced = hybrid 3 or more HIIT workouts per week in the last six months combined with other weight lifting / cardio training. 
   The lifting experience levels are defined as 1. beginner = lifting weights consistently for less than 3 years; 2. intermediate = lifting weights consistently for 3-5 years; 3. advanced = lifting weights consistently for more than 5 years.

2. Should users input current fitness benchmarks? If so, which ones? (e.g., 1-mile pace, 5K time, 1RM squat/deadlift/clean, etc.)

   **Answer:** Optional inputs for: 1. 1 mile time; 2. 5k time; 3. 10k time; 4. 5 rep max squat; 5. 5 rep max squat; 6. 5 rep max deadlift; 7. 2000 meter ski erg time; 8. 2000 meter row erg time; 9. calories burned in 20 minutes on assault bike

3. Should the app account for injuries or physical limitations, or is that out of scope for v1?

   **Answer:** No

4. Should users specify their body weight? (relevant for relative strength calculations)

   **Answer:** Yes; Bodyweight will be used for relative strength

---

## Goal & Event Parameters

5. What event types should the app target? (HYROX, obstacle races like Spartan, general hybrid fitness, running races, powerlifting meets, or all of the above?)

   **Answer:** To start, this will be exclusively for preparing for hyrox. 

6. Should users input a specific goal event date, or just a training duration (e.g., "16-week program")?

   **Answer:** Users should have the option to set a specific goal event date or a specific training duration, with a minimum 4 week training duration.

7. Should the app support multiple goals simultaneously (e.g., a 10K in 8 weeks and a HYROX race in 20 weeks), or one goal at a time?

   **Answer:** It should be able to support multiple races in 1 program; for example, if you have a hyrox scheduled in 10 weeks, 14 weeks, and 20 weeks, it should adjust training so that the user is tapered going into each race. However, the user should be able to select the importance of the race using "A Race", "B Race", or "C Race". An A race is the most importan type, it must be given a 2-3 week taper when possible. A B race is the 2nd most important, it should be given approximately a 1 week taper if possible. A C race is the least important and can be either a non-important race or even a fitness test like a 5k at max effort.

8. Should there be a "no event / general fitness" option?

   **Answer:** Yes

---

## Weekly Schedule & Equipment

9. How should weekly training availability be captured — days per week, or specific days (Mon/Tue/etc.)?

   **Answer:** specific days

10. Should users specify time available per session, or will the app output a standard session length?

    **Answer:** Standard session length for now.

11. What equipment options should the app account for? (Full gym, home gym with barbells, minimal/bodyweight only, access to a track, treadmill vs. outdoor running, etc.)

    **Answer:** Assume access to all equipment

12. Should the app ask about cardio equipment specifically? (assault bike, ski erg, rowing machine — all relevant for HYROX-style training)

    **Answer:** Assume access to all equipment

---

## Periodization Philosophy (your rules)

13. What block/mesocycle structure do you want to use? (e.g., 3-week build + 1-week deload, 4+1, 5+1?)

    **Answer:** User must select "Non-highly trained" or "highly-trained (extensive high volume training history)". The general structure will be as follows: Non-highly trained option: (1) Week 1 rebound (use volume from prior increase week), (2) week 2 increase (7.5% increase in mileage and 10% increase in total cardio volume), (3) deload [40% decrease in mileage and cardio volume]; Highly trained option: (1) Week 1 rebound (use volume from prior increase week), (2) week 2 increase (7.5% increase in mileage and 10% increase in total cardio volume), (3) week 3 increase (7.5% increase in mileage and 10% increase in total cardio volume),(4) deload [40% decrease in mileage and cardio volume]. The 3 or 4 week cycle will repeat in perpetuity until a race is coming up. Begin the taper for an A race 2 weeks out, begin the taper for a B race 1 week out. Only do a 3-4 day taper a C race. These 3 and 4 week cycles will constitute the micro-cycle within each mesocycle (mesocycles are the base, build, peak, and taper phases).

14. What training phases do you want the app to build through? (e.g., Base → Build → Peak → Taper, or something different?)

    **Answer:** Yes use the suggested structure. Base should be the largest mesocycle. 
    For example, in a 21 week training plan for a "non-highly trained" individual, the weeks dedicated to each mesocycle preparing for an A race should be 9 weeks base, 6 weeks build, 3 weeks peak, 3 week taper. 
    For example, in a 21 week training plan for a "highly trained" individual, the weeks dedicated to each mesocycle preparing for an A race should be 8 weeks base, 8 weeks build, 2 weeks peak, 2 week taper.
    Off-Season / Base Building (Months 1–3): Focus on "speed play" (Fartleks) or progression runs where you just naturally pick up the pace over the last 10-15 minutes of an easy run. This keeps the physiological systems primed without introducing high training stress. Pre-Competition Phase (Months 4–6): Start scheduling structured, continuous tempo runs (or tempo intervals) once a week. Aim for 20–35 minutes of running at about 80-90% of your maximum heart rate (or your half-marathon race pace).Peak Racing Phase (Months 7–9): Keep 1 tempo session per week but focus on pushing right up to your lactate threshold. This pace should feel "comfortably hard" (about 20-30 seconds slower than 5K pace) where you can only speak in short sentences.

15. How should the app balance the three modalities week to week? Should the ratio shift across phases (e.g., more aerobic base early, more intensity and hybrid work later)?

    **Answer:** Generally, the training should get more specific the closer to the race; i.e., build general physical fitness early and shift to more high intensity and hybrid work closer to the race. The split should be based on the individuals week points. If a person needs more running volume the program should prioritize increasing running volume; needs more aerobic base, focus more aerobic base; needs more threshold work, focus more threshold work, etc. The program should have some functional tests that are designed to determine what the user needs most.

16. What lifting movements do you consider non-negotiable in a well-built program? (e.g., squat, hinge, press, pull — and specific exercises you always want included?)

    **Answer:** Squat, hip hinge, lunge, horizontal press, vertical press, horizontal pull, vertical pull.

17. What running workout types do you want represented? (Easy/zone 2, tempo, intervals, long run — and how many of each per week at different phases?)

    **Answer:** Minimum 3 runs per week. Max 8 runs per week. Minimum: 1 long run, 1 tempo, 1 easy. Max: 2 long runs, 2 threshold runs, 2 easy runs, 1 interval run. All runs during hybrid workouts will be at a threshold pace, these will be counted in the total number of runs per week. Phases closer to the race should be higher intensity, phases towards the beginning should be more easy running.

18. What counts as a "hybrid workout" in your system? (e.g., circuits mixing runs and loaded carries, HYROX-simulation workouts, metcons, etc.)

    **Answer:** Hyrox type workouts; a mix of runs and non-running cardio like burpees, ski erg, row erg, etc.

19. How do you want intensity prescribed — RPE, heart rate zones, percentage of 1RM, pace zones, or a mix?

    **Answer:** Heart rate zones.

20. How should the app handle tapering before an event? (Duration of taper, how aggressively to drop volume/intensity?)

    **Answer:** A race taper = 2 week taper with 30% volume reduction taper week 1 then another 30% volume reduction taper week 2. B race taper = 1 week 40% reduction in volume (standard deload). C race taper = 3-4 day reduction in volume by 40%. In all tapers, you should start by cutting back easy training volume, then moderate intensity, then high intensity, with the last training day being 2-3 days out of the race and the last hard training day being 5-7 days out.

21. Are there any training methodologies or approaches you specifically want to avoid?

    **Answer:** No.

---

## Program Output & V1 Scope

22. How many weeks should a generated program cover — fixed length (e.g., always 12 weeks), or dynamic based on goal date?

    **Answer:** Select a goal date or a program length, within 4-24 weeks.

23. What should a single day's output look like? (Exercise, sets × reps, rest periods, notes — how much detail do you want?)

    **Answer:** For hybrid workouts, it should provide a pacing estimate for the runs and the exercise x reps x weight for the exercises and desired heart rate zones for the training session. For Runs it should be run time x pace x distance (as a factor of time and pace) and goal HR. For weight lifting workouts, simply stick to 1 upper body, 1 lower body, and 1 full body session. For each you will just insert the name of the movement pattern (e.g., squat, hip hinge), the # of sets, and the rep range (5-7 on full body days and 12-15 on upper/lower days). The progarm should provide an estimate of total cardio minutes per week, total miles per week, and % of cardio time in zone 1, zone 2, zone 3, zone 4, and zone 5. The goal is for the total cardio training time to be about 20% zone 1, 60% zone 2, 10% zone 3, 5% zone 4, 5% zone 5. Do not take weightlifting workouts into account for cardio training time.

24. Should the app distinguish between "A" and "B" workout variants, or is each session unique?

    **Answer:** There should be a basic repeatable set of workouts that the program uses and may switch out from mesocycle to mesocycle.

25. For v1, should users be able to regenerate or adjust the program after seeing it, or is one-shot generation enough?

    **Answer:** The idea is that the training program is written in full at the beginning but will be updated on a weekly basis to adjust the next week of training based on the current week's performance.

26. Should the program be exportable (PDF, copy to clipboard), or just viewable on screen for v1?

    **Answer:** Only viewable on screen for now.

27. Should the app display the full program at once, or week by week?

    **Answer:** Full program. 

---

## Tech Stack & Build Decisions

28. Are you building this yourself, hiring a developer, or using me to help build it directly?

    **Answer:** Using you to help me build this.

29. Do you have a preference for frontend framework, or are you open to a recommendation?

    **Answer:** Open to recommendation.

30. Do you want user accounts and saved programs in v1, or truly stateless (generate → view → done)?

    **Answer:** User accounts.

31. What's your budget for API costs and hosting per month? (This affects AI model choice and architecture.)

    **Answer:** $50/month currently. 

32. Web only for v1, or do you want a mobile-ready responsive design from the start?

    **Answer:** Web only for now.

33. Do you have a domain name in mind, or is that a later concern?

    **Answer:** Later concern. Use "HyroxAI" for now.
