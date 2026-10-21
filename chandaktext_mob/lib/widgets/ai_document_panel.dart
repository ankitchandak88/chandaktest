import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../api/project_api.dart';
import '../models/models.dart';

class _ChatMessage {
  final String role; // 'user' | 'assistant'
  final String content;
  _ChatMessage(this.role, this.content);
}

/// Phase 11: mirrors web/src/components/AiDocumentPanel.tsx - summarize
/// (cached via ai_summary, ?force to recompute) + a small stateless chat
/// (client carries history, same as web). Backed by whatever AiProvider the
/// admin has configured (AI_PROVIDER env) - the default 'fake' driver
/// returns clearly-labeled canned text, so this works with no API key.
class AiDocumentPanel extends StatefulWidget {
  const AiDocumentPanel({super.key, required this.document, required this.onSummaryUpdated});

  final ReaderDocument document;
  final ValueChanged<String> onSummaryUpdated;

  @override
  State<AiDocumentPanel> createState() => _AiDocumentPanelState();
}

class _AiDocumentPanelState extends State<AiDocumentPanel> {
  bool _open = false;
  bool _summarizing = false;
  bool _chatting = false;
  String? _error;
  final List<_ChatMessage> _messages = [];
  final _draftController = TextEditingController();

  @override
  void dispose() {
    _draftController.dispose();
    super.dispose();
  }

  Future<void> _summarize({required bool force}) async {
    setState(() {
      _summarizing = true;
      _error = null;
    });
    try {
      final summary = await ProjectApi.summarizeDocument(widget.document.id, force: force);
      widget.onSummaryUpdated(summary);
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = apiErrorMessage(err, fallback: 'Could not generate a summary.'));
    } finally {
      if (mounted) setState(() => _summarizing = false);
    }
  }

  Future<void> _send() async {
    final message = _draftController.text.trim();
    if (message.isEmpty) return;

    setState(() {
      _error = null;
      _draftController.clear();
      _messages.add(_ChatMessage('user', message));
      _chatting = true;
    });

    try {
      final history = _messages
          .sublist(0, _messages.length - 1)
          .map((m) => {'role': m.role, 'content': m.content})
          .toList();
      final reply = await ProjectApi.chatAboutDocument(widget.document.id, message, history);
      if (!mounted) return;
      setState(() => _messages.add(_ChatMessage('assistant', reply)));
    } catch (err) {
      if (!mounted) return;
      setState(() => _error = apiErrorMessage(err, fallback: 'Could not get a reply.'));
    } finally {
      if (mounted) setState(() => _chatting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_open) {
      return TextButton(
        onPressed: () => setState(() => _open = true),
        style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 0)),
        child: const Text('Ask AI', style: TextStyle(fontSize: 11)),
      );
    }

    return Container(
      margin: const EdgeInsets.only(top: 6),
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey.shade700),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text('AI assistant', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
              ),
              GestureDetector(
                onTap: () => setState(() => _open = false),
                child: const Text('Close', style: TextStyle(fontSize: 11, color: Colors.grey)),
              ),
            ],
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(_error!, style: const TextStyle(fontSize: 11, color: Colors.redAccent)),
            ),
          const SizedBox(height: 6),
          Text(
            widget.document.aiSummary ?? 'No summary yet.',
            style: const TextStyle(fontSize: 11, color: Colors.white70),
          ),
          GestureDetector(
            onTap: _summarizing ? null : () => _summarize(force: widget.document.aiSummary != null),
            child: Text(
              _summarizing
                  ? 'Summarizing…'
                  : widget.document.aiSummary != null
                      ? 'Re-summarize'
                      : 'Summarize',
              style: const TextStyle(fontSize: 11, color: Colors.cyan),
            ),
          ),
          const Divider(height: 16),
          ConstrainedBox(
            constraints: const BoxConstraints(maxHeight: 140),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final m in _messages)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 2),
                      child: Text(
                        '${m.role == 'user' ? 'You' : 'AI'}: ${m.content}',
                        style: TextStyle(
                          fontSize: 11,
                          color: m.role == 'user' ? Colors.white70 : Colors.cyan,
                        ),
                      ),
                    ),
                  if (_chatting) const Text('Thinking…', style: TextStyle(fontSize: 11, color: Colors.grey)),
                ],
              ),
            ),
          ),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _draftController,
                  decoration: const InputDecoration(isDense: true, hintText: 'Ask about this document…'),
                  style: const TextStyle(fontSize: 12),
                  onSubmitted: (_) => _send(),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.send, size: 18),
                onPressed: _chatting ? null : _send,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
