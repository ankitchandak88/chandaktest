import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../api/project_api.dart';
import '../models/models.dart';

/// Phase 9: mobile counterpart of web/src/components/CitationEditor.tsx -
/// same backend endpoint and the same server-computed citation_apa/
/// citation_mla strings (App\Services\CitationFormatter), so formatting
/// logic is never duplicated here.
class CitationEditor extends StatefulWidget {
  const CitationEditor({super.key, required this.document, required this.onUpdated});

  final ReaderDocument document;
  final ValueChanged<ReaderDocument> onUpdated;

  @override
  State<CitationEditor> createState() => _CitationEditorState();
}

class _CitationEditorState extends State<CitationEditor> {
  bool _editing = false;
  bool _saving = false;
  late final Map<String, TextEditingController> _controllers;

  static const _fields = ['title', 'author', 'year', 'publisher', 'url'];

  @override
  void initState() {
    super.initState();
    final metadata = widget.document.citationMetadata ?? {};
    _controllers = {
      for (final field in _fields) field: TextEditingController(text: (metadata[field] ?? '').toString()),
    };
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final citation = <String, dynamic>{};
      for (final field in _fields) {
        final value = _controllers[field]!.text.trim();
        if (value.isNotEmpty) citation[field] = value;
      }
      final updated = await ProjectApi.updateDocumentCitation(
        widget.document.id,
        citation.isEmpty ? null : citation,
      );
      widget.onUpdated(updated);
      if (mounted) setState(() => _editing = false);
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_editing && widget.document.citationApa == null) {
      return TextButton(
        onPressed: () => setState(() => _editing = true),
        style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 0)),
        child: const Text('+ Add citation', style: TextStyle(fontSize: 11)),
      );
    }

    if (!_editing) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (widget.document.citationApa != null)
            Text('APA: ${widget.document.citationApa}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
          if (widget.document.citationMla != null)
            Text('MLA: ${widget.document.citationMla}', style: const TextStyle(fontSize: 11, color: Colors.grey)),
          TextButton(
            onPressed: () => setState(() => _editing = true),
            style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 0)),
            child: const Text('Edit citation', style: TextStyle(fontSize: 11)),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final field in _fields)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: TextField(
              controller: _controllers[field],
              decoration: InputDecoration(
                isDense: true,
                labelText: field == 'title' ? 'Title (required to generate a citation)' : field,
              ),
              style: const TextStyle(fontSize: 12),
            ),
          ),
        Row(
          children: [
            Expanded(
              child: OutlinedButton(
                onPressed: () => setState(() => _editing = false),
                child: const Text('Cancel'),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton(
                onPressed: _saving ? null : _save,
                child: Text(_saving ? 'Saving…' : 'Save'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
