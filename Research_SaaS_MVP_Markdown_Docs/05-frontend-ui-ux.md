# 5. Frontend and UI/UX Specification

## 5.1 Design direction

Use a premium, editorial, minimal, document-first interface. Favor readable typography, clear hierarchy, restrained color, consistent spacing, subtle motion, and reliable document interaction. Avoid visual effects that compete with reading.

Suggested visual direction:
- Dark slate shell or neutral light workspace, with user-selectable theme if feasible.
- Cyan accent for active tools and selected states.
- Accessible contrast and visible keyboard focus.
- Clear loading, empty, error, saved, saving, and offline states.
- Consistent iconography and restrained animation.

## 5.2 Suggested frontend stack

- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- PDF.js for rendering and text selection
- Konva.js or tldraw for workspace canvas after evaluation
- TanStack Query for server state
- Zustand or Redux Toolkit for client state
- React Hook Form and schema validation
- Playwright for end-to-end tests

## 5.3 Screens

1. Marketing landing page
2. Sign up/login/password recovery
3. Dashboard and recent projects
4. Project document manager
5. PDF reading workspace
6. Search results with source navigation
7. Billing and usage
8. Account/security settings
9. Admin dashboard (Filament)
10. Help/privacy/terms pages

## 5.4 Workspace layout

```text
┌─────────────────────────────────────────────────────────────────┐
│ Project title | Search | Undo/Redo | Save status | Export       │
├──────────────────────────────┬──────────────────────────────────┤
│                              │                                  │
│ PDF Viewer                   │ Research Canvas                  │
│                              │                                  │
│ Pages, zoom, text selection  │ Excerpts, notes, links, ink      │
│ Highlights and comments      │ Pan, zoom, drag and resize       │
│                              │                                  │
└──────────────────────────────┴──────────────────────────────────┘
```

The divider should be resizable. On small screens, use an intentional tab/split navigation model rather than squeezing both panels.

## 5.5 UX requirements

- Preserve text selection when annotation and canvas tools are active.
- Distinguish source excerpts from user-authored notes.
- Show source document and page for each excerpt.
- Support undo/redo for workspace edits where feasible.
- Debounce autosave but show pending and failed changes.
- Handle network loss and reconnect without silently discarding edits.
- Avoid losing canvas positions after zoom, resize, or reload.
- Provide keyboard alternatives for core interactions.
- Respect reduced-motion preferences.
- Keep dialogs, menus, tooltips, and focus management accessible.

## 5.6 Accessibility and responsiveness

Target WCAG 2.2 AA. Verify keyboard access, focus visibility, labels, contrast, zoom, screen-reader behavior, and reduced motion. Test at phone, tablet, laptop, and wide-desktop widths.

## 5.7 Performance

- Paginate document and project lists.
- Avoid loading every page's extracted text at once.
- Use virtualized lists where justified.
- Avoid re-rendering every canvas object on each pointer movement.
- Test large PDFs and dense workspaces on modest hardware.
- Use thumbnails and worker processing carefully.
- Profile before adopting complex caching or rendering optimizations.

## 5.8 Visual acceptance criteria

The design is accepted when all primary screens share a consistent design system, text remains readable, PDF selection works, canvas actions do not interfere with reading, mobile layouts are usable, and accessibility checks have documented results.
