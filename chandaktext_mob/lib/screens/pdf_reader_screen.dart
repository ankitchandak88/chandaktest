import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:perfect_freehand/perfect_freehand.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:syncfusion_flutter_pdfviewer/pdfviewer.dart';
import 'package:syncfusion_flutter_pdf/pdf.dart' as pdf;
import '../api/api_client.dart';
import '../api/project_api.dart';
// `Annotation` clashes with syncfusion_flutter_pdfviewer's own `Annotation`
// base class (HighlightAnnotation/UnderlineAnnotation/StickyNoteAnnotation
// all extend it, and it's the type `onAnnotationSelected` hands back) - our
// backend-record model is imported under a prefix (`model.Annotation`) just
// for that one name; every other models.dart type (ReaderDocument, etc.)
// stays unprefixed.
import '../models/models.dart' hide Annotation;
import '../models/models.dart' as model show Annotation;

enum _AnnotationTool { select, comment, pen, highlighter, eraser, lasso }

bool _isDrawingTool(_AnnotationTool tool) =>
    tool == _AnnotationTool.pen || tool == _AnnotationTool.highlighter || tool == _AnnotationTool.eraser || tool == _AnnotationTool.lasso;

// Drawing/Document/Workspace mode-tabs (matches the LiquidText reference
// screenshots the user compared against, same reasoning as web's
// PdfViewer.tsx ReaderMode) - Workspace isn't a mode this screen can
// render itself (it's the project-wide canvas, a separate screen reached
// via Navigator), so selecting it pops back and asks the caller to switch
// there instead (see PdfReaderScreen.onSwitchToWorkspace below).
enum _ReaderMode { drawing, document }

// Default (first) color must be visible against a white PDF page - code
// review caught that both platforms defaulted to a near-white pen color,
// which made the very first stroke a new user draws effectively invisible.
const _penColors = [Color(0xFF1E293B), Colors.redAccent, Colors.blueAccent, Colors.greenAccent, Colors.amber];
const _highlighterColors = [Colors.yellow, Colors.lightGreenAccent, Colors.lightBlueAccent, Colors.pinkAccent, Colors.orangeAccent];
const _penSize = 0.004;
const _highlighterSize = 0.016;

// Phase 5 (discoverability): same hint, same storage-key naming scheme as
// web's PdfViewer.tsx (localStorage there, SharedPreferences here) - shown
// once per device, pointing at the drawing toolbar, then dismissed for good.
const _annotationHintPrefsKey = 'chandaktext:annotation-toolbar-hint-dismissed';

class _UndoEntry {
  _UndoEntry({
    required this.id,
    required this.present,
    required this.pageNumber,
    required this.type,
    this.color,
    this.commentText,
    required this.payload,
  });

  String id;
  bool present;
  final int pageNumber;
  final String type;
  final String? color;
  final String? commentText;
  final Map<String, dynamic> payload;
}

class _OutlineNode {
  _OutlineNode({required this.title, required this.pageNumber, required this.children});

  final String title;
  final int? pageNumber;
  final List<_OutlineNode> children;
}

class PdfReaderScreen extends StatefulWidget {
  const PdfReaderScreen({super.key, required this.document, this.initialPage, this.onSwitchToWorkspace});

  final ReaderDocument document;

  // Phase 7: lets a search result open straight to the page it was found
  // on, same reasoning as web's PdfViewer `initialPage` prop.
  final int? initialPage;

  // Mode-tabs: tapping "Workspace" pops this screen and asks the caller
  // to switch to the project-wide canvas tab instead (see this file's
  // _ReaderMode docblock for why - Workspace isn't a mode this screen can
  // render itself).
  final VoidCallback? onSwitchToWorkspace;

  @override
  State<PdfReaderScreen> createState() => _PdfReaderScreenState();
}

class _PdfReaderScreenState extends State<PdfReaderScreen> {
  final _controller = PdfViewerController();
  final _pdfViewerKey = GlobalKey<SfPdfViewerState>();
  Future<Uint8List>? _bytes;
  pdf.PdfDocument? _pdfDoc;
  String? _selectedText;
  int _selectedPage = 1;
  bool _saving = false;
  _AnnotationTool _tool = _AnnotationTool.select;
  _ReaderMode _readerMode = _ReaderMode.document;
  Color _penColor = _penColors.first;
  Color _highlighterColor = _highlighterColors.first;
  // Color for the Highlight/Underline buttons on a text selection
  // (distinct from the Drawing-mode pen/highlighter colors above) - user
  // feedback: this used to be hardcoded (always yellow for highlight,
  // always light blue for underline) with no way to change it at all.
  Color _markupColor = _highlighterColors.first;
  bool _squeezeMode = false;

  // Every annotation for the currently loaded document - kept in full so
  // the drawing-mode overlay (ink rendering, eraser hit-testing, lasso
  // selection) can work from real payload data, alongside Syncfusion's own
  // native rendering of highlight/underline/comment (see
  // _renderExistingAnnotation).
  List<model.Annotation> _annotations = [];
  List<Excerpt> _documentExcerpts = [];
  List<_OutlineNode> _outline = [];

  List<int> get _allSqueezedPages {
    final set = <int>{
      ..._annotations.map((a) => a.pageNumber),
      ..._documentExcerpts.map((e) => e.pageNumber),
    };
    return set.toList()..sort();
  }

  // Undo/redo for drawing actions - same design as web's PdfViewer.tsx
  // UndoEntry: a single chronological stack (LIFO undo/redo always
  // guarantees whichever entry is being toggled is the most recent thing
  // that touched that annotation's id). `present` tracks whether it
  // currently exists server-side; `id` is only meaningful while true.
  final List<_UndoEntry> _undoStack = [];
  final List<_UndoEntry> _redoStack = [];

  // Maps a live Syncfusion Annotation instance (identity-keyed, these don't
  // override ==) back to our backend row id, so tapping one to delete it can
  // also delete the right backend record - Syncfusion's own API only ever
  // hands back the Annotation object itself (onAnnotationSelected), not an
  // external id. Kept alongside its inverse (id -> live object) since the
  // eraser hit-tests by payload data (giving an id) and then needs the live
  // object to actually remove it from the viewer.
  final Map<Annotation, String> _backendIdByLiveAnnotation = {};
  final Map<String, Annotation> _liveAnnotationByBackendId = {};

  // In-progress freehand stroke, normalized (0-1) page coordinates +
  // pressure - same payload convention as web's PdfViewer.tsx so a stroke
  // drawn on one platform renders identically on the other.
  final List<PointVector> _activeStroke = [];
  final List<Offset> _lassoPoints = [];
  final Set<String> _erasedThisDrag = {};
  List<String>? _lassoSelection;
  final Map<String, _CachedInkPath> _inkPathCache = {};

  // Starts hidden (not shown-then-hidden) so there's no visible flash while
  // SharedPreferences loads asynchronously - it only ever appears once
  // _loadAnnotationHintPreference confirms it hasn't been dismissed before.
  bool _showAnnotationHint = false;
  bool _showTabletSidebar = true;
  final ValueNotifier<int> _tabletSidebarNotifier = ValueNotifier<int>(0);

  @override
  void initState() {
    super.initState();
    _loadAnnotationHintPreference();
    _bytes = ProjectApi.downloadDocumentBytes(widget.document.id).then((bytes) {
      final typed = Uint8List.fromList(bytes);
      // Syncfusion's text-selection API (getSelectedTextLines) returns
      // bounds in the PDF's own point-space, the same space a `PdfDocument`
      // (the lower-level PDF object model, syncfusion_flutter_pdf) parsed
      // from the same bytes exposes via `pages[i].size` - this is how we
      // normalize a selection's bounds into the 0-1 page-fraction
      // convention the backend/web already use, per Syncfusion's own
      // documented pattern for `getSelectedTextLines()`.
      _pdfDoc = pdf.PdfDocument(inputBytes: typed);
      return typed;
    });
  }

  @override
  void dispose() {
    _tabletSidebarNotifier.dispose();
    _pdfDoc?.dispose();
    super.dispose();
  }

  Future<void> _loadAnnotationHintPreference() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    if (!(prefs.getBool(_annotationHintPrefsKey) ?? false)) {
      setState(() => _showAnnotationHint = true);
    }
  }

  Future<void> _dismissAnnotationHint() async {
    setState(() => _showAnnotationHint = false);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_annotationHintPrefsKey, true);
  }

  // Outline (Phase 3): the PDF's own embedded bookmark/TOC tree, read via
  // the lower-level PdfDocument object model (same `_pdfDoc` parsed for
  // page-size normalization elsewhere in this file) - `bookmark.destination
  // .page` is a PdfPage object, converted to a 1-based page number via
  // `pages.indexOf()` + 1 (matches this app's page_number convention
  // everywhere else).
  List<_OutlineNode> _buildOutline(pdf.PdfBookmarkBase root) {
    final nodes = <_OutlineNode>[];
    for (var i = 0; i < root.count; i++) {
      final bookmark = root[i];
      final destinationPage = bookmark.destination?.page;
      nodes.add(_OutlineNode(
        title: bookmark.title,
        pageNumber: destinationPage != null ? _pdfDoc!.pages.indexOf(destinationPage) + 1 : null,
        children: _buildOutline(bookmark),
      ));
    }
    return nodes;
  }

  Future<void> _loadAnnotations() async {
    try {
      final results = await Future.wait([
        ProjectApi.listAnnotations(widget.document.id),
        ProjectApi.listExcerpts(widget.document.projectId),
      ]);
      if (!mounted) return;

      final annotations = results[0] as List<model.Annotation>;
      final allExcerpts = (results[1] as Paginated<Excerpt>).data;
      final docExcerpts = allExcerpts.where((e) => e.documentId == widget.document.id).toList();

      setState(() {
        _annotations = annotations;
        _documentExcerpts = docExcerpts;
        _outline = _buildOutline(_pdfDoc!.bookmarks);
      });

      for (final a in annotations) {
        if (a.type != 'ink') {
          _renderExistingAnnotation(a);
        }
      }
    } catch (_) {
      final annotations = await ProjectApi.listAnnotations(widget.document.id);
      if (!mounted) return;
      setState(() {
        _annotations = annotations;
        _outline = _buildOutline(_pdfDoc!.bookmarks);
      });
      for (final a in annotations) {
        if (a.type != 'ink') {
          _renderExistingAnnotation(a);
        }
      }
    }
  }

  Size _pageSize(int pageNumber) {
    final doc = _pdfDoc!;
    // PdfTextLine.pageNumber / addAnnotation's pageNumber are 1-based
    // (matches this app's own page_number convention everywhere else -
    // excerpts, notes, the backend column); PdfDocument.pages is 0-based.
    //
    // Clamped (not a plain `pageNumber - 1` index) - found live on a real
    // device (RangeError, "Only valid value is 0: 1") for a real 3-page
    // PDF where this lower-level PdfDocument's own page count disagreed
    // with SfPdfViewer's: `_controller.pageNumber` had already reached 2
    // (page 2 of 3, per the high-level viewer) while this lower-level
    // parser's own `pages.count` was still 1. Root cause not fully
    // understood yet (flagged in docs/PROGRESS.md) - this clamp keeps the
    // ink-overlay's per-frame layout from crashing the build in the
    // meantime, at the cost of a possibly-misaligned overlay on whichever
    // page this parser hasn't resolved yet.
    final index = (pageNumber - 1).clamp(0, doc.pages.count - 1);
    final page = doc.pages[index];
    return page.size;
  }

  void _renderExistingAnnotation(model.Annotation a) {
    final size = _pageSize(a.pageNumber);

    if (a.type == 'highlight' || a.type == 'underline') {
      final rects = (a.payload['rects'] as List?) ?? [];
      final lines = rects.map((r) {
        final map = r as Map;
        return PdfTextLine(
          Rect.fromLTWH(
            (map['x'] as num).toDouble() * size.width,
            (map['y'] as num).toDouble() * size.height,
            (map['width'] as num).toDouble() * size.width,
            (map['height'] as num).toDouble() * size.height,
          ),
          a.payload['text'] as String? ?? '',
          a.pageNumber,
        );
      }).toList();

      if (lines.isEmpty) return;

      final live = a.type == 'highlight'
          ? HighlightAnnotation(textBoundsCollection: lines)
          : UnderlineAnnotation(textBoundsCollection: lines);
      live.color = _colorFromHex(a.color) ?? (a.type == 'highlight' ? Colors.yellow : Colors.lightBlue);
      _controller.addAnnotation(live);
      _backendIdByLiveAnnotation[live] = a.id;
      _liveAnnotationByBackendId[a.id] = live;
    } else if (a.type == 'comment') {
      final x = (a.payload['x'] as num?)?.toDouble() ?? 0;
      final y = (a.payload['y'] as num?)?.toDouble() ?? 0;
      final live = StickyNoteAnnotation(
        pageNumber: a.pageNumber,
        text: a.commentText ?? '',
        position: Offset(x * size.width, y * size.height),
        icon: PdfStickyNoteIcon.comment,
      );
      live.color = _colorFromHex(a.color) ?? Colors.pinkAccent;
      _controller.addAnnotation(live);
      _backendIdByLiveAnnotation[live] = a.id;
      _liveAnnotationByBackendId[a.id] = live;
    }
  }

  Color? _colorFromHex(String? hex) {
    if (hex == null) return null;
    final cleaned = hex.replaceFirst('#', '');
    final value = int.tryParse(cleaned, radix: 16);
    if (value == null) return null;
    return Color(0xFF000000 | value);
  }

  String _colorToHex(Color color) =>
      '#${(color.r * 255).round().toRadixString(16).padLeft(2, '0')}'
      '${(color.g * 255).round().toRadixString(16).padLeft(2, '0')}'
      '${(color.b * 255).round().toRadixString(16).padLeft(2, '0')}';

  Future<void> _createMarkupAnnotation(String type) async {
    final lines = _pdfViewerKey.currentState?.getSelectedTextLines() ?? [];
    if (lines.isEmpty) return;

    final pageNumber = lines.first.pageNumber;
    final size = _pageSize(pageNumber);
    // User-picked via the color row shown alongside the Highlight/Underline
    // buttons while text is selected - previously hardcoded to a single
    // fixed yellow/blue with no way to change it at all.
    final color = _markupColor;

    final live = type == 'highlight'
        ? HighlightAnnotation(textBoundsCollection: lines)
        : UnderlineAnnotation(textBoundsCollection: lines);
    live.color = color;
    _controller.addAnnotation(live);
    _controller.clearSelection();

    final text = lines.map((l) => l.text).join(' ');
    final rects = lines
        .map((l) => {
              'x': l.bounds.left / size.width,
              'y': l.bounds.top / size.height,
              'width': l.bounds.width / size.width,
              'height': l.bounds.height / size.height,
            })
        .toList();

    try {
      final saved = await ProjectApi.createAnnotation(
        widget.document.id,
        pageNumber: pageNumber,
        type: type,
        color: _colorToHex(color),
        payload: {'rects': rects, 'text': text},
      );
      _backendIdByLiveAnnotation[live] = saved.id;
      _liveAnnotationByBackendId[saved.id] = live;
      setState(() => _annotations = [..._annotations, saved]);
      _recordCreate(saved);
    } catch (err) {
      if (!mounted) return;
      _controller.removeAnnotation(live);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
    }

    if (mounted) setState(() => _selectedText = null);
  }

  Future<void> _handlePageTapForComment(PdfGestureDetails details) async {
    if (_tool != _AnnotationTool.comment) return;

    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: const Text('Add comment'),
        content: TextField(controller: controller, autofocus: true, maxLines: 3),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (text == null || text.isEmpty) return;

    final pageNumber = _controller.pageNumber;
    final size = _pageSize(pageNumber);
    const commentColor = Colors.pinkAccent;

    final live = StickyNoteAnnotation(
      pageNumber: pageNumber,
      text: text,
      position: details.pagePosition,
      icon: PdfStickyNoteIcon.comment,
    );
    live.color = commentColor;
    _controller.addAnnotation(live);

    try {
      final saved = await ProjectApi.createAnnotation(
        widget.document.id,
        pageNumber: pageNumber,
        type: 'comment',
        color: _colorToHex(commentColor),
        commentText: text,
        payload: {
          'x': details.pagePosition.dx / size.width,
          'y': details.pagePosition.dy / size.height,
        },
      );
      _backendIdByLiveAnnotation[live] = saved.id;
      _liveAnnotationByBackendId[saved.id] = live;
      setState(() => _annotations = [..._annotations, saved]);
      _recordCreate(saved);
    } catch (err) {
      if (!mounted) return;
      _controller.removeAnnotation(live);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
    }

    if (mounted) setState(() => _tool = _AnnotationTool.select);
  }

  Future<void> _handleAnnotationSelected(Annotation annotation) async {
    if (_tool != _AnnotationTool.select) return;
    final backendId = _backendIdByLiveAnnotation[annotation];
    if (backendId == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: const Text('Remove this annotation?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete', style: TextStyle(color: Colors.redAccent)),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    _deleteAnnotation(backendId);
  }

  // `record: false` is for undo/redo's own internal toggling (see
  // _toggleEntry) - recording that reversal as a NEW undoable action would
  // corrupt the stack (every undo would push its own undo, etc.). Every
  // other caller (eraser, lasso, the confirm-delete dialog) keeps the
  // default `record: true`.
  void _deleteAnnotation(String backendId, {bool record = true}) {
    if (record) {
      final match = _annotations.where((a) => a.id == backendId);
      if (match.isNotEmpty) _recordDelete(match.first);
    }

    final live = _liveAnnotationByBackendId.remove(backendId);
    if (live != null) {
      _controller.removeAnnotation(live);
      _backendIdByLiveAnnotation.remove(live);
    }
    _inkPathCache.remove(backendId);
    setState(() => _annotations = _annotations.where((a) => a.id != backendId).toList());

    ProjectApi.deleteAnnotation(backendId).catchError((err) {
      if (!mounted) return;
      // Code review finding: this is an optimistic removal (state/viewer
      // already updated above, before the backend call resolves) with no
      // rollback on failure - during an eraser drag or a lasso bulk-delete
      // (both loop-call this), a transient network error on one of several
      // DELETE calls would otherwise remove that one annotation from the
      // UI permanently for the session while the backend still has it.
      // Re-syncing from the server (rather than trying to surgically
      // reconstruct the one removed native Annotation object) corrects
      // local state back to whatever's actually true server-side.
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('${apiErrorMessage(err)} Re-syncing annotations.')),
      );
      _resyncAnnotations();
    });
  }

  void _recordCreate(model.Annotation created) {
    setState(() {
      _redoStack.clear();
      _undoStack.add(_UndoEntry(
        id: created.id,
        present: true,
        pageNumber: created.pageNumber,
        type: created.type,
        color: created.color,
        commentText: created.commentText,
        payload: created.payload,
      ));
    });
  }

  void _recordDelete(model.Annotation deleted) {
    setState(() {
      _redoStack.clear();
      _undoStack.add(_UndoEntry(
        id: deleted.id,
        present: false,
        pageNumber: deleted.pageNumber,
        type: deleted.type,
        color: deleted.color,
        commentText: deleted.commentText,
        payload: deleted.payload,
      ));
    });
  }

  // Both undo and redo perform the exact same toggle (delete if present,
  // recreate from the entry's own data if not) - they only differ in
  // which stack they pop from and push back onto (see _undo/_redo).
  Future<void> _toggleEntry(_UndoEntry entry) async {
    if (entry.present) {
      _deleteAnnotation(entry.id, record: false);
      entry.present = false;
      return;
    }

    final saved = await ProjectApi.createAnnotation(
      widget.document.id,
      pageNumber: entry.pageNumber,
      type: entry.type,
      color: entry.color,
      commentText: entry.commentText,
      payload: entry.payload,
    );
    setState(() => _annotations = [..._annotations, saved]);
    // Highlight/underline/comment render via a native Syncfusion overlay
    // object, not from `_annotations` directly (unlike ink) - without
    // this, a redo (or an undo of a delete) would persist correctly but
    // never actually become visible on the page.
    if (saved.type != 'ink') _renderExistingAnnotation(saved);
    entry.id = saved.id;
    entry.present = true;
  }

  Future<void> _undo() async {
    if (_undoStack.isEmpty) return;
    final entry = _undoStack.last;
    await _toggleEntry(entry);
    if (!mounted) return;
    setState(() {
      _undoStack.removeLast();
      _redoStack.add(entry);
    });
  }

  Future<void> _redo() async {
    if (_redoStack.isEmpty) return;
    final entry = _redoStack.last;
    await _toggleEntry(entry);
    if (!mounted) return;
    setState(() {
      _redoStack.removeLast();
      _undoStack.add(entry);
    });
  }

  Future<void> _resyncAnnotations() async {
    _controller.removeAllAnnotations();
    _backendIdByLiveAnnotation.clear();
    _liveAnnotationByBackendId.clear();
    _inkPathCache.clear();
    await _loadAnnotations();
  }

  Future<void> _saveExcerpt({String? tag}) async {
    final text = _selectedText;
    if (text == null || text.isEmpty) return;

    setState(() => _saving = true);
    try {
      // Real per-line selection bounds are available (getSelectedTextLines,
      // same source used for highlight/underline annotations above) - no
      // longer a full-page placeholder.
      final lines = _pdfViewerKey.currentState?.getSelectedTextLines() ?? [];
      final size = lines.isNotEmpty ? _pageSize(_selectedPage) : null;
      final rects = size != null
          ? lines
              .map((l) => {
                    'x': l.bounds.left / size.width,
                    'y': l.bounds.top / size.height,
                    'width': l.bounds.width / size.width,
                    'height': l.bounds.height / size.height,
                  })
              .toList()
          : [
              {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0},
            ];

      final response = await ApiClient.instance.dio.post(
        '/projects/${widget.document.projectId}/excerpts',
        data: {
          'document_id': widget.document.id,
          'page_number': _selectedPage,
          'text': text,
          'source_rects': rects,
        },
      );

      final excerptId = response.data['data']['id'] as String;

      if (tag != null && tag.isNotEmpty) {
        try {
          final tags = await ProjectApi.listTags(widget.document.projectId);
          final existing = tags.where((t) => t.name.toLowerCase() == tag.toLowerCase()).firstOrNull;
          String tagId;
          if (existing != null) {
            tagId = existing.id;
          } else {
            final created = await ProjectApi.createTag(widget.document.projectId, tag);
            tagId = created.id;
          }
          await ProjectApi.syncExcerptTags(excerptId, [tagId]);
        } catch (_) {}
      }

      // Phase 7: without a workspace_item, this excerpt would never appear
      // on the canvas (web's or mobile's) - see
      // project_detail_screen.dart's _placeOnCanvas for the same reasoning.
      final offset = (DateTime.now().millisecondsSinceEpoch % 10) * 24.0;
      await ProjectApi.saveWorkspaceBatch(widget.document.projectId, [
        {'item_type': 'excerpt', 'target_id': excerptId, 'x': 40.0 + offset, 'y': 40.0 + offset},
      ]);

      _documentExcerpts.add(
        Excerpt(
          id: excerptId,
          documentId: widget.document.id,
          pageNumber: _selectedPage,
          text: text,
          tags: tag != null ? [Tag(id: 'temp', name: tag)] : const [],
        ),
      );

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(tag != null ? '⚖️ $tag Excerpt saved to Canvas' : 'Excerpt saved.'),
            behavior: SnackBarBehavior.floating,
          ),
        );
        _controller.clearSelection();
        setState(() => _selectedText = null);
        _tabletSidebarNotifier.value++;
      }
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  // Maps a point local to the drawing overlay (same size as the viewport,
  // single-page layout mode, see build()) to 0-1 page-normalized
  // coordinates.
  //
  // Confirmed via Syncfusion's own source (single_page_view.dart /
  // pdfviewer.dart's `greyAreaSize`/`heightPercentage` handling) that
  // single-page mode at zoomLevel=1.0 fits the page to the viewport's
  // *width* exactly (not width-and-height "contain" - that was this
  // function's original, wrong assumption): offsetX is always 0 at that
  // zoom, and offsetY is a *centered* grey margin only when the page is
  // shorter than the viewport at that width-fit scale. `zoomLevel` is
  // folded in multiplicatively (code-review finding: the original version
  // ignored it entirely, so pinch-zooming before switching to a drawing
  // tool misaligned every subsequent stroke) so the overlay's *scale*
  // always tracks the live zoom (`build()` listens via
  // `onZoomLevelChanged` and rebuilds). What zooming still doesn't give us
  // is the resulting *pan* offset once zoomed/tall content overflows the
  // viewport - Syncfusion exposes no public API for a single page's
  // current pan position - so this deliberately assumes offsetY=0/no pan
  // in that case, which `build()` establishes as true for actual drawing
  // by resetting both scroll (`jumpToPage`) and zoom (`zoomLevel = 1.0`)
  // every time a drawing tool is selected. The known, narrow gap this
  // leaves: zooming in or panning within an overflowing page *while
  // passively reading* (not drawing) can still show already-saved ink
  // slightly offset until zoom is reset back to 1.0 - not yet
  // live-verified on a real device (see docs/PROGRESS.md); recalibrate
  // here first if a stroke doesn't land under the finger.
  Rect _pageRectInViewport(Size viewport, Size pageSize) {
    final scale = (viewport.width / pageSize.width) * _controller.zoomLevel;
    final displayedW = pageSize.width * scale;
    final displayedH = pageSize.height * scale;
    final offsetX = displayedW <= viewport.width ? (viewport.width - displayedW) / 2 : 0.0;
    final offsetY = displayedH <= viewport.height ? (viewport.height - displayedH) / 2 : 0.0;
    return Rect.fromLTWH(offsetX, offsetY, displayedW, displayedH);
  }

  Offset? _localToNormalized(Offset local, Size viewport, int pageNumber) {
    final pageRect = _pageRectInViewport(viewport, _pageSize(pageNumber));
    final nx = (local.dx - pageRect.left) / pageRect.width;
    final ny = (local.dy - pageRect.top) / pageRect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null;
    return Offset(nx, ny);
  }

  void _handleDrawPointerDown(Offset local, Size viewport) {
    final n = _localToNormalized(local, viewport, _controller.pageNumber);
    if (n == null) return;

    if (_tool == _AnnotationTool.pen || _tool == _AnnotationTool.highlighter) {
      setState(() => _activeStroke
        ..clear()
        ..add(PointVector(n.dx, n.dy, 0.5)));
    } else if (_tool == _AnnotationTool.lasso) {
      setState(() => _lassoPoints
        ..clear()
        ..add(n));
    } else if (_tool == _AnnotationTool.eraser) {
      _erasedThisDrag.clear();
    }
  }

  void _handleDrawPointerMove(Offset local, Size viewport) {
    final pageNumber = _controller.pageNumber;
    final n = _localToNormalized(local, viewport, pageNumber);
    if (n == null) return;

    if (_tool == _AnnotationTool.pen || _tool == _AnnotationTool.highlighter) {
      setState(() => _activeStroke.add(PointVector(n.dx, n.dy, 0.5)));
    } else if (_tool == _AnnotationTool.lasso) {
      setState(() => _lassoPoints.add(n));
    } else if (_tool == _AnnotationTool.eraser) {
      final pageRect = _pageRectInViewport(viewport, _pageSize(pageNumber));
      const thresholdPx = 18.0;

      for (final a in _annotations.where((a) => a.pageNumber == pageNumber)) {
        if (_erasedThisDrag.contains(a.id)) continue;

        bool hit = false;
        if (a.type == 'ink') {
          final points = (a.payload['points'] as List?) ?? [];
          final pixelPoints = points
              .map((p) => Offset((p[0] as num).toDouble() * pageRect.width, (p[1] as num).toDouble() * pageRect.height))
              .toList();
          final pointerPx = Offset(n.dx * pageRect.width, n.dy * pageRect.height);
          // Distance to each *segment*, not just each stored sample point
          // (code review finding) - a fast/sparse stroke can have a
          // visually continuous span between two stored points that's
          // nowhere near either point itself.
          hit = false;
          for (var i = 1; i < pixelPoints.length; i++) {
            if (_distanceToSegment(pointerPx, pixelPoints[i - 1], pixelPoints[i]) < thresholdPx) {
              hit = true;
              break;
            }
          }
        } else if (a.type == 'highlight' || a.type == 'underline') {
          final rects = (a.payload['rects'] as List?) ?? [];
          hit = rects.any((r) {
            final x = (r['x'] as num).toDouble();
            final y = (r['y'] as num).toDouble();
            final w = (r['width'] as num).toDouble();
            final h = (r['height'] as num).toDouble();
            return n.dx >= x && n.dx <= x + w && n.dy >= y && n.dy <= y + h;
          });
        }

        if (hit) {
          _erasedThisDrag.add(a.id);
          _deleteAnnotation(a.id);
        }
      }
    }
  }

  Future<void> _handleDrawPointerUp() async {
    if (_tool == _AnnotationTool.pen || _tool == _AnnotationTool.highlighter) {
      if (_activeStroke.length > 1) {
        final pageNumber = _controller.pageNumber;
        final isPen = _tool == _AnnotationTool.pen;
        final color = isPen ? _penColor : _highlighterColor;

        try {
          final saved = await ProjectApi.createAnnotation(
            widget.document.id,
            pageNumber: pageNumber,
            type: 'ink',
            color: _colorToHex(color),
            payload: {
              'points': _activeStroke.map((p) => [p.x, p.y, p.pressure ?? 0.5]).toList(),
              'size': isPen ? _penSize : _highlighterSize,
              'tool': isPen ? 'pen' : 'highlighter',
            },
          );
          setState(() => _annotations = [..._annotations, saved]);
          _recordCreate(saved);
        } catch (err) {
          if (!mounted) return;
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
        }
      }
      setState(() => _activeStroke.clear());
    } else if (_tool == _AnnotationTool.lasso) {
      if (_lassoPoints.length > 2) {
        final pageNumber = _controller.pageNumber;
        final ids = _annotations
            .where((a) => a.pageNumber == pageNumber)
            .where((a) {
              final anchor = _annotationAnchor(a);
              return anchor != null && _pointInPolygon(anchor, _lassoPoints);
            })
            .map((a) => a.id)
            .toList();
        setState(() => _lassoSelection = ids.isEmpty ? null : ids);
      }
      setState(() => _lassoPoints.clear());
    }
  }

  Offset? _annotationAnchor(model.Annotation a) {
    if (a.type == 'highlight' || a.type == 'underline') {
      final rects = (a.payload['rects'] as List?) ?? [];
      if (rects.isEmpty) return null;
      final r = rects.first;
      final x = (r['x'] as num).toDouble();
      final y = (r['y'] as num).toDouble();
      final w = (r['width'] as num).toDouble();
      final h = (r['height'] as num).toDouble();
      return Offset(x + w / 2, y + h / 2);
    }
    if (a.type == 'comment') {
      return Offset((a.payload['x'] as num).toDouble(), (a.payload['y'] as num).toDouble());
    }
    if (a.type == 'ink') {
      final points = (a.payload['points'] as List?) ?? [];
      if (points.isEmpty) return null;
      final mid = points[points.length ~/ 2];
      return Offset((mid[0] as num).toDouble(), (mid[1] as num).toDouble());
    }
    return null;
  }

  // Shortest distance from a point to the segment [a, b] - matches web's
  // identical helper in PdfViewer.tsx.
  double _distanceToSegment(Offset p, Offset a, Offset b) {
    final dx = b.dx - a.dx;
    final dy = b.dy - a.dy;
    final lengthSquared = dx * dx + dy * dy;
    final t = lengthSquared == 0 ? 0.0 : (((p.dx - a.dx) * dx + (p.dy - a.dy) * dy) / lengthSquared).clamp(0.0, 1.0);
    final closestX = a.dx + t * dx;
    final closestY = a.dy + t * dy;
    return (p - Offset(closestX, closestY)).distance;
  }

  bool _pointInPolygon(Offset point, List<Offset> polygon) {
    var inside = false;
    for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      final pi = polygon[i];
      final pj = polygon[j];
      final intersects = (pi.dy > point.dy) != (pj.dy > point.dy) &&
          point.dx < (pj.dx - pi.dx) * (point.dy - pi.dy) / (pj.dy - pi.dy) + pi.dx;
      if (intersects) inside = !inside;
    }
    return inside;
  }

  void _deleteLassoSelection() {
    final ids = _lassoSelection;
    if (ids == null) return;
    for (final id in ids) {
      _deleteAnnotation(id);
    }
    setState(() => _lassoSelection = null);
  }

  void _setTool(_AnnotationTool tool) {
    final enteringDrawingMode = !_isDrawingTool(_tool) && _isDrawingTool(tool);

    setState(() {
      _tool = tool;
      _controller.clearSelection();
      _lassoSelection = null;
    });

    if (enteringDrawingMode) {
      // _pageRectInViewport assumes the page starts top-left-aligned
      // (offset=0) and at zoomLevel=1.0 whenever content would otherwise
      // overflow the viewport, since Syncfusion's single-page pan offset
      // isn't readable through any public API - resetting both scroll
      // (jumpToPage) and zoom right before any drawing can happen is what
      // makes that assumption actually true for the interactive drawing
      // case (code-review finding: zoom wasn't reset here originally, so
      // pinch-zooming before switching to a drawing tool misaligned every
      // subsequent stroke).
      final pageNumber = _controller.pageNumber;
      _controller.zoomLevel = 1.0;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _controller.jumpToPage(pageNumber);
      });
    }
  }

  // Mode-tabs: entering Drawing gets you drawing immediately (auto-picks
  // the pen if you weren't already using a drawing tool); entering
  // Document hands reading/selection back immediately - same reasoning as
  // web's PdfViewer.switchReaderMode. Comment is deliberately excluded
  // from both resets, same as web.
  void _setReaderMode(_ReaderMode mode) {
    setState(() => _readerMode = mode);
    if (mode == _ReaderMode.drawing && _tool == _AnnotationTool.select) {
      _setTool(_AnnotationTool.pen);
    } else if (mode == _ReaderMode.document && _isDrawingTool(_tool)) {
      _setTool(_AnnotationTool.select);
    }
  }

  void _showOutlineSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        expand: false,
        builder: (sheetContext, scrollController) => ListView(
          controller: scrollController,
          padding: const EdgeInsets.all(8),
          children: _outline
              .map((n) => _OutlineTile(
                    node: n,
                    onJump: (pageNumber) {
                      Navigator.pop(sheetContext);
                      _jumpToPage(pageNumber);
                    },
                  ))
              .toList(),
        ),
      ),
    );
  }

  // HiLiteView (Phase 3): every highlight-type annotation across the whole
  // document, using the text already captured at creation time - no
  // reverse rect-to-text mapping, no new backend endpoint.
  //
  // Phase 6: two AI actions on top of the list - "Summarize my highlights"
  // and "Suggest highlights" (suggest-only, mirrors web's PdfViewer.tsx -
  // the model has no bounding-box info to hand back, so a suggestion is
  // just text for the reader to go find and highlight themselves).
  void _showHighlightsSheet() {
    final highlights = _annotations.where((a) => a.type == 'highlight').toList()
      ..sort((a, b) => a.pageNumber.compareTo(b.pageNumber));

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => DraggableScrollableSheet(
        initialChildSize: 0.7,
        expand: false,
        builder: (context, scrollController) => StatefulBuilder(
          builder: (context, setSheetState) {
            String? summary;
            List<String>? suggestions;
            var summarizing = false;
            var suggesting = false;

            Future<void> runSummarize() async {
              setSheetState(() => summarizing = true);
              try {
                final result = await ProjectApi.summarizeHighlights(widget.document.id);
                setSheetState(() {
                  summary = result;
                  summarizing = false;
                });
              } catch (err) {
                setSheetState(() => summarizing = false);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
                }
              }
            }

            Future<void> runSuggest() async {
              setSheetState(() => suggesting = true);
              try {
                final result = await ProjectApi.suggestHighlights(widget.document.id);
                setSheetState(() {
                  suggestions = result;
                  suggesting = false;
                });
              } catch (err) {
                setSheetState(() => suggesting = false);
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
                }
              }
            }

            return ListView(
              controller: scrollController,
              padding: const EdgeInsets.all(8),
              children: [
                OutlinedButton(
                  onPressed: summarizing ? null : runSummarize,
                  child: Text(summarizing ? 'Summarizing…' : '✨ AI: Summarize my highlights'),
                ),
                if (summary != null)
                  Card(
                    margin: const EdgeInsets.only(top: 8),
                    child: Padding(padding: const EdgeInsets.all(12), child: Text(summary!)),
                  ),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: suggesting ? null : runSuggest,
                  child: Text(suggesting ? 'Thinking…' : '✨ AI: Suggest highlights'),
                ),
                if (suggestions != null)
                  if (suggestions!.isEmpty)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: Text('No suggestions found.'),
                    )
                  else ...[
                    const Padding(
                      padding: EdgeInsets.only(top: 8, bottom: 4),
                      child: Text(
                        'Find and select these passages to highlight them yourself:',
                        style: TextStyle(fontSize: 12, color: Colors.grey),
                      ),
                    ),
                    for (final s in suggestions!)
                      Card(
                        child: Padding(padding: const EdgeInsets.all(12), child: Text('“$s”')),
                      ),
                  ],
                const Divider(height: 24),
                if (highlights.isEmpty)
                  const Center(child: Text('No highlights yet.'))
                else
                  for (final a in highlights)
                    Card(
                      child: ListTile(
                        leading: CircleAvatar(backgroundColor: _colorFromHex(a.color) ?? Colors.yellow, radius: 8),
                        title: Text(a.payload['text'] as String? ?? '', maxLines: 2, overflow: TextOverflow.ellipsis),
                        subtitle: Text('Page ${a.pageNumber}'),
                        onTap: () {
                          Navigator.pop(sheetContext);
                          _jumpToPage(a.pageNumber);
                        },
                      ),
                    ),
              ],
            );
          },
        ),
      ),
    );
  }

  void _showCommentsSheet() {
    final comments = _annotations.where((a) => a.type == 'comment').toList()
      ..sort((a, b) => a.pageNumber.compareTo(b.pageNumber));

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        expand: false,
        builder: (context, scrollController) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Document Comments (${comments.length})',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                  const Text('Tap to jump', style: TextStyle(fontSize: 12, color: Colors.grey)),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: comments.isEmpty
                  ? const Center(child: Text('No comments yet.'))
                  : ListView.builder(
                      controller: scrollController,
                      itemCount: comments.length,
                      padding: const EdgeInsets.all(8),
                      itemBuilder: (context, i) {
                        final c = comments[i];
                        return Card(
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: _colorFromHex(c.color) ?? Colors.pinkAccent,
                              radius: 12,
                              child: const Icon(Icons.comment, size: 14, color: Colors.white),
                            ),
                            title: Text(c.commentText ?? '', maxLines: 3, overflow: TextOverflow.ellipsis),
                            subtitle: Text('Page ${c.pageNumber}'),
                            onTap: () {
                              Navigator.pop(sheetContext);
                              _jumpToPage(c.pageNumber);
                            },
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  void _showPagesSheet() {
    final count = _controller.pageCount;
    if (count <= 0) return;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => DraggableScrollableSheet(
        initialChildSize: 0.65,
        maxChildSize: 0.9,
        minChildSize: 0.4,
        expand: false,
        builder: (context, scrollController) => Column(
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Document Pages ($count)',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                  const Text('Tap to jump', style: TextStyle(fontSize: 12, color: Colors.grey)),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: GridView.builder(
                controller: scrollController,
                padding: const EdgeInsets.all(16),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: 3,
                  crossAxisSpacing: 12,
                  mainAxisSpacing: 12,
                  childAspectRatio: 0.85,
                ),
                itemCount: count,
                itemBuilder: (context, index) {
                  final pageNum = index + 1;
                  final isCurrent = pageNum == _controller.pageNumber;
                  final pageAnnos = _annotations.where((a) => a.pageNumber == pageNum).length;

                  return InkWell(
                    borderRadius: BorderRadius.circular(12),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      _jumpToPage(pageNum);
                    },
                    child: Container(
                      decoration: BoxDecoration(
                        color: isCurrent
                            ? Theme.of(context).colorScheme.primaryContainer
                            : Theme.of(context).colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: isCurrent ? Theme.of(context).colorScheme.primary : Colors.white12,
                          width: isCurrent ? 2 : 1,
                        ),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.article_outlined,
                              size: 26,
                              color: isCurrent ? Theme.of(context).colorScheme.primary : Colors.white54),
                          const SizedBox(height: 4),
                          Text('Page $pageNum',
                              style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal)),
                          if (pageAnnos > 0)
                            Container(
                              margin: const EdgeInsets.only(top: 4),
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                              decoration: BoxDecoration(
                                color: Theme.of(context).colorScheme.secondary.withValues(alpha: 0.2),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                '$pageAnnos item${pageAnnos > 1 ? 's' : ''}',
                                style: TextStyle(
                                  fontSize: 9,
                                  color: Theme.of(context).colorScheme.secondary,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  void _jumpToPage(int pageNumber) {
    _controller.jumpToPage(pageNumber);
  }

  void _jumpToNextAnnotatedPage() {
    final pages = _allSqueezedPages;
    if (pages.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No annotations or excerpts found yet.')),
      );
      return;
    }
    final cur = _controller.pageNumber;
    final next = pages.firstWhere((p) => p > cur, orElse: () => pages.first);
    HapticFeedback.lightImpact();
    _jumpToPage(next);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Squeezed: Jumped to Page $next'),
        duration: const Duration(milliseconds: 900),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _jumpToPrevAnnotatedPage() {
    final pages = _allSqueezedPages;
    if (pages.isEmpty) return;
    final cur = _controller.pageNumber;
    final prev = pages.lastWhere((p) => p < cur, orElse: () => pages.last);
    HapticFeedback.lightImpact();
    _jumpToPage(prev);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Squeezed: Jumped to Page $prev'),
        duration: const Duration(milliseconds: 900),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _toggleSqueezeMode() {
    final pages = _allSqueezedPages;
    if (pages.isEmpty) {
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          icon: const Icon(Icons.compress, size: 36, color: Color(0xFF1E3A8A)),
          title: const Text('No Notes or Highlights Yet'),
          content: const Text(
            'Squeeze Mode brings all pages with highlights, comments, or excerpts side-by-side.\n\n'
            'Select any text in the document and tap "Highlight" or "Excerpt" to see pages squeeze together.',
            style: TextStyle(fontSize: 14),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Got it'),
            ),
          ],
        ),
      );
      return;
    }

    setState(() => _squeezeMode = !_squeezeMode);
    if (_squeezeMode) {
      HapticFeedback.mediumImpact();
      final cur = _controller.pageNumber;
      if (!pages.contains(cur)) {
        final next = pages.firstWhere((p) => p >= cur, orElse: () => pages.first);
        _jumpToPage(next);
      }
    }
  }

  void _showSqueezedOverviewSheet() {
    final pages = _allSqueezedPages;
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => DraggableScrollableSheet(
        initialChildSize: 0.7,
        maxChildSize: 0.9,
        minChildSize: 0.4,
        expand: false,
        builder: (context, scrollController) {
          return Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: const Color(0xFFCBD5E1),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(6),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFEF3C7),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Text('🤏', style: TextStyle(fontSize: 16)),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Squeezed Brief Notes',
                            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A)),
                          ),
                          Text(
                            '${pages.length} pages with notes across ${widget.document.originalFilename}',
                            style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 14),
                const Divider(height: 1, color: Color(0xFFE2E8F0)),
                const SizedBox(height: 10),
                Expanded(
                  child: ListView.separated(
                    controller: scrollController,
                    itemCount: pages.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final p = pages[index];
                      final pageAnnotations = _annotations.where((a) => a.pageNumber == p).toList();
                      final pageExcerpts = _documentExcerpts.where((e) => e.pageNumber == p).toList();

                      return Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: const Color(0xFFF8FAFC),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: const Color(0xFFE2E8F0)),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF1E3A8A),
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: Text(
                                    'Page $p',
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontSize: 12,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                                const Spacer(),
                                TextButton.icon(
                                  style: TextButton.styleFrom(
                                    visualDensity: VisualDensity.compact,
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  ),
                                  icon: const Icon(Icons.open_in_new, size: 14),
                                  label: const Text('Jump to Page', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                                  onPressed: () {
                                    Navigator.pop(sheetContext);
                                    _jumpToPage(p);
                                  },
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            for (final ex in pageExcerpts)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 6),
                                child: Container(
                                  padding: const EdgeInsets.all(8),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(color: const Color(0xFFCBD5E1)),
                                  ),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Text('❝ ', style: TextStyle(color: Color(0xFFD97706), fontSize: 16, fontWeight: FontWeight.bold)),
                                      Expanded(
                                        child: Text(
                                          ex.text,
                                          style: const TextStyle(fontSize: 12, color: Color(0xFF1E293B)),
                                          maxLines: 3,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            for (final an in pageAnnotations)
                              if (an.commentText != null && an.commentText!.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: Container(
                                    padding: const EdgeInsets.all(8),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFDF4FF),
                                      borderRadius: BorderRadius.circular(8),
                                      border: Border.all(color: const Color(0xFFF0ABFC)),
                                    ),
                                    child: Row(
                                      children: [
                                        const Icon(Icons.comment_outlined, size: 14, color: Color(0xFF9333EA)),
                                        const SizedBox(width: 6),
                                        Expanded(
                                          child: Text(
                                            an.commentText!,
                                            style: const TextStyle(fontSize: 12, color: Color(0xFF581C87)),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  void _showInlineWorkspaceSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => DraggableScrollableSheet(
        initialChildSize: 0.7,
        maxChildSize: 0.92,
        minChildSize: 0.4,
        expand: false,
        builder: (context, scrollController) {
          return FutureBuilder(
            future: Future.wait([
              ProjectApi.listExcerpts(widget.document.projectId),
              ProjectApi.listNotes(widget.document.projectId),
            ]),
            builder: (context, snapshot) {
              final excerpts = snapshot.hasData ? (snapshot.data![0] as Paginated<Excerpt>).data : <Excerpt>[];
              final notes = snapshot.hasData ? (snapshot.data![1] as Paginated<ResearchNote>).data : <ResearchNote>[];

              return Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Row(
                          children: [
                            const Text('🧠 ', style: TextStyle(fontSize: 18)),
                            Text('Canvas & Notes (${excerpts.length + notes.length})',
                                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold)),
                          ],
                        ),
                        TextButton.icon(
                          onPressed: () {
                            Navigator.pop(sheetContext);
                            Navigator.of(context).pop();
                            widget.onSwitchToWorkspace?.call();
                          },
                          icon: const Icon(Icons.open_in_new, size: 14),
                          label: const Text('Full Canvas', style: TextStyle(fontSize: 12)),
                        ),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  if (snapshot.connectionState == ConnectionState.waiting)
                    const Expanded(child: Center(child: CircularProgressIndicator()))
                  else if (excerpts.isEmpty && notes.isEmpty)
                    const Expanded(
                      child: Center(
                        child: Text('No excerpts or notes in workspace yet.', style: TextStyle(color: Colors.grey)),
                      ),
                    )
                  else
                    Expanded(
                      child: ListView(
                        controller: scrollController,
                        padding: const EdgeInsets.all(12),
                        children: [
                          if (excerpts.isNotEmpty) ...[
                            Padding(
                              padding: const EdgeInsets.only(left: 4, bottom: 8),
                              child: Text('EXCERPTS (${excerpts.length})',
                                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.amber)),
                            ),
                            ...excerpts.map((exc) => Card(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    side: const BorderSide(color: Colors.amber, width: 1.5),
                                  ),
                                  child: ListTile(
                                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                    title: Text(exc.text, maxLines: 3, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                                    subtitle: Text('Page ${exc.pageNumber}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                                    trailing: const Icon(Icons.arrow_forward_ios, size: 14, color: Colors.amber),
                                    onTap: () {
                                      Navigator.pop(sheetContext);
                                      _jumpToPage(exc.pageNumber);
                                      ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(content: Text('Jumped to excerpt on Page ${exc.pageNumber}')),
                                      );
                                    },
                                  ),
                                )),
                          ],
                          if (notes.isNotEmpty) ...[
                            Padding(
                              padding: const EdgeInsets.only(left: 4, top: 12, bottom: 8),
                              child: Text('NOTES (${notes.length})',
                                  style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.cyan)),
                            ),
                            ...notes.map((note) => Card(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(10),
                                    side: const BorderSide(color: Colors.cyan, width: 1.5),
                                  ),
                                  child: ListTile(
                                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                    title: Text(note.content ?? '', maxLines: 4, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13)),
                                  ),
                                )),
                          ],
                        ],
                      ),
                    ),
                ],
              );
            },
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final hasSelection = _selectedText?.isNotEmpty ?? false;
    final drawingActive = _isDrawingTool(_tool);
    final isTablet = MediaQuery.of(context).size.width >= 720;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.document.originalFilename),
        actions: [
          if (isTablet)
            IconButton(
              tooltip: _showTabletSidebar ? 'Hide Court Brief' : 'Show Court Brief',
              icon: Icon(_showTabletSidebar ? Icons.view_sidebar : Icons.view_sidebar_outlined),
              onPressed: () => setState(() => _showTabletSidebar = !_showTabletSidebar),
            ),
          IconButton(
            tooltip: _undoStack.isEmpty ? 'Nothing to undo' : 'Undo the last drawing action',
            icon: const Icon(Icons.undo),
            onPressed: _undoStack.isEmpty ? null : _undo,
          ),
          IconButton(
            tooltip: _redoStack.isEmpty ? 'Nothing to redo' : 'Redo the last undone action',
            icon: const Icon(Icons.redo),
            onPressed: _redoStack.isEmpty ? null : _redo,
          ),
        ],
      ),
      floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
      floatingActionButton: hasSelection
          ? Card(
              elevation: 12,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
              color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.96),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    _ColorRow(
                      colors: _highlighterColors,
                      active: _markupColor,
                      onPick: (c) => setState(() => _markupColor = c),
                    ),
                    const SizedBox(width: 6),
                    Container(width: 1, height: 22, color: Colors.white24),
                    const SizedBox(width: 6),
                    IconButton(
                      tooltip: 'Highlight',
                      icon: Icon(Icons.border_color, size: 20, color: _markupColor),
                      onPressed: () {
                        HapticFeedback.lightImpact();
                        _createMarkupAnnotation('highlight');
                      },
                    ),
                    IconButton(
                      tooltip: 'Underline',
                      icon: Icon(Icons.format_underlined, size: 20, color: _markupColor),
                      onPressed: () {
                        HapticFeedback.lightImpact();
                        _createMarkupAnnotation('underline');
                      },
                    ),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: Colors.amber.shade600,
                        foregroundColor: Colors.black87,
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      icon: const Icon(Icons.bookmark_add, size: 16),
                      label: Text(_saving ? '…' : 'Excerpt',
                          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      onPressed: _saving
                          ? null
                          : () {
                              HapticFeedback.mediumImpact();
                              _saveExcerpt();
                            },
                    ),
                    const SizedBox(width: 4),
                    PopupMenuButton<String>(
                      tooltip: 'Advocate Legal Stamp',
                      offset: const Offset(0, -170),
                      icon: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
                        decoration: BoxDecoration(
                          color: Colors.amber.shade700.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.amber.shade500.withValues(alpha: 0.5)),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: const [
                            Text('⚖️ Stamp', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.amber)),
                            Icon(Icons.arrow_drop_down, size: 14, color: Colors.amber),
                          ],
                        ),
                      ),
                      onSelected: (tag) {
                        HapticFeedback.mediumImpact();
                        _saveExcerpt(tag: tag);
                      },
                      itemBuilder: (context) => [
                        const PopupMenuItem(
                          value: 'Issue',
                          child: Text('⚖️ Legal Issue', style: TextStyle(color: Colors.blueAccent, fontWeight: FontWeight.bold)),
                        ),
                        const PopupMenuItem(
                          value: 'Precedent',
                          child: Text('📜 Precedent / Citation', style: TextStyle(color: Colors.purpleAccent, fontWeight: FontWeight.bold)),
                        ),
                        const PopupMenuItem(
                          value: 'Exhibit',
                          child: Text('🔍 Court Exhibit', style: TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold)),
                        ),
                        const PopupMenuItem(
                          value: 'Contradiction',
                          child: Text('⚠️ Contradiction', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ),
                    IconButton(
                      tooltip: 'Copy',
                      icon: const Icon(Icons.copy, size: 18),
                      onPressed: () {
                        HapticFeedback.lightImpact();
                        Clipboard.setData(ClipboardData(text: _selectedText ?? ''));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('Copied text to clipboard'),
                            duration: Duration(seconds: 1),
                            behavior: SnackBarBehavior.floating,
                          ),
                        );
                      },
                    ),
                    IconButton(
                      tooltip: 'Clear selection',
                      icon: const Icon(Icons.close, size: 18, color: Colors.grey),
                      onPressed: () {
                        setState(() => _selectedText = null);
                      },
                    ),
                  ],
                ),
              ),
            )
          : null,
      bottomNavigationBar: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_showAnnotationHint) _AnnotationHintBanner(onDismiss: _dismissAnnotationHint),
            if (_tool == _AnnotationTool.pen) _ColorRow(colors: _penColors, active: _penColor, onPick: (c) => setState(() => _penColor = c)),
            if (_tool == _AnnotationTool.highlighter)
              _ColorRow(colors: _highlighterColors, active: _highlighterColor, onPick: (c) => setState(() => _highlighterColor = c)),
            // Mode-tabs: this row is genuinely different per mode (not
            // reordered) - matches the LiquidText reference screenshots,
            // same reasoning as web's PdfViewer.tsx.
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
              child: Row(
                children: _readerMode == _ReaderMode.drawing
                    ? [
                        _ToolChip(label: 'Select', icon: Icons.touch_app, active: _tool == _AnnotationTool.select, onTap: () => _setTool(_AnnotationTool.select)),
                        _ToolChip(label: 'Pen', icon: Icons.edit, active: _tool == _AnnotationTool.pen, onTap: () => _setTool(_AnnotationTool.pen)),
                        _ToolChip(
                            label: 'Highlighter',
                            icon: Icons.border_color,
                            active: _tool == _AnnotationTool.highlighter,
                            onTap: () => _setTool(_AnnotationTool.highlighter)),
                        _ToolChip(label: 'Eraser', icon: Icons.auto_fix_normal, active: _tool == _AnnotationTool.eraser, onTap: () => _setTool(_AnnotationTool.eraser)),
                        _ToolChip(label: 'Lasso', icon: Icons.gesture, active: _tool == _AnnotationTool.lasso, onTap: () => _setTool(_AnnotationTool.lasso)),
                      ]
                    : [
                        _ToolChip(label: 'Canvas 🧠', icon: Icons.dashboard_outlined, active: false, onTap: _showInlineWorkspaceSheet),
                        _ToolChip(label: _squeezeMode ? 'Squeezed 🤏' : 'Squeeze', icon: Icons.compress, active: _squeezeMode, onTap: _toggleSqueezeMode),
                        _ToolChip(label: 'Comment', icon: Icons.comment, active: _tool == _AnnotationTool.comment, onTap: () => _setTool(_AnnotationTool.comment)),
                        _ToolChip(label: 'Comments', icon: Icons.comment_bank_outlined, active: false, onTap: _showCommentsSheet),
                        _ToolChip(label: 'Pages', icon: Icons.grid_view, active: false, onTap: _showPagesSheet),
                        _ToolChip(label: 'Next ✦', icon: Icons.skip_next, active: false, onTap: _jumpToNextAnnotatedPage),
                        _ToolChip(label: 'Outline', icon: Icons.toc, active: false, onTap: _showOutlineSheet),
                        _ToolChip(label: 'HiLiteView', icon: Icons.border_color, active: false, onTap: _showHighlightsSheet),
                      ],
              ),
            ),
            Row(
              children: [
                Expanded(
                  child: _ModeTab(
                    label: 'Drawing',
                    active: _readerMode == _ReaderMode.drawing,
                    onTap: () => _setReaderMode(_ReaderMode.drawing),
                  ),
                ),
                Expanded(
                  child: _ModeTab(
                    label: 'Document',
                    active: _readerMode == _ReaderMode.document,
                    onTap: () => _setReaderMode(_ReaderMode.document),
                  ),
                ),
                Expanded(
                  child: _ModeTab(
                    label: 'Workspace',
                    active: false,
                    onTap: () {
                      Navigator.of(context).pop();
                      widget.onSwitchToWorkspace?.call();
                    },
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
      body: FutureBuilder<Uint8List>(
        future: _bytes,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError || !snapshot.hasData) {
            return const Center(child: Text('Could not load this PDF.'));
          }

          final viewer = SfPdfViewer.memory(
            snapshot.data!,
            key: _pdfViewerKey,
            controller: _controller,
            enableTextSelection: !drawingActive,
            canShowTextSelectionMenu: false,
            pageLayoutMode: _readerMode == _ReaderMode.drawing
                ? PdfPageLayoutMode.single
                : PdfPageLayoutMode.continuous,
            scrollDirection: PdfScrollDirection.vertical,
            onDocumentLoaded: (_) {
              _loadAnnotations();
              if (widget.initialPage != null) _jumpToPage(widget.initialPage!);
            },
            onZoomLevelChanged: (_) => setState(() {}),
            onTextSelectionChanged: (details) {
              setState(() {
                _selectedText = details.selectedText;
                _selectedPage = _controller.pageNumber;
              });
            },
            onTap: _handlePageTapForComment,
            onAnnotationSelected: _handleAnnotationSelected,
          );

          final viewerStack = Stack(
            children: [
              viewer,
              // Ink overlay: always mounted (so saved strokes stay visible
              // outside drawing mode too) - only the GestureDetector that
              // captures new strokes is conditional on a drawing tool being
              // active.
              Positioned.fill(
                child: IgnorePointer(
                  ignoring: !drawingActive,
                  child: LayoutBuilder(
                    builder: (context, constraints) {
                      final viewportSize = Size(constraints.maxWidth, constraints.maxHeight);
                      final pageRect = _pageRectInViewport(viewportSize, _pageSize(_controller.pageNumber));
                      final painter = CustomPaint(
                        size: viewportSize,
                        painter: _DrawingOverlayPainter(
                          pageNumber: _controller.pageNumber,
                          pageRect: pageRect,
                          annotations: _annotations,
                          activeStroke: _activeStroke,
                          activeColor: _tool == _AnnotationTool.pen ? _penColor : _highlighterColor,
                          activeSize: _tool == _AnnotationTool.pen ? _penSize : _highlighterSize,
                          activeOpacity: _tool == _AnnotationTool.highlighter ? 0.4 : 1,
                          lassoPoints: _lassoPoints,
                          lassoSelection: _lassoSelection ?? const [],
                          pathCache: _inkPathCache,
                        ),
                      );

                      if (!drawingActive) return painter;

                      return GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onPanDown: (d) => _handleDrawPointerDown(d.localPosition, viewportSize),
                        onPanUpdate: (d) => _handleDrawPointerMove(d.localPosition, viewportSize),
                        onPanEnd: (_) => _handleDrawPointerUp(),
                        child: painter,
                      );
                    },
                  ),
                ),
              ),
              if (_lassoSelection != null)
                Positioned(
                  bottom: 16,
                  left: 0,
                  right: 0,
                  child: Center(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        borderRadius: BorderRadius.circular(999),
                        boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 8)],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text('${_lassoSelection!.length} selected', style: const TextStyle(fontSize: 12)),
                          const SizedBox(width: 12),
                          TextButton(onPressed: _deleteLassoSelection, child: const Text('Delete', style: TextStyle(color: Colors.redAccent))),
                          TextButton(onPressed: () => setState(() => _lassoSelection = null), child: const Text('Cancel')),
                        ],
                      ),
                    ),
                  ),
                ),
              if (_squeezeMode)
                Positioned(
                  top: 8,
                  left: 12,
                  right: 12,
                  child: Container(
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(color: const Color(0xFFD97706).withValues(alpha: 0.5)),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.12),
                          blurRadius: 16,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.all(6),
                              decoration: BoxDecoration(
                                color: const Color(0xFFFEF3C7),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: const Text('🤏', style: TextStyle(fontSize: 16)),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      const Text(
                                        'Squeeze Mode Active',
                                        style: TextStyle(
                                          fontWeight: FontWeight.w800,
                                          fontSize: 13,
                                          color: Color(0xFF78350F),
                                        ),
                                      ),
                                      const Spacer(),
                                      Text(
                                        '${_allSqueezedPages.length} active pages',
                                        style: const TextStyle(
                                          fontSize: 11,
                                          fontWeight: FontWeight.w700,
                                          color: Color(0xFFD97706),
                                        ),
                                      ),
                                    ],
                                  ),
                                  const Text(
                                    'Blank pages collapsed · Notes meet side-by-side',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w500,
                                      color: Color(0xFF92400E),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 6),
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(),
                              icon: const Icon(Icons.close, size: 18, color: Color(0xFF64748B)),
                              onPressed: () => setState(() => _squeezeMode = false),
                            ),
                          ],
                        ),
                        const SizedBox(height: 8),
                        // Horizontal ribbon of squeezed pages with 1-tap jumping
                        SizedBox(
                          height: 32,
                          child: ListView.separated(
                            scrollDirection: Axis.horizontal,
                            itemCount: _allSqueezedPages.length,
                            separatorBuilder: (_, __) => const SizedBox(width: 6),
                            itemBuilder: (context, index) {
                              final p = _allSqueezedPages[index];
                              final isCurrent = _controller.pageNumber == p;
                              return InkWell(
                                onTap: () => _jumpToPage(p),
                                borderRadius: BorderRadius.circular(8),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                                  decoration: BoxDecoration(
                                    color: isCurrent ? const Color(0xFF1E3A8A) : const Color(0xFFF1F5F9),
                                    borderRadius: BorderRadius.circular(8),
                                    border: Border.all(
                                      color: isCurrent ? const Color(0xFF1E3A8A) : const Color(0xFFCBD5E1),
                                    ),
                                  ),
                                  child: Text(
                                    'Page $p',
                                    style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w700,
                                      color: isCurrent ? Colors.white : const Color(0xFF334155),
                                    ),
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                style: OutlinedButton.styleFrom(
                                  visualDensity: VisualDensity.compact,
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                  side: const BorderSide(color: Color(0xFFCBD5E1)),
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                ),
                                icon: const Icon(Icons.list_alt, size: 14, color: Color(0xFF1E3A8A)),
                                label: const Text('All Squeezed Notes', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Color(0xFF1E3A8A))),
                                onPressed: _showSqueezedOverviewSheet,
                              ),
                            ),
                            const SizedBox(width: 8),
                            InkWell(
                              onTap: _jumpToPrevAnnotatedPage,
                              borderRadius: BorderRadius.circular(8),
                              child: Container(
                                padding: const EdgeInsets.all(6),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFF8FAFC),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: const Color(0xFFCBD5E1)),
                                ),
                                child: const Icon(Icons.chevron_left, size: 16, color: Color(0xFF334155)),
                              ),
                            ),
                            const SizedBox(width: 4),
                            InkWell(
                              onTap: _jumpToNextAnnotatedPage,
                              borderRadius: BorderRadius.circular(8),
                              child: Container(
                                padding: const EdgeInsets.all(6),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFF8FAFC),
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border.all(color: const Color(0xFFCBD5E1)),
                                ),
                                child: const Icon(Icons.chevron_right, size: 16, color: Color(0xFF334155)),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          );

          if (isTablet && _showTabletSidebar) {
            return Row(
              children: [
                Expanded(
                  flex: 6,
                  child: viewerStack,
                ),
                const VerticalDivider(width: 1, thickness: 1, color: Colors.white12),
                Expanded(
                  flex: 4,
                  child: _TabletLegalSidebar(
                    projectId: widget.document.projectId,
                    onJumpToPage: _jumpToPage,
                    refreshNotifier: _tabletSidebarNotifier,
                  ),
                ),
              ],
            );
          }

          return viewerStack;
        },
      ),
    );
  }
}

class _TabletLegalSidebar extends StatefulWidget {
  const _TabletLegalSidebar({
    required this.projectId,
    required this.onJumpToPage,
    this.refreshNotifier,
  });

  final String projectId;
  final void Function(int page) onJumpToPage;
  final ValueNotifier<int>? refreshNotifier;

  @override
  State<_TabletLegalSidebar> createState() => _TabletLegalSidebarState();
}

class _TabletLegalSidebarState extends State<_TabletLegalSidebar> {
  String _filter = 'all';
  List<Excerpt> _excerpts = [];
  List<ResearchNote> _notes = [];
  bool _loading = true;
  final TextEditingController _noteCtrl = TextEditingController();
  bool _addingNote = false;
  double _fontSize = 15.0;

  @override
  void initState() {
    super.initState();
    _loadData();
    widget.refreshNotifier?.addListener(_loadData);
  }

  @override
  void dispose() {
    widget.refreshNotifier?.removeListener(_loadData);
    _noteCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    try {
      final results = await Future.wait([
        ProjectApi.listExcerpts(widget.projectId),
        ProjectApi.listNotes(widget.projectId),
      ]);
      if (!mounted) return;
      setState(() {
        _excerpts = (results[0] as Paginated<Excerpt>).data;
        _notes = (results[1] as Paginated<ResearchNote>).data;
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submitNote() async {
    final text = _noteCtrl.text.trim();
    if (text.isEmpty) return;
    setState(() => _addingNote = true);
    try {
      final note = await ProjectApi.createNote(widget.projectId, text);
      final offset = (DateTime.now().millisecondsSinceEpoch % 10) * 24.0;
      await ProjectApi.saveWorkspaceBatch(widget.projectId, [
        {'item_type': 'note', 'target_id': note.id, 'x': 80.0 + offset, 'y': 80.0 + offset},
      ]);
      _noteCtrl.clear();
      await _loadData();
    } catch (_) {
    } finally {
      if (mounted) setState(() => _addingNote = false);
    }
  }

  Color _tagColor(String tagName) {
    switch (tagName.toLowerCase()) {
      case 'issue':
        return Colors.blueAccent;
      case 'precedent':
        return Colors.purpleAccent;
      case 'exhibit':
        return Colors.greenAccent;
      case 'contradiction':
        return Colors.redAccent;
      default:
        return Colors.amber;
    }
  }

  @override
  Widget build(BuildContext context) {
    final surface = Theme.of(context).colorScheme.surface;

    final filteredExcerpts = _filter == 'notes'
        ? <Excerpt>[]
        : _filter == 'all'
            ? _excerpts
            : _excerpts.where((e) => e.tags.any((t) => t.name.toLowerCase() == _filter.toLowerCase())).toList();

    final showNotes = _filter == 'all' || _filter == 'notes';

    return Container(
      color: Theme.of(context).colorScheme.surfaceContainerLowest,
      child: Column(
        children: [
          // Header
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              color: surface,
              border: const Border(bottom: BorderSide(color: Colors.white12)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    const Text('⚖️ ', style: TextStyle(fontSize: 16)),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Court Workspace',
                          style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: Colors.amber),
                        ),
                        Text(
                          '${_excerpts.length} Excerpts · ${_notes.length} Notes',
                          style: const TextStyle(fontSize: 10, color: Colors.grey),
                        ),
                      ],
                    ),
                  ],
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextButton(
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                      onPressed: () {
                        setState(() {
                          if (_fontSize == 13.0) {
                            _fontSize = 15.0;
                          } else if (_fontSize == 15.0) {
                            _fontSize = 18.0;
                          } else {
                            _fontSize = 13.0;
                          }
                        });
                      },
                      child: Text(
                        _fontSize == 18.0 ? 'A++ Jumbo' : _fontSize == 15.0 ? 'A+ Large' : 'A Normal',
                        style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.amber),
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.refresh, size: 18),
                      tooltip: 'Reload workspace',
                      onPressed: _loadData,
                    ),
                  ],
                ),
              ],
            ),
          ),

          // Filter bar
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
            child: Row(
              children: [
                _filterChip('all', 'All (${_excerpts.length + _notes.length})'),
                _filterChip('exhibit', '🔍 Exhibits'),
                _filterChip('issue', '⚖️ Issues'),
                _filterChip('precedent', '📜 Precedents'),
                _filterChip('contradiction', '⚠️ Contradictions'),
                _filterChip('notes', '📝 Notes (${_notes.length})'),
              ],
            ),
          ),
          const Divider(height: 1, color: Colors.white12),

          // Quick Note Composer
          Padding(
            padding: const EdgeInsets.all(8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _noteCtrl,
                    style: const TextStyle(fontSize: 12),
                    decoration: InputDecoration(
                      hintText: 'Quick courtroom note / argument...',
                      hintStyle: const TextStyle(fontSize: 11, color: Colors.grey),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                      filled: true,
                      fillColor: surface,
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                    ),
                    onSubmitted: (_) => _submitNote(),
                  ),
                ),
                const SizedBox(width: 6),
                IconButton.filled(
                  icon: _addingNote
                      ? const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.send, size: 14),
                  onPressed: _addingNote ? null : _submitNote,
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.amber.shade700,
                    padding: const EdgeInsets.all(8),
                    minimumSize: Size.zero,
                  ),
                ),
              ],
            ),
          ),

          // Main list
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : (filteredExcerpts.isEmpty && (!showNotes || _notes.isEmpty))
                    ? Center(
                        child: Text(
                          _filter == 'all' ? 'No items in workspace yet.' : 'No items match this filter.',
                          style: const TextStyle(color: Colors.grey, fontSize: 12),
                        ),
                      )
                    : ListView(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        children: [
                          if (filteredExcerpts.isNotEmpty) ...[
                            ...filteredExcerpts.map((exc) {
                              final primaryTag = exc.tags.firstOrNull;
                              final borderCol = primaryTag != null ? _tagColor(primaryTag.name) : Colors.amber.shade600;
                              return Card(
                                margin: const EdgeInsets.only(bottom: 8),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8),
                                  side: BorderSide(color: borderCol.withValues(alpha: 0.7), width: 1.2),
                                ),
                                child: Padding(
                                  padding: const EdgeInsets.all(10),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Row(
                                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                        children: [
                                          if (primaryTag != null)
                                            Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                              decoration: BoxDecoration(
                                                color: borderCol.withValues(alpha: 0.15),
                                                borderRadius: BorderRadius.circular(4),
                                              ),
                                              child: Text(
                                                primaryTag.name.toUpperCase(),
                                                style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: borderCol),
                                              ),
                                            )
                                          else
                                            const Text('EXCERPT', style: TextStyle(fontSize: 9, fontWeight: FontWeight.bold, color: Colors.amber)),
                                          InkWell(
                                            onTap: () => widget.onJumpToPage(exc.pageNumber),
                                            borderRadius: BorderRadius.circular(4),
                                            child: Container(
                                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                              decoration: BoxDecoration(
                                                color: Colors.white10,
                                                borderRadius: BorderRadius.circular(4),
                                              ),
                                              child: Row(
                                                mainAxisSize: MainAxisSize.min,
                                                children: [
                                                  Text('Page ${exc.pageNumber}', style: const TextStyle(fontSize: 10, color: Colors.cyanAccent)),
                                                  const SizedBox(width: 2),
                                                  const Icon(Icons.arrow_forward, size: 10, color: Colors.cyanAccent),
                                                ],
                                              ),
                                            ),
                                          ),
                                        ],
                                      ),
                                      const SizedBox(height: 6),
                                      Text(
                                        exc.text,
                                        maxLines: 6,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(fontSize: _fontSize, height: 1.4),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            }),
                          ],
                          if (showNotes && _notes.isNotEmpty) ...[
                            Padding(
                              padding: const EdgeInsets.only(top: 8, bottom: 4, left: 4),
                              child: Text('NOTES (${_notes.length})', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.cyan)),
                            ),
                            ..._notes.map((note) => Card(
                                  margin: const EdgeInsets.only(bottom: 8),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(8),
                                    side: const BorderSide(color: Colors.cyan, width: 1.2),
                                  ),
                                  child: Padding(
                                    padding: const EdgeInsets.all(10),
                                    child: Text(
                                      note.content ?? '',
                                      maxLines: 6,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(fontSize: _fontSize, height: 1.4),
                                    ),
                                  ),
                                )),
                          ],
                        ],
                      ),
          ),
        ],
      ),
    );
  }

  Widget _filterChip(String key, String label) {
    final active = _filter == key;
    return Padding(
      padding: const EdgeInsets.only(right: 4),
      child: ChoiceChip(
        label: Text(label, style: TextStyle(fontSize: 10, fontWeight: active ? FontWeight.bold : FontWeight.normal)),
        selected: active,
        onSelected: (_) => setState(() => _filter = key),
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.symmetric(horizontal: 4),
      ),
    );
  }
}

class _AnnotationHintBanner extends StatelessWidget {
  const _AnnotationHintBanner({required this.onDismiss});

  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final primary = Theme.of(context).colorScheme.primary;
    return Container(
      margin: const EdgeInsets.fromLTRB(8, 8, 8, 0),
      padding: const EdgeInsets.fromLTRB(12, 8, 4, 8),
      decoration: BoxDecoration(
        color: primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: primary.withValues(alpha: 0.25)),
      ),
      child: Row(
        children: [
          const Text('✨', style: TextStyle(fontSize: 16)),
          const SizedBox(width: 8),
          Expanded(
            child: Text.rich(
              TextSpan(
                style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurface, height: 1.3),
                children: [
                  const TextSpan(text: 'New: draw, highlight, and annotate the page directly with '),
                  TextSpan(text: 'Pen', style: TextStyle(fontWeight: FontWeight.w600, color: primary)),
                  const TextSpan(text: ', '),
                  TextSpan(text: 'Highlighter', style: TextStyle(fontWeight: FontWeight.w600, color: primary)),
                  const TextSpan(text: ', and '),
                  TextSpan(text: 'Lasso', style: TextStyle(fontWeight: FontWeight.w600, color: primary)),
                  const TextSpan(text: ' below.'),
                ],
              ),
            ),
          ),
          IconButton(
            icon: Icon(Icons.close, size: 16, color: primary.withValues(alpha: 0.7)),
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
            tooltip: 'Dismiss',
            onPressed: onDismiss,
          ),
        ],
      ),
    );
  }
}

// Bottom-anchored mode switch (Drawing/Document/Workspace), three equal
// full-width segments - matches web's PdfViewer.tsx `ModeTab` and the
// LiquidText reference screenshots' bottom bar layout.
class _ModeTab extends StatelessWidget {
  const _ModeTab({required this.label, required this.active, required this.onTap});

  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = active ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.onSurfaceVariant;
    return InkWell(
      onTap: onTap,
      child: Container(
        color: active ? Theme.of(context).colorScheme.surfaceContainerHighest : null,
        padding: const EdgeInsets.symmetric(vertical: 10),
        alignment: Alignment.center,
        child: Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w500)),
      ),
    );
  }
}

class _ToolChip extends StatelessWidget {
  const _ToolChip({required this.label, required this.icon, required this.active, required this.onTap});

  final String label;
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = active ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.onSurfaceVariant;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: active ? Theme.of(context).colorScheme.primary.withValues(alpha: 0.15) : null,
            borderRadius: BorderRadius.circular(999),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 20, color: color),
              Text(label, style: TextStyle(fontSize: 10, color: color)),
            ],
          ),
        ),
      ),
    );
  }
}

class _ColorRow extends StatelessWidget {
  const _ColorRow({required this.colors, required this.active, required this.onPick});

  final List<Color> colors;
  final Color active;
  final ValueChanged<Color> onPick;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: colors
            .map(
              (c) => GestureDetector(
                onTap: () => onPick(c),
                child: Container(
                  margin: const EdgeInsets.symmetric(horizontal: 4),
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(
                    color: c,
                    shape: BoxShape.circle,
                    border: Border.all(color: active == c ? Colors.white : Colors.transparent, width: 2),
                  ),
                ),
              ),
            )
            .toList(),
      ),
    );
  }
}

class _CachedInkPath {
  _CachedInkPath(this.path, this.pageRect);
  final Path path;
  final Rect pageRect;
}

class _DrawingOverlayPainter extends CustomPainter {
  _DrawingOverlayPainter({
    required this.pageNumber,
    required this.pageRect,
    required this.annotations,
    required this.activeStroke,
    required this.activeColor,
    required this.activeSize,
    required this.activeOpacity,
    required this.lassoPoints,
    required this.lassoSelection,
    required this.pathCache,
  });

  final int pageNumber;
  final Rect pageRect;
  final List<model.Annotation> annotations;
  final List<PointVector> activeStroke;
  final Color activeColor;
  final double activeSize;
  final double activeOpacity;
  final List<Offset> lassoPoints;
  final List<String> lassoSelection;

  // Owned by the State (persists across repaints, unlike this painter
  // instance which is constructed fresh every build()) - code review
  // finding: without this, every pointer-move frame of an in-progress
  // stroke repainted the whole overlay, recomputing getStroke() for every
  // *existing* ink annotation on the page too, not just the active one.
  // Keyed by annotation id; invalidated per-entry if pageRect changed
  // since it was cached (zoom/orientation) - ink annotations are never
  // edited in place in this app (only created or deleted), so an id match
  // with a matching pageRect is sufficient to trust the cached Path.
  final Map<String, _CachedInkPath> pathCache;

  Path _strokePathFor(model.Annotation annotation, List<PointVector> points, double sizeFraction) {
    final cached = pathCache[annotation.id];
    if (cached != null && cached.pageRect == pageRect) {
      return cached.path;
    }

    final path = _strokePath(points, sizeFraction);
    pathCache[annotation.id] = _CachedInkPath(path, pageRect);
    return path;
  }

  Path _strokePath(List<PointVector> points, double sizeFraction) {
    final scaled = points
        .map((p) => PointVector(pageRect.left + p.x * pageRect.width, pageRect.top + p.y * pageRect.height, p.pressure))
        .toList();
    final outline = getStroke(
      scaled,
      options: StrokeOptions(size: sizeFraction * pageRect.width, thinning: 0.5, smoothing: 0.5, streamline: 0.5),
    );
    if (outline.isEmpty) return Path();

    final path = Path()..moveTo(outline.first.dx, outline.first.dy);
    for (var i = 0; i < outline.length; i++) {
      final next = outline[(i + 1) % outline.length];
      path.quadraticBezierTo(outline[i].dx, outline[i].dy, (outline[i].dx + next.dx) / 2, (outline[i].dy + next.dy) / 2);
    }
    path.close();
    return path;
  }

  @override
  void paint(Canvas canvas, Size size) {
    for (final a in annotations.where((a) => a.pageNumber == pageNumber && a.type == 'ink')) {
      final points = (a.payload['points'] as List?) ?? [];
      final pts = points.map((p) => PointVector((p[0] as num).toDouble(), (p[1] as num).toDouble(), (p[2] as num?)?.toDouble() ?? 0.5)).toList();
      final strokeSize = (a.payload['size'] as num?)?.toDouble() ?? _penSize;
      final isHighlighter = a.payload['tool'] == 'highlighter';
      final selected = lassoSelection.contains(a.id);

      final strokePath = _strokePathFor(a, pts, strokeSize);

      final paint = Paint()
        ..color = (_colorFromHex(a.color) ?? Colors.white).withValues(alpha: isHighlighter ? 0.4 : 1)
        ..style = PaintingStyle.fill;
      canvas.drawPath(strokePath, paint);

      if (selected) {
        canvas.drawPath(
          strokePath,
          Paint()
            ..color = const Color(0xFF38BDF8)
            ..style = PaintingStyle.stroke
            ..strokeWidth = 2,
        );
      }
    }

    if (activeStroke.length > 1) {
      canvas.drawPath(
        _strokePath(activeStroke, activeSize),
        Paint()
          ..color = activeColor.withValues(alpha: activeOpacity)
          ..style = PaintingStyle.fill,
      );
    }

    if (lassoPoints.length > 1) {
      final path = Path()..moveTo(pageRect.left + lassoPoints.first.dx * pageRect.width, pageRect.top + lassoPoints.first.dy * pageRect.height);
      for (final p in lassoPoints.skip(1)) {
        path.lineTo(pageRect.left + p.dx * pageRect.width, pageRect.top + p.dy * pageRect.height);
      }
      canvas.drawPath(
        path,
        Paint()
          ..color = const Color(0xFF38BDF8)
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.5,
      );
    }
  }

  Color? _colorFromHex(String? hex) {
    if (hex == null) return null;
    final cleaned = hex.replaceFirst('#', '');
    final value = int.tryParse(cleaned, radix: 16);
    if (value == null) return null;
    return Color(0xFF000000 | value);
  }

  @override
  bool shouldRepaint(covariant _DrawingOverlayPainter oldDelegate) => true;
}

class _OutlineTile extends StatelessWidget {
  const _OutlineTile({required this.node, required this.onJump});

  final _OutlineNode node;
  final ValueChanged<int> onJump;

  @override
  Widget build(BuildContext context) {
    if (node.children.isEmpty) {
      return ListTile(
        title: Text(node.title, maxLines: 1, overflow: TextOverflow.ellipsis),
        enabled: node.pageNumber != null,
        onTap: node.pageNumber != null ? () => onJump(node.pageNumber!) : null,
      );
    }

    return ExpansionTile(
      title: Text(node.title, maxLines: 1, overflow: TextOverflow.ellipsis),
      children: [
        if (node.pageNumber != null)
          ListTile(
            dense: true,
            title: const Text('Go to section'),
            onTap: () => onJump(node.pageNumber!),
          ),
        ...node.children.map((c) => Padding(
              padding: const EdgeInsets.only(left: 16),
              child: _OutlineTile(node: c, onJump: onJump),
            )),
      ],
    );
  }
}
