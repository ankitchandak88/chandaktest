import 'dart:typed_data';
import 'package:flutter/material.dart';
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

enum _AnnotationTool { select, comment }

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

  // Maps a live Syncfusion Annotation instance (identity-keyed, these don't
  // override ==) back to our backend row id, so tapping one to delete it can
  // also delete the right backend record - Syncfusion's own API only ever
  // hands back the Annotation object itself (onAnnotationSelected), not an
  // external id.
  final Map<Annotation, String> _backendIdByLiveAnnotation = {};

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

    for (final a in annotations) {
      _renderExistingAnnotation(a);
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
    } catch (err) {
      if (!mounted) return;
      _controller.removeAnnotation(live);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
    }

    if (mounted) setState(() => _tool = _AnnotationTool.select);
  }

  Future<void> _handleAnnotationSelected(Annotation annotation) async {
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

    _controller.removeAnnotation(annotation);
    _backendIdByLiveAnnotation.remove(annotation);

    try {
      await ProjectApi.deleteAnnotation(backendId);
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
    }
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

  @override
  Widget build(BuildContext context) {
    final hasSelection = _selectedText?.isNotEmpty ?? false;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.document.originalFilename),
        actions: [
          IconButton(
            tooltip: 'Add comment',
            icon: Icon(
              Icons.comment,
              color: _tool == _AnnotationTool.comment ? Theme.of(context).colorScheme.primary : null,
            ),
            onPressed: () => setState(() {
              _tool = _tool == _AnnotationTool.comment ? _AnnotationTool.select : _AnnotationTool.comment;
              _controller.clearSelection();
            }),
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
      body: FutureBuilder<Uint8List>(
        future: _bytes,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snapshot.hasError || !snapshot.hasData) {
            return const Center(child: Text('Could not load this PDF.'));
          }

          return SfPdfViewer.memory(
            snapshot.data!,
            key: _pdfViewerKey,
            controller: _controller,
            enableTextSelection: true,
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
        },
      ),
    );
  }
}
