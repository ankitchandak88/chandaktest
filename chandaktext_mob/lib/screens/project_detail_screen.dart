import 'dart:async';
import 'dart:io';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import '../api/api_client.dart';
import '../api/project_api.dart';
import '../models/models.dart';
import 'pdf_reader_screen.dart';
import 'project_canvas.dart';
import '../widgets/citation_editor.dart';

class ProjectDetailScreen extends StatefulWidget {
  const ProjectDetailScreen({super.key, required this.project});

  final Project project;

  @override
  State<ProjectDetailScreen> createState() => _ProjectDetailScreenState();
}

class _ProjectDetailScreenState extends State<ProjectDetailScreen> {
  List<ReaderDocument> _documents = [];
  List<ResearchNote> _notes = [];
  List<Excerpt> _excerpts = [];
  PageMeta? _documentsMeta;
  PageMeta? _notesMeta;
  PageMeta? _excerptsMeta;
  bool _loadingMoreDocuments = false;
  bool _loadingMoreNotes = false;
  bool _loadingMoreExcerpts = false;
  bool _loading = true;
  bool _uploading = false;
  String? _exportMessage;
  Timer? _pollTimer;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() => _loading = true);
    final documents = await ProjectApi.listDocuments(widget.project.id);
    final notes = await ProjectApi.listNotes(widget.project.id);
    final excerpts = await ProjectApi.listExcerpts(widget.project.id);
    if (!mounted) return;
    setState(() {
      _documents = documents.data;
      _documentsMeta = documents.meta;
      _notes = notes.data;
      _notesMeta = notes.meta;
      _excerpts = excerpts.data;
      _excerptsMeta = excerpts.meta;
      _loading = false;
    });
    _scheduleDocumentPoll();
  }

  // Documents move processing -> ready/failed in the background (see
  // ProcessDocumentJob on the backend); poll gently while any loaded
  // document is still processing, same as the web app's refetchInterval.
  void _scheduleDocumentPoll() {
    _pollTimer?.cancel();
    if (_documents.any((d) => d.status == 'processing')) {
      _pollTimer = Timer(const Duration(milliseconds: 2500), () {
        if (mounted) _reload();
      });
    }
  }

  // BUG-006 (mobile): these endpoints are paginated (20/page) on the
  // backend, same as projects - without "Load more", anything past the
  // first page was silently invisible.
  Future<void> _loadMoreDocuments() async {
    final meta = _documentsMeta;
    if (meta == null || !meta.hasMore || _loadingMoreDocuments) return;
    setState(() => _loadingMoreDocuments = true);
    final result = await ProjectApi.listDocuments(widget.project.id, page: meta.currentPage + 1);
    if (!mounted) return;
    setState(() {
      _documents = [..._documents, ...result.data];
      _documentsMeta = result.meta;
      _loadingMoreDocuments = false;
    });
  }

  Future<void> _loadMoreExcerpts() async {
    final meta = _excerptsMeta;
    if (meta == null || !meta.hasMore || _loadingMoreExcerpts) return;
    setState(() => _loadingMoreExcerpts = true);
    final result = await ProjectApi.listExcerpts(widget.project.id, page: meta.currentPage + 1);
    if (!mounted) return;
    setState(() {
      _excerpts = [..._excerpts, ...result.data];
      _excerptsMeta = result.meta;
      _loadingMoreExcerpts = false;
    });
  }

  Future<void> _loadMoreNotes() async {
    final meta = _notesMeta;
    if (meta == null || !meta.hasMore || _loadingMoreNotes) return;
    setState(() => _loadingMoreNotes = true);
    final result = await ProjectApi.listNotes(widget.project.id, page: meta.currentPage + 1);
    if (!mounted) return;
    setState(() {
      _notes = [..._notes, ...result.data];
      _notesMeta = result.meta;
      _loadingMoreNotes = false;
    });
  }

  Future<void> _uploadPdf() async {
    final result = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf'],
    );
    final path = result?.files.single.path;
    if (path == null) return;

    setState(() => _uploading = true);
    try {
      await ProjectApi.uploadDocument(widget.project.id, File(path));
      await _reload();
    } catch (err) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(apiErrorMessage(err))));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _openDocument(ReaderDocument doc) async {
    // Reading a document can create excerpts (text selection -> save); the
    // Excerpts tab here needs those on return, same reasoning as the
    // projects list refreshing after a project visit.
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => PdfReaderScreen(document: doc)),
    );
    if (mounted) _reload();
  }

  Future<void> _addNote() async {
    final controller = TextEditingController();
    final content = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New note'),
        content: TextField(controller: controller, maxLines: 4, autofocus: true),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Add'),
          ),
        ],
      ),
    );

    if (content == null || content.isEmpty) return;

    final note = await ProjectApi.createNote(widget.project.id, content);
    await _placeOnCanvas('note', note.id);
    await _reload();
  }

  // A fresh excerpt/note has no workspace_item yet, so it would never
  // appear on the canvas (web's or this one) until positioned - matches
  // web's nextCanvasPosition() (ProjectWorkspacePage.tsx), with the same
  // small cascading offset so new cards don't all stack on top of each
  // other.
  Future<void> _placeOnCanvas(String itemType, String targetId) async {
    final offset = (DateTime.now().millisecondsSinceEpoch % 10) * 24.0;
    await ProjectApi.saveWorkspaceBatch(widget.project.id, [
      {'item_type': itemType, 'target_id': targetId, 'x': 40.0 + offset, 'y': 40.0 + offset},
    ]);
  }

  Future<void> _startExport() async {
    setState(() => _exportMessage = 'Export queued…');
    try {
      final job = await ProjectApi.startExport(widget.project.id);
      _pollExport(job['id'] as String);
    } catch (err) {
      setState(() => _exportMessage = apiErrorMessage(err));
    }
  }

  Future<void> _pollExport(String exportId) async {
    for (var i = 0; i < 20; i++) {
      await Future.delayed(const Duration(seconds: 1));
      final job = await ProjectApi.exportStatus(exportId);
      if (job['status'] == 'ready') {
        setState(() => _exportMessage = 'Export ready (download from the web app for now).');
        return;
      }
      if (job['status'] == 'failed') {
        setState(() => _exportMessage = 'Export failed: ${job['failure_reason']}');
        return;
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.project.name),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Documents'),
              Tab(text: 'Excerpts'),
              Tab(text: 'Notes'),
              Tab(text: 'Canvas'),
            ],
          ),
          actions: [
            IconButton(
              icon: const Icon(Icons.ios_share),
              tooltip: 'Export',
              onPressed: _startExport,
            ),
          ],
        ),
        body: Column(
          children: [
            if (_exportMessage != null)
              Container(
                width: double.infinity,
                color: Colors.cyan.withValues(alpha: 0.1),
                padding: const EdgeInsets.all(8),
                child: Text(_exportMessage!, textAlign: TextAlign.center),
              ),
            Expanded(
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : TabBarView(
                      children: [
                        _buildDocumentsTab(),
                        _buildExcerptsTab(),
                        _buildNotesTab(),
                        ProjectCanvas(
                          projectId: widget.project.id,
                          excerpts: _excerpts,
                          notes: _notes,
                          onTagsChanged: _reload,
                        ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _loadMoreButton({
    required PageMeta? meta,
    required int loadedCount,
    required bool loading,
    required VoidCallback onPressed,
  }) {
    if (!(meta?.hasMore ?? false)) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 16),
      child: Center(
        child: loading
            ? const CircularProgressIndicator()
            : OutlinedButton(
                onPressed: onPressed,
                child: Text('Load more ($loadedCount of ${meta!.total})'),
              ),
      ),
    );
  }

  Widget _buildDocumentsTab() {
    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: _reload,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (_documents.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 48),
                  child: Center(child: Text('No documents yet. Upload a PDF below.')),
                ),
              for (final doc in _documents)
                Card(
                  child: InkWell(
                    onTap: doc.status == 'ready' ? () => _openDocument(doc) : null,
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(doc.originalFilename, overflow: TextOverflow.ellipsis),
                          const SizedBox(height: 4),
                          Text(
                            doc.status == 'ready'
                                ? '${doc.pageCount ?? '?'} pages'
                                : doc.status == 'failed'
                                    ? 'Failed: ${doc.failureReason}'
                                    : 'Processing…',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                          if (doc.status == 'ready') ...[
                            const SizedBox(height: 6),
                            CitationEditor(
                              document: doc,
                              onUpdated: (updated) {
                                setState(() {
                                  final idx = _documents.indexWhere((d) => d.id == updated.id);
                                  if (idx != -1) _documents[idx] = updated;
                                });
                              },
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              _loadMoreButton(
                meta: _documentsMeta,
                loadedCount: _documents.length,
                loading: _loadingMoreDocuments,
                onPressed: _loadMoreDocuments,
              ),
            ],
          ),
        ),
        Positioned(
          right: 16,
          bottom: 16,
          child: FloatingActionButton.extended(
            onPressed: _uploading ? null : _uploadPdf,
            icon: _uploading
                ? const SizedBox(
                    height: 16,
                    width: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.upload_file),
            label: Text(_uploading ? 'Uploading…' : 'Upload PDF'),
          ),
        ),
      ],
    );
  }

  Widget _buildExcerptsTab() {
    if (_excerpts.isEmpty) {
      return const Center(child: Text('No excerpts yet. Select text in a document to save one.'));
    }
    return RefreshIndicator(
      onRefresh: _reload,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final excerpt in _excerpts)
            Card(
              child: ListTile(
                title: Text(excerpt.text, maxLines: 3, overflow: TextOverflow.ellipsis),
                subtitle: Text('Page ${excerpt.pageNumber}'),
              ),
            ),
          _loadMoreButton(
            meta: _excerptsMeta,
            loadedCount: _excerpts.length,
            loading: _loadingMoreExcerpts,
            onPressed: _loadMoreExcerpts,
          ),
        ],
      ),
    );
  }

  Widget _buildNotesTab() {
    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: _reload,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (_notes.isEmpty)
                const Padding(
                  padding: EdgeInsets.only(top: 48),
                  child: Center(child: Text('No notes yet.')),
                ),
              for (final note in _notes)
                Card(
                  child: ListTile(
                    title: Text(note.title ?? 'Note'),
                    subtitle: Text(note.content ?? '', maxLines: 3, overflow: TextOverflow.ellipsis),
                  ),
                ),
              _loadMoreButton(
                meta: _notesMeta,
                loadedCount: _notes.length,
                loading: _loadingMoreNotes,
                onPressed: _loadMoreNotes,
              ),
            ],
          ),
        ),
        Positioned(
          right: 16,
          bottom: 16,
          child: FloatingActionButton(onPressed: _addNote, child: const Icon(Icons.add)),
        ),
      ],
    );
  }
}
