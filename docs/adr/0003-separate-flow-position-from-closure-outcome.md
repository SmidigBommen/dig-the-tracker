# Separate flow position from closure outcome

Each board has one intake column, one completion column, and columns with stable Queue, Active, or Complete flow roles beneath customizable names. Entering the completion column closes a task with an Outcome, while append-only transitions record movement, closure, reopening, and Outcome changes beside ordinary current-state tables. This supports WIP, aging, and Cycle-time evidence without tying behavior to a column name or event-sourcing the application.
