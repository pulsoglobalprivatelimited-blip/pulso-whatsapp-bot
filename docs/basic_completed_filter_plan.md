# "Basic completed" number on the desk: plan

7 Oct 2026. Founder: "Create one more filter basic completed."

## What you will see

In **The numbers** on the Provider tab, one more box, right after
"Total females completed":

> **20**  Basic completed

Tap it, and the list shows only those 20 people: every caregiver who finished
joining (Done) on the Basic rate.

## Who is counted as Basic

Anyone whose joining is complete and who is on the Basic rate:

- approved as **Basic caregiver** (no certificate, nursing students, and
  anyone approved as Basic after a call), or
- approved on the **Basic rate** for another reason, for example above 50,
  even if her qualification is GNM or GDA.

Today that is **20** people. All 20 are both Basic caregivers and on the Basic
rate, so the two ways of counting agree.

## What does not change

- The other numbers stay as they are.
- Nothing is sent to anyone. This is only a count and a filter on the desk.

## Steps

1. Add the box and its count.
2. Tapping it filters the list to Done + Basic.
3. Tests, then live on whatsapp.pulso.co.in.

About half an hour of work. One bot deploy, and no app release needed.

## For the developer

- Markup: `src/public/admin/index.html`, a new `metric-button`
  `#completed-basic-metric` / `#completed-basic-count` after
  `#completed-female-metric`; bump the `?v=` on `dashboard.js`.
- Count in `src/public/assets/dashboard.js` next to line ~1030:
  `getDashboardStatus(p) === 'completed' && (p.careTier === 'basic' || p.qualification === 'basic_caregiver')`.
- Click handler like `completedFemaleMetric`: `applyCompletedMetricFilter('all')`
  plus a Basic predicate. Extend `applyCompletedMetricFilter` with an optional
  `tier` argument rather than a second filter path.
- Live check on 7 Oct 2026 (`providers` where `status == 'completed'`): 590
  completed, 20 with `qualification == 'basic_caregiver'`, 20 with
  `careTier == 'basic'`, and the same 20 in both.
