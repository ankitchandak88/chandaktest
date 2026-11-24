# ChandakText: LiquidText-Superior Architecture & Implementation Plan

> **Objective:** Transform ChandakText from a disconnected document-and-tab viewer into an ultra-fluid, tactile research canvas that equals and surpasses LiquidText in speed, ergonomics, visual elegance, and synthesis capabilities.

---

## 1. Feature Status & Gap Analysis (12-Point Checklist)

All 12 items from the tracking matrix verified against current codebase:

| # | Feature | Current Codebase Status | Core Gap / Challenge | Target State ("Better Than LiquidText") | Status |
|---|---|---|---|---|---|
| **1** | **Comment Pin** | ✅ Complete | Distinct glowing bubble pin with comment preview on hover/tap, page-margin comment rail, and clickable comment list in side panel. | Web + Mobile glowing speech-bubble SVG pins, click-to-open, jump-to-page side drawers. | **VERIFIED & WORKING** |
| **2** | **HiLiteView & Squeeze Mode** | ✅ Complete | In-document accordion "Squeeze" mode (collapses non-annotated pages between highlights). | Interactive Squeeze mode toggles accordion strip across unhighlighted ranges; click-to-expand. | **VERIFIED & WORKING** |
| **3** | **Text Box Tool (Rich Styling)** | ✅ Complete | Rich text box (Bold, Italic, Underline, Font size, custom color swatches) movable anywhere on Canvas. | Floating toolbar, rich styling controls, formatted persistent render on canvas. | **VERIFIED & WORKING** |
| **4** | **Page Editor & Manager** | ✅ Complete | Visual thumbnail strip in Outline/Drawer where users can preview pages, inspect annotation density, and jump directly. | Responsive page grid thumbnail manager drawer on both Web and Mobile. | **VERIFIED & WORKING** |
| **5** | **Outline (TOC)** | ✅ Complete | Native TOC bookmark tree works in both Web and Mobile. | Visual hierarchy with progress indicator and jump-to-page preview thumbnail. | **VERIFIED & WORKING** |
| **6** | **Parallel / Split Document View** | ✅ Complete | Dual-document split viewer (`Doc A \| Doc B \| Workspace`) allowing cross-referencing and pulling excerpts from both into one canvas. | Side-by-side Dual Document view with compare dropdown selector. | **VERIFIED & WORKING** |
| **7** | **Document-to-Document Linking** | ✅ Complete | Extend `links.source_type` and `target_type` to accept `document`; add "Link to Document" picker in Document Header. | Backend + Frontend full document-to-document linking support. | **VERIFIED & WORKING** |
| **8** | **Search Across Documents** | ✅ Complete | Project-wide fulltext search indexes extracted text, excerpts, and annotations. Deep-links to page. | Visual highlight halo on page when arriving from search result. | **VERIFIED & WORKING** |
| **9** | **Freehand Ink (Pen/Highlighter)** | ✅ Complete | `perfect-freehand` with undo/redo stack on both Web and Mobile; stroke persistence. | Ink across canvas boundary with undo/redo stack. | **VERIFIED & WORKING** |
| **10** | **Syncing & Mindmap Auto-Layout** | ✅ Complete | Real-time optimistic UI + instant background auto-save status indicator with offline cache. | Auto-Layout button arranges connected excerpts & notes into structured hierarchical mindmaps. | **VERIFIED & WORKING** |
| **11** | **Text Selection Ergonomics** | ✅ Complete | Mobile text selection ergonomics with floating action pill bar, copy to clipboard, and haptics. | Center-docked floating pill bar with highlight, underline, excerpt, copy, and haptics. | **VERIFIED & WORKING** |
| **12** | **Inline Workspace (LiquidText-Style)** | ✅ Complete | **Unified Split Surface**: Left pane PDF Viewer + Right pane Canvas with draggable divider, drag excerpt from PDF straight to Canvas. | Direct HTML5 drag from PDF selection onto canvas with precise drop coordinate calculation. | **VERIFIED & WORKING** |

---

## 2. Architectural Blueprint for the Core "Liquid" Experience

### 2.1 Unified Split-Screen Workspace (Closing Gap 12)
Instead of forcing the user to switch tabs:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Header: Project Title | [Split Doc] | [Squeeze] | AI Co-Pilot | Export      │
├──────────────────────────────────────┬─┬────────────────────────────────────┤
│                                      │ │                                    │
│ PDF READING SURFACE                  │D│ RESEARCH CANVAS                    │
│                                      │I│                                    │
│ • Pages 1..N continuous scroll       │V│ • Infinite zoomable/pannable area  │
│ • Text selection with [Drag] handle  │I│ • Excerpt & Note cards             │
│ • Floating comment pins & ink        │D│ • Elastic Bezier Tethers to PDF    │
│ • "Pull" gesture -> drops to canvas  │E│ • Rich Text Boxes                  │
│ • Squeeze mode (collapsible spaces)  │R│ • Magnetic Idea Stacks             │
│                                      │ │                                    │
└──────────────────────────────────────┴─┴────────────────────────────────────┘
```
- **Web**: Replace tab toggling in `ProjectWorkspacePage.tsx` with a flexible CSS Grid / Flex split pane (`SplitPane` component) with a persistent divider.
- **Mobile**: Sliding persistent drawer or dual-pane tablet view so reading is never interrupted to see canvas cards.

### 2.2 Live Drag-to-Excerpt Physics & Elastic Tethers
1. **Direct Drag**:
   - When text is selected in PDF, a floating grab handle `⠿ Drag to Canvas` appears.
   - Dragging across the divider onto the canvas automatically instantiates an `ExcerptCard` at the exact mouse release coordinates `(canvasX, canvasY)` and persists it via `createExcerpt` + `saveWorkspaceBatch`.
2. **Elastic Bezier Tethers (Spring Lines)**:
   - Clicking or hovering an excerpt card renders an SVG cubic bezier ray starting from the card's anchor point to the exact `(x, y)` coordinate of the text on the active PDF page.
   - Simultaneously, the PDF container smoothly scrolls to center that paragraph and highlights it with a 1.5-second pulse glow.

### 2.3 Comment Pin Visibility & Rail (Closing Gap 1)
- **Root Cause**: The current comment marker is a single, hard-to-see 8px circle with low contrast against varied PDF backgrounds and no callout tail.
- **Fix**:
  1. Replace with an SVG Speech-Bubble Pin: 24x24 badge with icon `💬`, drop shadow, and high-contrast border.
  2. Add **Comment Margin Rail**: Right margin of PDF page displays comment avatars/previews aligning vertically with the comment location.
  3. Include a "Comments" filter in HiLiteView/Outline drawer listing all document comments with click-to-jump.

### 2.4 Text Box Tool with Rich Styling (Closing Gap 3)
- **Data Model**: Extend `WorkspaceItem` payload / create a `text_box` item type.
  - Store: `{ content: string, fontSize: number, bold: boolean, italic: boolean, underline: boolean, color: string, bgColor: string }`.
- **Canvas & Doc Integration**:
  - Toolbar adds `[T] Text Box` tool.
  - Click on Canvas (or Document) inserts an editable rich container with floating format bar (B, *I*, <u>U</u>, Font Size, Palette).

### 2.5 Document-to-Document Linking (Closing Gap 7)
- **Backend**:
  - Allow `links.source_type` and `target_type` to accept `'document'`.
- **Frontend**:
  - In Document Header / Overview, add a "Related Documents" chip bar.
  - Clicking "Link another Document" opens a quick picker of all PDFs in the current project, creating a bidirectional document link.

---

## 3. Phased Implementation Plan

### Batch 1: Immediate Fluidity & Bug Resolution
1. **Comment Pin Visibility Fix**:
   - Redesign pin in `PdfViewer.tsx` and `pdf_reader_screen.dart` with prominent 24px badge + tooltip.
   - Add comments tab to Outline/HiLite drawer so no comment is ever lost.
2. **Web Split-Screen Workspace (Phase 13 Foundation)**:
   - Convert `ProjectWorkspacePage.tsx` from tab navigation to a resizable dual-pane layout (`PdfViewer` on Left, `WorkspaceCanvas` on Right).
   - Add live tether bezier lines connecting canvas cards to their PDF coordinates.

### Batch 2: Expressive Tools & Selection Ergonomics
1. **Text Box Tool with Rich Styling (Phase 10)**:
   - Support Rich Text cards on canvas and document with formatting controls (Bold, Italic, Underline, Size, Color).
2. **Document-to-Document Linking (Phase 11)**:
   - Extend `Link` model to support `document` source/target; build the document linking modal and display linked document tags.
3. **Mobile Text Selection Ergonomics (Phase 9)**:
   - Implement custom tap handler layer for reliable double-tap (word) and triple-tap (line) selection without conflicting with Syncfusion drag handles.

### Batch 3: Pure "Liquid" Mechanics
1. **Direct Drag-from-Document-to-Canvas**:
   - HTML5 / Touch drag-and-drop from PDF text selection directly onto canvas cards.
2. **Parallel Dual-Document View (Phase 12)**:
   - Dual PDF reader split (`Doc 1 | Doc 2 | Canvas`).
3. **Document Accordion Squeeze (Pinch-to-Summarize)**:
   - Accordion collapse of un-highlighted pages to instantly review all annotations in continuous sequence.

### Batch 4: Page Management & AI Superpowers
1. **Page Editor**: Reorder and delete pages with backend PDF compilation.
2. **AI Cluster & Synthesis**: Generate syntheses and concept graphs from canvas cards.

---

## 4. Verification & Testing Strategy
- **Web Playwright / Cypress & Component Verification**:
  - Verify split pane resize responsiveness at 1280px, 1440px, and 1920px.
  - Verify comment pin click opens comment popover on both desktop and mobile resolutions.
  - Verify dragging an excerpt onto the canvas updates PostgreSQL batch positions correctly.
- **Mobile Device Verification**:
  - Live test on connected Android device via ADB for gesture conflicts, frame rates, and drawer animations.
