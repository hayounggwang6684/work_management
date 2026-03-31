# MEMORY

## Bug Fixes Applied

- 2026-03-31: Fixed half-manpower (`0.5공`) regression on the daily work page by making both frontend instant calculation and backend manpower calculation accept italic markers in both `*이름*` and `<i>이름</i>` forms. This prevents loaded/imported day-work records from reverting to `1.0공` during recalculation.
