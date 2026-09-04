# Dig task management

Dig helps small teams manage work through a flow-based kanban system. This glossary defines the target language for the first team MVP; the current prototype still uses older terms in places.

## Language

**Space**:
The named membership boundary for one team's work. Each space contains members and exactly one board.
_Avoid_: Project, workspace

**Space time zone**:
The IANA time zone that defines calendar boundaries for one space's reports and scheduled actions.
_Avoid_: Member time zone, server time zone

**Archived space**:
A read-only space removed from normal navigation while its board, membership, and history remain recoverable.
_Avoid_: Deleted space, inactive project

**Space key**:
The immutable short code chosen when a space is created and used to form its task keys, such as `DIG`. A space key is unique and never reused within one Dig installation.
_Avoid_: Project key, board key

**Board**:
The unnamed, ordered set of columns and tasks within a space. Each board has exactly one intake column and one completion column.
_Avoid_: Project

**Member**:
An authenticated person accepted into a space. Members manage the board's work; some members are also space administrators.
_Avoid_: User, account, local actor

**Space administrator**:
A member who can manage invitations, membership, space settings, and permanent space deletion. Every space has at least one space administrator.
_Avoid_: Owner, superuser, board administrator

**Installation administrator**:
An authenticated person permitted to create spaces in one Dig installation. An installation administrator becomes the first space administrator of each space they create.
_Avoid_: System user, superuser

**Invitation**:
A revocable, single-use grant that lets one authenticated person become a member of a space before the invitation expires.
_Avoid_: Invite code, signup link

**Former member**:
A person whose membership in a space has ended. Their authorship and flow history remain attributed to them, but their open tasks become unassigned.
_Avoid_: Deleted member, inactive user

**Assignee**:
The member responsible for a task. A task may have one assignee or remain unassigned.
_Avoid_: Owner, assignees

**Column**:
An ordered lane on the board with a stable flow role and a customizable name. Each active task belongs to one column.
_Avoid_: Status

**Flow role**:
The meaning a column has in the board's workflow: Queue, Active, or Complete. Several columns may share the Queue or Active role, but exactly one has the Complete role.
_Avoid_: Status, category

**Completion column**:
The board's only column with the Complete flow role. Entering this column closes a task; its default name is `Done`.
_Avoid_: Done status, closed column

**Intake column**:
The board's designated Queue column where every new task and subtask enters; its default name is `Backlog`.
_Avoid_: Default column, inbox

**Archived column**:
A column removed from the active board after all its tasks have moved elsewhere. Its identity and earlier transitions remain in flow history.
_Avoid_: Deleted column, hidden column

**Work-in-progress limit**:
The required positive limit on tasks in an Active column. Exceeding the limit produces a warning but does not block movement.
_Avoid_: Task limit, capacity

**Task**:
A numbered item of work on the board.
_Avoid_: Issue, ticket, card

**Task key**:
The space-visible identifier formed from its space key and a task number, such as `DIG-5`. Task numbers are never reused within a space.
_Avoid_: Task ID, issue ID

**Task reference**:
A task key written in a description or comment to link related work. Dig resolves the link only for members who can access the referenced task's space.
_Avoid_: Dependency, relation

**Closed task**:
A task whose work ended by entering the completion column. A closed task has an outcome and remains closed if it later archives.
_Avoid_: Done task, resolved task, finished task

**Outcome**:
The reason a task was closed. Completed means the intended work finished; Rejected means the team did not accept it; Duplicate means another task in the same space represents it; Cancelled means accepted work stopped deliberately.
_Avoid_: Resolution, status

**Column transition**:
An immutable record that a member moved a task from one column to another at a specific time. Column transitions provide the history used to measure flow.
_Avoid_: Status change, activity

**Column age**:
The elapsed time since a task most recently entered its current column.
_Avoid_: Task age, time open

**Cycle time**:
The elapsed calendar time from a task's first entry into an Active column until its latest closure. Reopening does not restart the clock.
_Avoid_: Lead time, completion time

**Archived task**:
A task removed from the active board without deleting its comments or flow history. Archiving a parent also archives its subtasks.
_Avoid_: Deleted task, closed task

**Tag**:
A space-scoped label used to group tasks. Tags are unique without regard to letter case.
_Avoid_: Category, component

**Subtask**:
A task directly beneath one parent task. A subtask keeps its own task key and column, and cannot have subtasks of its own.
_Avoid_: Checklist item, child issue

**Comment**:
A time-stamped note attached to one task and attributed to a member.
_Avoid_: Message, activity

**Mention**:
A reference to a current member in a comment that directs their attention to the task.
_Avoid_: Tag, notification

**Notification**:
A temporary inbox item that directs a member to a new assignment, mention, or comment on one of their assigned tasks.
_Avoid_: Activity, message
