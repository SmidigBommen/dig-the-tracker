# Put Board behavior behind one deep Module

Board behavior lives behind a three-entry `BoardModule` Interface: `read`, `change`, and `follow`. The Module owns authorization checks, invariants, PostgreSQL transactions, ordering, history, notifications, pagination, and live updates; HTTP, React, and PostgreSQL details do not cross its Seam. This was chosen over many named methods and refresh-only signals because one command grammar and one authoritative update shape give callers more Leverage and keep Board changes local.
