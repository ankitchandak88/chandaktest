import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:syncfusion_flutter_pdfviewer/pdfviewer.dart';
import '../api/api_client.dart';
import '../api/project_api.dart';
import '../models/models.dart';

class PdfReaderScreen extends StatefulWidget {
  const PdfReaderScreen({super.key, required this.document});

  final ReaderDocument document;

  @override
  State<PdfReaderScreen> createState() => _PdfReaderScreenState();
}

class _PdfReaderScreenState extends State<PdfReaderScreen> {
  final _controller = PdfViewerController();
  Future<Uint8List>? _bytes;
  String? _selectedText;
  int _selectedPage = 1;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _bytes = ProjectApi.downloadDocumentBytes(widget.document.id)
        .then((bytes) => Uint8List.fromList(bytes));
  }

  Future<void> _saveExcerpt() async {
    final text = _selectedText;
    if (text == null || text.isEmpty) return;

    setState(() => _saving = true);
    try {
      // Mobile MVP simplification (see docs/PROGRESS.md): precise
      // normalized source_rects (what the web viewer captures from the
      // DOM selection) aren't derived from Syncfusion's selection geometry
      // here yet - a full-page placeholder rect is stored instead, so the
      // excerpt still links back to the right document+page even though
      // on-page highlight positioning isn't pixel-accurate on mobile yet.
      final response = await ApiClient.instance.dio.post(
        '/projects/${widget.document.projectId}/excerpts',
        data: {
          'document_id': widget.document.id,
          'page_number': _selectedPage,
          'text': text,
          'source_rects': [
            {'x': 0.0, 'y': 0.0, 'width': 1.0, 'height': 1.0},
          ],
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
    return Scaffold(
      appBar: AppBar(title: Text(widget.document.originalFilename)),
      floatingActionButton: (_selectedText?.isNotEmpty ?? false)
          ? FloatingActionButton.extended(
              onPressed: _saving ? null : _saveExcerpt,
              icon: const Icon(Icons.bookmark_add),
              label: Text(_saving ? 'Saving…' : 'Save selection as excerpt'),
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
            controller: _controller,
            enableTextSelection: true,
            onTextSelectionChanged: (details) {
              setState(() {
                _selectedText = details.selectedText;
                _selectedPage = _controller.pageNumber;
              });
            },
          );
        },
      ),
    );
  }
}
