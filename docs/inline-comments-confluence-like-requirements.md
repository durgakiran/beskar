# Inline Comments Requirements

## Summary

Beskar supports inline comments in both edit mode and view mode.

The visibility rules are:

- If a comment is added in edit mode and the document is not published after that, the comment is visible only in edit mode.
- If a comment is added in edit mode and the document is published after that, the comment is visible in both edit mode and view mode.
- If a comment is added in view mode, the comment is visible immediately in both edit mode and view mode.

## Problem Statement

Inline comments already exist in the editor, but visibility is inconsistent across edit and view modes. The behavior needs to be well-defined across draft content, published content, and comments created directly from the view surface.

The solution must also define what happens when the commented text is edited or removed.

## Goals

- Allow adding inline comments in both edit mode and view mode.
- Make comment visibility deterministic across edit and view mode.
- Preserve highlighted comment anchors when possible.
- Handle text edits and text deletion predictably.
- Keep the implementation understandable and operationally simple.

## Non-Goals

- Building a completely generic document anchoring engine.
- Supporting silent background mutations that make comment visibility unpredictable.
- Requiring users to understand draft versus published internals in order to use comments.

## User Stories

- As an editor, I can add an inline comment in edit mode.
- As a viewer, I can add an inline comment in view mode.
- As an editor, I can see unpublished edit-mode comments in edit mode.
- As a viewer, I can see published comments in view mode.
- As a user, if I add a comment in view mode, I can see it immediately in both modes.
- As a user, if the commented text is removed, I can still access the thread and understand that its anchor is no longer valid.

## Functional Requirements

### FR1. Separate comment origin semantics

Each inline comment must record where it was created:

- `origin = edit`
- `origin = view`

This origin determines visibility behavior.

### FR2. Edit-mode comments follow draft/publish visibility

For comments created in edit mode:

- the comment must be visible immediately in edit mode
- the comment must not be visible in view mode until the document is published after the comment was added
- after publish, the comment must be visible in both edit mode and view mode

### FR3. View-mode comments are immediately visible everywhere

For comments created in view mode:

- the comment must be visible immediately in view mode
- the comment must be visible immediately in edit mode
- the comment must not require a later publish action to appear in view mode

### FR4. Inline highlight behavior

- A visible inline comment must show a highlight over its anchored text.
- Clicking the highlighted text must open the corresponding thread.
- Highlight styling should remain consistent across edit mode and view mode.

### FR5. Thread actions

- Users must be able to open, reply to, resolve, unresolve, and delete threads from both modes, subject to permissions.
- Deleting a thread must also remove or deactivate its highlight.

### FR6. Text removal and anchor loss

If the anchored text is changed or removed:

- the system must try to preserve the anchor when the text still exists in a matchable form
- if the anchor can no longer be resolved, the thread must be marked orphaned
- orphaned threads must remain accessible from the comment side panel
- orphaned threads must indicate that the original text was removed or changed

## Visibility Matrix

### Comment created in edit mode

- Edit mode before publish: visible
- View mode before publish: not visible
- Edit mode after publish: visible
- View mode after publish: visible

### Comment created in view mode

- Edit mode immediately after creation: visible
- View mode immediately after creation: visible
- Edit mode after later publishes: visible
- View mode after later publishes: visible

## Text Removal Edge Cases

### EC1. Exact commented text deleted in edit mode

- The comment thread remains.
- The inline highlight disappears because there is no anchorable text.
- The thread is marked orphaned.
- The user can still open, reply to, resolve, or delete the thread.

### EC2. Exact commented text deleted in view mode

- The same orphaning behavior applies.
- The thread remains accessible.
- The UI must clearly indicate that the original text no longer exists.

### EC3. Commented text partially edited

- If the anchor can still be resolved to the intended text span, preserve the highlight.
- If the anchor cannot be resolved confidently, mark the thread orphaned.

### EC4. Whole block deleted

- All inline comments anchored only to that block become orphaned.

### EC5. Text moved

- If the editor model preserves the underlying anchor, keep the comment attached.
- If the move breaks the anchor identity, mark the thread orphaned.

### EC6. Published text differs from draft text

- Edit mode must show anchors against the current edit representation.
- View mode must show anchors against the current visible representation.
- A comment should only appear in a mode if its anchor resolves in that mode's visible content.

## Data Requirements

Each thread must include:

- `commentId`
- `origin`
- enough anchor data to render the highlight in the applicable mode or modes
- orphaned state when the anchor can no longer be resolved

## Acceptance Criteria

- Add a comment in edit mode, do not publish, open view mode: comment is not visible in view mode.
- Add a comment in edit mode, publish, open view mode: comment is visible in both modes.
- Add a comment in view mode: comment is visible immediately in both modes.
- Delete commented text: comment becomes orphaned and remains accessible from the thread list.
- Delete an orphaned comment thread: it is removed from both modes.
