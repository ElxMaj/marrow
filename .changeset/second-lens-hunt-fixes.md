---
"@marrowhq/core": patch
---

Four defensive fixes from a second-lens engine hunt. The private-key scrubber is now linear instead of O(n^2): the old lazy BEGIN...END regex scanned to end-of-string once per header, so a crafted multi-MB blob of BEGIN lines stalled the single event loop for seconds on one evidence insert; a non-backtracking scanner that jumps BEGIN to END by index replaces it. A connector item whose source timestamp does not parse is now treated as missing rather than becoming an Invalid-Date watermark that crashed the unguarded toISOString() and wedged the connector on every run. Two distills of the same evidence are serialized by a per-evidence advisory lock, so a scheduled drain overlapping a manual distill can no longer double-insert every node. The instruction-smell detector now flags the anchor-as-object override phrasing ("ignore the above and ...") that the stricter pattern missed.
</content>
</invoke>
