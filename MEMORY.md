# MEMORY

## Bug Fixes Applied

- 2026-04-09: Changed the employee work-hours name picker to a real combo box with automatic reload on employee/month changes, so users can switch to another name even when one is already selected and no longer need a separate search button.
- 2026-04-09: Expanded work-hours weekly calendar rows to include adjacent-month days at the start/end of the week, and changed the `주합계` label to `주 계` while keeping monthly totals limited to the selected month.
- 2026-03-31: Fixed half-manpower (`0.5공`) regression on the daily work page by making both frontend instant calculation and backend manpower calculation accept italic markers in both `*이름*` and `<i>이름</i>` forms. This prevents loaded/imported day-work records from reverting to `1.0공` during recalculation.
- 2026-03-31: Unified the day/night work action area so the save button stays in the same place across tabs, added a `리프레쉬` button for reloading the current tab's records, and mapped `F5` to the same refresh action with overwrite confirmation when there are unsaved edits.
- 2026-04-01: Split unsaved-change tracking between day and night work tabs so refreshing or loading one tab does not clear the other tab's pending edits, and added a tab-switch warning when moving between day/night with unsaved changes.
