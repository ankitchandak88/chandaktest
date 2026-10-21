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

const _penColors = [Colors.white, Colors.redAccent, Colors.blueAccent, Colors.greenAccent, Colors.amber];
const _highlighterColors = [Colors.yellow, Colors.lightGreenAccent, Colors.lightBlueAccent, Colors.pinkAccent, Colors.orangeAccent];
const _penSize = 0.004;
const _highlighterSize = 0.016;

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

  Future<void> _loadAnnotations() async {
    final annotations = await ProjectApi.listAnnotations(widget.document.id);
    if (!mounted) return;

    setState(() => _annotations = annotations);

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
    setState(() => _annotations = _annotations.where((a) => a.id != backendId).toList());

    ProjectApi.deleteAnnotation(backendId).catchError((err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
    });
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
  // single-page layout mode forced while any drawing tool is active, see
  // build()) to 0-1 page-normalized coordinates, by computing the same
  // "fit page within viewport, centered" rect Syncfusion itself renders the
  // page into. Returns null if the point fell in the letterboxed margin
  // outside the actual page. NOT YET LIVE-VERIFIED ON A REAL DEVICE as of
  // writing (see docs/PROGRESS.md) - this is the one piece of this phase
  // that needs an on-device check before being trusted; the math is
  // isolated here and in _pageRectInViewport so it's a small, easy place to
  // recalibrate if a real stroke doesn't land where drawn.
  Rect _pageRectInViewport(Size viewport, Size pageSize) {
    final scale = (viewport.width / pageSize.width < viewport.height / pageSize.height)
        ? viewport.width / pageSize.width
        : viewport.height / pageSize.height;
    final displayedW = pageSize.width * scale;
    final displayedH = pageSize.height * scale;
    final offsetX = (viewport.width - displayedW) / 2;
    final offsetY = (viewport.height - displayedH) / 2;
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
          hit = points.any((p) {
            final px = (p[0] as num).toDouble();
            final py = (p[1] as num).toDouble();
            final dx = (px - n.dx) * pageRect.width;
            final dy = (py - n.dy) * pageRect.height;
            return (dx * dx + dy * dy) < thresholdPx * thresholdPx;
          });
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
    setState(() {
      _tool = tool;
      _controller.clearSelection();
      _lassoSelection = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final hasSelection = _selectedText?.isNotEmpty ?? false;
    final drawingActive = _isDrawingTool(_tool);

    return Scaffold(
      appBar: AppBar(title: Text(widget.document.originalFilename)),
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
            // Drawing mode forces single-page layout: Syncfusion fits the
            // whole page within the viewport with no scroll overflow, which
            // is what makes _pageRectInViewport's fit-math valid (continuous
            // mode's per-page vertical offset within the long scroll isn't
            // exposed by any public API).
            pageLayoutMode: drawingActive ? PdfPageLayoutMode.single : PdfPageLayoutMode.continuous,
            onDocumentLoaded: (_) => _loadAnnotations(),
            onTextSelectionChanged: (details) {
              setState(() {
                _selectedText = details.selectedText;
                _selectedPage = _controller.pageNumber;
              });
            },
            onTap: _handlePageTapForComment,
            onAnnotationSelected: _handleAnnotationSelected,
          );

          if (!drawingActive) return viewer;

          return Stack(
            children: [
              viewer,
              Positioned.fill(
                child: LayoutBuilder(
                  builder: (context, constraints) {
                    final viewportSize = Size(constraints.maxWidth, constraints.maxHeight);
                    return GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onPanDown: (d) => _handleDrawPointerDown(d.localPosition, viewportSize),
                      onPanUpdate: (d) => _handleDrawPointerMove(d.localPosition, viewportSize),
                      onPanEnd: (_) => _handleDrawPointerUp(),
                      child: CustomPaint(
                        size: viewportSize,
                        painter: _DrawingOverlayPainter(
                          pageNumber: _controller.pageNumber,
                          pageRect: _pageRectInViewport(viewportSize, _pageSize(_controller.pageNumber)),
                          annotations: _annotations,
                          activeStroke: _activeStroke,
                          activeColor: _tool == _AnnotationTool.pen ? _penColor : _highlighterColor,
                          activeSize: _tool == _AnnotationTool.pen ? _penSize : _highlighterSize,
                          activeOpacity: _tool == _AnnotationTool.highlighter ? 0.4 : 1,
                          lassoPoints: _lassoPoints,
                          lassoSelection: _lassoSelection ?? const [],
                        ),
                      ),
                    );
                  },
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

      final paint = Paint()
        ..color = (_colorFromHex(a.color) ?? Colors.white).withValues(alpha: isHighlighter ? 0.4 : 1)
        ..style = PaintingStyle.fill;
      canvas.drawPath(_strokePath(pts, strokeSize), paint);

      if (selected) {
        canvas.drawPath(
          _strokePath(pts, strokeSize),
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
