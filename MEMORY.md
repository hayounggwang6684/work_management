# MEMORY

## Bug Fixes Applied

- 2026-03-31: Fixed half-manpower (`0.5공`) regression on the daily work page by making both frontend instant calculation and backend manpower calculation accept italic markers in both `*이름*` and `<i>이름</i>` forms. This prevents loaded/imported day-work records from reverting to `1.0공` during recalculation.
- 2026-03-31: Unified the day/night work action area so the save button stays in the same place across tabs, added a `리프레쉬` button for reloading the current tab's records, and mapped `F5` to the same refresh action with overwrite confirmation when there are unsaved edits.
