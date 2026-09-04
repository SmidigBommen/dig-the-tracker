# Separate stable identity from human keys

Space, Member, Column, Task, Comment, and history records use opaque stable identity; mutable names and slugs never act as relationships. Space keys and Task numbers remain human-facing, may appear in URLs, and are never reused. This prevents renames or old references from changing meaning while preserving readable Task keys such as `DIG-5`.
