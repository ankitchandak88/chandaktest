import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:perfect_freehand/perfect_freehand.dart';
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

// Default (first) color must be visible against a white PDF page - code
// review caught that both platforms defaulted to a near-white pen color,
// which made the very first stroke a new user draws effectively invisible.
const _penColors = [Color(0xFF1E293B), Colors.redAccent, Colors.blueAccent, Colors.greenAccent, Colors.amber];
const _highlighterColors = [Colors.yellow, Colors.lightGreenAccent, Colors.lightBlueAccent, Colors.pinkAccent, Colors.orangeAccent];
const _penSize = 0.004;
const _highlighterSize = 0.016;

class _OutlineNode {
  _OutlineNode({required this.title, required this.pageNumber, required this.children});

  final String title;
  final int? pageNumber;
  final List<_OutlineNode> children;
}

class PdfReaderScreen extends StatefulWidget {
  const PdfReaderScreen({super.key, required this.document});

  final ReaderDocument document;

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
  Color _penColor = _penColors.first;
  Color _highlighterColor = _highlighterColors.first;

  // Every annotation for the currently loaded document - kept in full so
  // the drawing-mode overlay (ink rendering, eraser hit-testing, lasso
  // selection) can work from real payload data, alongside Syncfusion's own
  // native rendering of highlight/underline/comment (see
  // _renderExistingAnnotation).
  List<model.Annotation> _annotations = [];
  List<_OutlineNode> _outline = [];

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

  @override
  void initState() {
    super.initState();
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
    _pdfDoc?.dispose();
    super.dispose();
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

  Size _pageSize(int pageNumber) {
    final doc = _pdfDoc!;
    // PdfTextLine.pageNumber / addAnnotation's pageNumber are 1-based
    // (matches this app's own page_number convention everywhere else -
    // excerpts, notes, the backend column); PdfDocument.pages is 0-based.
    final page = doc.pages[pageNumber - 1];
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
    final color = type == 'highlight' ? Colors.yellow : Colors.lightBlue;

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

  void _deleteAnnotation(String backendId) {
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

  Future<void> _resyncAnnotations() async {
    _controller.removeAllAnnotations();
    _backendIdByLiveAnnotation.clear();
    _liveAnnotationByBackendId.clear();
    _inkPathCache.clear();
    await _loadAnnotations();
  }

  Future<void> _saveExcerpt() async {
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

      // Phase 7: without a workspace_item, this excerpt would never appear
      // on the canvas (web's or mobile's) - see
      // project_detail_screen.dart's _placeOnCanvas for the same reasoning.
      final excerptId = response.data['data']['id'] as String;
      final offset = (DateTime.now().millisecondsSinceEpoch % 10) * 24.0;
      await ProjectApi.saveWorkspaceBatch(widget.document.projectId, [
        {'item_type': 'excerpt', 'target_id': excerptId, 'x': 40.0 + offset, 'y': 40.0 + offset},
      ]);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Excerpt saved.')),
        );
        _controller.clearSelection();
        setState(() => _selectedText = null);
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
  void _showHighlightsSheet() {
    final highlights = _annotations.where((a) => a.type == 'highlight').toList()
      ..sort((a, b) => a.pageNumber.compareTo(b.pageNumber));

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        expand: false,
        builder: (context, scrollController) => highlights.isEmpty
            ? const Center(child: Text('No highlights yet.'))
            : ListView.builder(
                controller: scrollController,
                padding: const EdgeInsets.all(8),
                itemCount: highlights.length,
                itemBuilder: (context, i) {
                  final a = highlights[i];
                  return Card(
                    child: ListTile(
                      leading: CircleAvatar(backgroundColor: _colorFromHex(a.color) ?? Colors.yellow, radius: 8),
                      title: Text(a.payload['text'] as String? ?? '', maxLines: 2, overflow: TextOverflow.ellipsis),
                      subtitle: Text('Page ${a.pageNumber}'),
                      onTap: () {
                        Navigator.pop(context);
                        _jumpToPage(a.pageNumber);
                      },
                    ),
                  );
                },
              ),
      ),
    );
  }

  void _jumpToPage(int pageNumber) {
    _controller.jumpToPage(pageNumber);
  }

  @override
  Widget build(BuildContext context) {
    final hasSelection = _selectedText?.isNotEmpty ?? false;
    final drawingActive = _isDrawingTool(_tool);

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.document.originalFilename),
        actions: [
          IconButton(
            tooltip: 'Table of contents',
            icon: const Icon(Icons.toc),
            onPressed: _outline.isEmpty ? null : _showOutlineSheet,
          ),
          IconButton(
            tooltip: 'All highlights',
            icon: const Icon(Icons.border_color),
            onPressed: _showHighlightsSheet,
          ),
        ],
      ),
      floatingActionButton: hasSelection
          ? Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                FloatingActionButton.small(
                  heroTag: 'highlight',
                  backgroundColor: Colors.yellow,
                  onPressed: () => _createMarkupAnnotation('highlight'),
                  child: const Icon(Icons.border_color, color: Colors.black87),
                ),
                const SizedBox(height: 8),
                FloatingActionButton.small(
                  heroTag: 'underline',
                  backgroundColor: Colors.lightBlue,
                  onPressed: () => _createMarkupAnnotation('underline'),
                  child: const Icon(Icons.format_underlined, color: Colors.black87),
                ),
                const SizedBox(height: 8),
                FloatingActionButton.extended(
                  heroTag: 'excerpt',
                  onPressed: _saving ? null : _saveExcerpt,
                  icon: const Icon(Icons.bookmark_add),
                  label: Text(_saving ? 'Saving…' : 'Save as excerpt'),
                ),
              ],
            )
          : null,
      bottomNavigationBar: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_tool == _AnnotationTool.pen) _ColorRow(colors: _penColors, active: _penColor, onPick: (c) => setState(() => _penColor = c)),
            if (_tool == _AnnotationTool.highlighter)
              _ColorRow(colors: _highlighterColors, active: _highlighterColor, onPick: (c) => setState(() => _highlighterColor = c)),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
              child: Row(
                children: [
                  _ToolChip(label: 'Select', icon: Icons.touch_app, active: _tool == _AnnotationTool.select, onTap: () => _setTool(_AnnotationTool.select)),
                  _ToolChip(label: 'Pen', icon: Icons.edit, active: _tool == _AnnotationTool.pen, onTap: () => _setTool(_AnnotationTool.pen)),
                  _ToolChip(
                      label: 'Highlighter', icon: Icons.border_color, active: _tool == _AnnotationTool.highlighter, onTap: () => _setTool(_AnnotationTool.highlighter)),
                  _ToolChip(label: 'Lasso', icon: Icons.gesture, active: _tool == _AnnotationTool.lasso, onTap: () => _setTool(_AnnotationTool.lasso)),
                  _ToolChip(label: 'Eraser', icon: Icons.auto_fix_normal, active: _tool == _AnnotationTool.eraser, onTap: () => _setTool(_AnnotationTool.eraser)),
                  _ToolChip(label: 'Comment', icon: Icons.comment, active: _tool == _AnnotationTool.comment, onTap: () => _setTool(_AnnotationTool.comment)),
                ],
              ),
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
            // Always single-page (not just during drawing, a code-review
            // finding caught: ink strokes are only ever painted by the
            // CustomPaint overlay below, which this used to mount only
            // while a drawing tool was active - switching back to "Select"
            // made every pen/highlighter stroke disappear from view, even
            // though it was still saved). Single-page mode is what makes
            // _pageRectInViewport's fit-math valid at all (continuous
            // mode's per-page vertical offset within the long scroll isn't
            // exposed by any public API) - trading infinite-scroll reading
            // for page-by-page navigation throughout this screen, not just
            // while drawing, so that trade only has to be made once.
            pageLayoutMode: PdfPageLayoutMode.single,
            onDocumentLoaded: (_) => _loadAnnotations(),
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

          return Stack(
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
            ],
          );
        },
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
