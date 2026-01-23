Value function page requirements
--------------------------------
- Layout: left sidebar with scrollable criteria list showing progress and allowing navigation. Main panel handles the current criterion. No limit on criteria count. Navigation auto-saves edits.
- Step 1 (shape): four options with tooltips; default is piecewise linear increasing. Options are piecewise linear increasing, piecewise linear decreasing, gaussian positive (bell), gaussian negative (inverted bell).
- Step 2 (thresholds): ask for low and high within the criterion range (min/max come from DB data). Real-time validation; auto-clamp out-of-range entries and show a tooltip noting the clamp.
- Step 3 (adjustment): choose “mid-splitting technique” (default) or “free edit”.
	- Mid-splitting flow (one question at a time; each can be skipped):
		1) Ask: which point X makes the increase from [min]→X equally important as X→[max]? Adds point (X, 0.5). Skipping this step skips all others and keeps the function linear.
		2) Repeat on range min→X. Adds point at X with Y = 0.25 (increasing) or 0.75 (decreasing). Can be skipped independently if step 1 was answered.
		3) Repeat on range X→max. Adds point at X with Y = 0.75 (increasing) or 0.25 (decreasing). Can be skipped independently if step 1 was answered.
		- Result must stay monotonic based on chosen linear shape.
	- Free edit, linear shapes: user can add points numerically and move them on the plot; max 10 points; keep endpoints within range.
	- Free edit, gaussian shapes: sliders for mean and sigma (sigma is a range control). Mean must stay in-range so there is at least one Y=0 and one Y=1 inside the range. User can edit the number of points used to draw the bell (default 10).
- Plot: always visible under the controls; updates on every change; shows thresholds and supports dragging when in linear free edit.
- Function bounds: Y in [0, 1]; X between each criterion’s min and max.
- Data storage: store an array of (x, y) points per criterion; always save to DB; auto-save edits and when switching criteria.
- Download: available from the output page as CSV with rows `CRITERION_NAME, LIST OF POINTS`, where points are serialized (e.g., `x1:y1;x2:y2`).

